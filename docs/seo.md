# Search visibility and sitemap

The original site was a client-rendered Vite/React SPA. Its initial HTML had an
empty root, a generic title/description, no canonical/social metadata, no
structured data, and no sitemap or robots.txt. Dataset URLs were hash fragments;
missing datasets displayed an error inside a successful homepage response.
Existing headings, landmarks, map lazy loading, and security headers were retained.

`npm run build` now builds the client, compiles the prerender script using the
existing Vite React plugin, and generates HTML using React's server renderer.
No new dependencies, framework migration, publisher requests, or user-agent
special cases are involved. The generated homepage uses the existing catalog
components and styling. Without JavaScript, its full dataset link list remains
accessible. Each dataset page includes its actual description, publisher, source
links, provenance, and fields. JavaScript replaces this initial HTML with the
existing interactive explorer. Search, filtering, previews, maps, and exports
continue to use the existing client implementation.

## URLs and metadata

The canonical origin is `https://tbdataexplorer.org`. Dataset paths are generated
from catalog identifiers, for example `/datasets/tampa/construction-permits/`.
Reserved characters use reversible `~XX` escapes rather than percent-encoded
filenames, so identifiers such as `arcgis:…:3` work on both Cloudflare Pages and
Windows. Existing `/#dataset-id` bookmarks and client navigation still work;
dataset cards expose real paths in their hrefs, including for opening a new tab.

Every generated page has a unique title, description, canonical URL, Open Graph
and Twitter summary metadata, English language and viewport attributes, and
JSON-LD. Homepage markup describes the WebSite. Dataset markup attributes the
government publisher and links to its source. Unknown coverage, licenses, and
modification dates are omitted. Publisher terms are not assumed to be a license.
No Organization ownership or government affiliation is claimed for this project.

Dataset pages in the deployed snapshot are individually indexable. The sitemap
uses exactly the same merged, deduplicated curated/discovered catalog as the page
generator. Query parameters, hash views (including Catalog Health), filters,
API endpoints, and missing IDs are excluded. No sitemap lastmod is emitted:
catalog generation/verification timestamps do not establish when a page changed.
Sitemaps split automatically at 50,000 URLs or 50 MiB, with an index at
`/sitemap.xml` when needed. Output uses XML escaping and absolute canonical URLs.

`public/robots.txt` permits public crawling and names the sitemap. The generated
root `404.html` disables Cloudflare Pages' implicit SPA fallback, returning a
real HTTP 404 for nonexistent dataset and other paths. Existing Pages Functions,
API routing, proxy guard, and security headers are retained. Local Vite preview
has different fallback behavior; use Pages local development to verify 404s.
See [Cloudflare's serving behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Refresh and deployment

The existing deploy workflow still builds and uploads `dist`. The daily discovery
workflow now uploads its validated build too, keeping generated dataset pages and
sitemap entries in sync with additions/removals. That job needs repository-level
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets, using the same credentials
as the existing Pages deployment. If those secrets exist only in the `production`
environment, make them available to the refresh job before enabling this change.
The private guard's deployment is unchanged. Metadata may appear in the live API
before its static pages finish deploying; sitemap inclusion follows deployment.

No production deployment or Search Console submission is performed by the code
change itself. After deploying, verify public responses and any dashboard-managed
Cloudflare access rules, redirects, or headers; local source inspection cannot
establish dashboard configuration. Preview deployments may intentionally noindex.

## Verification

Run `npm run test`, `npm run lint`, `npm run build`,
`npm run build:functions`, `npm run test:guard`, and `npm run test:e2e`.
SEO unit tests cover safe URLs, HTML/JSON-LD/XML escaping, attribution, omitted
unknown metadata, deduplication, and both sitemap split limits. Browser tests
check XML parsing, no-JavaScript pages, metadata, and interactive deep links.

With `npx wrangler pages dev dist --port 8788 --ip 127.0.0.1` running, execute
`node scripts/verify-seo.mjs`. It checks HTTP 200 for sitemap/robots and sample
curated/discovered pages, canonical HTML, JSON-LD, and HTTP 404 for missing paths.
Set `SEO_BASE_URL=https://tbdataexplorer.org` to check the deployment. This check
expects the current small sitemap to be a URL set; unit tests cover future indexes.

On Windows, OneDrive placeholder/reparse files can be skipped by Wrangler's
Functions directory scan. `node scripts/stage-seo-check.mjs` makes an ordinary-file
copy under ignored `.wrangler/seo-check` without changing source attributes.
Use `npx wrangler pages functions build .wrangler/seo-check/functions --outdir .wrangler/seo-functions-build`
and `npx wrangler pages dev ../../dist --cwd .wrangler/seo-check --port 8788 --ip 127.0.0.1`
for equivalent local verification when affected.

## Submit after deploying

1. In [Google Search Console](https://search.google.com/search-console), add and
   verify the domain property `tbdataexplorer.org` using its DNS TXT record (or
   select the existing property). Under **Sitemaps**, submit
   `https://tbdataexplorer.org/sitemap.xml`. Inspect the homepage and representative
   dataset URLs with URL Inspection and its live test. Monitor sitemap processing
   and Page indexing reports.
2. In [Bing Webmaster Tools](https://www.bing.com/webmasters/), add and verify the
   site, or import its verified Google Search Console property. Under **Sitemaps**,
   submit the same sitemap URL and monitor processing and URL Inspection.

A sitemap helps discovery; crawlability and successful submission do not guarantee
indexing or rankings. See [Google's sitemap guidance](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
and [Bing's sitemap help](https://www.bing.com/webmasters/help/Sitemaps-3b5cf6ed).
