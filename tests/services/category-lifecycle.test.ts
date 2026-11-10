import { describe, expect, it } from "vitest";
import { dataset } from "../fixtures";
import {
  classificationHash,
  categoryChange,
} from "../../scripts/category-lifecycle";
import {
  semanticKey,
  semanticText,
} from "../../scripts/semantic-categorization";
import { classifyDataset } from "../../src/services/discovery/classify-catalog";
describe("metadata classification lifecycle", () => {
  it.each(["title", "description", "tags", "fields"] as const)(
    "invalidates classification input on %s changes",
    (field) => {
      const changed = {
        ...dataset,
        [field]:
          field === "tags"
            ? ["new"]
            : field === "fields"
              ? [{ name: "new", alias: "Flood risk", type: "string" }]
              : "Changed metadata",
      };
      expect(classificationHash(changed)).not.toBe(classificationHash(dataset));
    },
  );
  it("ignores check timestamps and generated categories", () => {
    const before = {
      ...dataset,
      source_category: null,
      category_source: "nlp" as const,
    };
    const after = {
      ...before,
      category: "Housing",
      metadata_check: {
        lastAttemptAt: "2026-11-10T10:00:00.000Z",
        lastSuccessAt: null,
        descriptionChangedAt: null,
        status: "failed" as const,
        descriptionStatus: "unknown" as const,
        error: "Offline",
      },
    };
    expect(classificationHash(after)).toBe(classificationHash(before));
  });
  it("invalidates semantic keys for changes beyond the model context window", () => {
    const first = { ...dataset, description: "x".repeat(2000) };
    const second = { ...first, description: first.description + "new" };
    expect(semanticText(first)).toBe(semanticText(second));
    expect(
      semanticKey(semanticText(first), classificationHash(first)),
    ).not.toBe(semanticKey(semanticText(second), classificationHash(second)));
  });
  it("records the changed metadata alongside the old/new category", () => {
    const first = {
      ...dataset,
      source_category: null,
      category_source: "nlp" as const,
      category: "Transportation",
      description: "Roads",
    };
    const second = {
      ...first,
      category: "Hazards",
      description: "Flood risk assessment",
    };
    expect(
      categoryChange(first, second, "2026-11-10T10:00:00.000Z"),
    ).toMatchObject({
      oldCategory: "Transportation",
      newCategory: "Hazards",
      reason: "metadata_changed",
      metadataChanges: [
        {
          field: "description",
          before: "Roads",
          after: "Flood risk assessment",
        },
      ],
    });
    expect(categoryChange(first, first, "2026-11-10T10:00:00.000Z")).toBeNull();
  });
  it("keeps manual overrides authoritative after metadata changes", () => {
    const changed = {
      ...dataset,
      title: "Flood risk assessment",
      description: "Flood risk assessment",
    };
    expect(
      classifyDataset(changed, { overrides: { [changed.id]: "Housing" } })
        .category,
    ).toBe("Housing");
  });
});
