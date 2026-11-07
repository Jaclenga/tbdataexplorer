import type { Dataset } from "../../types";
import { canonicalEndpoint } from "../source-url";

export function datasetKey(dataset: Dataset) {
  return dataset.resource
    ? new URL(dataset.resource.url).href
    : canonicalEndpoint(`${dataset.serviceUrl}/${dataset.layerId}`);
}

export function mergeDatasets(curated: Dataset[], discovered: Dataset[]) {
  const byEndpoint = new Map<string, Dataset>();
  for (const dataset of discovered)
    if (!byEndpoint.has(datasetKey(dataset)))
      byEndpoint.set(datasetKey(dataset), dataset);
  for (const dataset of curated) {
    const key = datasetKey(dataset);
    const live = byEndpoint.get(key);
    const fresh = newestInspection(dataset, live);
    byEndpoint.set(key, {
      ...live,
      ...dataset,
      validationStatus: "curated",
      verification: fresh.verification,
      lastAttemptedAt: fresh.lastAttemptedAt,
      verificationError: fresh.verificationError,
      lastVerifiedAt: fresh.lastVerifiedAt,
      sourceUpdatedAt: fresh.sourceUpdatedAt,
      sourceUpdatedKind: fresh.sourceUpdatedKind,
    });
  }
  const curatedIds = new Set(curated.map((d) => d.id));
  return [
    ...curated.map((d) => byEndpoint.get(datasetKey(d))!),
    ...[...byEndpoint.values()].filter((d) => !curatedIds.has(d.id)),
  ];
}

export function preservePrevious(previous: Dataset[], current: Dataset[]) {
  const currentById = new Map(current.map((dataset) => [dataset.id, dataset]));
  const previousById = new Map(
    previous.map((dataset) => [dataset.id, dataset]),
  );
  for (const id of currentById.keys()) previousById.delete(id);
  const byKey = new Map(
    [...previousById.values(), ...currentById.values()].map((dataset) => [
      datasetKey(dataset),
      dataset,
    ]),
  );
  return [...byKey.values()];
}

function newestInspection(curated: Dataset, discovered?: Dataset) {
  if (!discovered) return curated;
  const liveAttempt =
    discovered.verification?.lastCheckedAt ?? discovered.lastAttemptedAt;
  const curatedAttempt =
    curated.verification?.lastCheckedAt ?? curated.lastAttemptedAt;
  if (
    liveAttempt &&
    (!curatedAttempt || Date.parse(liveAttempt) > Date.parse(curatedAttempt))
  )
    return discovered;
  if (
    curatedAttempt &&
    (!liveAttempt || Date.parse(curatedAttempt) >= Date.parse(liveAttempt))
  )
    return curated;
  if (!discovered.lastVerifiedAt) return curated;
  if (
    curated.lastVerifiedAt &&
    Date.parse(curated.lastVerifiedAt) >= Date.parse(discovered.lastVerifiedAt)
  )
    return curated;
  return discovered;
}
