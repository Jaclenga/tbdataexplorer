import SourceStatus from "./SourceStatus";
import { useEffect, useRef, useState } from "react";
import type { Dataset, LayerMetadata } from "../types";
import { getMetadata } from "../services/arcgis";
import { geometryLabel } from "../services/catalog-presentation";

// Endpoint-keyed, bounded session cache. Failed requests are evicted for retry.
const cache = new Map<
  string,
  { expires: number; value: Promise<LayerMetadata> }
>();
function metadata(dataset: Dataset) {
  const key = `${dataset.serviceUrl}/${dataset.layerId}`;
  const existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.value;
  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  const value = getMetadata(dataset).catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { value, expires: Date.now() + 5 * 60_000 });
  return value;
}
function plainText(value: string | null | undefined) {
  if (!value) return null;
  const document = new DOMParser().parseFromString(value, "text/html");
  document.querySelectorAll("script, style").forEach((node) => node.remove());
  return document.body.textContent?.trim() || null;
}
function timestamp(value: string | null | undefined) {
  if (!value || !Number.isFinite(new Date(value).getTime()))
    return "Not available";
  return new Date(value).toLocaleString();
}
export default function CatalogDatasetDetails({
  id,
  dataset,
  recordCount,
  onClose,
}: {
  id: string;
  dataset: Dataset;
  recordCount?: number | null;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [layer, setLayer] = useState<LayerMetadata | null>(null);
  const [status, setStatus] = useState("Loading publisher metadata...");
  const [attempt, setAttempt] = useState(0);
  const arcgis = dataset.serviceUrl !== null && dataset.layerId !== null;
  useEffect(() => {
    const node = dialog.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      node.close();
      document.body.style.overflow = overflow;
      trigger?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    if (!arcgis) return;
    let active = true;
    metadata(dataset)
      .then((result) => {
        if (active) {
          setLayer(result);
          setStatus("");
        }
      })
      .catch(() => {
        if (active)
          setStatus(
            "Publisher metadata is unavailable. Catalog metadata is shown below.",
          );
      });
    return () => {
      active = false;
    };
  }, [dataset, arcgis, attempt]);
  return (
    <dialog
      ref={dialog}
      id={id}
      className="metadata-drawer"
      aria-labelledby={`${id}-title`}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            "button, a[href], summary, [tabindex='0']",
          ),
        ).filter((node) => node.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <header className="metadata-drawer-header">
        <div>
          <p className="dataset-meta">Dataset metadata</p>
          <h2 id={`${id}-title`}>{dataset.title}</h2>
          <p>{dataset.publisher}</p>
        </div>
        <button
          type="button"
          className="text-button"
          aria-label="Close dataset details"
          onClick={onClose}
          autoFocus
        >
          &times;
        </button>
      </header>
      <div className="metadata-drawer-body">
        {arcgis && <p role="status">{status}</p>}
        {status.includes("unavailable") && (
          <button
            className="text-button"
            onClick={() => {
              setStatus("Loading publisher metadata...");
              setAttempt(attempt + 1);
            }}
          >
            Retry metadata
          </button>
        )}
        <section
          className="publisher-description"
          aria-label="Publisher description"
        >
          <h3>Publisher description</h3>
          <p>
            {plainText(layer?.description) ??
              dataset.description ??
              "Publisher description unavailable."}
          </p>
        </section>
        <SourceStatus dataset={dataset} />
        <MetadataRows
          dataset={dataset}
          layer={layer}
          recordCount={recordCount}
          arcgis={arcgis}
        />
        <Schema fields={layer?.fields ?? dataset.fields} />
      </div>
      <footer className="metadata-drawer-footer">
        <a className="button" href={`#${encodeURIComponent(dataset.id)}`}>
          Explore dataset
        </a>
      </footer>
    </dialog>
  );
}

function MetadataRows({
  dataset,
  layer,
  recordCount,
  arcgis,
}: {
  dataset: Dataset;
  layer: LayerMetadata | null;
  recordCount?: number | null;
  arcgis: boolean;
}) {
  const updated = layer?.sourceUpdatedAt ?? dataset.sourceUpdatedAt;
  return (
    <dl className="drawer-metadata">
      <div>
        <dt>Category (catalog)</dt>
        <dd>{dataset.category ?? "Not available"}</dd>
      </div>
      {dataset.source_category && (
        <div>
          <dt>Publisher category</dt>
          <dd>{dataset.source_category}</dd>
        </div>
      )}
      <div>
        <dt>Geometry type</dt>
        <dd>{geometryLabel(dataset.geometryType)}</dd>
      </div>
      <div>
        <dt>Geographic coverage</dt>
        <dd>{dataset.coverage ?? "Not available"}</dd>
      </div>
      <div>
        <dt>
          Last updated by publisher
          {(layer?.sourceUpdatedKind ?? dataset.sourceUpdatedKind)
            ? ` (${layer?.sourceUpdatedKind ?? dataset.sourceUpdatedKind})`
            : ""}
        </dt>
        <dd>{timestamp(updated)}</dd>
      </div>
      <div>
        <dt>Last verified endpoint</dt>
        <dd>{timestamp(dataset.lastVerifiedAt)}</dd>
      </div>
      <div>
        <dt>Record count (last source check)</dt>
        <dd>
          {recordCount != null ? recordCount.toLocaleString() : "Not available"}
        </dd>
      </div>
      <SourceTerms dataset={dataset} layer={layer} />
      {arcgis && (
        <div>
          <dt>ArcGIS endpoint</dt>
          <dd>
            <a href={`${dataset.serviceUrl}/${dataset.layerId}`}>
              {dataset.serviceUrl}/{dataset.layerId}
            </a>
          </dd>
        </div>
      )}
      <div>
        <dt>Original dataset URL</dt>
        <dd>
          <a href={dataset.sourceUrl}>{dataset.sourceUrl}</a>
        </dd>
      </div>
    </dl>
  );
}

function Schema({ fields }: { fields: Dataset["fields"] }) {
  return (
    <details className="drawer-schema">
      <summary>Fields &amp; schema ({fields?.length ?? "unknown"})</summary>
      {fields?.length ? (
        fields.map((field) => (
          <div className="drawer-field" key={field.name}>
            <strong>{field.name}</strong>
            <code>{field.type}</code>
            {field.alias && <span>Publisher alias: {field.alias}</span>}
            <p>
              {plainText(field.description) ??
                "Description not provided by source."}
            </p>
          </div>
        ))
      ) : (
        <p>Field metadata unavailable.</p>
      )}
    </details>
  );
}

function SourceTerms({
  dataset,
  layer,
}: {
  dataset: Dataset;
  layer: LayerMetadata | null;
}) {
  return (
    <>
      <div>
        <dt>License / reuse terms</dt>
        <dd>
          {dataset.terms ?? "Not available"}
          {dataset.termsUrl && (
            <>
              {" "}
              <a href={dataset.termsUrl}>Publisher terms</a>
            </>
          )}
        </dd>
      </div>
      <div>
        <dt>Attribution</dt>
        <dd>{plainText(layer?.attribution) ?? "Not available"}</dd>
      </div>
    </>
  );
}
