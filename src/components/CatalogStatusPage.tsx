import {
  verificationPolicy,
  verificationFailure,
} from "../services/verification";
import type { Catalog } from "../types";
import { catalogHealth, failureKind } from "../services/catalog-health";
import { useEffect, useRef, useState } from "react";
import type { DiscoveryReport, PortalRun } from "../services/discovery/types";
import {
  catalogStatus,
  coverageLabel,
  displayStatusDate,
  groupedIssues,
  publisherLastCheck,
  publisherName,
  staleAfterHours,
} from "../services/catalog-status";
export default function CatalogStatusPage({
  report,
  catalog,
  warning,
}: {
  catalog: Catalog;
  report: DiscoveryReport;
  warning: string | null;
}) {
  const status = catalogStatus(report, warning);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <main id="main" className="shell catalog-status-page">
      <a href="#catalog">Return to datasets</a>
      <h1 ref={heading} tabIndex={-1}>
        Catalog Health
      </h1>
      <HealthOverview catalog={catalog} report={report} />
      <section aria-labelledby="status-overview">
        <h2 id="status-overview">Refresh diagnostics</h2>
        <dl className="catalog-metadata">
          <div>
            <dt>Status</dt>
            <dd>{status.state}</dd>
          </div>
          <div>
            <dt>Last successful verification</dt>
            <dd>{displayStatusDate(status.successfulAt)}</dd>
          </div>
          <div>
            <dt>Last attempted refresh</dt>
            <dd>{displayStatusDate(status.attemptedAt)}</dd>
          </div>
          <div>
            <dt>Reported endpoint checks</dt>
            <dd>
              {status.verified === null
                ? "Not recorded"
                : `${status.verified} in the latest recorded attempt`}
            </dd>
          </div>
          <div>
            <dt>Publishers checked</dt>
            <dd>{status.publishers}</dd>
          </div>
          <div>
            <dt>Discovery issues or limits</dt>
            <dd>{status.issues}</dd>
          </div>
          <div>
            <dt>Discovery coverage</dt>
            <dd>{coverageLabel(report)}</dd>
          </div>
        </dl>
        <p>
          Reported endpoint checks describe the job result. Unique catalog
          counts appear above.
        </p>
        {report.refresh && (
          <p>
            Latest recorded attempt:{" "}
            {report.refresh.outcome === "failed"
              ? "Failed"
              : report.refresh.outcome === "partial"
                ? "Partial"
                : "Successful"}
            . {report.refresh.curatedErrors} curated endpoint checks failed.
          </p>
        )}
        {warning && <p>{warning}</p>}
        <p>
          Catalog refresh status is considered stale after {staleAfterHours}{" "}
          hours. Dataset verification is considered stale after{" "}
          {verificationPolicy.freshnessDays} days. This view describes the
          published catalog; same-day attempts without changes are recorded in
          the scheduled run history.
        </p>
      </section>
      <section aria-labelledby="status-coverage">
        <h2 id="status-coverage">Discovery coverage</h2>
        <p>
          Coverage depends on configured publishers and supported endpoints.
          Some publishers do not provide machine-readable catalogs. Metadata
          quality varies between sources. Dataset availability and freshness may
          change independently of the Explorer's refresh schedule.
        </p>
        <p>
          {!report.runs.length && !report.datasets.length
            ? "Discovery coverage is unavailable. The curated catalog remains accessible."
            : report.complete && report.runs.length > 0
              ? "This catalog includes datasets discovered from participating government sources. All configured sources were scanned, but this is not an exhaustive inventory of Tampa Bay public data."
              : "This catalog includes datasets discovered from participating government sources. Some scans may be incomplete, so it should not be treated as an exhaustive inventory of Tampa Bay public data."}
        </p>
        <p>
          Successful endpoint verification means a source responded to a
          structural check. It does not guarantee that its records are accurate,
          current or complete. Discovery completeness describes how much of the
          configured source list was scanned.
        </p>
        <p>
          Publisher update timestamps describe source updates and appear
          separately on dataset pages. They are not verification dates.
        </p>
      </section>
      <section aria-labelledby="publisher-scans">
        <h2 id="publisher-scans">Publisher scan details</h2>
        {report.runs.length ? (
          report.runs.map((run) => (
            <PublisherScan key={run.portalId} run={run} report={report} />
          ))
        ) : (
          <p>No publisher scan results recorded.</p>
        )}
      </section>
      <section aria-labelledby="technical-reports">
        <h2 id="technical-reports">Technical reports</h2>
        <ul>
          <li>
            <a href="/api/discovery">Latest scheduled discovery report</a>{" "}
            (publisher diagnostics and verification results)
          </li>
          <li>
            <a href="/discovery.json">Discovery report</a> (bundled snapshot)
          </li>
          <li>
            <a href="/access.json">Browser access verification results</a>{" "}
            (separate publisher-access audit)
          </li>
          <li>
            <a href="https://github.com/Jaclenga/tbdataexplorer/actions/workflows/discovery.yml">
              Scheduled run history and report artifacts
            </a>
          </li>
        </ul>
      </section>
    </main>
  );
}
function PublisherScan({
  run,
  report,
}: {
  run: PortalRun;
  report: DiscoveryReport;
}) {
  return (
    <details className="publisher-scan">
      <summary>
        {publisherName(run.portalId)}: {run.itemsScanned} services scanned;{" "}
        {run.datasetsFound} datasets discovered;{" "}
        {run.complete ? "Complete scan" : "Partial scan"}; {run.issues.length}{" "}
        issues; last successful check{" "}
        {displayStatusDate(publisherLastCheck(report, run.portalId), true)}
      </summary>
      <p>
        Last successful endpoint check:{" "}
        {displayStatusDate(publisherLastCheck(report, run.portalId))}.
      </p>
      <p>
        Scan attempted {displayStatusDate(run.startedAt)}; finished{" "}
        {displayStatusDate(run.finishedAt)}. {run.layersInspected} layers
        inspected.{" "}
        {run.totalItems === null
          ? "Total service count not reported."
          : `${run.totalItems} services reported by publisher.`}
      </p>
      {groupedIssues(run).map((issue, index) => (
        <div key={index}>
          <p>
            {issue.label}
            {issue.count > 1 ? ` (${issue.count} occurrences)` : ""}.
          </p>
          <details>
            <summary>Technical explanation</summary>
            <p>{issue.message}</p>
            {issue.endpoints.length > 0 && (
              <ul>
                {issue.endpoints.map((endpoint) => (
                  <li key={endpoint}>
                    <code>{endpoint}</code>
                  </li>
                ))}
              </ul>
            )}
          </details>
        </div>
      ))}
      {!run.issues.length && <p>No issues recorded.</p>}
    </details>
  );
}

