import { lazy, Suspense } from "react";
import type { Field, Page } from "../types";
import type { Bounds } from "../services/arcgis";
import DatasetTable from "./DatasetTable";

const DatasetMap = lazy(() => import("./DatasetMap"));

interface Props {
  page: Page | null;
  fields: Field[];
  offset: number;
  onBounds: (bounds: Bounds) => void;
  loading?: boolean;
  spatial?: boolean;
}

export default function DatasetRecords({
  page,
  fields,
  offset,
  onBounds,
  loading = false,
  spatial = false,
}: Props) {
  if (!page) return loading && spatial ? <MapPlaceholder /> : null;
  const count = page.records.length;
  return (
    <>
      {page.warning && (
        <p role="status" className="notice">
          {page.warning}
        </p>
      )}
      {page.geojson && (
        <Suspense fallback={<MapPlaceholder />}>
          <DatasetMap data={page.geojson} onBounds={onBounds} />
        </Suspense>
      )}
      <div className="record-count">
        {count} records loaded
        {count > 0 && ` · rows ${offset + 1}–${offset + count}`} · preview only
      </div>
      {page.retrievedAt && (
        <p className="muted">
          Records retrieved {new Date(page.retrievedAt).toLocaleString()} ·
          loaded page only
        </p>
      )}
      <DatasetTable records={page.records} fields={fields} />
    </>
  );
}

// Match the existing map and toolbar, including their responsive wrapping.
function MapPlaceholder() {
  return (
    <section aria-label="Loading map" aria-busy="true">
      <div className="map-toolbar">
        <p>Only the loaded page is mapped. Select a feature for its attributes.</p>
        <button className="button secondary" disabled>Search this map area</button>
      </div>
      <div className="map" role="status">Loading map...</div>
    </section>
  );
}
