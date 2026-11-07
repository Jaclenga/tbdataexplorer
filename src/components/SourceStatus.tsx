import type { Dataset } from "../types";
import {
  sourceStatus,
  verificationDate,
  publicFailureMessage,
} from "../services/verification";
export default function SourceStatus({ dataset }: { dataset: Dataset }) {
  const { state, result, stale, message } = sourceStatus(dataset);
  return (
    <section className="source-status" aria-label="Source status">
      <h3>Source status</h3>
      <dl className="drawer-metadata">
        <div>
          <dt>Status</dt>
          <dd>{state}</dd>
        </div>
        <div>
          <dt>Last checked (UTC)</dt>
          <dd>{verificationDate(result?.lastCheckedAt)}</dd>
        </div>
        <div>
          <dt>Last successful verification (UTC)</dt>
          <dd>{verificationDate(result?.lastSuccessfulAt)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>
            {!result || stale
              ? "Current availability unknown"
              : result.status === "verified"
                ? "Accessible at last check"
                : "Issue detected at last check"}
          </dd>
        </div>
        {stale && (
          <div>
            <dt>Last completed result</dt>
            <dd>{result?.status === "failed" ? "Failed" : "Verified"}</dd>
          </div>
        )}
      </dl>
      <p>{message}</p>
      {stale && result?.status === "failed" && (
        <p>{publicFailureMessage(result.errorType)}</p>
      )}
    </section>
  );
}
