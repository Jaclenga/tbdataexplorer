// Offline metadata migration; never claim a new publisher verification.
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { parseCatalog } from "../src/services/catalog";
import { discoverySchema } from "../src/services/discovery/types";
import { categorizeWithSemantic } from "./semantic-categorization";
import { validateIndex } from "../src/server/discovery-index";
const previous = discoverySchema.parse(
  JSON.parse(await readFile("public/discovery.json", "utf8")),
);
const curated = parseCatalog(
  JSON.parse(await readFile("public/catalog.json", "utf8")),
).datasets;
const classified = await categorizeWithSemantic(previous, curated, previous, false);
const report = validateIndex(classified.report);
const content = JSON.stringify(report, null, 2) + "\n";
if (JSON.stringify(previous) !== JSON.stringify(report)) {
  if (Buffer.byteLength(content) > 4194304)
    throw Error("Catalog exceeds the 4 MiB serving limit.");
  await mkdir("reports", { recursive: true });
  await writeFile("public/discovery.json.pending", content);
  await rename("public/discovery.json.pending", "public/discovery.json");
  await writeFile(
    "reports/category-review.json",
    JSON.stringify(classified.review, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify({
    total: classified.review.total,
    sources: classified.review.sources,
    counts: classified.review.counts,
  }),
);
