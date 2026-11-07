import type { Dataset } from "../types";
import { endpoint } from "../services/arcgis";
import { DatasetProvenance } from "./DatasetProvenance";

export default function DatasetHeader({ dataset }: { dataset: Dataset }) {
  return (
    <>
      <a href="/#catalog" className="back" onClick={(event) => {
        if (location.pathname === "/" && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
          event.preventDefault();
          location.hash = "catalog";
        }
      }}>
        ← All datasets
      </a>
      <div className="eyebrow">
        {dataset.publisher}{" "}
        <span> / {dataset.category ?? "Uncategorized"}</span>
      </div>
      <h1>{dataset.title}</h1>
      <p className="detail-description">
        {dataset.description ?? "Description unavailable."}
      </p>
      <div className="source-line">
        <a href={dataset.sourceUrl} target="_blank" rel="noreferrer">
          Original source ↗
        </a>
        <a
          href={dataset.resource?.url ?? `${endpoint(dataset)}?f=pjson`}
          target="_blank"
          rel="noreferrer"
        >
          Source endpoint ↗
        </a>
        <span>Structure checked {dataset.verified ?? "unknown"}</span>
      </div>
      <DatasetProvenance dataset={dataset} />
      <div className="freshness-details">
        <p>
          Publisher{" "}
          {dataset.sourceUpdatedKind === "portal-item"
            ? "catalog item modified"
            : "source updated"}
          :{" "}
          {dataset.sourceUpdatedAt
            ? new Date(dataset.sourceUpdatedAt).toLocaleString()
            : "Not reported"}
          .
        </p>
        <p>
          Last successful endpoint check:{" "}
          {dataset.lastVerifiedAt
            ? new Date(dataset.lastVerifiedAt).toLocaleString()
            : "Not recorded in the live index"}
          .{" "}
          {dataset.verificationError &&
            "The latest check failed; the previous descriptor has been retained."}
        </p>
      </div>
    </>
  );
}
