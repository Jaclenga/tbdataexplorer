import { ArcGISError } from "./http";
import { requestArcGIS } from "./arcgis-transport";
import { compileFilter, type RecordFilter } from "./record-filter";
export { ArcGISError, requestJson } from "./http";
import { z } from "zod";
import { arcgisToGeoJSON } from "@terraformer/arcgis";
import {
  fieldSchema,
  type Dataset,
  type LayerMetadata,
  type Page,
  type RecordFeature,
} from "../types";
const metadataSchema = z.object({
  description: z.string().nullable().optional(),
  copyrightText: z.string().nullable().optional(),
  fields: z.array(fieldSchema),
  objectIdField: z.string().optional(),
  objectIdFieldName: z.string().optional(),
  geometryType: z.string().optional(),
  maxRecordCount: z.number().int().positive().optional(),
  capabilities: z.string().optional(),
  supportedQueryFormats: z.string().optional(),
  editingInfo: z
    .object({ lastEditDate: z.number().nullable().optional() })
    .optional(),
  advancedQueryCapabilities: z
    .object({
      supportsPagination: z.boolean().optional(),
      supportsOrderBy: z.boolean().optional(),
    })
    .optional(),
});
const spatialReferenceSchema = z.object({
  wkid: z.number().optional(),
  latestWkid: z.number().optional(),
});
const positionSchema = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .rest(z.number());
const lineSchema = z.array(positionSchema).min(2);
const ringSchema = z.array(positionSchema).min(4).refine(closedRing);
const polygonSchema = z.array(ringSchema).min(1);
const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: positionSchema }),
  z.object({
    type: z.literal("MultiPoint"),
    coordinates: z.array(positionSchema).min(1),
  }),
  z.object({ type: z.literal("LineString"), coordinates: lineSchema }),
  z.object({
    type: z.literal("MultiLineString"),
    coordinates: z.array(lineSchema).min(1),
  }),
  z.object({ type: z.literal("Polygon"), coordinates: polygonSchema }),
  z.object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(polygonSchema).min(1),
  }),
]);
const responseSchema = z.object({
  features: z.array(
    z.object({
      attributes: z.record(
        z.string(),
        z.union([z.string(), z.number(), z.boolean(), z.null()]),
      ),
      geometry: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  ),
  exceededTransferLimit: z.boolean().optional(),
  spatialReference: spatialReferenceSchema.optional(),
});
export const endpoint = (d: Dataset) => `${d.serviceUrl}/${d.layerId}`;
export function queryUrl(
  d: Dataset,
  params: Record<string, string | number | boolean>,
) {
  const url = new URL(`${endpoint(d)}/query`);
  url.search = new URLSearchParams(
    Object.entries({ f: "json", ...params }).map(([k, v]) => [k, String(v)]),
  ).toString();
  return url.href;
}
export async function getMetadata(
  d: Dataset,
  signal?: AbortSignal,
): Promise<LayerMetadata> {
  let httpStatus: number | undefined;
  const parsed = metadataSchema.safeParse(
    await requestArcGIS(d, "metadata", {}, signal, (status) => {
      httpStatus = status;
    }),
  );
  if (!parsed.success)
    throw new ArcGISError(
      "The publisher returned an unsupported layer schema.",
    );
  const m = parsed.data;
  return {
    httpStatus,
    fields: m.fields,
    description: m.description,
    attribution: m.copyrightText,
    sourceUpdatedAt: sourceTimestamp(m.editingInfo?.lastEditDate),
    sourceUpdatedKind: m.editingInfo?.lastEditDate != null ? "records" : null,
    inspectedAt: new Date().toISOString(),
    objectIdField: metadataObjectId(m),
    geometryType: m.geometryType ?? null,
    maxRecordCount: m.maxRecordCount ?? 100,
    pagination: m.advancedQueryCapabilities?.supportsPagination === true,
    orderBy: m.advancedQueryCapabilities?.supportsOrderBy === true,
    geojson: /geojson/i.test(m.supportedQueryFormats ?? ""),
    query: hasQueryCapability(m.capabilities),
  };
}
function metadataObjectId(metadata: z.infer<typeof metadataSchema>) {
  return (
    metadata.objectIdField ??
    metadata.objectIdFieldName ??
    metadata.fields.find((field) => field.type === "esriFieldTypeOID")?.name ??
    null
  );
}
function hasQueryCapability(capabilities: string | undefined) {
  return (
    capabilities === undefined ||
    capabilities
      .split(",")
      .some((capability) => capability.trim().toLowerCase() === "query")
  );
}
export type Bounds = [number, number, number, number];

function closedRing(ring: number[][]) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) return false;
  return (
    first.length === last.length &&
    first.every((coordinate, index) => coordinate === last[index])
  );
}

function validateSpatialReference(value: unknown) {
  if (value === undefined) return;
  const result = spatialReferenceSchema.safeParse(value);
  if (!result.success || (result.data.latestWkid ?? result.data.wkid) !== 4326)
    throw new ArcGISError(
      "Publisher did not honor WGS84 output coordinates; map and spatial export are unavailable.",
    );
}

