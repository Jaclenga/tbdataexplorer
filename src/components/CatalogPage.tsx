import { useEffect, useMemo, useRef } from "react";
import type { Catalog } from "../types";
import type { AccessReport } from "../services/access";
import {
  searchCatalog,
  sortCatalog,
  catalogSorts,
  type Filters,
} from "../services/catalog";
import DatasetCard from "./DatasetCard";
import FilterPanel from "./FilterPanel";
import type { DiscoveryReport } from "../services/discovery/types";
import { proxyEligible } from "../services/arcgis-transport";
import DiscoveryStatus from "./DiscoveryStatus";
import type { useCatalogBrowse } from "../hooks/useCatalogBrowse";

import {
  catalogPageSizes,
  paginateCatalog,
} from "../services/catalog-pagination";

const empty: Filters = { query: "", publisher: "", category: "", spatial: "" };
interface Props extends ReturnType<typeof useCatalogBrowse> {
  catalog: Catalog;
  access: AccessReport;
  discovery: DiscoveryReport;
  discoveryWarning: string | null;
}

export default function CatalogPage({
  catalog,
  access,
  filters,
  onChange,
  discovery,
  discoveryWarning,
  sort,
  onSort,
  page,
  pageSize,
  onPage,
  onPageSize,
  expanded,
  onExpand,
}: Props) {
  const results = useMemo(
    () => sortCatalog(searchCatalog(catalog.datasets, filters), sort),
    [catalog, filters, sort],
  );
  const pagination = paginateCatalog(results, page, pageSize);
  const resultsTop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (page !== pagination.page) onPage(pagination.page);
  }, [page, pagination.page, onPage]);
  const changePage = (next: number) => {
    onPage(next);
    requestAnimationFrame(() => {
      resultsTop.current?.focus({ preventScroll: true });
      resultsTop.current?.scrollIntoView({
        block: "start",
        behavior: "instant",
      });
    });
  };
  const sourceOnly = new Set(
    access.datasets
      .filter(
        (entry) =>
          entry.status === "source-only" &&
          !proxyEligible(
            catalog.datasets.find((dataset) => dataset.id === entry.id)!,
          ),
      )
      .map((entry) => entry.id),
  );
  return (
    <main id="main">
      <section
        id="catalog"
        className="shell catalog"
        aria-labelledby="results-heading"
      >
        <div className="section-top catalog-heading">
          <h2 id="results-heading" tabIndex={-1}>
            Browse datasets
          </h2>
          <DiscoveryStatus report={discovery} warning={discoveryWarning} />
        </div>
        <div className="catalog-layout">
          <FilterPanel
            datasets={catalog.datasets}
            filters={filters}
            onChange={onChange}
            onReset={() => onChange(empty)}
            matchCount={results.length}
          />
          <div className="catalog-results">
            <form
              role="search"
              className="search catalog-search"
              onSubmit={(event) => {
                event.preventDefault();
              }}
            >
              <label className="sr-only" htmlFor="dataset-search">
                Search datasets
              </label>
              <svg
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 5 5" />
              </svg>
              <input
                id="dataset-search"
                type="search"
                placeholder="Search datasets"
                value={filters.query}
                onChange={(event) =>
                  onChange({ ...filters, query: event.target.value })
                }
              />
              {filters.query && (
                <button
                  type="button"
                  className="clear-search"
                  onClick={() => {
                    onChange({ ...filters, query: "" });
                    document.getElementById("dataset-search")?.focus();
                  }}
                >
                  Clear search
                </button>
              )}
              <button type="submit">Search</button>
            </form>
            <div
              className="results-bar"
              ref={resultsTop}
              tabIndex={-1}
              aria-label="Dataset results"
            >
              <p role="status">
                {results.length
                  ? `Showing ${pagination.start}\u2013${pagination.end} of ${results.length} datasets`
                  : "No matching datasets"}
              </p>
              <div className="catalog-result-controls">
                <label className="catalog-sort">
                  Rows per page:
                  <select
                    value={pageSize}
                    onChange={(event) => onPageSize(Number(event.target.value))}
                  >
                    {catalogPageSizes.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="catalog-sort">
                  Sort by{" "}
                  <select
                    value={sort}
                    onChange={(event) =>
                      onSort(event.target.value as Props["sort"])
                    }
                  >
                    {Object.entries(catalogSorts).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            {Object.values(filters).some(Boolean) && (
              <p
                className="active-filters"
                aria-label="Active search and filters"
              >
                {[
                  filters.query && `Search: ${filters.query}`,
                  filters.publisher,
                  filters.category,
                  filters.spatial,
                  filters.platform,
                ]
                  .filter(Boolean)
                  .join(" / ")}
              </p>
            )}
            <div className="cards">
              {pagination.rows.map((dataset) => (
                <DatasetCard
                  key={dataset.id}
                  dataset={dataset}
                  sourceOnly={sourceOnly.has(dataset.id)}
                  access={access.datasets.find(
                    (entry) => entry.id === dataset.id,
                  )}
                  expanded={expanded.has(dataset.id)}
                  onExpand={() => onExpand(dataset.id)}
                />
              ))}
            </div>
            {pagination.pages > 1 && (
              <nav className="catalog-pagination" aria-label="Dataset pages">
                <button
                  type="button"
                  className="button secondary"
                  disabled={pagination.page === 1}
                  onClick={() => changePage(pagination.page - 1)}
                >
                  Previous
                </button>
                <span aria-live="polite">
                  Page {pagination.page} of {pagination.pages}
                </span>
                <button
                  type="button"
                  className="button secondary"
                  disabled={pagination.page === pagination.pages}
                  onClick={() => changePage(pagination.page + 1)}
                >
                  Next
                </button>
              </nav>
            )}
            {!results.length && (
              <div className="empty">
                <h3>No datasets match these filters.</h3>
                <p>Try another search or clear the filters.</p>
                <button className="button" onClick={() => onChange(empty)}>
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
