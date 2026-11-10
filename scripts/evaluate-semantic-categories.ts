import { readFile, writeFile } from "node:fs/promises";
import examples from "../tests/fixtures/semantic-evaluation.json";
import config from "../config/semantic-categories.json";
import { predictCategory } from "../src/services/discovery/categorization";
import {
  loadInference,
  semanticDecision,
  semanticKey,
  semanticText,
  type Infer,
  type SemanticScore,
} from "./semantic-categorization";

const cache: Record<string, SemanticScore[]> = JSON.parse(
  await readFile("reports/category-semantic-cache.json", "utf8"),
);
let infer: Infer | undefined;
const rows = [];
for (const example of examples) {
  const keyword = predictCategory({ ...example.metadata, category: null });
  let predicted = keyword.category;
  if (predicted === "Uncategorized") {
    const text = semanticText(example.metadata),
      key = semanticKey(text);
    if (!cache[key]) {
      infer ??= await loadInference();
      cache[key] = await infer(text);
    }
    const decision = semanticDecision(cache[key]);
    if (decision.accepted) predicted = decision.scores[0].category;
  }
  rows.push({
    id: example.id,
    title: example.metadata.title,
    expected: example.expected,
    predicted,
    correct: predicted === example.expected,
  });
}
const errors = rows.filter(
  (row) => !row.correct && row.predicted !== "Uncategorized",
);
const report = {
  model: config.model,
  revision: config.revision,
  version: config.version,
  methodology:
    "Small reviewed development regression set chosen while inspecting model output; not an independent holdout or population accuracy estimate. Publisher category and manual overrides withheld. Incorrect abstentions are reported separately from incorrect assignments.",
  total: rows.length,
  correct: rows.filter((row) => row.correct).length,
  incorrectAssignments: errors.length,
  abstentionsOnLabeledRecords: rows.filter(
    (row) =>
      row.predicted === "Uncategorized" && row.expected !== "Uncategorized",
  ).length,
  rows,
};
const path = "reports/category-semantic-evaluation.json",
  content = JSON.stringify(report, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if ((await readFile(path, "utf8")) !== content)
    throw Error(
      "Semantic evaluation report is stale; run npm run category:semantic:evaluate.",
    );
} else await writeFile(path, content);
console.log(JSON.stringify(report, null, 2));
if (errors.length)
  throw Error(
    `${errors.length} incorrect semantic assignments on reviewed regression examples.`,
  );
