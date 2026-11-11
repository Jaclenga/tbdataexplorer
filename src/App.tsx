import { useEffect, useState, useRef } from "react";
import DatasetDetail from "./components/DatasetDetail";
import CatalogPage from "./components/CatalogPage";
import CatalogStatusPage from "./components/CatalogStatusPage";
import { SiteHeader, SiteFooter } from "./components/SiteChrome";
import type { AppData } from "./services/load-app-data";
import { useCatalogBrowse } from "./hooks/useCatalogBrowse";
import { pathDatasetId, updatePageMetadata } from "./services/seo";
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
export default function App({ initialData, error = "" }: { initialData?: AppData; error?: string }) {
  const { catalog, access, discovery, discoveryWarning = null } = initialData ?? {};
  const browse = useCatalogBrowse();
  const browseScroll = useRef(0);
  const previousId = useRef(currentId());
  const restoreScroll = useRef(false);
  const [id, setId] = useState(currentId);
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
    if (!id || catalog?.datasets.some((entry) => entry.id === id)) {
      updatePageMetadata(catalog?.datasets.find((entry) => entry.id === id), /^\/datasets\/?$/.test(location.pathname));
    } else if (id === "catalog-status") {
      document.title = "Catalog Health | Tampa Bay Open Data Explorer";
    } else if (catalog) {
      document.title = "Dataset not found | Tampa Bay Open Data Explorer";
    }
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
      <SiteHeader catalog={!id && !error} datasets={/^\/datasets\/?$/.test(location.pathname)} />
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
