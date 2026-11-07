import type { Dataset } from "../types";
import policy from "../../config/proxy.json";
import { endpointAllowed } from "./source-url";
import { ArcGISError, requestJson } from "./http";

export function proxyEligible(dataset: Dataset) {
  return (
    (!dataset.platform || dataset.platform === "arcgis") &&
    endpointAllowed(
      `${dataset.serviceUrl}/${dataset.layerId}`,
      policy.servicePrefixes,
    )
  );
}

export async function requestArcGIS(
  dataset: Dataset,
  operation: "metadata" | "query",
  params: Record<string, string | number | boolean>,
  signal?: AbortSignal,
  onResponse?: (status: number) => void,
) {
  const endpoint = `${dataset.serviceUrl}/${dataset.layerId}`;
  const suffix = operation === "query" ? "/query" : "";
  const query = new URLSearchParams(
    Object.entries({ f: "json", ...params }).map(([key, value]) => [
      key,
      String(value),
    ]),
  );
  try {
    return await requestJson(
      `${endpoint}${suffix}?${query}`,
      signal,
      15000,
      onResponse,
    );
  } catch (error) {
    if (
      !(error instanceof ArcGISError) ||
      !error.networkFailure ||
      !proxyEligible(dataset) ||
      typeof location === "undefined"
    )
      throw error;
    const proxy = new URL("/api/arcgis", location.origin);
    proxy.search = new URLSearchParams({
      dataset: dataset.id,
      operation,
      ...Object.fromEntries(query),
    }).toString();
    return requestJson(proxy.href, signal, 15000, onResponse);
  }
}
