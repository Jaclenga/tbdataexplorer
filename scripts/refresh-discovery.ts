import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { z } from "zod";
import { parseCatalog } from "../src/services/catalog";
import { discoverySchema, portalSchema } from "../src/services/discovery/types";
import {
  refreshCatalog,
  catalogChanged,
} from "../src/services/discovery/refresh";
import { categorizeReport } from "../src/services/discovery/classify-catalog";
import { validateIndex } from "../src/server/discovery-index";
function option(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? fallback : Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1) throw Error(`Invalid ${name}`);
  return value;
}
async function read(path: string) {
  return JSON.parse(await readFile(path, "utf8"));
}
async function atomicWrite(path: string, value: unknown) {
  const content = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(content) > 4194304)
    throw Error("Discovery metadata exceeds the 4 MiB serving limit.");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.pending`, content);
  await rename(`${path}.pending`, path);
}
const previous = discoverySchema.parse(await read("public/discovery.json"));
const curated = parseCatalog(await read("public/catalog.json")).datasets;
const candidate = await refreshCatalog({
  portals: z.array(portalSchema).parse(await read("config/portals.json")),
  curated,
  previous,
  options: {
    forceVerification: process.argv.includes("--force-verification"),
    maxItems: option("--max-items", 25),
    maxLayers: option("--max-layers", 100),
    signal: AbortSignal.timeout(option("--timeout-ms", 600000)),
  },
});
const classified = categorizeReport(candidate, curated, previous);
const report = validateIndex(classified.report);
await atomicWrite(resolve(".wrangler/category-review.json"), classified.review);
const changed = catalogChanged(previous, report);
await atomicWrite(resolve(".wrangler/discovery-refresh.json"), report);
if (changed || process.env.DISCOVERY_OUTPUT) {
  await atomicWrite(resolve("reports/category-review.json"), classified.review);
  await atomicWrite(
    resolve(process.env.DISCOVERY_OUTPUT ?? "public/discovery.json"),
    report,
  );
}
console.log(
  JSON.stringify({
    changed,
    ...report.refresh,
    retained: report.datasets.length,
    complete: report.complete,
  }),
);
