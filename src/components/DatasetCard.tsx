import { useId } from "react";
import type { Dataset } from "../types";
import type { DatasetAccess } from "../services/access";
import {
  datasetMetadata,
  catalogAccessStatus,
} from "../services/catalog-presentation";
import CatalogDatasetDetails from "./CatalogDatasetDetails";
import { datasetPath } from "../services/seo";

export default function DatasetCard({
  dataset,
  sourceOnly,
  access,
  expanded,
  onExpand,
}: {
  dataset: Dataset;
  sourceOnly: boolean;
  access?: DatasetAccess;
  expanded: boolean;
  onExpand: () => void;
}) {
  const detailsId = useId();
  const status = catalogAccessStatus(
    dataset.verificationError ?? (sourceOnly ? access?.reason : null),
  );
  const url = datasetPath(dataset.id);
  const explore: React.MouseEventHandler<HTMLAnchorElement> = (event) => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
    event.preventDefault();
    location.hash = encodeURIComponent(dataset.id);
  };
  return (
    <article className="dataset-card">
      <div className="dataset-row">
        <div className="dataset-summary">
          <h3>
            <a href={url} title={dataset.title} onClick={explore}>
              {dataset.title}
            </a>
          </h3>
          <p className="dataset-meta">{datasetMetadata(dataset)}</p>
          <p className="description">
            {dataset.description ?? "Description unavailable."}
          </p>
          {status?.failed && (
            <p className="catalog-source-error">{status.label}</p>
          )}
        </div>
        <div className="dataset-row-actions">
          <a
            href={sourceOnly ? dataset.sourceUrl : url}
            onClick={explore}
            aria-label={`${sourceOnly ? "View source" : "Explore"}: ${dataset.title}`}
            target={sourceOnly ? "_blank" : undefined}
            rel={sourceOnly ? "noreferrer" : undefined}
          >
            {sourceOnly ? "View source" : "Explore"}
          </a>
          <button
            className="text-button dataset-expand"
            aria-expanded={expanded}
            aria-haspopup="dialog"
            aria-controls={detailsId}
            aria-label={`${expanded ? "Hide" : "Show"} details for ${dataset.title}`}
            onClick={onExpand}
          >
            Details
          </button>
        </div>
      </div>
      {expanded && (
        <CatalogDatasetDetails
          id={detailsId}
          dataset={dataset}
          recordCount={access && access.recordCount}
          onClose={onExpand}
        />
      )}
    </article>
  );
}
