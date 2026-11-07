import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { parseCatalog } from "../src/services/catalog";
import { parseAccessReport } from "../src/services/access";
import { discoverySchema } from "../src/services/discovery/types";
import { federatedCatalog } from "../src/services/federated-catalog";
import { SiteHeader, SiteFooter } from "../src/components/SiteChrome";
import CatalogPage from "../src/components/CatalogPage";
import DatasetHeader from "../src/components/DatasetHeader";
import { DatasetFields } from "../src/components/DatasetProvenance";
import { datasetPath, datasetStructuredData, datasetDescription, homeDescription, homeTitle, pageMetadata, sitemapFiles, siteOrigin } from "../src/services/seo";

const readJson = async (name: string) => JSON.parse(await readFile(`public/${name}.json`, "utf8"));
const curated = parseCatalog(await readJson("catalog"));
const access = parseAccessReport(await readJson("access"), curated);
const discovery = discoverySchema.parse(await readJson("discovery"));
const catalog = federatedCatalog(curated, discovery);
const template = (await readFile("dist/index.html", "utf8"))
  .replace(/<title>[\s\S]*?<\/title>/, "")
  .replace(/<meta\s+name="description"[\s\S]*?>/, "");

async function emit(path: string, body: string, metadata: string) {
  const target = join("dist", path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, template.replace("</head>", () => `${metadata}</head>`).replace('<div id="root"></div>', () => `<div id="root">${body}</div>`));
}
const noop = () => {};
const home = renderToStaticMarkup(<>
  <a className="skip" href="#main">Skip to content</a>
  <SiteHeader catalog />
  <CatalogPage catalog={catalog} access={access} discovery={discovery} discoveryWarning={null}
    filters={{ query: "", publisher: "", category: "", spatial: "" }} sort="name-asc"
    page={1} pageSize={20} expanded={new Set()} onChange={noop} onSort={noop} onPage={noop} onPageSize={noop} onExpand={noop} />
  <noscript><div className="shell"><p>Enable JavaScript for search, filtering, and live previews. Dataset descriptions and publisher links remain available below.</p><h2>All datasets</h2><ul>{catalog.datasets.map((dataset) => <li key={dataset.id}><a href={datasetPath(dataset.id)}>{dataset.title} — {dataset.publisher}</a></li>)}</ul></div></noscript>
  <SiteFooter />
</>);
await emit("index.html", home, pageMetadata(homeTitle, homeDescription, "/", {
  "@context": "https://schema.org", "@type": "WebSite", name: "Tampa Bay Open Data Explorer", url: siteOrigin + "/", description: homeDescription,
}));
for (const dataset of catalog.datasets) {
  const body = renderToStaticMarkup(<>
    <a className="skip" href="#main">Skip to content</a><SiteHeader />
    <main id="main" className="detail shell"><DatasetHeader dataset={dataset} /><DatasetFields fields={dataset.fields} />
      <noscript><p>Enable JavaScript for live previews, maps, and exports. You can also visit the publisher’s original source above.</p></noscript>
    </main><SiteFooter />
  </>);
  await emit(`${datasetPath(dataset.id).slice(1)}index.html`, body,
    pageMetadata(`${dataset.title} | Tampa Bay Open Data Explorer`, datasetDescription(dataset), datasetPath(dataset.id), datasetStructuredData(dataset)));
}
// A root 404 disables Pages' SPA fallback, so missing dataset URLs return 404.
await writeFile("dist/404.html", '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found | Tampa Bay Open Data Explorer</title></head><body><main><h1>Page not found</h1><p>This dataset or page does not exist.</p><a href="/">Return to the catalog</a></main></body></html>');
for (const [name, xml] of sitemapFiles([siteOrigin + "/", ...catalog.datasets.map((dataset) => siteOrigin + datasetPath(dataset.id))]))
  await writeFile(join("dist", name), xml);
console.log(`Prerendered homepage and ${catalog.datasets.length} dataset pages; generated sitemap.`);
