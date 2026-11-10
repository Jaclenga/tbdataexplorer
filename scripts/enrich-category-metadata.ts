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
  now = new Date().toISOString(),
): Dataset {
  const layerDescription = plain(layer.description);
  const fields = z.array(fieldSchema).safeParse(layer.fields);
  return {
    ...dataset,
    title:
      typeof layer.name === "string" && layer.name.trim()
        ? layer.name
        : dataset.title,
    tags: Array.isArray(item.tags)
      ? item.tags
          .filter((tag): tag is string => typeof tag === "string")
          .slice(0, 50)
      : dataset.tags,
    description: layerDescription || null,
    metadata_check: {
      lastAttemptAt: now,
      lastSuccessAt: now,
      descriptionChangedAt:
        (layerDescription || null) !== dataset.description
          ? now
          : (dataset.metadata_check?.descriptionChangedAt ?? null),
      status: "success",
      descriptionStatus: layerDescription ? "present" : "empty",
      error: null,
    },
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
      checkedOn: now.slice(0, 10),
    },
  };
}
export async function enrichCategoryMetadata(
  datasets: Dataset[],
  refresh: boolean,
  now = new Date().toISOString(),
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
          (!refresh &&
            (dataset.metadata_check ||
              (dataset.category_source !== "uncategorized" &&
                dataset.description))) ||
          !dataset.itemId ||
          !dataset.serviceUrl ||
          dataset.metadata_check?.lastAttemptAt.slice(0, 10) ===
            now.slice(0, 10)
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
        const failed = (message: string) => {
          result[index] = {
            ...dataset,
            metadata_check: {
              lastAttemptAt: now,
              lastSuccessAt: dataset.metadata_check?.lastSuccessAt ?? null,
              descriptionChangedAt:
                dataset.metadata_check?.descriptionChangedAt ?? null,
              status: "failed",
              descriptionStatus:
                dataset.metadata_check?.descriptionStatus ??
                (dataset.description ? "present" : "unknown"),
              error: message,
            },
          };
          issues.push({ id: dataset.id, error: message });
        };
        if (item.status === "rejected" || layer.status === "rejected") {
          failed("Metadata request failed; prior metadata retained");
          continue;
        }
        if (
          item.value.access !== "public" ||
          item.value.id !== dataset.itemId
        ) {
          failed(
            "Item identity or public access did not match; prior metadata retained",
          );
          continue;
        }
        if (
          !z
            .object({
              description: z.string().nullable().optional(),
              snippet: z.string().nullable().optional(),
              tags: z.array(z.string()).optional(),
            })
            .safeParse(item.value).success ||
          !Array.isArray(layer.value.fields) ||
          !z.array(fieldSchema).safeParse(layer.value.fields).success ||
          (layer.value.description !== undefined &&
            layer.value.description !== null &&
            typeof layer.value.description !== "string")
        ) {
          failed("Invalid layer metadata; prior metadata retained");
          continue;
        }
        result[index] = mergeCategoryMetadata(
          dataset,
          item.value,
          layer.value,
          itemUrl,
          layerUrl,
          now,
        );
      }
    }),
  );
  return { datasets: result, issues, requests: requests.size };
}
