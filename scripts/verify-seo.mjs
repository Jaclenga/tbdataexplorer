import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Run against `wrangler pages dev`, not Vite preview (which has SPA fallback).
const base = process.env.SEO_BASE_URL ?? "http://127.0.0.1:8788";
const origin = "https://tbdataexplorer.org";
const xmlResponse = await fetch(`${base}/sitemap.xml`);
assert.equal(xmlResponse.status, 200);
assert.match(xmlResponse.headers.get("content-type"), /xml/);
const xml = await xmlResponse.text();
assert.match(xml, /<urlset/);
assert.ok(!xml.includes("<lastmod>"));
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.equal(urls[0], origin + "/");
assert.equal(new Set(urls).size, urls.length);
assert.ok(urls.every((url) => url.startsWith(origin + "/") && !/[?#]/.test(url)));
const catalog = JSON.parse(await readFile("public/catalog.json", "utf8"));
const path = `/datasets/${catalog.datasets[0].id.split("/").map((part) => encodeURIComponent(part).replace(/~/g, "%7E").replace(/%/g, "~")).join("/")}/`;
const discovered = urls.find((url) => url.includes("arcgis~3A"));
for (const route of ["/", "/datasets", path, ...(discovered ? [new URL(discovered).pathname] : [])]) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, route);
  assert.ok(!/noindex/i.test(response.headers.get("x-robots-tag") ?? ""));
  const html = await response.text();
  assert.match(html, /<h1[\s>]/);
  assert.ok(html.includes(`href="${origin}${route}"`), `Canonical for ${route}`);
  assert.match(html, /application\/ld\+json/);
}
const robots = await fetch(`${base}/robots.txt`);
assert.equal(robots.status, 200);
assert.ok((await robots.text()).includes(`Sitemap: ${origin}/sitemap.xml`));
for (const route of ["/datasets/nonexistent-dataset/", "/nonexistent-page", "/datasets/%ZZ/"]) {
  const response = await fetch(base + route);
  // Cloudflare may reject invalid percent escapes before reaching Pages.
  if (route.includes("%ZZ") && response.status === 400) continue;
  assert.equal(response.status, 404, route);
  assert.match(await response.text(), /noindex/);
}
console.log(`Cloudflare Pages SEO verified: ${urls.length} sitemap URLs, public robots, HTML, canonicals, JSON-LD, and missing-page 404s.`);
