import type { Dataset, LayerMetadata, Verification } from "../types";
import { getAdapter } from "./adapters";
import { datasetKey } from "./discovery/identity";
import {
  completedVerification,
  verificationFailure,
  verificationPolicy,
} from "./verification";
export interface VerificationOptions {
  signal?: AbortSignal;
  force?: boolean;
  now?: () => string;
  inspect?: (dataset: Dataset, signal?: AbortSignal) => Promise<LayerMetadata>;
}
function revision(dataset: Dataset) {
  return dataset.sourceUpdatedAt
    ? `${dataset.sourceUpdatedKind ?? "unknown"}:${dataset.sourceUpdatedAt}`
    : null;
}
export function reusableVerification(
  dataset: Dataset,
  previous: Dataset | undefined,
  now: number,
  force = false,
) {
  if (force || !previous?.verification) return false;
  const result = completedVerification(previous, now);
  if (
    !result ||
    result.status !== "verified" ||
    now - Date.parse(result.lastCheckedAt) >=
      verificationPolicy.recheckAfterHours * 3600000
  )
    return false;
  return (
    descriptorIdentity(dataset) === descriptorIdentity(previous) &&
    (dataset === previous || revision(dataset) === result.sourceRevision)
  );
}
function descriptorIdentity(dataset: Dataset) {
  return JSON.stringify([
    dataset.id,
    datasetKey(dataset),
    dataset.platform,
    dataset.resource?.apiRoot,
    dataset.title,
    dataset.publisher,
    dataset.sourceUrl,
  ]);
}

function sameEndpoint(a: Dataset, b: Dataset) {
  try {
    return datasetKey(a) === datasetKey(b);
  } catch {
    return false;
  }
}
function validateDescriptor(dataset: Dataset) {
  if (!dataset.title?.trim() || !dataset.publisher?.trim())
    throw Error("Required dataset metadata is missing.");
  new URL(dataset.sourceUrl);
  const url = new URL(
    dataset.resource?.url ?? `${dataset.serviceUrl}/${dataset.layerId}`,
  );
  if (url.protocol !== "https:" || url.username || url.password)
    throw Error("Invalid source endpoint URL.");
  if (
    (!dataset.platform || dataset.platform === "arcgis") &&
    (!dataset.serviceUrl || dataset.layerId === null)
  )
    throw Error("Missing ArcGIS layer endpoint.");
}
export async function inspectVerified(
  dataset: Dataset,
  options: VerificationOptions = {},
) {
  options.signal?.throwIfAborted();
  const started = performance.now();
  const now = options.now ?? (() => new Date().toISOString());
  const deadline = AbortSignal.timeout(verificationPolicy.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;
  validateDescriptor(dataset);
  const metadata = await (
    options.inspect ?? ((d, s) => getAdapter(d).inspect(d, s))
  )(dataset, signal);
  signal.throwIfAborted();
  if (
    !metadata.fields.length ||
    metadata.fields.some((f) => !f.name || !f.type) ||
    !metadata.query
  )
    throw Error("Required source metadata or query service is missing.");
  const checkedAt = now();
  const verification: Verification = {
    status: "verified",
    lastCheckedAt: checkedAt,
    lastSuccessfulAt: checkedAt,
    httpStatus: metadata.httpStatus ?? null,
    responseTimeMs: Math.round(performance.now() - started),
    errorType: null,
    errorMessage: null,
    sourceRevision: revision(dataset),
  };
  return { metadata, verification };
}
export function applyVerification(
  dataset: Dataset,
  metadata: LayerMetadata,
  verification: Verification,
): Dataset {
  return {
    ...dataset,
    fields: metadata.fields,
    queryable: metadata.query,
    lastAttemptedAt: verification.lastCheckedAt,
    lastVerifiedAt: verification.lastSuccessfulAt,
    sourceUpdatedAt: metadata.sourceUpdatedAt ?? dataset.sourceUpdatedAt,
    sourceUpdatedKind: metadata.sourceUpdatedKind ?? dataset.sourceUpdatedKind,
    verificationError: null,
    verification,
  };
}
export async function verifyDataset(
  dataset: Dataset,
  previous: Dataset | undefined,
  options: VerificationOptions = {},
): Promise<Dataset> {
  const now = options.now ?? (() => new Date().toISOString());
  options.signal?.throwIfAborted();
  const compatible =
    previous && sameEndpoint(dataset, previous) ? previous : undefined;
  if (
    reusableVerification(dataset, compatible, Date.parse(now()), options.force)
  )
    return {
      ...compatible!,
      ...dataset,
      fields: compatible!.fields,
      verification: compatible!.verification,
      lastVerifiedAt: compatible!.lastVerifiedAt,
      lastAttemptedAt: compatible!.lastAttemptedAt,
      verificationError: null,
    };
  const started = performance.now();
  try {
    const { metadata, verification } = await inspectVerified(dataset, options);
    return applyVerification(dataset, metadata, verification);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    const lastSuccessfulAt = previousSuccess(
      dataset,
      previous,
      Date.parse(now()),
    );
    const lastCheckedAt = now();
    const failure = verificationFailure(error);
    return {
      ...dataset,
      ...retainedMetadata(dataset, compatible),
      lastAttemptedAt: lastCheckedAt,
      lastVerifiedAt: lastSuccessfulAt,
      verificationError: failure.errorMessage,
      verification: {
        status: "failed",
        lastCheckedAt,
        lastSuccessfulAt,
        ...failure,
        responseTimeMs: Math.round(performance.now() - started),
        sourceRevision: revision(dataset),
      },
    };
  }
}
function retainedMetadata(dataset: Dataset, previous: Dataset | undefined) {
  return {
    fields: previous?.fields ?? dataset.fields,
    sourceUpdatedAt: dataset.sourceUpdatedAt ?? previous?.sourceUpdatedAt,
    sourceUpdatedKind: dataset.sourceUpdatedKind ?? previous?.sourceUpdatedKind,
    queryable: previous?.queryable ?? dataset.queryable,
  };
}
function previousSuccess(
  dataset: Dataset,
  previous: Dataset | undefined,
  now: number,
) {
  if (previous && !sameEndpoint(dataset, previous)) return null;
  return (
    completedVerification(previous ?? dataset, now)?.lastSuccessfulAt ?? null
  );
}
export async function verifyDatasets(
  datasets: Dataset[],
  previous: Dataset[],
  options: VerificationOptions = {},
) {
  const old = new Map(previous.map((d) => [d.id, d]));
  const results: Dataset[] = [];
  for (
    let index = 0;
    index < datasets.length;
    index += verificationPolicy.concurrency
  ) {
    options.signal?.throwIfAborted();
    results.push(
      ...(await Promise.all(
        datasets
          .slice(index, index + verificationPolicy.concurrency)
          .map((d) => verifyDataset(d, old.get(d.id), options)),
      )),
    );
  }
  return results;
}
