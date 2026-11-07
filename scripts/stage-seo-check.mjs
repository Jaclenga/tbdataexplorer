// OneDrive placeholder files are reported as reparse points on Windows, which
// some test/build directory walkers skip. Make an ignored, ordinary-file copy
// for verification without changing any source files or their attributes.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const target = ".wrangler/seo-check";
async function copy(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) await copy(from, to);
    else await writeFile(to, await readFile(from));
  }
}
for (const directory of ["functions", "src", "config", "tests", "public", "scripts"])
  await copy(directory, join(target, directory));
for (const file of ["vite.config.ts", "tsconfig.json", "package.json", "wrangler.jsonc", "worker-configuration.d.ts"])
  await writeFile(join(target, file), await readFile(file));
console.log(`Staged ordinary files in ${target}`);
