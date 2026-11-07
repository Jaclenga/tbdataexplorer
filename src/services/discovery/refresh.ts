import { publicDiscoveryError, verificationPolicy } from "../verification";
import { snapshotRecords, compareSnapshots } from "./health-snapshot";
import { mergeDatasets } from "./identity";
import type { Dataset, LayerMetadata } from "../../types";
import { discoverPortal } from ".";
import { getAdapter } from "../adapters";
import { verifyDataset, verifyDatasets } from "../verify-source";
import { preservePrevious, datasetKey } from "./identity";
import {
  discoverySchema,
  type DiscoveryReport,
  type Portal,
  type PortalRun,
  type DiscoveryOptions,
} from "./types";

interface RefreshInput {
  portals: Portal[];
  curated: Dataset[];
  previous: DiscoveryReport;
  options: DiscoveryOptions;
}
interface Dependencies {
  discover: typeof discoverPortal;
  inspect: (dataset: Dataset, signal?: AbortSignal) => Promise<LayerMetadata>;
  now: () => string;
  log?: (message: string) => void;
}
const dependencies: Dependencies = {
  discover: discoverPortal,
  inspect: (dataset, signal) => getAdapter(dataset).inspect(dataset, signal),
  now: () => new Date().toISOString(),
  log: console.log,
};

