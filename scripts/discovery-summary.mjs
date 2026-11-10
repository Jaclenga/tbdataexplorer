import { readFileSync, existsSync } from "node:fs";
const path = ".wrangler/discovery-refresh.json";
if (!existsSync(path)) {
  console.log(
    "No new scan report was produced. See the failed refresh/validation step; the committed catalog remains intact.",
  );
} else {
  const report = JSON.parse(readFileSync(path, "utf8"));
  const refresh = report.refresh;
  console.log(
    `Catalog check: ${report.generatedAt}\n\nOutcome: **${refresh.outcome}**. ${refresh.verified} datasets verified; ${refresh.curatedErrors} curated checks failed.\n\n${report.datasets.length} retained public layers. Configured discovery scope fully scanned: ${report.complete ? "yes" : "no"}. This is not a complete regional inventory.\n\n${refresh.changes.added.length} added; ${refresh.changes.updated.length} metadata changes; ${refresh.changes.retained} retained.\n\n| Portal | Items scanned / reported | Layers | Issues |\n| --- | --- | --- | --- |`,
  );
  for (const run of report.runs)
    console.log(
      `| ${run.portalId} | ${run.itemsScanned} / ${run.totalItems ?? "unknown"} | ${run.datasetsFound} | ${run.issues.length} |`,
    );
  for (const run of report.runs)
    for (const issue of run.issues)
      console.log(
        `\n- ${run.portalId}: ${issue.kind}: ${issue.message.replaceAll("\n", " ")}`,
      );
}

if (existsSync(".wrangler/category-review.json")) {
  const categories = JSON.parse(
    readFileSync(".wrangler/category-review.json", "utf8"),
  );
  console.log(
    `\nCategory rules ${categories.version}: ${categories.total} datasets; ${categories.sources.override} overrides, ${categories.sources.curated} curated, ${categories.sources.publisher} trusted publisher, ${categories.sources.nlp} keyword NLP, ${categories.sources.semantic ?? 0} semantic, ${categories.sources.uncategorized} uncategorized. ${categories.review.filter((d) => d.reason === "ambiguous").length} ambiguous; ${categories.changes.length} changed assignments. See the category-review artifact for signals, candidates and distribution warnings.`,
  );
}
