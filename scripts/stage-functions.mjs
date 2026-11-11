// OneDrive reparse points are skipped by Wrangler's Functions route scanner.
// Stage ordinary files while preserving relative imports for the compiler.
import { readdir, readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

await mkdir(".wrangler", { recursive: true });
const target = await mkdtemp(".wrangler/functions-stage-");
async function copy(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copy(from, to);
    else await writeFile(to, await readFile(from));
  }
}
for (const directory of ["functions", "src", "config", "public"])
  await copy(directory, join(target, directory));
console.log(`Staged Functions in ${target}`);
const result = spawnSync(process.execPath, [
  "node_modules/wrangler/bin/wrangler.js",
  "pages", "functions", "build", join(target, "functions"),
  "--outdir", "dist/_worker.js",
], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