export async function refreshCatalog(
  input: RefreshInput,
  deps: Dependencies = dependencies,
) {
  const startedAt = deps.now();
  const current: Dataset[] = [];
  const runs: PortalRun[] = [];
  for (
    let index = 0;
    index < input.portals.length;
    index += verificationPolicy.concurrency
  ) {
    const batch = await Promise.all(
      input.portals
        .slice(index, index + verificationPolicy.concurrency)
        .map((portal) => scan(portal, input, deps, startedAt)),
    );
    for (const result of batch) {
      current.push(...result.datasets);
      runs.push(result.run);
      deps.log?.(JSON.stringify(result.run));
    }
  }
  if (new Set(current.map((d) => d.id)).size !== current.length)
    throw Error(
      "Duplicate discovered dataset identifiers; previous catalog was not replaced.",
    );
  deps.log?.(`Verifying ${input.curated.length} existing curated endpoints`);
  const curatedUpdates: Dataset[] = [];
  const oldCurated = new Map(
    (input.previous.curatedUpdates ?? []).map((d) => [d.id, d]),
  );
  for (
    let index = 0;
    index < input.curated.length;
    index += verificationPolicy.concurrency
  ) {
    curatedUpdates.push(
      ...(await Promise.all(
        input.curated
          .slice(index, index + verificationPolicy.concurrency)
          .map((d) =>
            inspectCurated(d, oldCurated.get(d.id), input.options, deps),
          ),
      )),
    );
  }
  const retained = await verifyRetained(input, current, deps);
  input.options.signal?.throwIfAborted();
  const verified = new Set(
    [
      ...current.filter((d) => !d.verificationError),
      ...retained.filter((d) => !d.verificationError),
      ...curatedUpdates.filter((d) => !d.verificationError),
    ].map(datasetKey),
  ).size;
  const hasIssues =
    runs.some((r) => !r.complete) ||
    [...curatedUpdates, ...retained].some((d) => !!d.verificationError);
  const outcome = verified === 0 ? "failed" : hasIssues ? "partial" : "success";
  const datasets = preservePrevious(retained, current.sort(byId)).sort(byId);
  const finishedAt = deps.now();
  return discoverySchema.parse({
    schemaVersion: 1,
    generatedAt: finishedAt,
    lastSuccessfulRunAt: verified
      ? finishedAt
      : input.previous.lastSuccessfulRunAt,
    complete: runs.every((r) => r.complete),
    datasets,
    curatedUpdates: curatedUpdates.sort(byId),
    runs: runs.sort((a, b) => a.portalId.localeCompare(b.portalId)),
    healthHistory: snapshotEligible(outcome, runs)
      ? (() => {
          const records = snapshotRecords(
            mergeDatasets(curatedUpdates, current),
          );
          return {
            schemaVersion: 1,
            successfulAt: finishedAt,
            records,
            changes: input.previous.healthHistory
              ? compareSnapshots(input.previous.healthHistory.records, records)
              : null,
          };
        })()
      : input.previous.healthHistory,
    refresh: {
      startedAt,
      finishedAt,
      outcome,
      verified,
      curatedErrors: curatedUpdates.filter((d) => !!d.verificationError).length,
      changes: catalogChanges(input.previous.datasets, datasets),
    },
  });
}
function snapshotEligible(outcome: string, runs: PortalRun[]) {
  return (
    outcome === "success" &&
    runs.every((run) => run.complete && run.issues.length === 0)
  );
}
function byId(a: Dataset, b: Dataset) {
  return a.id.localeCompare(b.id);
}
async function scan(
  portal: Portal,
  input: RefreshInput,
  deps: Dependencies,
  startedAt: string,
) {
  deps.log?.(
    `Scanning ${portal.publisher}: up to ${input.options.maxItems} services / ${input.options.maxLayers} layers`,
  );
  try {
    const result = await deps.discover(portal, {
      ...input.options,
      previousDatasets: input.previous.datasets,
    });
    if (
      !result.datasets.length &&
      input.previous.datasets.some((d) => d.portalId === portal.id)
    ) {
      result.run.complete = false;
      result.run.issues.push({
        portalId: portal.id,
        kind: "schema",
        message:
          "Unexpected empty discovery response; previously verified datasets retained.",
      });
    }
    return result;
  } catch (error) {
    return {
      datasets: [],
      run: {
        portalId: portal.id,
        startedAt,
        finishedAt: deps.now(),
        complete: false,
        itemsScanned: 0,
        layersInspected: 0,
        datasetsFound: 0,
        totalItems: null,
        nextStart: null,
        issues: [
          {
            portalId: portal.id,
            kind: "request" as const,
            message: publicDiscoveryError(error),
          },
        ],
      },
    };
  }
}
async function inspectCurated(
  dataset: Dataset,
  previous: Dataset | undefined,
  options: DiscoveryOptions,
  deps: Dependencies,
) {
  return {
    ...(await verifyDataset(dataset, previous, {
      signal: options.signal,
      force: options.forceVerification,
      inspect: deps.inspect,
      now: deps.now,
    })),
    validationStatus: "curated" as const,
  };
}
async function verifyRetained(
  input: RefreshInput,
  current: Dataset[],
  deps: Dependencies,
) {
  const ids = new Set(current.map((d) => d.id));
  const endpoints = new Set(current.map(datasetKey));
  const retained = input.previous.datasets.filter(
    (d) => !ids.has(d.id) && !endpoints.has(datasetKey(d)),
  );
  return verifyDatasets(retained, retained, {
    signal: input.options.signal,
    force: input.options.forceVerification,
    inspect: deps.inspect,
    now: deps.now,
  });
}
function substantive(dataset: Dataset) {
  const {
    lastAttemptedAt: _attempt,
    lastVerifiedAt: _verified,
    verification: _verification,
    ...rest
  } = dataset;
  void _attempt;
  void _verified;
  void _verification;
  return stableJSON(rest);
}
export function catalogChanges(previous: Dataset[], next: Dataset[]) {
  const old = new Map(previous.map((d) => [d.id, d]));
  const added: string[] = [],
    updated: string[] = [];
  for (const d of next) {
    const before = old.get(d.id);
    if (!before) added.push(d.id);
    else if (
      substantive(before) !== substantive(d) ||
      datasetKey(before) !== datasetKey(d)
    )
      updated.push(d.id);
  }
  return {
    added,
    updated,
    retained: next.filter(
      (d) => !added.includes(d.id) && !updated.includes(d.id),
    ).length,
  };
}
// A new verification day is meaningful freshness. Identical same-day reruns are
// logged as artifacts, but do not churn the committed catalog's timestamps.
export function catalogChanged(
  previous: DiscoveryReport,
  next: DiscoveryReport,
) {
  const normalize = (report: DiscoveryReport) =>
    stableJSON({
      day: report.generatedAt.slice(0, 10),
      complete: report.complete,
      datasets: report.datasets.map(normalizeDataset).sort(byId),
      curatedUpdates: (report.curatedUpdates ?? [])
        .map(normalizeDataset)
        .sort(byId),
      runs: report.runs
        .map(({ startedAt: _start, finishedAt: _end, ...run }) => {
          void _start;
          void _end;
          return run;
        })
        .sort((a, b) => a.portalId.localeCompare(b.portalId)),
      outcome: report.refresh?.outcome,
      healthHistory: report.healthHistory
        ? {
            records: report.healthHistory.records,
            successfulAt: report.healthHistory.successfulAt.slice(0, 10),
          }
        : null,
    });
  return normalize(previous) !== normalize(next);
}
function normalizeDataset(d: Dataset): Dataset {
  return {
    ...d,
    lastAttemptedAt: d.lastAttemptedAt?.slice(0, 10),
    lastVerifiedAt: d.lastVerifiedAt?.slice(0, 10),
    verification: d.verification
      ? {
          ...d.verification,
          lastCheckedAt: d.verification.lastCheckedAt.slice(0, 10),
          lastSuccessfulAt:
            d.verification.lastSuccessfulAt?.slice(0, 10) ?? null,
          responseTimeMs: null,
        }
      : undefined,
  };
}

function stableJSON(value: unknown) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}
