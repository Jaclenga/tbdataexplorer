# Tampa Bay Open Data Explorer

Find public Tampa Bay datasets, preview live records, explore maps, and export the records you load.

Powered by [tampaBayOpenData](https://jaclenga.github.io/tampaBayOpenData/).

**[Open the explorer →](https://tbdataexplorer.pages.dev)**

## What it does

- Search a checked catalog from [tampaBayOpenData](https://jaclenga.github.io/tampaBayOpenData/) alongside datasets discovered daily from government portals.
- View live publisher records, field details, filters, and maps where supported.
- Download the current page as CSV or GeoJSON.
- Copy ready-to-run code from the **Use in R** tab.

Checked and discovered datasets are clearly labeled. Publisher update times are shown separately from the app's verification times. Unavailable sources keep their publisher links.

Previews load up to 100 records per page, with navigation capped at 10,000 records. Exports contain only the loaded page. Availability and supported features depend on the publisher.

## Run locally

Use Node.js 24 and npm. R is not required to run the website.

```sh
npm ci
npm run dev
```

## Test

```sh
npx playwright install chromium
npm run test:all
```

For individual checks and test coverage, see the [testing guide](docs/testing.md).

## Deploy

The app uses React, TypeScript, and Vite on Cloudflare Pages. Small server functions deliver catalog metadata and provide an allowlisted fallback for blocked publisher requests. A private Durable Object manages proxy request limits. Government records stay with their publishers.

With Cloudflare credentials configured for the existing project:

```sh
npm run deploy
```

This builds the app, deploys the private guard, then publishes the site. The manual [deployment workflow](.github/workflows/deploy.yml) does the same. Validation and tests run separately in [Application checks](.github/workflows/ci.yml) on every push and pull request; check those results before publishing.

## Technical guides

- [SEO, indexable dataset pages, sitemap, and search engine submission](docs/seo.md)

- [Dataset source verification, statuses, and scheduling](docs/dataset-verification.md)

- [Catalog health metrics, verification, and coverage limitations](docs/catalog-health.md)

- [Metadata categorization, overrides, and evaluation](docs/categorization.md)
- [Catalog browsing and shared views](docs/catalog-browsing.md)
- [Scheduled refreshes and troubleshooting](docs/scheduled-refresh.md)
- [Discovery, adapters, catalog maintenance, and freshness](docs/federation.md)
- [Security, request limits, and local proxy setup](docs/security-fixes.md)
- [Architecture and implementation notes](docs/implementation.md)

Independent project. Government datasets remain subject to their publishers' terms.

The former site address redirects to the new domain. Historical access reports retain the origin where they were recorded.
