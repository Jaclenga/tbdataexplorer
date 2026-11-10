import { describe, it, expect, vi } from "vitest";
import { dataset } from "../fixtures";
import {
  mergeCategoryMetadata,
  enrichCategoryMetadata,
} from "../../scripts/enrich-category-metadata";
describe("category metadata enrichment", () => {
  it("keeps parent context separate from the layer and preserves verification dates", () => {
    const result = mergeCategoryMetadata(
      dataset,
      {
        description: "<p>Shared zoning overview</p>",
        snippet: "Parent summary",
        tags: ["zoning"],
      },
      { description: "<b>Water quality samples</b>" },
      "https://example.com/item",
      "https://example.com/layer",
    );
    expect(result.description).toBe("Water quality samples");
    expect(result.category_metadata?.itemDescription).toBe(
      "Shared zoning overview",
    );
    expect(result.tags).toEqual(["zoning"]);
    expect(result.lastVerifiedAt).toBe(dataset.lastVerifiedAt);
    expect(result.verification).toEqual(dataset.verification);
  });
  it("records a successful empty description instead of retaining removed text", () => {
    const result = mergeCategoryMetadata(dataset, {}, {}, "item", "layer");
    expect(result.description).toBeNull();
    expect(result.metadata_check?.status).toBe("success");
    expect(result.metadata_check?.descriptionStatus).toBe("empty");
    expect(result.fields).toEqual(dataset.fields);
  });
  it("retains previous metadata on request failures and refuses unregistered services", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Offline"));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const input = {
        ...dataset,
        category_source: "uncategorized" as const,
        platform: "arcgis" as const,
        portalId: "city",
        itemId: "0123456789abcdef0123456789abcdef",
        serviceUrl:
          "https://services1.arcgis.com/IbNXlmt2RVVRCZ6M/arcgis/rest/services/Test/FeatureServer",
      };
      const result = await enrichCategoryMetadata([input], true);
      expect(result.datasets[0].description).toEqual(input.description);
      expect(result.datasets[0].fields).toEqual(input.fields);
      expect(result.datasets[0].metadata_check?.status).toBe("failed");
      expect(result.datasets[0].metadata_check?.lastSuccessAt).toBeNull();
      expect(result.issues).toHaveLength(1);
      fetchMock.mockClear();
      await enrichCategoryMetadata(
        [{ ...input, serviceUrl: "https://example.com/FeatureServer" }],
        true,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("checks categorized records daily and preserves successful timestamps on failure", async () => {
    const input = {
      ...dataset,
      category_source: "nlp" as const,
      portalId: "city",
      itemId: "0123456789abcdef0123456789abcdef",
      serviceUrl:
        "https://services1.arcgis.com/IbNXlmt2RVVRCZ6M/arcgis/rest/services/Test/FeatureServer",
    };
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url.includes("content/items")
              ? {
                  id: input.itemId,
                  access: "public",
                  description: "parent",
                  tags: [],
                }
              : { description: "Updated roads", fields: [] },
          ),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const first = await enrichCategoryMetadata(
        [input],
        true,
        "2026-11-10T10:00:00.000Z",
      );
      expect(first.datasets[0].description).toBe("Updated roads");
      expect(first.datasets[0].metadata_check?.descriptionChangedAt).toBe(
        "2026-11-10T10:00:00.000Z",
      );
      fetchMock.mockClear();
      await enrichCategoryMetadata(
        first.datasets,
        true,
        "2026-11-10T12:00:00.000Z",
      );
      expect(fetchMock).not.toHaveBeenCalled();
      fetchMock.mockRejectedValue(new Error("Offline"));
      const failed = await enrichCategoryMetadata(
        first.datasets,
        true,
        "2026-11-11T10:00:00.000Z",
      );
      expect(failed.datasets[0].description).toBe("Updated roads");
      expect(failed.datasets[0].metadata_check).toMatchObject({
        status: "failed",
        lastSuccessAt: "2026-11-10T10:00:00.000Z",
        descriptionChangedAt: "2026-11-10T10:00:00.000Z",
        lastAttemptAt: "2026-11-11T10:00:00.000Z",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("does not move the change timestamp when an unchanged description is checked again", () => {
    const first = mergeCategoryMetadata(
      dataset,
      {},
      { description: "Roads" },
      "item",
      "layer",
      "2026-11-10T10:00:00.000Z",
    );
    const second = mergeCategoryMetadata(
      first,
      {},
      { description: "Roads" },
      "item",
      "layer",
      "2026-11-11T10:00:00.000Z",
    );
    expect(second.metadata_check?.descriptionChangedAt).toBe(
      first.metadata_check?.descriptionChangedAt,
    );
    expect(second.metadata_check?.lastSuccessAt).toBe(
      "2026-11-11T10:00:00.000Z",
    );
  });
  it("refreshes publisher titles and tags even if the description is unchanged", () => {
    const result = mergeCategoryMetadata(
      dataset,
      { tags: ["flood"] },
      { name: "Flood assessment", description: dataset.description },
      "item",
      "layer",
    );
    expect(result.title).toBe("Flood assessment");
    expect(result.tags).toEqual(["flood"]);
  });
});
