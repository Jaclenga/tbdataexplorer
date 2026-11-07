import type { Dataset } from "../types";
import { sourceStatus } from "./verification";
import { datasetKey } from "./discovery/identity";
import type { DiscoveryReport } from "./discovery/types";

export function metadataIssues(d: Dataset) {
  return [
    !d.title?.trim() && "Missing title",
    !d.publisher?.trim() && "Missing publisher",
    !d.sourceUrl && "Missing source URL",
    !d.fields?.length && "Missing field schema",
  ].filter(Boolean) as string[];
}
export function verificationState(d: Dataset, now = Date.now()) {
  const state = sourceStatus(d, now).state;
  return state === "Verified" && metadataIssues(d).length ? "Failed" : state;
}

export function uniqueDatasets(datasets: Dataset[]) {
  const ids = new Set<string>(),
    endpoints = new Set<string>();
  return datasets.filter((d) => {
    let endpoint: string;
    try {
      endpoint = datasetKey(d);
    } catch {
      endpoint = d.id;
    }
    if (ids.has(d.id) || endpoints.has(endpoint)) return false;
    ids.add(d.id);
    endpoints.add(endpoint);
    return true;
  });
}
export function catalogHealth(
  datasets: Dataset[],
  report: DiscoveryReport,
  now = Date.now(),
) {
  const records = uniqueDatasets(datasets).map((dataset) => ({
    dataset,
    state: verificationState(dataset, now),
    issues: metadataIssues(dataset),
  }));
  const attention = records.filter(
    (r) => r.state === "Failed" || r.state === "Stale" || r.issues.length,
  );
  const cycle = report.refresh;
  const verified = records.filter(
    (r) =>
      r.state === "Verified" &&
      cycle &&
      cycle.outcome !== "failed" &&
      Date.parse(r.dataset.lastVerifiedAt!) >= Date.parse(cycle.startedAt) &&
      Date.parse(r.dataset.lastVerifiedAt!) <= Date.parse(cycle.finishedAt),
  );
  const publishers = [
    ...new Set(
      records.map((r) => r.dataset.publisher?.trim() || "Unknown publisher"),
    ),
  ].map((name) => {
    const rows = records.filter(
      (r) => (r.dataset.publisher?.trim() || "Unknown publisher") === name,
    );
    const checked = rows
      .map((r) => r.dataset.lastAttemptedAt ?? r.dataset.lastVerifiedAt)
      .filter((s): s is string => !!s && Number.isFinite(Date.parse(s)))
      .sort();
    return {
      name,
      discovered: rows.length,
      verified: verified.filter((r) => rows.includes(r)).length,
      issues: attention.filter((r) => rows.includes(r)).length,
      checkedAt: checked.at(-1) ?? null,
    };
  });
  return {
    records,
    attention,
    publishers,
    discovered: records.length,
    verified: verified.length,
  };
}
export function failureKind(message: string) {
  if (/401|403|unauthori[sz]ed|forbidden|token|authentication/i.test(message))
    return "Authorization";
  if (/404|410|not found|missing endpoint/i.test(message))
    return "Missing endpoint";
  if (/schema|field|metadata/i.test(message)) return "Metadata or schema";
  if (/json|parse|malformed|unsupported.*response/i.test(message))
    return "Malformed response";
  if (/network|fetch|timeout|timed out|offline|connection/i.test(message))
    return "Network";
  return "Endpoint check";
}
