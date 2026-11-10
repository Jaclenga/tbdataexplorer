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
    expect(result.tags).toEqual(dataset.tags);
    expect(result.lastVerifiedAt).toBe(dataset.lastVerifiedAt);
    expect(result.verification).toEqual(dataset.verification);
  });
  it("retains existing layer context when the publisher supplies none", () => {
    const result = mergeCategoryMetadata(dataset, {}, {}, "item", "layer");
    expect(result.description).toBe(dataset.description);
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
      expect(result.datasets[0]).toEqual(input);
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
});
