import { mergeDatasets } from "../../src/services/discovery/identity";
import { federatedCatalog } from "../../src/services/federated-catalog";
import { catalog } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";
import { describe, expect, it, vi } from "vitest";
import { dataset, fields, layerResponse } from "../fixtures";
import {
  verifyDataset,
  verifyDatasets,
} from "../../src/services/verify-source";
import {
  sourceStatus,
  completedVerification,
  verificationDate,
  verificationFailure,
  verificationPolicy,
} from "../../src/services/verification";
import type { Dataset } from "../../src/types";
const checkedAt = "2026-11-06T18:00:00.000Z";
const now = () => checkedAt;
const inspect = vi.fn(async () => ({
  fields,
  query: true,
  geometryType: null,
  objectIdField: null,
  maxRecordCount: 100,
  pagination: false,
  orderBy: false,
  geojson: false,
}));
const options = { now, inspect };
describe("source verification", () => {
  it("performs a lightweight ArcGIS metadata check and records actual status and stable identity", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json(layerResponse));
    const result = await verifyDataset(dataset, undefined, { now });
    expect(result.id).toBe(dataset.id);
    expect(result.verification).toMatchObject({
      status: "verified",
      lastCheckedAt: checkedAt,
      lastSuccessfulAt: checkedAt,
      httpStatus: 200,
      errorType: null,
    });
    expect(result.verification!.responseTimeMs).toBeGreaterThanOrEqual(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toMatch(
      /FeatureServer\/0\?f=json$/,
    );
    expect(sourceStatus(result, Date.parse(checkedAt)).state).toBe("Verified");
  });
  it.each([
    [404, "missing-endpoint", 1],
    [403, "authorization", 1],
    [500, "http", 3],
    [429, "http", 3],
  ])("records HTTP %s and limits retries", async (status, kind, attempts) => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      async () => new Response("failure", { status: Number(status) }),
    );
    const pending = verifyDataset(dataset, undefined, { now });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.verification).toMatchObject({
      status: "failed",
      errorType: kind,
      httpStatus: status,
      lastSuccessfulAt: null,
    });
    expect(fetch).toHaveBeenCalledTimes(Number(attempts));
  });
  it("respects a long Retry-After without immediately retrying the publisher", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("busy", { status: 429, headers: { "Retry-After": "60" } }),
    );
    const result = await verifyDataset(dataset, undefined, { now });
    expect(result.verification?.status).toBe("failed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [
      () => {
        throw new TypeError(
          "fetch failed at https://private.test/?token=secret",
        );
      },
      "network",
    ],
    [() => new Response("not JSON"), "invalid-response"],
    [() => Response.json({ fields: [] }), "metadata"],
    [
      () =>
        Response.json({
          error: { code: 499, message: "private token details" },
        }),
      "authorization",
    ],
    [() => Response.json({ ...layerResponse, capabilities: "" }), "metadata"],
  ])(
    "rejects inaccessible or uninterpretable sources safely",
    async (response, kind) => {
      vi.mocked(fetch).mockImplementation(async () => response());
      const result = await verifyDataset(dataset, undefined, { now });
      expect(result.verification?.errorType).toBe(kind);
      expect(JSON.stringify(result.verification)).not.toMatch(
        /secret|private\.test|private token/,
      );
      expect(result.verification?.status).toBe("failed");
    },
  );
  it("records a bounded timeout without suggesting permanent removal", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockRejectedValue(
      new DOMException("Timed out", "TimeoutError"),
    );
    const pending = verifyDataset(dataset, undefined, { now });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.verification?.errorType).toBe("timeout");
    expect(result.verification?.errorMessage).toContain("timed out");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
  it.each([
    { ...dataset, serviceUrl: null },
    { ...dataset, title: "" },
    { ...dataset, sourceUrl: "invalid" },
    { ...dataset, platform: "json" as const, resource: { url: "invalid" } },
  ])(
    "rejects missing or invalid endpoint metadata before requesting",
    async (d) => {
      const result = await verifyDataset(d, undefined, { now });
      expect(result.verification?.status).toBe("failed");
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("supports external adapters with bounded sample responses", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json([{ name: "Park" }]));
    const result = await verifyDataset(
      {
        ...dataset,
        platform: "json",
        resource: { url: "https://data.example.test/data.json" },
      },
      undefined,
      { now },
    );
    expect(result.verification?.status).toBe("verified");
  });
  it("keeps a successful timestamp when a later check fails, including when the failure becomes stale", async () => {
    const success = await verifyDataset(dataset, undefined, options);
    const failedAt = "2026-11-07T18:00:00.000Z";
    const failure = await verifyDataset(dataset, success, {
      now: () => failedAt,
      inspect: async () => {
        throw Error("HTTP 404 credentials=private");
      },
    });
    expect(failure.verification).toMatchObject({
      status: "failed",
      lastSuccessfulAt: checkedAt,
      lastCheckedAt: failedAt,
    });
    expect(failure.lastVerifiedAt).toBe(checkedAt);
    const view = sourceStatus(failure, Date.parse(failedAt) + 8 * 86400000);
    expect(view.state).toBe("Stale");
    expect(view.result?.status).toBe("failed");
    expect(view.message).toContain("Current availability is unknown");
    expect(sourceStatus(failure, Date.parse(failedAt)).state).toBe("Failed");
  });
  it("reuses recent unchanged checks and rechecks after a revision, endpoint change, or force", async () => {
    const check = vi.fn(inspect);
    const success = await verifyDataset(dataset, undefined, {
      now,
      inspect: check,
    });
    const cached = await verifyDataset(dataset, success, {
      now,
      inspect: check,
    });
    expect(cached.verification).toEqual(success.verification);
    expect(check).toHaveBeenCalledTimes(1);
    await verifyDataset({ ...dataset, sourceUpdatedAt: checkedAt }, success, {
      now,
      inspect: check,
    });
    await verifyDataset(dataset, success, { now, inspect: check, force: true });
    expect(check).toHaveBeenCalledTimes(3);
    const moved = await verifyDataset({ ...success, layerId: 5 }, success, {
      now,
      inspect: async () => {
        throw Error("HTTP 404");
      },
    });
    expect(moved.verification?.lastSuccessfulAt).toBeNull();
  });
  it("isolates failures within a batch and enforces bounded concurrency", async () => {
    let active = 0,
      maximum = 0;
    const datasets = Array.from({ length: 5 }, (_, i) => ({
      ...dataset,
      id: `test/${i}`,
      layerId: i,
    }));
    const result = await verifyDatasets(datasets, [], {
      now,
      inspect: async (d) => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        if (d.layerId === 1) throw Error("HTTP 500");
        return inspect();
      },
    });
    expect(maximum).toBeLessThanOrEqual(verificationPolicy.concurrency);
    expect(result.map((d) => d.id)).toEqual(datasets.map((d) => d.id));
    expect(
      result.filter((d) => d.verification?.status === "verified"),
    ).toHaveLength(4);
  });
  it("keeps the latest result together during endpoint deduplication and federation", async () => {
    const success = await verifyDataset(dataset, undefined, options);
    const failed = await verifyDataset(dataset, success, {
      now: () => "2026-11-07T18:00:00.000Z",
      force: true,
      inspect: async () => {
        throw Error("HTTP 403");
      },
    });
    const discovered = {
      ...failed,
      id: "discovered:alias",
      validationStatus: "discovered" as const,
    };
    const merged = mergeDatasets([success], [discovered]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(dataset.id);
    expect(merged[0].verification?.status).toBe("failed");
    expect(merged[0].lastVerifiedAt).toBe(checkedAt);
    const federated = federatedCatalog(catalog, {
      ...emptyDiscovery,
      curatedUpdates: [failed],
    });
    expect(
      federated.datasets.find((d) => d.id === dataset.id)?.verification,
    ).toEqual(failed.verification);
  });
  it("does not mutate prior records when a job is interrupted", async () => {
    const success = await verifyDataset(dataset, undefined, options);
    const before = structuredClone(success);
    const controller = new AbortController();
    await expect(
      verifyDatasets([success], [success], {
        now,
        force: true,
        signal: controller.signal,
        inspect: async () => {
          controller.abort();
          throw controller.signal.reason;
        },
      }),
    ).rejects.toBeDefined();
    expect(success).toEqual(before);
  });
  it("handles legacy, never checked, future and malformed timestamps and formats UTC dates", () => {
    const current = Date.parse(checkedAt);
    expect(sourceStatus(dataset, current).state).toBe("Not checked");
    const legacy = { ...dataset, fields, lastVerifiedAt: checkedAt };
    expect(sourceStatus(legacy, current + 6 * 86400000).state).toBe("Verified");
    expect(sourceStatus(legacy, current + 8 * 86400000).state).toBe("Stale");
    expect(sourceStatus(legacy, current - 1).state).toBe("Not checked");
    expect(
      completedVerification(
        { ...legacy, verification: { status: "verified" } } as Dataset,
        current,
      ),
    ).toBeNull();
    expect(verificationDate("invalid")).toBe("Not recorded");
    expect(verificationDate("2026-11-06T00:00:00Z")).toContain(
      "November 6, 2026",
    );
    expect(
      verificationFailure(Error("HTTP 503 https://user:secret@private.test/"))
        .errorMessage,
    ).not.toContain("secret");
  });
});
