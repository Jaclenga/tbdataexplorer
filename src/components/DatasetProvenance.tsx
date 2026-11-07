import SourceStatus from "./SourceStatus";
import type { Dataset, Field } from "../types";

const discoveryNotices = new Set([
  "Automatically discovered public portal layer. Not reviewed by the curated R-package catalog.",
  "Automatically discovered; not curator-reviewed.",
]);

export function DatasetProvenance({ dataset }: { dataset: Dataset }) {
  const coverage =
    dataset.coverage ??
    `Not specified in the package registry; publisher jurisdiction is ${dataset.jurisdiction}.`;
  return (
    <details className="provenance">
      <summary>About this dataset & source terms</summary>
      <SourceStatus dataset={dataset} />
      {!discoveryNotices.has(dataset.scopeNote ?? "") && (
        <p>{dataset.scopeNote ?? "Scope information unavailable."}</p>
      )}
      <p>
        <strong>Geographic coverage:</strong> {coverage}
      </p>
      <p>
        {dataset.terms ?? "Reuse terms unavailable. Consult the publisher."}
      </p>
      {dataset.termsUrl && <a href={dataset.termsUrl}>Publisher terms ↗</a>}
      <p>
        Verification checks structure, not record accuracy or freshness. Source
        data belongs to its publisher.
      </p>
    </details>
  );
}

export function DatasetFields({ fields }: { fields: Field[] | null }) {
  return (
    <details className="provenance">
      <summary>Fields & schema ({fields?.length ?? "unknown"})</summary>
      {fields ? (
        fields.map((field) => (
          <div className="field-row" key={field.name}>
            <strong>{field.name}</strong>
            <span>{field.alias}</span>
            <code>{field.type}</code>
          </div>
        ))
      ) : (
        <p>Fields unavailable.</p>
      )}
    </details>
  );
}
