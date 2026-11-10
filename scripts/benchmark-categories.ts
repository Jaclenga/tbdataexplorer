import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import examples from "../tests/fixtures/category-benchmark.json";
import { enrichCategoryMetadata } from "./enrich-category-metadata";
import {
  loadInference,
  semanticText,
  type SemanticScore,
} from "./semantic-categorization";
import config from "../config/semantic-categories.json";
import { predictCategory } from "../src/services/discovery/categorization";
import { discoverySchema } from "../src/services/discovery/types";

const models = [
  { model: config.model, revision: config.revision },
  {
    model: "Xenova/distilbert-base-uncased-mnli",
    revision: "fddd480db7392a87114a6813c6acb5ede13ff4ee",
  },
];
await mkdir(".wrangler", { recursive: true });
// Freeze identical enriched inputs for both models; endpoint verification dates are untouched.
const catalog = discoverySchema.parse(
  JSON.parse(await readFile("public/discovery.json", "utf8")),
);
const selected = catalog.datasets
  .filter((d) => examples.some((e) => e.id === d.id))
  .map((d) => ({ ...d, category_source: "uncategorized" as const }));
const enriched = process.argv.includes("--refresh-metadata")
  ? await enrichCategoryMetadata(selected, false)
  : { datasets: [] };
const frozen = examples.map((example) => {
  const live = enriched.datasets.find((d) => d.id === example.id);
  const metadata = live
    ? {
        title: live.title,
        description: live.description,
        tags: live.tags,
        fields: live.fields,
        category_metadata: live.category_metadata,
        source_category: null,
      }
    : example.metadata;
  return {
    ...example,
    metadata,
    split:
      parseInt(
        createHash("sha256")
          .update(example.metadata.title.toLowerCase())
          .digest("hex")
          .slice(0, 8),
        16,
      ) %
        3 ===
      0
        ? "validation"
        : "tuning",
    text: semanticText(metadata),
  };
});
await writeFile(
  "tests/fixtures/category-benchmark.json",
  JSON.stringify(
    frozen.map((row) => ({
      id: row.id,
      expected: row.expected,
      metadata: row.metadata,
      split: row.split,
    })),
    null,
    2,
  ) + "\n",
);
type Scored = {
  id: string;
  expected: string;
  split: string;
  scores: SemanticScore[];
};
const measure = (
  rows: Scored[],
  minimumScore: number,
  minimumMargin: number,
) => {
  let correct = 0,
    incorrect = 0,
    abstained = 0;
  for (const row of rows) {
    const [first, second] = row.scores;
    const predicted =
      first.score >= minimumScore && first.score - second.score >= minimumMargin
        ? first.category
        : "Uncategorized";
    if (predicted === "Uncategorized") abstained++;
    else if (predicted === row.expected) correct++;
    else incorrect++;
  }
  return {
    correct,
    incorrect,
    abstained,
    precision: correct + incorrect ? correct / (correct + incorrect) : null,
  };
};
const results = [];
for (const settings of models) {
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ settings, categories: config.categories, frozen }))
    .digest("hex");
  const path = `.wrangler/benchmark-${inputHash}.json`;
  let cached: { rows: Scored[]; milliseconds: number } | undefined;
  try {
    cached = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (!cached) {
    const infer = await loadInference(settings),
      started = performance.now(),
      rows: Scored[] = [];
    for (const row of frozen) {
      const scores = (await infer(row.text)).sort(
        (a, b) => b.score - a.score || a.category.localeCompare(b.category),
      );
      rows.push({
        id: row.id,
        expected: row.expected,
        split: row.split,
        scores,
      });
      console.log(`${settings.model}: ${rows.length}/${frozen.length}`);
    }
    cached = { rows, milliseconds: Math.round(performance.now() - started) };
    await writeFile(path, JSON.stringify(cached, null, 2) + "\n");
  }
  const tuning = cached.rows.filter((r) => r.split === "tuning"),
    validation = cached.rows.filter((r) => r.split === "validation");
  const grid = [0.55, 0.65, 0.75, 0.85, 0.95].flatMap((minimumScore) =>
    [0.1, 0.2, 0.3].map((minimumMargin) => ({
      minimumScore,
      minimumMargin,
      ...measure(tuning, minimumScore, minimumMargin),
    })),
  );
  const selected = grid
    .filter((row) => row.incorrect === 0 && row.correct > 0)
    .sort(
      (a, b) =>
        b.correct - a.correct ||
        b.minimumScore - a.minimumScore ||
        b.minimumMargin - a.minimumMargin,
    )[0];
  results.push({
    ...settings,
    milliseconds: cached.milliseconds,
    grid,
    selected: selected ?? null,
    validation: selected
      ? measure(validation, selected.minimumScore, selected.minimumMargin)
      : null,
    currentThresholds: {
      tuning: measure(tuning, config.minimumScore, config.minimumMargin),
      validation: measure(
        validation,
        config.minimumScore,
        config.minimumMargin,
      ),
    },
    rows: cached.rows,
  });
}
const keyword = frozen.map((e) => ({
  id: e.id,
  expected: e.expected,
  predicted: predictCategory({ ...e.metadata, category: null }).category,
}));
await writeFile(
  "reports/category-benchmark.json",
  JSON.stringify(
    {
      methodology:
        "Reviewed development examples, including known failures. Frozen inputs; title hashes determine tuning/validation groups so repeated titles stay together. Threshold selection uses tuning records only. Small convenience sample, not independent population accuracy. Model scores include neutral. Runtime excludes download and initialization.",
      total: frozen.length,
      deploymentDecision: {
        model: config.model,
        minimumScore: config.minimumScore,
        minimumMargin: config.minimumMargin,
        reason:
          "Retain the deployed configuration unless a tuning-selected candidate improves correct validation assignments without incorrect validation assignments. The small development sample does not establish population accuracy.",
        validatedCandidates: results
          .filter(
            (result) =>
              result.selected &&
              result.validation?.incorrect === 0 &&
              (result.validation?.correct ?? 0) >
                (result.currentThresholds.validation.correct ?? 0),
          )
          .map((result) => ({
            model: result.model,
            thresholds: result.selected,
            validation: result.validation,
          })),
      },
      tuning: frozen.filter((r) => r.split === "tuning").length,
      validation: frozen.filter((r) => r.split === "validation").length,
      keyword,
      results,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    results.map(({ model, selected, validation, milliseconds }) => ({
      model,
      selected,
      validation,
      milliseconds,
    })),
    null,
    2,
  ),
);
