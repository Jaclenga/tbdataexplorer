// Build-time inference only. No model code or weights are sent to the browser.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { z } from "zod";
import config from "../config/semantic-categories.json";
import type { Dataset } from "../src/types";
import type { DiscoveryReport } from "../src/services/discovery/types";
import {
  categoryNames,
  normalizeMetadata,
} from "../src/services/discovery/categorization";
import {
  categorizeReport,
  classificationReview,
} from "../src/services/discovery/classify-catalog";
import { mergeDatasets } from "../src/services/discovery/identity";
import { catalogChanges } from "../src/services/discovery/refresh";
import { enrichCategoryMetadata } from "./enrich-category-metadata";
import { classificationHash, categoryChange } from "./category-lifecycle";

const scoreSchema = z.object({
  category: z.enum(categoryNames as [string, ...string[]]),
  score: z.number().min(0).max(1),
});
const cacheSchema = z.record(
  z.string(),
  z.array(scoreSchema).length(Object.keys(config.categories).length),
);
export type SemanticScore = z.infer<typeof scoreSchema>;
export type Infer = (text: string) => Promise<SemanticScore[]>;
const cachePath = "reports/category-semantic-cache.json";
const labels = Object.entries(config.categories);
if (
  labels.length !== categoryNames.length - 1 ||
  labels.some(([name]) => !categoryNames.includes(name))
)
  throw Error(
    "Semantic category descriptions must cover every canonical category.",
  );

