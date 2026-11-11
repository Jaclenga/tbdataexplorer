# CLS investigation and verification

## Findings and changes

The footer `#about` was a shifted element, rather than the cause. The static
catalog was replaced by React's one-line loading state, then replaced again by
the full catalog after catalog/access/discovery requests completed. PerformanceObserver
attributed the initial poor shift directly to `#about`. Its document position
traveled 2,250px on desktop and 3,716px on mobile during catalog startup.

The client now leaves the prerendered page in place until the same validated
catalog, access, and live-discovery inputs needed for the interactive page are
ready. React starts with that complete state, preserving the existing final UI,
search semantics, live discovery, error handling, and real dataset links. Static
links stay usable during loading. Form controls are disabled until their handlers
are ready, so input is not silently lost during the transition.

Detail pages previously prerendered only the header/fields; the client later
inserted the workspace and preview. The generator now renders DatasetDetail,
including its real initial loading state. Spatial previews reserve the existing
390px map and naturally wrapping toolbar while records and the lazy map module
load. The same placeholder is used for both stages. No new fixed content heights,
clipping rules, dependencies, or CSS changes were introduced.

No font downloads or @font-face declarations are present. The existing font stack
uses locally available fonts; measured font requests were zero. Preloading a new
font would not address the observed cause. Inline search SVG dimensions and the
existing map container already reserve media space. There are no application CSS
animations/transitions of layout properties to replace, and no animated skeleton
was added. Tests exercise reduced-motion preferences.

## Before and after

These are local Chromium measurements of the production build, not Cloudflare
field percentiles. Each row reports the worst of normal and delayed-network
samples, with a fresh browser page for each sample (16 before, 16 after).
Footer travel measures document coordinates even when the footer is below the
viewport; movement outside the viewport does not itself contribute to CLS.

| Viewport | Route | Before CLS | After CLS | Before footer travel | After footer travel |
| --- | --- | ---: | ---: | ---: | ---: |
| 1440px | Homepage | 0.2589 | 0.0000 | 2250.4px | 0.0px |
| 1440px | Dataset catalog | 0.2589 | 0.0000 | 2250.4px | 0.0px |
| 1440px | Homepage About anchor | 0.2589 | 0.0000 | 2250.4px | 0.0px |
| 1440px | Dataset detail | 0.1992 | 0.0169 | 1660.4px | 329.0px |
| 390px | Homepage | 0.5978 | 0.0000 | 3716.1px | 0.0px |
| 390px | Dataset catalog | 0.5978 | 0.0000 | 3716.1px | 0.0px |
| 390px | Homepage About anchor | 0.5978 | 0.0000 | 3716.1px | 0.0px |
| 390px | Dataset detail | 0.6143 | 0.0179 | 1782.3px | 369.3px |

Catalog startup and direct `/#about` loads now show zero observed footer movement.
The detail page still grows below the fold as actual records and metadata arrive;
its measured initial CLS is below 0.1, rather than zero. No unexpected CLS was
observed during the final real mouse/keyboard search and publisher-filter tests.
Expected input-triggered movement is retained in raw diagnostics and excluded
from CLS using the browser's hadRecentInput flag.

## Reproduce and inspect

Run `npm run test:e2e` to build production assets and run all browser regressions.
For the focused matrix in PowerShell:

```powershell
$env:CLS_REPORT_DIR='.wrangler/cls-after'
npx playwright test tests/e2e/cls.spec.ts --workers=2
```

For baseline auditing only, set CLS_AUDIT_ONLY=1; this records the metrics without
applying the regression budget. Remove that environment variable for assertions.
Set E2E_BASE_URL to test an already-running deployment without rebuilding it.
The publisher preview and discovery endpoints are served deterministic fixtures,
so results do not depend on government service availability. The slow scenarios
inject 350ms per script and 1,200ms per catalog/access/discovery and publisher
response. This is controlled latency, not a complete simulation of every network,
CPU, or device. Normal desktop is 1440x900; mobile layout is 390x900.

The observer starts before application code. It records value, time, recent-input
flag, initial/interaction phase, source selectors, old/new vertical positions, and footer
positions. CLS uses the maximum session window (1s gaps, up to 5s), excluding
recent-input shifts. Browser report attachments include raw JSON and desktop/mobile
screenshots. Optional JSON files are saved under CLS_REPORT_DIR; the comparison
runs used .wrangler/cls-before and .wrangler/cls-after. These artifacts are ignored
by Git. The suite asserts initial CLS <0.1 and <=2px catalog footer travel.
It also waits for document.fonts.ready and counts font resource requests.

Validation: 501 unit tests passed; 37 browser tests passed; lint, TypeScript and
the production build passed. Existing dependency annotation and large-bundle
warnings remain. Responsive header checks cover 320, 390, 768, and 1440px, and
existing catalog/navigation/SEO tests passed. Desktop/mobile screenshots were
inspected for wrapping and overflow.

## Changed files for this task

- src/main.tsx: load complete app inputs before replacing the static page.
- src/App.tsx: accept ready-to-render state instead of mounting a short loader.
- src/services/load-app-data.ts: shared validated startup loader.
- scripts/generate-seo.tsx: prerender the actual dataset workspace.
- src/components/DatasetDetail.tsx: identify pending spatial previews.
- src/components/DatasetRecords.tsx: reserve the existing map/toolbar footprint.
- tests/e2e/cls.spec.ts: observer diagnostics and desktop/mobile regression matrix.
- tests/services/load-app-data.test.ts: startup validation and failure coverage.
- docs/seo.md and docs/performance.md: document startup and measured behavior.

## Remaining limits and deployment follow-up

No deployment was performed. After deployment, compare Cloudflare Web Analytics
CLS distributions and the 75th percentile separately for mobile and desktop.
The target is p75 below 0.1. These limited lab samples cannot establish field p75.
See [the CLS measurement guidance](https://web.dev/articles/cls).

A live discovery index that differs from the deployed HTML snapshot, publisher
errors, long/variable field values, different OS font metrics, and users scrolling
into a still-loading preview can produce additional shifts. Catalog failure views
and every dataset/publisher response are not covered by this matrix. Existing
preview table maximum height and scrolling behavior are retained; records were
not hidden or removed to achieve these measurements. Keep generated HTML and the
live discovery catalog deployed together, and investigate remaining field sources
with the recorded element-level diagnostics.
