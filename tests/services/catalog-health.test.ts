import {
  snapshotRecords,
  compareSnapshots,
} from "../../src/services/discovery/health-snapshot";
import { describe, expect, it } from "vitest";
import { dataset, fields } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";
import {
  failureKind,
  catalogHealth,
  verificationState,
} from "../../src/services/catalog-health";
import { refreshCatalog } from "../../src/services/discovery/refresh";
const time = "2026-11-06T12:00:00.000Z";
const now = Date.parse(time);
const checked = {
  ...dataset,
  fields,
  lastVerifiedAt: time,
  lastAttemptedAt: time,
};
const report = {
  ...emptyDiscovery,
  refresh: {
    startedAt: time,
    finishedAt: time,
    outcome: "success" as const,
    verified: 999,
    curatedErrors: 0,
    changes: { added: [], updated: [], retained: 0 },
  },
};
describe("catalog health", () => {
  it("classifies original failure reasons without losing their text", () => {
    expect(failureKind("HTTP 403")).toBe("Authorization");
    expect(failureKind("HTTP 404")).toBe("Missing endpoint");
    expect(failureKind("Network timeout")).toBe("Network");
    expect(failureKind("Invalid JSON")).toBe("Malformed response");
    expect(failureKind("unsupported layer schema")).toBe("Metadata or schema");
  });
  it("counts unique records and actual publishers rather than reported totals", () => {
    const health = catalogHealth(
      [
        checked,
        checked,
        { ...checked, id: "alias" },
        { ...checked, id: "other", layerId: 2, publisher: "Other" },
      ],
      report,
      now,
    );
    expect(health.discovered).toBe(2);
    expect(health.verified).toBe(2);
    expect(health.publishers).toHaveLength(2);
  });
  it("distinguishes checked, stale, failed, malformed and unknown states", () => {
    expect(verificationState(checked, now)).toBe("Verified");
    expect(verificationState(checked, now + 169 * 3600000)).toBe("Stale");
    expect(
      verificationState({ ...checked, verificationError: "HTTP 403" }, now),
    ).toBe("Failed");
    expect(verificationState(dataset, now)).toBe("Not checked");
    expect(
      verificationState({ ...checked, lastVerifiedAt: "invalid" }, now),
    ).toBe("Not checked");
    expect(
      verificationState({ ...checked, lastAttemptedAt: "invalid" }, now),
    ).toBe("Not checked");
    expect(verificationState({ ...checked, fields: null }, now)).toBe("Failed");
  });
  it("excludes old checks from cycle totals and handles empty catalogs and unknown publishers", () => {
    expect(catalogHealth([], emptyDiscovery, now).discovered).toBe(0);
    const result = catalogHealth(
      [{ ...dataset, publisher: "" }],
      emptyDiscovery,
      now,
    );
    expect(result.publishers[0].name).toBe("Unknown publisher");
    expect(result.attention).toHaveLength(1);
    expect(
      catalogHealth(
        [checked],
        { ...report, refresh: { ...report.refresh, outcome: "failed" } },
        now,
      ).verified,
    ).toBe(0);
    expect(catalogHealth([checked], emptyDiscovery, now).verified).toBe(0);
  });
  it("compares stable IDs and metadata while excluding verification timestamp changes", () => {
    const before = snapshotRecords([checked]);
    expect(
      compareSnapshots(
        before,
        snapshotRecords([
          { ...checked, lastVerifiedAt: "2026-11-07T12:00:00Z" },
        ]),
      ),
    ).toEqual({ added: 0, removed: 0, changed: 0 });
    expect(
      compareSnapshots(
        before,
        snapshotRecords([
          { ...checked, title: "Changed" },
          { ...checked, id: "new", layerId: 2 },
        ]),
      ),
    ).toEqual({ added: 1, removed: 0, changed: 1 });
    expect(compareSnapshots(before, [])).toEqual({
      added: 0,
      removed: 1,
      changed: 0,
    });
  });
  it("preserves successful history on failed checks and initializes history without invented differences", async () => {
    const deps = {
      discover: async () => {
        throw Error("offline");
      },
      inspect: async () => ({
        fields,
        objectIdField: null,
        geometryType: null,
        maxRecordCount: 10,
        pagination: false,
        orderBy: false,
        geojson: false,
        query: true,
        inspectedAt: time,
      }),
      now: () => time,
    };
    const first = await refreshCatalog(
      {
        portals: [],
        curated: [checked],
        previous: emptyDiscovery,
        options: { maxItems: 1, maxLayers: 1, forceVerification: true },
      },
      deps,
    );
    expect(first.healthHistory?.changes).toBeNull();
    const failed = await refreshCatalog(
      {
        portals: [],
        curated: [checked],
        previous: first,
        options: { maxItems: 1, maxLayers: 1, forceVerification: true },
      },
      {
        ...deps,
        inspect: async () => {
          throw Error("offline");
        },
      },
    );
    expect(failed.healthHistory).toEqual(first.healthHistory);
    const partial = await refreshCatalog(
      {
        portals: [],
        curated: [checked, { ...checked, id: "broken", layerId: 3 }],
        previous: first,
        options: { maxItems: 1, maxLayers: 1, forceVerification: true },
      },
      {
        ...deps,
        inspect: async (d) => {
          if (d.id === "broken") throw Error("HTTP 403");
          return deps.inspect();
        },
      },
    );
    expect(partial.refresh?.outcome).toBe("partial");
    expect(partial.healthHistory).toEqual(first.healthHistory);
    const second = await refreshCatalog(
      {
        portals: [],
        curated: [{ ...checked, title: "New title" }],
        previous: first,
        options: { maxItems: 1, maxLayers: 1, forceVerification: true },
      },
      deps,
    );
    expect(second.healthHistory?.changes?.changed).toBe(1);
  });
});
