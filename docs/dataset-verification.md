# Dataset source verification

Every dataset details panel and metadata drawer shows Source status from the published catalog. Showing this section performs no network requests and does not write verification results. Existing preview and publisher-metadata requests continue separately and do not change the scheduled verification record.

## What the states mean

- **Verified:** the latest completed source check passed the required metadata and structural checks.
- **Failed:** the latest completed check detected an issue. A network failure or timeout describes that attempt; it does not establish permanent removal.
- **Not checked:** no usable completed result exists. Discovery, a valid URL, the legacy curated date and HTTP 200 alone do not establish verification.
- **Stale:** the latest completed result is older than seven days. The last completed result remains visible, including failures. Current availability is unknown.

`config/verification.json` configures the seven-day freshness threshold, 24-hour reuse window, two concurrent checks and 20-second overall deadline per source. The separate 48-hour catalog refresh policy describes job freshness, not dataset availability.

## Checks and request limits

ArcGIS checks request the layer metadata with `f=json`, parse the expected layer schema and validate nonempty named fields and query capability. They do not download the dataset or establish that every query operation works. CKAN and Socrata reuse their existing metadata/sample adapters. JSON/CSV resources use the existing bounded 1 MiB sample reader; larger files fail safely rather than being downloaded without limit. Required catalog title, publisher, source URL and endpoint metadata must be present. HTTPS endpoints with embedded credentials are rejected.

The shared HTTP client retries transient HTTP responses and timeouts at most twice, with backoff. It respects Retry-After, stopping rather than retrying early if the requested wait exceeds five seconds. File reads use their existing bounded fetch without retries. Network failures are recorded as issues; none are interpreted as proof of deletion. Jobs isolate per-source failures and use bounded concurrency. Recent successful checks are reused only for an unchanged stable ID, endpoint, publisher, title, source link and known source revision; `--force-verification` bypasses reuse. Unknown new source changes will be detected at the next scheduled check, not immediately.

## Storage and publication

The optional `verification` object in each catalog dataset contains the underlying `verified` or `failed` result, UTC lastCheckedAt and lastSuccessfulAt timestamps, nullable httpStatus, measured responseTimeMs for the check including any retries, errorType and a short public errorMessage. sourceRevision identifies the known publisher revision used for cache decisions. HTTP status is populated where the adapter supplies actual transport telemetry (currently ArcGIS); unavailable values remain null. Legacy records have no measured duration or status. No values are inferred from example data.

Failed checks preserve earlier successful timestamps and field descriptors for the same endpoint. A changed endpoint starts a new verification history. Successful and failed records survive federation and endpoint deduplication together, using the latest attempt rather than combining an old failure with a newer success. Retained datasets outside incomplete discovery scans are also checked when due. Newly discovered endpoints that fail before indexing remain in publisher diagnostics and are not counted as verified catalog datasets.

Results remain in versioned `public/discovery.json`, served through the existing cached `/api/discovery` path with a bundled fallback. The refresh script validates the complete report and writes a temporary file followed by atomic rename. The scheduled workflow validates and tests before committing publication. Interrupted jobs throw before writing public results; prior snapshots remain intact. Partial completed jobs can publish usable results and explicit failures without discarding previous successes. Safe error categories replace publisher exception text; credentials, private addresses and internal server messages are not copied into verification records.

## Schedule and manual runs

Discovery and verification run daily at 04:17 America/New_York in `.github/workflows/discovery.yml`. Run **Refresh discovery metadata** manually in GitHub Actions, or locally:

```sh
npm run discovery:refresh
npm run discovery:refresh -- --force-verification
npm run discovery:validate
```

Use the existing max-items, max-layers and timeout-ms flags to control discovery limits and the overall job budget. A failed process leaves the last published results available. Review the workflow's discovery-report artifact and publisher diagnostics, correct endpoint or allowlist configuration, and force a new verification when troubleshooting.

Successful source verification does not independently audit record accuracy, geographic coverage, completeness or data freshness. Publisher update timestamps remain separate from verification dates.