function featureGeometry(record: RecordFeature): GeoJSON.Geometry | null {
  if (!record.geometry) return null;
  validateSpatialReference(record.geometry.spatialReference);
  const geometry = arcgisToGeoJSON(record.geometry);
  if (!geometry || !geometry.type)
    throw new ArcGISError("Publisher returned unsupported geometry.");
  if (!geometrySchema.safeParse(geometry).success)
    throw new ArcGISError(
      "Publisher returned invalid WGS84 geometry or coordinates.",
    );
  return geometry;
}

export function normalizeGeometry(
  records: RecordFeature[],
  spatial: boolean,
  sr?: { wkid?: number; latestWkid?: number },
): GeoJSON.FeatureCollection<GeoJSON.Geometry | null> | null {
  if (!spatial) return null;
  validateSpatialReference(sr);
  return {
    type: "FeatureCollection",
    features: records.map((record, id) => ({
      type: "Feature",
      id,
      properties: record.attributes,
      geometry: featureGeometry(record),
    })),
  };
}

function supportsOrderedPages(metadata: LayerMetadata) {
  return metadata.pagination && metadata.orderBy && !!metadata.objectIdField;
}

function pageQuery(
  m: LayerMetadata,
  offset: number,
  bounds?: Bounds,
  filter?: RecordFilter,
) {
  const limit = Math.min(100, m.maxRecordCount, 10000 - offset);
  const params: Record<string, string | number | boolean> = {
    where: compileFilter(filter, m.fields),
    outFields: "*",
    returnGeometry: !!m.geometryType,
    outSR: 4326,
    resultRecordCount: limit,
  };
  if (supportsOrderedPages(m)) {
    params.resultOffset = offset;
    params.orderByFields = `${m.objectIdField} ASC`;
  }
  if (bounds) {
    params.geometry = JSON.stringify({
      xmin: bounds[0],
      ymin: bounds[1],
      xmax: bounds[2],
      ymax: bounds[3],
      spatialReference: { wkid: 4326 },
    });
    params.geometryType = "esriGeometryEnvelope";
    params.inSR = 4326;
    params.spatialRel = "esriSpatialRelIntersects";
  }
  return params;
}

type QueryResponse = z.infer<typeof responseSchema>;

function validateRecordIds(
  records: RecordFeature[],
  objectIdField: string | null,
  previousIds?: Set<string>,
) {
  if (!objectIdField) return;
  const ids = new Set<string>();
  for (const record of records) {
    const id = record.attributes[objectIdField];
    if (
      id === null ||
      id === undefined ||
      ids.has(String(id)) ||
      previousIds?.has(String(id))
    )
      throw new ArcGISError(
        "The publisher returned missing or repeated record IDs. Pagination stopped to avoid misleading results.",
      );
    ids.add(String(id));
  }
}

function validatePage(
  body: QueryResponse,
  limit: number,
  objectIdField: string | null,
  previousIds?: Set<string>,
) {
  if (body.features.length > limit)
    throw new ArcGISError(
      "The publisher ignored the preview limit. No oversized page was accepted.",
    );
  validateRecordIds(body.features, objectIdField, previousIds);
  if (!body.features.length && body.exceededTransferLimit)
    throw new ArcGISError(
      "Publisher reports more results but returned an empty page.",
    );
}

function pageGeometry(body: QueryResponse, spatial: boolean) {
  try {
    return {
      geojson: normalizeGeometry(body.features, spatial, body.spatialReference),
      warning: null,
    };
  } catch (error) {
    return {
      geojson: null,
      warning:
        error instanceof Error
          ? error.message
          : "Geometry could not be displayed.",
    };
  }
}

export async function getPage(
  dataset: Dataset,
  metadata: LayerMetadata,
  offset = 0,
  signal?: AbortSignal,
  bounds?: Bounds,
  previousIds?: Set<string>,
  filter?: RecordFilter,
): Promise<Page> {
  if (!metadata.query)
    throw new ArcGISError(
      "This endpoint does not advertise Query capability. Open the source for other access options.",
    );
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= 10000)
    throw new ArcGISError("Invalid page offset.");
  const paginates = supportsOrderedPages(metadata);
  if (offset > 0 && !paginates)
    throw new ArcGISError(
      "This endpoint cannot provide reliable ordered pagination. Only its initial preview is available.",
    );

  const params = pageQuery(metadata, offset, bounds, filter);
  const parsed = responseSchema.safeParse(
    await requestArcGIS(dataset, "query", params, signal),
  );
  if (!parsed.success)
    throw new ArcGISError("The publisher returned malformed records.");
  const body = parsed.data;
  const limit = Math.min(100, metadata.maxRecordCount, 10000 - offset);
  validatePage(body, limit, metadata.objectIdField, previousIds);
  const { geojson, warning } = pageGeometry(body, !!metadata.geometryType);
  const warnings = [warning];
  if (!paginates)
    warnings.push(
      "Reliable ordered pagination is unavailable. This is only the initial bounded preview.",
    );
  return {
    records: body.features,
    retrievedAt: new Date().toISOString(),
    geojson,
    hasMore:
      paginates &&
      (body.exceededTransferLimit ?? body.features.length === limit),
    offset,
    limit,
    warning: warnings.filter(Boolean).join(" ") || null,
  };
}

export function sourceTimestamp(value: unknown): string | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isFinite(new Date(value).getTime())
  )
    return null;
  return new Date(value).toISOString();
}
