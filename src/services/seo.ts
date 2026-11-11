import type { Dataset } from "../types";

export const siteOrigin = "https://tbdataexplorer.org";
export const homeTitle = "Tampa Bay Open Data Explorer | Free Public & GIS Data";
export const homeDescription = "Discover Tampa Bay public data in one place. Search free government datasets covering housing, transportation, development, GIS, and the environment.";
export const datasetsTitle = "Tampa Bay Open Data & GIS Datasets | Data Explorer";
export const datasetsDescription = "Find free public datasets from Tampa Bay governments. Explore GIS, housing, transportation, development, infrastructure, and environmental data.";

export function datasetDescription(dataset: Dataset) {
  return `${dataset.title}, published by ${dataset.publisher}.${dataset.coverage?.trim() ? ` Coverage: ${dataset.coverage.trim()}.` : ""}${dataset.category?.trim() ? ` Category: ${dataset.category.trim()}.` : ""}`;
}

export function homeStructuredData() {
  // The independent project is a website; government publishers are identified
  // on Dataset nodes. No separate legal organization is asserted here.
  return {
    "@context": "https://schema.org", "@type": "WebSite",
    name: "Tampa Bay Open Data Explorer", url: siteOrigin + "/", description: homeDescription,
  };
}

export function datasetPath(id: string) {
  const parts = id.split("/");
  if (parts.some((part) => !part || part === "." || part === ".."))
    throw Error("Invalid dataset path");
  // Keep reserved characters out of filenames as well as URLs: Pages decodes
  // percent escapes when matching assets, and Windows disallows ':' filenames.
  return `/datasets/${parts.map((part) => encodeURIComponent(part).replace(/~/g, "%7E").replace(/%/g, "~")).join("/")}/`;
}

export function pathDatasetId(path: string) {
  if (!path.startsWith("/datasets/")) return "";
  try {
    return path.slice(10).replace(/\/$/, "").split("/").map((part) => decodeURIComponent(part.replace(/~/g, "%"))).join("/");
  } catch { return ""; }
}

export function datasetStructuredData(dataset: Dataset) {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: dataset.title,
    description: dataset.description?.trim() || datasetDescription(dataset),
    url: siteOrigin + datasetPath(dataset.id),
    sameAs: dataset.sourceUrl,
    publisher: { "@type": "Organization", name: dataset.publisher },
    spatialCoverage: dataset.coverage?.trim() || undefined,
    ...(dataset.resource ? { distribution: [{
      "@type": "DataDownload", contentUrl: dataset.resource.url,
      ...(["csv", "json"].includes(dataset.platform ?? "") ? {
        encodingFormat: dataset.platform === "csv" ? "text/csv" : "application/json",
      } : {}),
    }] } : {}),
    // Publisher terms are not necessarily a license. Verification dates are
    // not modification dates, and source updates need not modify this page.
    dateModified: dataset.sourceUpdatedAt ?? undefined,
  };
}

export function escapeMarkup(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
}

export function jsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function pageMetadata(title: string, description: string, path: string, structured: unknown) {
  const url = siteOrigin + path;
  return `<title>${escapeMarkup(title)}</title>
<meta name="description" content="${escapeMarkup(description)}">
<link rel="canonical" href="${escapeMarkup(url)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeMarkup(title)}">
<meta property="og:description" content="${escapeMarkup(description)}">
<meta property="og:url" content="${escapeMarkup(url)}">
<meta property="og:site_name" content="Tampa Bay Open Data Explorer">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeMarkup(title)}">
<meta name="twitter:description" content="${escapeMarkup(description)}">
<script type="application/ld+json" id="structured-data">${jsonLd(structured)}</script>`;
}

function metadataSelector(element: Element) {
  return element.tagName === "META"
      ? `meta[${element.hasAttribute("name") ? "name" : "property"}="${element.getAttribute("name") ?? element.getAttribute("property")}"]`
      : element.tagName === "LINK" ? 'link[rel="canonical"]'
      : element.tagName === "SCRIPT" ? '#structured-data' : "title";
}

export function updatePageMetadata(dataset?: Dataset, datasets = false) {
  const path = dataset ? datasetPath(dataset.id) : datasets ? "/datasets" : "/";
  const title = dataset ? `${dataset.title} | Tampa Bay Open Data Explorer` : datasets ? datasetsTitle : homeTitle;
  const description = dataset ? datasetDescription(dataset) : datasets ? datasetsDescription : homeDescription;
  const structured = dataset ? datasetStructuredData(dataset) : datasets ? {
    "@context": "https://schema.org", "@type": "CollectionPage",
    name: datasetsTitle, url: siteOrigin + path, description,
  } : homeStructuredData();
  // Replace the shared generated head nodes, including during Vite development
  // where the HTML template does not yet have canonical or JSON-LD elements.
  const template = document.createElement("template");
  template.innerHTML = pageMetadata(title, description, path, structured);
  for (const element of template.content.children) {
    const selector = metadataSelector(element);
    document.head.querySelector(selector)?.remove();
  }
  document.head.appendChild(template.content);
}

export function sitemapFiles(urls: string[], maxUrls = 50000, maxBytes = 50 * 1024 * 1024) {
  const start = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">';
  const end = "</urlset>";
  const chunks: string[] = [];
  let entries: string[] = [];
  let bytes = new TextEncoder().encode(start + end).length;
  for (const url of new Set(urls)) {
    const entry = `<url><loc>${escapeMarkup(url)}</loc></url>`;
    const size = new TextEncoder().encode(entry).length;
    if (entries.length && (entries.length >= maxUrls || bytes + size > maxBytes)) {
      chunks.push(start + entries.join("") + end);
      entries = [];
      bytes = new TextEncoder().encode(start + end).length;
    }
    if (bytes + size > maxBytes) throw Error("Sitemap entry exceeds size limit");
    entries.push(entry);
    bytes += size;
  }
  chunks.push(start + entries.join("") + end);
  if (chunks.length === 1) return new Map([["sitemap.xml", chunks[0]]]);
  if (chunks.length > 50000) throw Error("Sitemap index exceeds URL limit");
  const files = new Map(chunks.map((chunk, i) => [`sitemap-${i + 1}.xml`, chunk]));
  files.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...files.keys()].map((name) => `<sitemap><loc>${siteOrigin}/${name}</loc></sitemap>`).join("")}</sitemapindex>`);
  return files;
}
