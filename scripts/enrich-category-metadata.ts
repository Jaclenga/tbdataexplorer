import { fieldSchema, type Dataset } from "../src/types";
import { z } from "zod";
import portals from "../config/portals.json";
import { endpointAllowed } from "../src/services/source-url";

const plain = (value: unknown) =>
  typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 6000)
    : "";
export function mergeCategoryMetadata(
  dataset: Dataset,
  item: Record<string, unknown>,
  layer: Record<string, unknown>,
  itemUrl: string,
  layerUrl: string,
): Dataset {
  const layerDescription = plain(layer.description);
  const fields = z.array(fieldSchema).safeParse(layer.fields);
  return {
    ...dataset,
    description: layerDescription || dataset.description,
    fields: fields.success ? fields.data : dataset.fields,
    category_metadata: {
      itemUrl,
      layerUrl,
      itemDescription: plain(item.description),
      itemSummary: plain(item.snippet),
      layerDescription,
      itemTags: Array.isArray(item.tags)
        ? item.tags
            .filter((t): t is string => typeof t === "string")
            .slice(0, 50)
        : [],
      checkedOn: new Date().toISOString().slice(0, 10),
    },
  };
}
export async function enrichCategoryMetadata(
  datasets: Dataset[],
  refresh: boolean,
) {
  const requests = new Map<string, Promise<Record<string, unknown>>>();
  const issues: { id: string; error: string }[] = [];
  const get = (url: string) => {
    if (!requests.has(url))
      requests.set(
        url,
        (async () => {
          const response = await fetch(`${url}?f=json`, {
            signal: AbortSignal.timeout(12000),
            redirect: "error",
          });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          const value = (await response.json()) as Record<string, unknown>;
          if (value.error) throw Error("Publisher returned an ArcGIS error");
          return value;
        })(),
      );
    return requests.get(url)!;
  };
  const result = [...datasets];
  let next = 0;
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (next < datasets.length) {
        const index = next++,
          dataset = datasets[index];
        if (
          (dataset.category_source !== "uncategorized" &&
            !(refresh && dataset.category_metadata)) ||
          !dataset.itemId ||
          !dataset.serviceUrl ||
          (dataset.category_metadata &&
            (!refresh ||
              dataset.category_metadata.checkedOn ===
                new Date().toISOString().slice(0, 10)))
        )
          continue;
        const portal = portals.find(
          (p) => p.id === dataset.portalId && p.platform === "arcgis",
        );
        if (
          !portal ||
          !endpointAllowed(dataset.serviceUrl, portal.servicePrefixes ?? [])
        )
          continue;
        const itemUrl = `${portal.root}/content/items/${dataset.itemId}`,
          layerUrl = `${dataset.serviceUrl}/${dataset.layerId}`;
        const [item, layer] = await Promise.allSettled([
          get(itemUrl),
          get(layerUrl),
        ]);
        if (item.status === "rejected" || layer.status === "rejected") {
          issues.push({
            id: dataset.id,
            error: "Metadata request failed; prior metadata retained",
          });
          continue;
        }
        if (
          item.value.access !== "public" ||
          item.value.id !== dataset.itemId
        ) {
          issues.push({
            id: dataset.id,
            error:
              "Item identity or public access did not match; prior metadata retained",
          });
          continue;
        }
        result[index] = mergeCategoryMetadata(
          dataset,
          item.value,
          layer.value,
          itemUrl,
          layerUrl,
        );
      }
    }),
  );
  return { datasets: result, issues, requests: requests.size };
}
