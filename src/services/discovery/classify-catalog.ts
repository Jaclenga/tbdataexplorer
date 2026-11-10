import type { Dataset } from "../../types";
import type { DiscoveryReport } from "./types";
import { datasetKey, mergeDatasets } from "./identity";
import { catalogChanges } from "./refresh";
import {
  categoryConfig,
  categoryNames,
  categoryOverrides,
  canonicalCategory,
  predictCategory,
} from "./categorization";
interface Context {
  curated?: Dataset;
  previous?: Dataset;
  overrides?: Record<string, string>;
}
function sourceCategory(dataset: Dataset) {
  if (Object.hasOwn(dataset, "source_category"))
    return dataset.source_category ?? null;
  return ["nlp", "semantic", "uncategorized"].includes(
    dataset.category_source ?? "",
  )
    ? null
    : dataset.category;
}
function trustedCategory(value: string | null | undefined) {
  const category = canonicalCategory(value);
  return category === "Uncategorized" ? null : category;
}
function trustedAssignment(
  dataset: Dataset,
  source: string | null,
  context: Context,
) {
  const overrides = context.overrides ?? categoryOverrides;
  const override =
    overrides[dataset.id] ??
    (context.curated ? overrides[context.curated.id] : undefined);
  if (override) {
    if (!categoryNames.includes(override))
      throw Error(`Unknown override category: ${override}`);
    return {
      category: override,
      source: "override" as const,
      signals: [`override:${dataset.id}`],
    };
  }
  const curated = trustedCategory(context.curated?.category);
  if (curated)
    return {
      category: curated,
      source: "curated" as const,
      signals: [`curated:${context.curated!.id}`],
    };
  const publisher = trustedCategory(source);
  if (publisher)
    return {
      category: publisher,
      source: "publisher" as const,
      signals: [`publisher:${source}`],
    };
  return previousAssignment(context.previous);
}
function previousAssignment(previous: Dataset | undefined) {
  const category = trustedCategory(previous?.category);
  const source = previous?.category_source;
  if (category && (source === "curated" || source === "publisher"))
    return { category, source, signals: ["previous trusted assignment"] };
  return null;
}
export function classifyDataset(
  dataset: Dataset,
  context: Context = {},
): Dataset {
  const source = sourceCategory(dataset);
  const trusted = trustedAssignment(dataset, source, context);
  const prediction = predictCategory({ ...dataset, category: source });
  return {
    ...dataset,
    source_category: source,
    category: trusted?.category ?? prediction.category,
    category_source:
      trusted?.source ??
      (prediction.category === "Uncategorized" ? "uncategorized" : "nlp"),
    category_confidence: trusted ? "high" : prediction.tier,
    category_version: categoryConfig.version,
    category_signals: trusted?.signals ?? prediction.signals,
    category_review: trusted ? null : prediction.review,
  };
}
export function categorizeReport(
  report: DiscoveryReport,
  curated: Dataset[],
  previous: DiscoveryReport,
  updateRefreshChanges = true,
) {
  const checkedById = new Map(curated.map((d) => [d.id, d])),
    checkedByKey = new Map(curated.map((d) => [datasetKey(d), d]));
  const old = mergeDatasets(
    previous.curatedUpdates ?? curated,
    previous.datasets,
  );
  const oldById = new Map(old.map((d) => [d.id, d])),
    oldByKey = new Map(old.map((d) => [datasetKey(d), d]));
  const classify = (d: Dataset) =>
    classifyDataset(d, {
      curated: checkedById.get(d.id) ?? checkedByKey.get(datasetKey(d)),
      previous: oldById.get(d.id) ?? oldByKey.get(datasetKey(d)),
    });
  const datasets = report.datasets.map(classify),
    curatedUpdates = (report.curatedUpdates ?? curated).map(classify);
  const next = { ...report, datasets, curatedUpdates };
  if (updateRefreshChanges && next.refresh)
    next.refresh = {
      ...next.refresh,
      changes: catalogChanges(previous.datasets, datasets),
    };
  const effective = mergeDatasets(curatedUpdates, datasets);
  return { report: next, review: classificationReview(effective, old) };
}
export function classificationReview(datasets: Dataset[], previous: Dataset[]) {
  const counts = Object.fromEntries(
    categoryNames.map((category) => [
      category,
      datasets.filter((d) => d.category === category).length,
    ]),
  );
  const sources = Object.fromEntries(
    [
      "override",
      "curated",
      "publisher",
      "nlp",
      "semantic",
      "uncategorized",
    ].map((source) => [
      source,
      datasets.filter((d) => d.category_source === source).length,
    ]),
  );
  const old = new Map(previous.map((d) => [d.id, d]));
  return {
    version: categoryConfig.version,
    total: datasets.length,
    sources,
    counts,
    distributionWarnings: Object.entries(counts)
      .filter(([, n]) => n === 0 || n > datasets.length * 0.4)
      .map(([category, count]) => ({
        category,
        count,
        reason: count === 0 ? "no examples" : "over 40% of the catalog",
      })),
    review: datasets
      .filter((d) => d.category_review)
      .map((d) => ({
        id: d.id,
        title: d.title,
        reason: d.category_review,
        signals: d.category_signals,
        candidates: predictCategory({
          ...d,
          category: d.source_category ?? null,
        }).scores.slice(0, 3),
      })),
    changes: datasets
      .filter((d) => old.get(d.id)?.category !== d.category)
      .map((d) => ({
        id: d.id,
        title: d.title,
        previous: old.get(d.id)?.category ?? null,
        category: d.category,
        source: d.category_source,
      })),
  };
}
