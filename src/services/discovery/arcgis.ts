import { publicDiscoveryError } from "../verification";
import {
  inspectVerified,
  applyVerification,
  reusableVerification,
} from "../verify-source";
import { z } from "zod";
import type { Dataset } from "../../types";
import { sourceTimestamp } from "../arcgis";
import { requestJson } from "../http";
import { canonicalEndpoint, endpointAllowed } from "../source-url";
import type {
  Portal,
  DiscoveryOptions,
  PortalRun,
  DiscoveryIssue,
} from "./types";

const itemSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/i),
  title: z.string(),
  type: z.string(),
  url: z.string().nullable().optional(),
  access: z.string().optional(),
  orgId: z.string().optional(),
  modified: z.number().optional(),
  description: z.string().nullable().optional(),
  snippet: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  categories: z.array(z.string()).optional(),
  licenseInfo: z.string().nullable().optional(),
});
const searchSchema = z.object({
  results: z.array(itemSchema),
  nextStart: z
    .number()
    .int()
    .refine((value) => value === -1 || value >= 1),
  total: z.number().int().min(0),
});
const serviceSchema = z.object({
  layers: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        name: z.string(),
        subLayerIds: z.array(z.number()).nullable().optional(),
      }),
    )
    .optional(),
  tables: z
    .array(z.object({ id: z.number().int().nonnegative(), name: z.string() }))
    .optional(),
});
type Item = z.infer<typeof itemSchema>;
type State = {
  datasets: Dataset[];
  issues: DiscoveryIssue[];
  items: number;
  layers: number;
  total: number | null;
  next: number | null;
};

function searchURL(portal: Portal, start: number, options: DiscoveryOptions) {
  if (!portal.organizationId)
    throw Error("ArcGIS portals require an organization ID.");
  const url = new URL(`${portal.root}/search`);
  const terms = options.query
    ? ` AND (${options.query.replace(/["():]/g, " ")})`
    : "";
  url.search = new URLSearchParams({
    f: "json",
    q: `orgid:${portal.organizationId} AND (type:"Feature Service" OR type:"Map Service") AND access:public${terms}`,
    num: String(Math.min(100, options.maxItems)),
    start: String(start),
    sortField: "modified",
    sortOrder: "desc",
  }).toString();
  return url.href;
}

function issue(
  portal: Portal,
  state: State,
  error: unknown,
  kind: DiscoveryIssue["kind"] = "request",
  endpoint?: string,
) {
  state.issues.push({
    portalId: portal.id,
    endpoint,
    kind,
    message: publicDiscoveryError(error),
  });
}

function descriptor(
  portal: Portal,
  item: Item,
  serviceUrl: string,
  id: number,
  name: string,
): Dataset {
  return {
    id: `arcgis:${item.id}:${id}`,
    packageId: `${item.id}-${id}`,
    title: name || item.title,
    description: plainText(item.description || item.snippet) || null,
    publisher: portal.publisher,
    jurisdiction: portal.jurisdiction,
    coverage: null,
    category: item.categories?.[0] ?? null,
    serviceUrl,
    layerId: id,
    geometryType: "none",
    fields: null,
    verified: null,
    sourceUrl: `${portal.root.replace(/\/sharing\/rest\/?$/, "")}/home/item.html?id=${item.id}`,
    terms: plainText(item.licenseInfo) || null,
    termsUrl: null,
    scopeNote:
      "Automatically discovered public portal layer. Not reviewed by the curated R-package catalog.",
    tags: item.tags ?? [],
    platform: "arcgis",
    validationStatus: "discovered",
    portalId: portal.id,
    itemId: item.id,
    sourceUpdatedAt: sourceTimestamp(item.modified),
    sourceUpdatedKind: item.modified === undefined ? null : "portal-item",
  };
}

async function inspectLayer(dataset: Dataset, options: DiscoveryOptions) {
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
  const geometry = metadata.geometryType ?? "none";
  const supported = [
    "esriGeometryPoint",
    "esriGeometryMultipoint",
    "esriGeometryPolyline",
    "esriGeometryPolygon",
    "none",
  ];
  if (!supported.includes(geometry))
    throw Error(`Unsupported geometry type: ${geometry}`);
  return {
    ...applyVerification(dataset, metadata, verification),
    geometryType: geometry as Dataset["geometryType"],
    fields: metadata.fields,
    queryable: metadata.query,
    lastAttemptedAt: verification.lastCheckedAt,
    lastVerifiedAt: verification.lastSuccessfulAt,
    sourceUpdatedAt: metadata.sourceUpdatedAt ?? dataset.sourceUpdatedAt,
    sourceUpdatedKind: metadata.sourceUpdatedAt
      ? ("records" as const)
      : dataset.sourceUpdatedKind,
    verificationError: null,
  };
}

