import { describe, expect, it, vi } from "vitest";
import {
  refreshCatalog,
  catalogChanged,
} from "../../src/services/discovery/refresh";
import { discoverArcGIS } from "../../src/services/discovery/arcgis";
import type {
  Portal,
  PortalRun,
  DiscoveryReport,
} from "../../src/services/discovery/types";
import { dataset, metadata } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";
const now = "2026-11-04T14:00:00.000Z";
const portal: Portal = {
  id: "one",
  platform: "arcgis",
  root: "https://data.example.test/sharing/rest",
  organizationId: "org",
  publisher: "Test city",
  jurisdiction: "test",
  website: "https://data.example.test",
  evidenceUrl: "https://data.example.test",
  servicePrefixes: ["https://data.example.test/arcgis/rest/services/"],
};
const discovered = {
  ...dataset,
  id: `arcgis:${"a".repeat(32)}:0`,
  validationStatus: "discovered" as const,
  portalId: "one",
  verified: null,
  lastVerifiedAt: "2026-11-03T14:00:00.000Z",
};
function run(id = "one"): PortalRun {
  return {
    portalId: id,
    startedAt: now,
    finishedAt: now,
    complete: true,
    itemsScanned: 1,
    layersInspected: 1,
    datasetsFound: 1,
    totalItems: 1,
    nextStart: -1,
    issues: [],
  };
}
function setup() {
  const previous: DiscoveryReport = {
    ...emptyDiscovery,
    datasets: [discovered],
    lastSuccessfulRunAt: discovered.lastVerifiedAt,
  };
  const input = {
    portals: [portal],
    curated: [dataset],
    previous,
    options: { maxItems: 10, maxLayers: 10 },
  };
  const deps = {
    now: () => now,
    discover: vi.fn(async (source: Portal) => ({
      datasets: [{ ...discovered, lastVerifiedAt: now }],
      run: run(source.id),
    })),
    inspect: vi.fn(async () => ({ ...metadata, inspectedAt: now })),
  };
  return { input, deps };
}
describe("scheduled catalog refresh", () => {
  it("updates discovered metadata while keeping checked registry content separate", async () => {
    const { input, deps } = setup();
    const checkedBefore = structuredClone(input.curated);
    const updated = {
      ...discovered,
      category: "Parks",
      description: "Current source description",
      sourceUrl: "https://data.example.test/current",
      serviceUrl:
        "https://data.example.test/arcgis/rest/services/Moved/FeatureServer",
      lastVerifiedAt: now,
    };
    deps.discover.mockResolvedValue({ datasets: [updated], run: run() });
    const report = await refreshCatalog(input, deps);
    expect(report.datasets).toEqual([expect.objectContaining(updated)]);
    expect(report.refresh).toMatchObject({
      outcome: "success",
      changes: { updated: [discovered.id], added: [] },
    });
    expect(report.curatedUpdates?.[0].id).toBe(dataset.id);
    expect(report.curatedUpdates?.[0].validationStatus).toBe("curated");
    expect(input.curated).toEqual(checkedBefore);
    expect(report.lastSuccessfulRunAt).toBe(now);
  });
  it("publishes successful portals while retaining failed portal datasets and curated verification", async () => {
    const { input, deps } = setup();
    const older = {
      ...discovered,
      id: `arcgis:${"b".repeat(32)}:1`,
      portalId: "two",
      layerId: 1,
    };
    input.portals.push({ ...portal, id: "two" });
    input.previous.datasets.push(older);
    input.previous.curatedUpdates = [
      {
        ...dataset,
        lastVerifiedAt: discovered.lastVerifiedAt,
        fields: metadata.fields,
      },
    ];
    deps.discover.mockImplementation(async (p) => {
      if (p.id === "two") throw Error("Publisher HTTP 503");
      return { datasets: [{ ...discovered, lastVerifiedAt: now }], run: run() };
    });
    deps.inspect.mockRejectedValue(Error("Token required"));
    const report = await refreshCatalog(input, deps);
    expect(report.datasets.find((d) => d.id === older.id)).toMatchObject({
      id: older.id,
      lastVerifiedAt: older.lastVerifiedAt,
      verification: { status: "failed", errorType: "authorization" },
    });
    expect(report.complete).toBe(false);
    expect(report.refresh?.outcome).toBe("partial");
    expect(
      report.runs.find((r) => r.portalId === "two")?.issues[0].message,
    ).toBe("The source returned an unsuccessful HTTP response.");
    expect(report.curatedUpdates?.[0]).toMatchObject({
      lastVerifiedAt: discovered.lastVerifiedAt,
      fields: metadata.fields,
      verificationError: "The source requires authorization or refused access.",
    });
  });
  it("retains the last successful snapshot when all publishers fail", async () => {
    const { input, deps } = setup();
    deps.discover.mockRejectedValue(Error("offline"));
    deps.inspect.mockRejectedValue(Error("offline"));
    const report = await refreshCatalog(input, deps);
    expect(report.datasets.map((d) => d.id)).toEqual(
      input.previous.datasets.map((d) => d.id),
    );
    expect(report.refresh?.outcome).toBe("failed");
    expect(report.lastSuccessfulRunAt).toBe(input.previous.lastSuccessfulRunAt);
  });
  it("does not treat an unexpected empty response as a complete scan", async () => {
    const { input, deps } = setup();
    deps.discover.mockResolvedValue({
      datasets: [],
      run: {
        ...run(),
        itemsScanned: 0,
        layersInspected: 0,
        datasetsFound: 0,
        totalItems: 0,
      },
    });
    const report = await refreshCatalog(input, deps);
    expect(report.datasets.map((d) => d.id)).toEqual(
      input.previous.datasets.map((d) => d.id),
    );
    expect(report.complete).toBe(false);
    expect(report.runs[0].issues[0].message).toContain("Unexpected empty");
  });
  it("rejects duplicate identifiers before replacing prior metadata", async () => {
    const { input, deps } = setup();
    const previous = structuredClone(input.previous);
    deps.discover.mockResolvedValue({
      datasets: [discovered, { ...discovered, layerId: 9 }],
      run: run(),
    });
    await expect(refreshCatalog(input, deps)).rejects.toThrow("Duplicate");
    expect(input.previous).toEqual(previous);
  });
  it("deduplicates equivalent layer endpoints with different portal identifiers", async () => {
    const { input, deps } = setup();
    deps.discover.mockResolvedValue({
      datasets: [
        discovered,
        { ...discovered, id: `arcgis:${"c".repeat(32)}:0` },
      ],
      run: run(),
    });
    const report = await refreshCatalog(input, deps);
    expect(report.datasets).toHaveLength(1);
  });
  it("skips same-day timestamp-only churn but publishes new daily verification or changed metadata", async () => {
    const { input, deps } = setup();
    const first = await refreshCatalog(input, deps);
    const later = "2026-11-04T15:00:00.000Z";
    deps.now = () => later;
    deps.discover.mockResolvedValue({
      datasets: [{ ...discovered, lastVerifiedAt: later }],
      run: { ...run(), startedAt: later, finishedAt: later },
    });
    deps.inspect.mockResolvedValue({ ...metadata, inspectedAt: later });
    const next = await refreshCatalog({ ...input, previous: first }, deps);
    expect(catalogChanged(first, next)).toBe(false);
    expect(
      catalogChanged(first, {
        ...next,
        generatedAt: "2026-11-05T09:17:00.000Z",
      }),
    ).toBe(true);
    expect(
      catalogChanged(first, {
        ...next,
        datasets: [{ ...next.datasets[0], description: "Updated" }],
      }),
    ).toBe(true);
  });
  it("records daily metadata additions without deleting older verified entries", async () => {
    const { input, deps } = setup();
    const added = {
      ...discovered,
      id: `arcgis:${"d".repeat(32)}:2`,
      layerId: 2,
    };
    deps.discover.mockResolvedValue({
      datasets: [added],
      run: {
        ...run(),
        complete: false,
        issues: [
          { portalId: "one", kind: "truncated", message: "Budget reached" },
        ],
      },
    });
    const report = await refreshCatalog(input, deps);
    expect(report.datasets).toHaveLength(2);
    expect(report.refresh?.changes.added).toEqual([added.id]);
    expect(report.complete).toBe(false);
  });
  it("rejects contradictory empty ArcGIS search pages even when nextStart says finished", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ results: [], total: 10, nextStart: -1 }),
    );
    const result = await discoverArcGIS(portal, {
      maxItems: 10,
      maxLayers: 10,
    });
    expect(result.run.complete).toBe(false);
    expect(result.run.issues[0].message).toContain("empty page");
  });
});
