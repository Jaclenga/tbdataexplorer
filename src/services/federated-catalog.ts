import type { Catalog } from "../types";
import type { DiscoveryReport } from "./discovery/types";
import { datasetKey, mergeDatasets } from "./discovery/identity";

export function federatedCatalog(
  curated: Catalog,
  report: DiscoveryReport,
): Catalog {
  const updates = new Map(
    (report.curatedUpdates ?? []).map((dataset) => [dataset.id, dataset]),
  );
  const checked = curated.datasets.map((dataset) => {
    const update = updates.get(dataset.id);
    if (!update || datasetKey(update) !== datasetKey(dataset)) return dataset;
    return {
      ...dataset,
      ...(update.category_source
        ? {
            category: update.category,
            source_category: update.source_category,
            category_source: update.category_source,
            category_confidence: update.category_confidence,
            category_version: update.category_version,
            category_signals: update.category_signals,
            category_review: update.category_review,
          }
        : {}),
      verification: update.verification,
      fields: update.fields,
      lastVerifiedAt: update.lastVerifiedAt,
      lastAttemptedAt: update.lastAttemptedAt,
      sourceUpdatedAt: update.sourceUpdatedAt,
      sourceUpdatedKind: update.sourceUpdatedKind,
      queryable: update.queryable,
      verificationError: update.verificationError,
    };
  });
  return { ...curated, datasets: mergeDatasets(checked, report.datasets) };
}
