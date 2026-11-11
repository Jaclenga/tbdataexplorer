import type { Dataset } from "../types";
import type { DatasetAccess } from "../services/access";
import { useDatasetPreview } from "../hooks/useDatasetPreview";
import DatasetRecords from "./DatasetRecords";
import DownloadMenu from "./DownloadMenu";
import { DatasetFields } from "./DatasetProvenance";
import DatasetWorkspace from "./DatasetWorkspace";
import SourceOnlyDataset from "./SourceOnlyDataset";
import { proxyEligible } from "../services/arcgis-transport";
import RecordFilters from "./RecordFilters";
import LiveFreshness from "./LiveFreshness";

export default function DatasetDetail({
  dataset,
  access,
  checkedAt,
}: {
  dataset: Dataset;
  access?: DatasetAccess;
  checkedAt: string;
}) {
  const [previewRequested, setPreviewRequested] = useState(false);
  if (
    access?.status === "source-only" &&
    !previewRequested &&
    !proxyEligible(dataset)
  )
    return (
      <SourceOnlyDataset
        dataset={dataset}
        access={access}
        checkedAt={checkedAt}
        onPreview={() => setPreviewRequested(true)}
      />
    );
  return <PreviewableDataset dataset={dataset} />;
}

function PreviewableDataset({ dataset }: { dataset: Dataset }) {
  const preview = useDatasetPreview(dataset);
  const { page, metadata, offset, bounds, busy, error, pageNumber } = preview;
  const fields = metadata?.fields ?? dataset.fields;
  return (
    <DatasetWorkspace dataset={dataset}>
      <section className="preview" aria-busy={busy}>
        <div className="section-top">
          <div>
            <h2>Data preview</h2>
          </div>
          <DownloadMenu
            page={page}
            fields={metadata?.fields ?? []}
            filename={`${dataset.packageId}-page-${pageNumber}`}
            busy={busy}
          />
        </div>
        <p className="muted">
          Exports contain only this loaded page, including any map-area filter.
          They are not complete dataset downloads.
        </p>
        {metadata && (
          <RecordFilters
            fields={metadata.fields}
            operators={metadata.filterOperators}
            busy={busy}
            filter={preview.filter}
            onApply={preview.filterRecords}
          />
        )}
        <LiveFreshness metadata={metadata} />
        {busy && (
          <p role="status" className="notice">
            Loading records from the publisher…
          </p>
        )}
        {error && (
          <div role="alert" className="error">
            <p>{error}</p>
            <button className="button secondary" onClick={preview.retry}>
              Try again
            </button>
          </div>
        )}
        {bounds && (
          <p className="notice">
            Map-area filter applied.{" "}
            <button onClick={() => preview.filterArea()}>
              Clear area filter
            </button>
          </p>
        )}
        <DatasetRecords
          page={page}
          fields={metadata?.fields ?? []}
          offset={offset}
          onBounds={preview.filterArea}
          loading={busy}
          spatial={dataset.geometryType !== "none"}
        />
        <div className="pagination">
          <button
            className="button secondary"
            disabled={!preview.canGoBack}
            onClick={preview.previousPage}
          >
            ← Previous
          </button>
          <span>Page {pageNumber}</span>
          <button
            className="button secondary"
            disabled={!preview.canGoForward}
            onClick={preview.nextPage}
          >
            Next →
          </button>
        </div>
        {page && preview.limitReached && (
          <p>
            Preview navigation is limited to 10,000 records. Narrow the map area
            or visit the source.
          </p>
        )}
      </section>
      <DatasetFields fields={fields} />
    </DatasetWorkspace>
  );
}
import { useState } from "react";
