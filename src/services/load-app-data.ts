import { parseCatalog } from "./catalog";
import { parseAccessReport } from "./access";
import { loadDiscovery } from "./load-discovery";
import { federatedCatalog } from "./federated-catalog";

// Keep the prerendered page in place until all inputs for the first interactive
// render are ready. Never collapse it to a short loading message in between.
export async function loadAppData(base: string, signal: AbortSignal) {
  const [catalogValue, accessValue] = await Promise.all(
    ["catalog.json", "access.json"].map(async (path) => {
      const response = await fetch(`${base}${path}`, { signal });
      if (!response.ok) throw Error("Catalog or browser access information could not be loaded.");
      return response.json();
    }),
  );
  const curated = parseCatalog(catalogValue);
  const access = parseAccessReport(accessValue, curated);
  const { report: discovery, warning } = await loadDiscovery(base, signal);
  signal.throwIfAborted();
  return { catalog: federatedCatalog(curated, discovery), access, discovery, discoveryWarning: warning };
}
export type AppData = Awaited<ReturnType<typeof loadAppData>>;