function HealthOverview({
  catalog,
  report,
}: {
  catalog: Catalog;
  report: DiscoveryReport;
}) {
  const health = catalogHealth(catalog.datasets, report);
  const [sort, setSort] = useState("publisher");
  const publishers = [...health.publishers].sort((a, b) =>
    sort === "discovered"
      ? b.discovered - a.discovered
      : sort === "verified"
        ? b.verified - a.verified
        : sort === "issues"
          ? b.issues - a.issues
          : a.name.localeCompare(b.name),
  );
  return (
    <>
      <section aria-labelledby="health-summary">
        <h2 id="health-summary">Coverage &amp; quality</h2>
        <dl className="catalog-metadata">
          <div>
            <dt>Discovered datasets</dt>
            <dd>{health.discovered}</dd>
            <dd>
              Unique entries in this Explorer, deduplicated by identifier and
              endpoint.
            </dd>
          </div>
          <div>
            <dt>Verified datasets</dt>
            <dd>{health.verified}</dd>
            <dd>
              Fresh structural checks passed during the latest completed
              nonfailed cycle.
            </dd>
          </div>
          <div>
            <dt>Publishers covered</dt>
            <dd>{health.publishers.length}</dd>
            <dd>
              Distinct publishers represented in catalog records, including
              unknown publishers.
            </dd>
          </div>
          <div>
            <dt>Datasets requiring attention</dt>
            <dd>{health.attention.length}</dd>
            <dd>
              Failed or stale checks, or missing required metadata. Unchecked
              entries alone are excluded.
            </dd>
          </div>
        </dl>
        <p>
          {health.records.filter((r) => r.state === "Not checked").length}{" "}
          datasets not checked. Successful endpoint checks do not establish
          record accuracy or completeness.
        </p>
      </section>
      <section aria-labelledby="publisher-coverage">
        <h2 id="publisher-coverage">Publisher coverage</h2>
        <p>
          Counts describe this catalog, not each publisher's complete inventory.
        </p>
        <label>
          Sort publishers{" "}
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="publisher">Publisher</option>
            <option value="discovered">Discovered datasets</option>
            <option value="verified">Verified datasets</option>
            <option value="issues">Issues</option>
          </select>
        </label>
        <div className="health-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Publisher</th>
                <th scope="col">Discovered</th>
                <th scope="col">Verified</th>
                <th scope="col">Issues</th>
                <th scope="col">Last checked</th>
              </tr>
            </thead>
            <tbody>
              {publishers.map((p) => (
                <tr key={p.name}>
                  <th scope="row">
                    {p.name === "Unknown publisher" ? (
                      p.name
                    ) : (
                      <a
                        href={`?publisher=${encodeURIComponent(p.name)}#catalog`}
                      >
                        {p.name}
                      </a>
                    )}
                  </th>
                  <td>{p.discovered}</td>
                  <td>{p.verified}</td>
                  <td>{p.issues}</td>
                  <td>{displayStatusDate(p.checkedAt, true)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!publishers.length && <p>No catalog entries available.</p>}
      </section>
      <HealthFreshness report={report} />
      <section aria-labelledby="dataset-issues">
        <h2 id="dataset-issues">Datasets requiring attention</h2>
        {health.attention.length ? (
          <ul>
            {health.attention.map((r) => (
              <li key={r.dataset.id}>
                <a href={`#${encodeURIComponent(r.dataset.id)}`}>
                  {r.dataset.title}
                </a>
                : {r.state}.{" "}
                {r.dataset.verificationError
                  ? `${failureKind(r.dataset.verificationError)}: ${verificationFailure(r.dataset.verificationError).errorMessage}`
                  : r.issues.join("; ")}
              </li>
            ))}
          </ul>
        ) : (
          <p>No recorded issues. Unchecked datasets may still have problems.</p>
        )}
      </section>
    </>
  );
}

function HealthFreshness({ report }: { report: DiscoveryReport }) {
  return (
    <section aria-labelledby="health-freshness">
      <h2 id="health-freshness">Catalog freshness</h2>
      <dl className="catalog-metadata">
        <div>
          <dt>Last successful catalog refresh</dt>
          <dd>
            {displayStatusDate(report.healthHistory?.successfulAt ?? null)}
          </dd>
        </div>
        <div>
          <dt>Last completed verification cycle</dt>
          <dd>{displayStatusDate(report.refresh?.finishedAt ?? null)}</dd>
        </div>
        <div>
          <dt>Datasets added</dt>
          <dd>{report.healthHistory?.changes?.added ?? "Not yet available"}</dd>
        </div>
        <div>
          <dt>Datasets removed or no longer discoverable</dt>
          <dd>
            {report.healthHistory?.changes?.removed ?? "Not yet available"}
          </dd>
        </div>
        <div>
          <dt>Changed metadata</dt>
          <dd>
            {report.healthHistory?.changes?.changed ?? "Not yet available"}
          </dd>
        </div>
      </dl>
      <p>
        Changes compare the last two complete successful scans. Partial or
        failed attempts retain prior snapshots and catalog entries.
      </p>
    </section>
  );
}