async function expandItem(
  portal: Portal,
  item: Item,
  state: State,
  options: DiscoveryOptions,
) {
  if (
    item.access !== "public" ||
    (item.orgId && item.orgId !== portal.organizationId)
  )
    return issue(
      portal,
      state,
      "Portal returned an item outside the registered public organization.",
      "security",
    );
  if (!item.url || !["Feature Service", "Map Service"].includes(item.type))
    return;
  const url = canonicalEndpoint(item.url);
  if (
    !/\/(FeatureServer|MapServer)(?:\/\d+)?$/.test(url) ||
    !endpointAllowed(url, portal.servicePrefixes)
  )
    return issue(
      portal,
      state,
      "Unregistered service location; publisher configuration must be reviewed.",
      "security",
      url,
    );
  const layerMatch = /^(.*\/(?:FeatureServer|MapServer))\/(\d+)$/.exec(url);
  if (layerMatch) {
    state.layers++;
    const dataset = descriptor(
      portal,
      item,
      layerMatch[1],
      Number(layerMatch[2]),
      item.title,
    );
    state.datasets.push(await inspectLayer(dataset, options));
    return;
  }
  await expandService(portal, item, url, state, options);
}

async function expandService(
  portal: Portal,
  item: Item,
  url: string,
  state: State,
  options: DiscoveryOptions,
) {
  const metadata = serviceSchema.parse(
    await requestJson(`${url}?f=json`, options.signal),
  );
  const layers = [
    ...(metadata.layers ?? []).filter((layer) => !layer.subLayerIds?.length),
    ...(metadata.tables ?? []),
  ];
  if (!layers.length)
    throw Error("Publisher service returned no discoverable layers or tables.");
  for (const layer of layers) {
    if (state.layers >= options.maxLayers) {
      issue(portal, state, "Layer inspection limit reached.", "truncated", url);
      break;
    }
    options.signal?.throwIfAborted();
    state.layers++;
    const dataset = descriptor(portal, item, url, layer.id, layer.name);
    try {
      state.datasets.push(await inspectLayer(dataset, options));
    } catch (error) {
      issue(portal, state, error, "schema", `${url}/${layer.id}`);
    }
  }
}

export async function discoverArcGIS(
  portal: Portal,
  options: DiscoveryOptions,
): Promise<{ datasets: Dataset[]; run: PortalRun }> {
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  if (
    !Number.isInteger(options.maxItems) ||
    options.maxItems < 1 ||
    !Number.isInteger(options.maxLayers) ||
    options.maxLayers < 1
  )
    throw Error("Discovery limits must be positive integers.");
  const state: State = {
    datasets: [],
    issues: [],
    items: 0,
    layers: 0,
    total: null,
    next: 1,
  };
  try {
    await scanPages(portal, state, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    issue(portal, state, error);
  }
  return {
    datasets: state.datasets,
    run: {
      portalId: portal.id,
      startedAt,
      finishedAt: now(),
      complete: state.issues.length === 0 && state.next === -1,
      itemsScanned: state.items,
      layersInspected: state.layers,
      datasetsFound: state.datasets.length,
      totalItems: state.total,
      nextStart: state.next,
      issues: state.issues,
    },
  };
}

function plainText(value: string | null | undefined) {
  return (
    value
      ?.replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim() ?? ""
  );
}

function budgetReached(state: State, options: DiscoveryOptions) {
  return state.items >= options.maxItems || state.layers >= options.maxLayers;
}

async function inspectItems(
  portal: Portal,
  items: Item[],
  state: State,
  options: DiscoveryOptions,
  seen: Set<string>,
) {
  for (const item of items) {
    if (budgetReached(state, options)) break;
    if (seen.has(item.id)) throw Error("Portal repeated a service item.");
    seen.add(item.id);
    state.items++;
    try {
      await expandItem(portal, item, state, options);
    } catch (error) {
      issue(portal, state, error, "request", item.url ?? undefined);
    }
  }
}

async function scanPages(
  portal: Portal,
  state: State,
  options: DiscoveryOptions,
) {
  const starts = new Set<number>();
  const seen = new Set<string>();
  while (state.next !== null && state.next !== -1) {
    const start = state.next;
    if (starts.has(start))
      throw Error("Portal search pagination repeated a cursor.");
    starts.add(start);
    const page = searchSchema.parse(
      await requestJson(searchURL(portal, start, options), options.signal),
    );
    state.total = page.total;
    state.next = page.nextStart;
    if (
      !page.results.length &&
      (page.nextStart !== -1 || page.total > state.items)
    )
      throw Error("Portal returned an empty page with further results.");
    await inspectItems(portal, page.results, state, options, seen);
    if (budgetReached(state, options)) {
      if (state.items < page.total)
        issue(
          portal,
          state,
          "Discovery budget reached; this is a partial scan.",
          "truncated",
        );
      break;
    }
  }
}
