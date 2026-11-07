import { createHash } from "node:crypto";
import type { Dataset } from "../../types";
import { uniqueDatasets } from "../catalog-health";
export function snapshotRecords(datasets: Dataset[]) {
  return uniqueDatasets(datasets)
    .map((d) => ({
      id: d.id,
      metadata: createHash("sha256")
        .update(
          JSON.stringify([
            d.title,
            d.description,
            d.publisher,
            d.sourceUrl,
            d.serviceUrl,
            d.layerId,
            d.resource,
            d.fields,
            d.tags,
            d.coverage,
            d.terms,
            d.category,
          ]),
        )
        .digest("hex"),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
export function compareSnapshots(
  previous: ReturnType<typeof snapshotRecords>,
  next: ReturnType<typeof snapshotRecords>,
) {
  const old = new Map(previous.map((d) => [d.id, d.metadata]));
  const current = new Map(next.map((d) => [d.id, d.metadata]));
  return {
    added: next.filter((d) => !old.has(d.id)).length,
    removed: previous.filter((d) => !current.has(d.id)).length,
    changed: next.filter((d) => old.has(d.id) && old.get(d.id) !== d.metadata)
      .length,
  };
}