export function semanticText(
  dataset: Pick<
    Dataset,
    | "title"
    | "description"
    | "tags"
    | "source_category"
    | "fields"
    | "category_metadata"
  >,
) {
  return [
    `Title: ${normalizeMetadata(dataset.title)}`,
    `Description: ${(dataset.description ?? "").replace(/<[^>]*>/g, " ").slice(0, 1800)}`,
    `Tags: ${dataset.tags.slice(0, 30).join(", ")}`,
    `Publisher category: ${dataset.source_category ?? ""}`,
    ...(dataset.category_metadata
      ? [
          `Parent item context (may describe other layers): ${dataset.category_metadata.itemSummary} ${dataset.category_metadata.itemDescription}`.slice(
            0,
            1600,
          ),
        ]
      : []),
    `Fields: ${(dataset.fields ?? [])
      .slice(0, 30)
      .map((f) => `${f.name} ${f.alias ?? ""}`)
      .join(", ")}`,
  ].join("\n");
}
export function semanticKey(text: string, inputHash = "") {
  return createHash("sha256")
    .update(JSON.stringify(config) + text + inputHash)
    .digest("hex");
}
export function semanticDecision(scores: SemanticScore[]) {
  const sorted = [...scores].sort(
    (a, b) => b.score - a.score || a.category.localeCompare(b.category),
  );
  if (
    sorted.length !== labels.length ||
    new Set(sorted.map((s) => s.category)).size !== labels.length ||
    sorted.some(
      (s) =>
        !labels.some(([name]) => name === s.category) ||
        !Number.isFinite(s.score) ||
        s.score < 0 ||
        s.score > 1,
    )
  )
    throw Error("Invalid semantic model scores");
  return {
    scores: sorted,
    accepted:
      sorted[0].score >= config.minimumScore &&
      sorted[0].score - sorted[1].score >= config.minimumMargin,
  };
}
export function entailmentScore(logits: number[], entailmentId: number) {
  if (
    logits.length !== 3 ||
    !logits.every(Number.isFinite) ||
    !Number.isInteger(entailmentId) ||
    entailmentId < 0 ||
    entailmentId >= logits.length
  )
    throw Error("Invalid NLI logits or entailment label");
  const maximum = Math.max(...logits);
  const weights = logits.map((value) => Math.exp(value - maximum));
  return weights[entailmentId] / weights.reduce((sum, value) => sum + value, 0);
}
export async function loadInference(
  settings: { model: string; revision: string } = config,
): Promise<Infer> {
  const { env, AutoTokenizer, AutoModelForSequenceClassification } =
    await import("@huggingface/transformers");
  env.cacheDir = ".wrangler/models";
  const tokenizer = await AutoTokenizer.from_pretrained(settings.model, {
    revision: settings.revision,
  });
  const model = await AutoModelForSequenceClassification.from_pretrained(
    settings.model,
    {
      revision: settings.revision,
      dtype: "q8",
      device: "cpu",
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    },
  );
  const modelConfig = z
    .object({ label2id: z.record(z.string(), z.number().int().nonnegative()) })
    .parse(model.config);
  const entailmentId = Object.entries(modelConfig.label2id).find(
    ([label]) => label.toLowerCase() === "entailment",
  )?.[1];
  if (typeof entailmentId !== "number")
    throw Error("Model must identify its entailment label.");
  return async (text) => {
    const scores: SemanticScore[] = [];
    for (const [category, description] of labels) {
      const inputs = tokenizer(text, {
        text_pair: `This dataset describes ${description}.`,
        padding: true,
        truncation: true,
        max_length: 512,
      });
      const output = await model(inputs);
      // Include neutral evidence: E/(E+C) alone can look confident when both
      // entailment and contradiction are tiny relative to neutral.
      const logits = Array.from(output.logits.data, Number);
      scores.push({ category, score: entailmentScore(logits, entailmentId) });
    }
    return scores;
  };
}
export async function categorizeWithSemantic(
  candidate: DiscoveryReport,
  curated: Dataset[],
  previous: DiscoveryReport,
  updateRefreshChanges = true,
  options: { enrich?: boolean } = {},
) {
  const previousById = new Map(
    previous.datasets.map((dataset) => [dataset.id, dataset]),
  );
  const withEvidence = {
    ...candidate,
    datasets: candidate.datasets.map((dataset) => {
      const old = previousById.get(dataset.id);
      if (
        !old ||
        old.serviceUrl !== dataset.serviceUrl ||
        old.layerId !== dataset.layerId
      )
        return dataset;
      return {
        ...dataset,
        description:
          old.metadata_check || old.category_metadata
            ? old.description
            : dataset.description,
        category_metadata: dataset.category_metadata ?? old.category_metadata,
        metadata_check: dataset.metadata_check ?? old.metadata_check,
        category_input_hash: old.category_input_hash,
      };
    }),
  };
  let classified = categorizeReport(withEvidence, curated, previous, false);
  const enrichment =
    options.enrich === false
      ? { datasets: classified.report.datasets, issues: [], requests: 0 }
      : await enrichCategoryMetadata(
          classified.report.datasets,
          updateRefreshChanges,
        );
  classified = categorizeReport(
    { ...classified.report, datasets: enrichment.datasets },
    curated,
    previous,
    false,
  );
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/category-enrichment.json",
    JSON.stringify(
      {
        requests: enrichment.requests,
        issues: enrichment.issues,
        enriched: enrichment.datasets.filter((d) => d.category_metadata).length,
      },
      null,
      2,
    ) + "\n",
  );
  let cache: z.infer<typeof cacheSchema> = {};
  try {
    cache = cacheSchema.parse(JSON.parse(await readFile(cachePath, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const attempts: {
    id: string;
    title: string;
    accepted: boolean;
    cached: boolean;
    scores: SemanticScore[];
  }[] = [];
  let infer: Infer | undefined;
  const usedKeys = new Set<string>();
  const classify = async (dataset: Dataset): Promise<Dataset> => {
    dataset = { ...dataset, category_input_hash: classificationHash(dataset) };
    if (dataset.category_source !== "uncategorized") return dataset;
    const text = semanticText(dataset),
      key = semanticKey(text, dataset.category_input_hash);
    // One-time migration of legacy text-only cache entries. Future changes use
    // the full metadata hash, including content beyond model context limits.
    if (
      !cache[key] &&
      !previousById.get(dataset.id)?.category_input_hash &&
      cache[semanticKey(text)]
    )
      cache[key] = cache[semanticKey(text)];
    const cached = Boolean(cache[key]);
    usedKeys.add(key);
    if (!cached) {
      infer ??= await loadInference();
      cache[key] = semanticDecision(await infer(text)).scores;
      console.log(
        `Semantic inference ${attempts.length + 1}: ${dataset.title}`,
      );
    }
    const decision = semanticDecision(cache[key]);
    attempts.push({
      id: dataset.id,
      title: dataset.title,
      cached,
      ...decision,
    });
    if (!decision.accepted) return dataset;
    return {
      ...dataset,
      category: decision.scores[0].category,
      category_source: "semantic",
      category_confidence: "medium",
      category_review: null,
      category_version: `${dataset.category_version}+semantic-${config.version}`,
      category_signals: [
        `model:${config.model}@${config.revision}`,
        ...decision.scores
          .slice(0, 2)
          .map((s) => `${s.category}:${s.score.toFixed(4)}`),
      ],
    };
  };
  // Sequential inference bounds CPU and memory use on Actions runners.
  const report = classified.report;
  for (let i = 0; i < report.datasets.length; i++)
    report.datasets[i] = await classify(report.datasets[i]);
  for (let i = 0; i < (report.curatedUpdates?.length ?? 0); i++)
    report.curatedUpdates![i] = await classify(report.curatedUpdates![i]);
  if (updateRefreshChanges && report.refresh)
    report.refresh = {
      ...report.refresh,
      changes: catalogChanges(previous.datasets, report.datasets),
    };
  const review = classificationReview(
    mergeDatasets(report.curatedUpdates ?? curated, report.datasets),
    mergeDatasets(previous.curatedUpdates ?? curated, previous.datasets),
  );
  await mkdir("reports", { recursive: true });
  await writeFile(
    `${cachePath}.pending`,
    JSON.stringify(
      Object.fromEntries([...usedKeys].sort().map((key) => [key, cache[key]])),
      null,
      2,
    ) + "\n",
  );
  await rename(`${cachePath}.pending`, cachePath);
  await writeFile(
    "reports/category-semantic-review.json",
    JSON.stringify(
      {
        model: config.model,
        revision: config.revision,
        version: config.version,
        minimumScore: config.minimumScore,
        minimumMargin: config.minimumMargin,
        note: "Uncalibrated model scores; acceptance thresholds are heuristics, not accuracy guarantees.",
        attempted: attempts.length,
        accepted: attempts.filter((a) => a.accepted).length,
        attempts,
      },
      null,
      2,
    ) + "\n",
  );
  const queue = report.datasets
    .filter((d) => d.category === "Uncategorized")
    .map((dataset) => {
      const attempt = attempts.find((a) => a.id === dataset.id);
      return {
        id: dataset.id,
        title: dataset.title,
        reason: !dataset.description
          ? "missing-layer-description"
          : attempt && attempt.scores[0].score >= config.minimumScore
            ? "competing-semantic-categories"
            : "below-semantic-threshold",
        description: dataset.description,
        parentSummary: dataset.category_metadata?.itemSummary ?? null,
        layerUrl: dataset.category_metadata?.layerUrl ?? null,
        itemUrl: dataset.category_metadata?.itemUrl ?? null,
        fields: (dataset.fields ?? [])
          .slice(0, 30)
          .map((f) => ({ name: f.name, alias: f.alias })),
        keywordSignals: dataset.category_signals,
        semanticCandidates: attempt?.scores.slice(0, 3) ?? [],
      };
    });
  await writeFile(
    "reports/category-triage.json",
    JSON.stringify(
      {
        total: queue.length,
        note: "Evidence queue for review, not additional automatic assignments. Inspect layer purpose before adding contextual rules or overrides; shared parent text can describe other layers.",
        records: queue,
      },
      null,
      2,
    ) + "\n",
  );
  const oldEffective = new Map(
    mergeDatasets(previous.curatedUpdates ?? curated, previous.datasets).map(
      (d) => [d.id, d],
    ),
  );
  const at = new Date().toISOString();
  const historyEvents = mergeDatasets(
    report.curatedUpdates ?? curated,
    report.datasets,
  )
    .map((d) => categoryChange(oldEffective.get(d.id), d, at))
    .filter((event): event is NonNullable<typeof event> => event !== null);
  return { report, review, historyEvents };
}
