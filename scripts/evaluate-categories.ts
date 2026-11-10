import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import examples from "../tests/fixtures/category-evaluation.json";
import {
  predictCategory,
  categoryConfig,
} from "../src/services/discovery/categorization";
const rows = examples.map((example) => {
  const prediction = predictCategory({ ...example.metadata, category: null });
  return {
    id: example.id,
    title: example.metadata.title,
    expected: example.expected,
    predicted: prediction.category,
    tier: prediction.tier,
    correct: prediction.category === example.expected,
  };
});
const correct = rows.filter((row) => row.correct).length;
const report = {
  version: categoryConfig.version,
  methodology:
    "Development evaluation: 52 existing curated labels plus 33 manually reviewed real discovered records. Title, description, tags and fields only; category withheld to prevent label leakage. This small development set is not an independent holdout or a population accuracy estimate. Confidence tiers are not probabilities.",
  total: rows.length,
  correct,
  accuracy: correct / rows.length,
  byCategory: [...new Set(rows.map((r) => r.expected))]
    .sort()
    .map((category) => ({
      category,
      total: rows.filter((r) => r.expected === category).length,
      correct: rows.filter((r) => r.expected === category && r.correct).length,
    })),
  confusionCases: rows.filter((r) => !r.correct),
};
await mkdir("reports", { recursive: true });
const path = "reports/category-evaluation.json";
const content = JSON.stringify(report, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== content)
    throw Error(
      "Category evaluation report is stale; run npm run category:evaluate.",
    );
} else await writeFile(path, content);
const started = performance.now();
for (let i = 0; i < 10000; i++)
  predictCategory({
    ...examples[i % examples.length].metadata,
    category: null,
  });
console.log(
  JSON.stringify(
    {
      ...report,
      benchmark: {
        records: 10000,
        milliseconds: Math.round(performance.now() - started),
      },
    },
    null,
    2,
  ),
);
