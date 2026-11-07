import { publicDiscoveryError } from "../verification";
import { z } from "zod";
import type { Dataset } from "../../types";
import type {
  Portal,
  DiscoveryOptions,
  PortalRun,
  DiscoveryIssue,
} from "./types";
import { requestJson } from "../http";
import { endpointAllowed } from "../source-url";
import {
  inspectVerified,
  applyVerification,
  reusableVerification,
} from "../verify-source";
const ckanSchema = z.object({
  success: z.literal(true),
  result: z.object({
    count: z.number().int().nonnegative(),
    results: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        notes: z.string().nullish(),
        resources: z.array(
          z.object({
            id: z.string(),
            url: z.string(),
            name: z.string().nullish(),
            format: z.string().optional(),
            datastore_active: z.boolean().optional(),
          }),
        ),
      }),
    ),
  }),
});
const socrataSchema = z.object({
  resultSetSize: z.number().int().nonnegative(),
  results: z.array(
    z.object({
      resource: z.object({
        id: z.string().regex(/^[a-z0-9]{4}-[a-z0-9]{4}$/),
        name: z.string(),
        description: z.string().optional(),
      }),
      metadata: z.object({ domain: z.string() }),
    }),
  ),
});
export function externalDescriptor(
  portal: Portal,
  id: string,
  title: string,
  url: string,
  platform: Dataset["platform"] = portal.platform,
): Dataset {
  return {
    id: `${platform}:${portal.id}:${id}`,
    packageId: id,
    title,
    description: null,
    publisher: portal.publisher,
    jurisdiction: portal.jurisdiction,
    coverage: null,
    category: null,
    serviceUrl: null,
    layerId: null,
    resource: { url, apiRoot: portal.root, id },
    geometryType: "none",
    fields: null,
    verified: null,
    sourceUrl: portal.website,
    terms: null,
    termsUrl: null,
    scopeNote: "Automatically discovered; not curator-reviewed.",
    tags: [],
    platform,
    validationStatus: "discovered",
    portalId: portal.id,
  };
}
async function externalPage(
  portal: Portal,
  start: number,
  options: DiscoveryOptions,
) {
  if (portal.platform === "ckan") {
    const url = new URL(
      `${portal.root.replace(/\/$/, "")}/api/3/action/package_search`,
    );
    url.search = new URLSearchParams({
      start: String(start),
      rows: String(Math.min(100, options.maxItems)),
      q: options.query ?? "",
      sort: "metadata_modified desc",
    }).toString();
    const data = ckanSchema.parse(
      await requestJson(url.href, options.signal),
    ).result;
    const datasets = data.results.flatMap((item) =>
      item.resources
        .filter(
          (r) =>
            r.datastore_active ||
            ["CSV", "JSON"].includes(r.format?.toUpperCase() ?? ""),
        )
        .map((r) =>
          externalDescriptor(
            portal,
            r.id,
            r.name || item.title,
            r.datastore_active
              ? `${portal.root}/api/3/action/datastore_search?resource_id=${encodeURIComponent(r.id)}`
              : r.url,
            r.datastore_active
              ? "ckan"
              : (r.format?.toLowerCase() as "csv" | "json"),
          ),
        ),
    );
    return { datasets, total: data.count, count: data.results.length };
  }
  if (portal.platform === "socrata") {
    const domain = new URL(portal.root).hostname;
    const url = new URL("https://api.us.socrata.com/api/catalog/v1");
    url.search = new URLSearchParams({
      domains: domain,
      limit: String(Math.min(100, options.maxItems)),
      offset: String(start),
      q: options.query ?? "",
      only: "datasets",
    }).toString();
    const data = socrataSchema.parse(
      await requestJson(url.href, options.signal),
    );
    return {
      datasets: data.results
        .filter((item) => item.metadata.domain === domain)
        .map((item) =>
          externalDescriptor(
            portal,
            item.resource.id,
            item.resource.name,
            `${portal.root}/resource/${item.resource.id}.json`,
          ),
        ),
      total: data.resultSetSize,
      count: data.results.length,
    };
  }
  const resources = portal.resources ?? [];
  return {
    datasets: resources
      .slice(start, start + options.maxItems)
      .map((r) => externalDescriptor(portal, r.id, r.title, r.url)),
    total: resources.length,
    count: Math.min(options.maxItems, resources.length - start),
  };
}
export async function discoverExternal(
  portal: Portal,
  options: DiscoveryOptions,
): Promise<{ datasets: Dataset[]; run: PortalRun }> {
  const startedAt = new Date().toISOString();
  const datasets: Dataset[] = [];
  const issues: DiscoveryIssue[] = [];
  let scanned = 0;
  let inspected = 0;
  let total: number | null = null;
  try {
    while (scanned < options.maxItems && inspected < options.maxLayers) {
      const page = await externalPage(portal, scanned, {
        ...options,
        maxItems: options.maxItems - scanned,
      });
      total = page.total;
      if (page.count === 0) break;
      scanned += page.count;
      if (page.datasets.length > options.maxLayers - inspected)
        issues.push({
          portalId: portal.id,
          kind: "truncated",
          message: "Layer inspection limit reached.",
        });
      for (const dataset of page.datasets.slice(
        0,
        options.maxLayers - inspected,
      )) {
        inspected++;
        try {
          datasets.push(await inspectExternal(portal, dataset, options));
        } catch (error) {
          issues.push({
            portalId: portal.id,
            kind: "request",
            message: publicDiscoveryError(error),
          });
        }
      }
      if (scanned >= total) break;
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    issues.push(requestIssue(portal, error));
  }
  if (total !== null && scanned < total)
    issues.push({
      portalId: portal.id,
      kind: "truncated",
      message: "Discovery budget reached; this is a partial scan.",
    });
  return {
    datasets,
    run: {
      portalId: portal.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      complete: completeScan(total, scanned, issues),
      itemsScanned: scanned,
      layersInspected: inspected,
      datasetsFound: datasets.length,
      totalItems: total,
      nextStart: nextOffset(total, scanned),
      issues,
    },
  };
}
function requestIssue(portal: Portal, error: unknown): DiscoveryIssue {
  return {
    portalId: portal.id,
    kind: "request",
    message: publicDiscoveryError(error),
  };
}
function completeScan(
  total: number | null,
  scanned: number,
  issues: DiscoveryIssue[],
) {
  return total !== null && scanned >= total && issues.length === 0;
}
function nextOffset(total: number | null, scanned: number) {
  return total !== null && scanned < total ? scanned : null;
}

async function inspectExternal(
  portal: Portal,
  dataset: Dataset,
  options: DiscoveryOptions,
) {
  if (
    !endpointAllowed(
      dataset.resource!.url.split("?")[0],
      portal.servicePrefixes,
    )
  )
    throw Error("Unregistered source resource URL.");
  const previous = options.previousDatasets?.find((d) => d.id === dataset.id);
  if (
    reusableVerification(
      dataset,
      previous,
      Date.now(),
      options.forceVerification,
    )
  )
    return previous!;
  const { metadata, verification } = await inspectVerified(dataset, {
    signal: options.signal,
  });
  return applyVerification(dataset, metadata, verification);
}
