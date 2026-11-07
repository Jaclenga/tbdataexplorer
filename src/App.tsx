import { useEffect, useState, useRef } from "react";
import { parseCatalog } from "./services/catalog";
import type { Catalog } from "./types";
import { parseAccessReport, type AccessReport } from "./services/access";
import DatasetDetail from "./components/DatasetDetail";
import CatalogPage from "./components/CatalogPage";
import CatalogStatusPage from "./components/CatalogStatusPage";
import { SiteHeader, SiteFooter } from "./components/SiteChrome";
import { type DiscoveryReport } from "./services/discovery/types";
import { loadDiscovery } from "./services/load-discovery";
import { federatedCatalog } from "./services/federated-catalog";
import { useCatalogBrowse } from "./hooks/useCatalogBrowse";
import { homeTitle, pathDatasetId, updatePageMetadata } from "./services/seo";
function currentId() {
  try {
    if (!location.hash) return pathDatasetId(location.pathname);
    const value = decodeURIComponent(location.hash.slice(1));
    return ["main", "catalog", "publishers", "about"].includes(value)
      ? ""
      : value;
  } catch {
    return "";
  }
}
export default function App() {
  const [catalog, setCatalog] = useState<Catalog>();
  const [access, setAccess] = useState<AccessReport>();
  const [discovery, setDiscovery] = useState<DiscoveryReport>();
  const [error, setError] = useState("");
  const [discoveryWarning, setDiscoveryWarning] = useState<string | null>(null);
  const browse = useCatalogBrowse();
  const browseScroll = useRef(0);
  const previousId = useRef(currentId());
  const restoreScroll = useRef(false);
  const [id, setId] = useState(currentId);
  useEffect(() => {
    const c = new AbortController();
    Promise.all(
      ["catalog.json", "access.json"].map(async (path) => {
        const response = await fetch(`${import.meta.env.BASE_URL}${path}`, {
          signal: c.signal,
        });
        if (!response.ok)
          throw Error(
            "Catalog or browser access information could not be loaded.",
          );
        return response.json();
      }),
    )
      .then(async ([catalogValue, accessValue]) => {
        const parsed = parseCatalog(catalogValue);
        const report = parseAccessReport(accessValue, parsed);
        const { report: discovered, warning } = await loadDiscovery(
          import.meta.env.BASE_URL,
          c.signal,
        );
        if (c.signal.aborted) return;
        setDiscoveryWarning(warning);
        setAccess(report);
        setDiscovery(discovered);
        setCatalog(federatedCatalog(parsed, discovered));
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    const change = () => {
      const nextId = currentId();
      if (nextId && !previousId.current) browseScroll.current = window.scrollY;
      restoreScroll.current =
        !nextId &&
        !!previousId.current &&
        ["", "#catalog"].includes(location.hash);
      previousId.current = nextId;
      setId(nextId);
      if (
        !["#catalog", "#main", "#publishers", "#about"].includes(location.hash)
      )
        window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.title =
      id === "catalog-status"
        ? "Catalog Health | Tampa Bay Open Data Explorer"
        : id && catalog
          ? `${catalog.datasets.find((d) => d.id === id)?.title ?? "Dataset"} · Tampa Bay Open Data Explorer`
          : homeTitle;
    if (catalog) updatePageMetadata(catalog.datasets.find((entry) => entry.id === id));
  }, [id, catalog]);
  useEffect(() => {
    if (restoreScroll.current && !id) {
      restoreScroll.current = false;
      const frame = requestAnimationFrame(() =>
        window.scrollTo(0, browseScroll.current),
      );
      return () => cancelAnimationFrame(frame);
    }
    if (["#catalog", "#publishers", "#about"].includes(location.hash)) {
      document
        .getElementById(location.hash.slice(1))
        ?.scrollIntoView({ block: "start" });
    }
  }, [id, catalog]);
  const selected = catalog?.datasets.find((d) => d.id === id);
  return (
    <>
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("main");
          main?.setAttribute("tabindex", "-1");
          main?.focus();
          main?.scrollIntoView();
        }}
      >
        Skip to content
      </a>
      <SiteHeader catalog={!id && !error} />
      {error ? (
        <main id="main" className="shell">
          <p role="alert" className="error">
            {error} Refresh to try again.
          </p>
        </main>
      ) : !catalog ? (
        <main id="main" className="shell">
          <p role="status">Loading the checked dataset catalog…</p>
        </main>
      ) : id === "catalog-status" ? (
        <CatalogStatusPage
          catalog={catalog}
          report={discovery!}
          warning={discoveryWarning}
        />
      ) : selected ? (
        <DatasetDetail
          key={selected.id}
          dataset={selected}
          access={access!.datasets.find((entry) => entry.id === selected.id)}
          checkedAt={access!.checkedAt}
        />
      ) : id ? (
        <main id="main" className="shell">
          <h1>Dataset not found</h1>
          <a href="/#catalog">Return to the catalog</a>
        </main>
      ) : (
        <CatalogPage
          catalog={catalog}
          access={access!}
          {...browse}
          discovery={discovery!}
          discoveryWarning={discoveryWarning}
        />
      )}
      <SiteFooter />
    </>
  );
}
