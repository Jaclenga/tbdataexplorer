import { createHash } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import type { Dataset } from "../src/types";

export function classificationInputs(dataset: Dataset) {
  const parent = dataset.category_metadata;
  return {
    title: dataset.title,
    description: dataset.description,
    tags: [...new Set(dataset.tags)].sort(),
    fields: (dataset.fields ?? [])
      .map((f) => ({ name: f.name, alias: f.alias ?? "" }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    source_category: Object.hasOwn(dataset, "source_category")
      ? (dataset.source_category ?? null)
      : ["nlp", "semantic", "uncategorized"].includes(
            dataset.category_source ?? "",
          )
        ? null
        : dataset.category,
    parent: parent
      ? {
          description: parent.itemDescription,
          summary: parent.itemSummary,
          tags: [...new Set(parent.itemTags)].sort(),
        }
      : null,
  };
}
export function classificationHash(dataset: Dataset) {
  return createHash("sha256")
    .update(JSON.stringify(classificationInputs(dataset)))
    .digest("hex");
}
export function categoryChange(
  previous: Dataset | undefined,
  next: Dataset,
  at: string,
) {
  const before = previous ? classificationInputs(previous) : null,
    after = classificationInputs(next);
  const beforeHash = previous ? classificationHash(previous) : null,
    afterHash = classificationHash(next);
  if (
    previous &&
    beforeHash === afterHash &&
    previous.category === next.category
  )
    return null;
  const metadataChanges = Object.entries(after)
    .filter(
      ([key, value]) =>
        JSON.stringify(before?.[key as keyof typeof after]) !==
        JSON.stringify(value),
    )
    .map(([field, value]) => ({
      field,
      before: before?.[field as keyof typeof after] ?? null,
      after: value,
    }));
  return {
    eventId: createHash("sha256")
      .update(
        JSON.stringify([
          next.id,
          beforeHash,
          afterHash,
          previous?.category,
          next.category,
          at,
        ]),
      )
      .digest("hex"),
    at,
    datasetId: next.id,
    title: next.title,
    oldCategory: previous?.category ?? null,
    newCategory: next.category,
    oldSource: previous?.category_source ?? null,
    newSource: next.category_source ?? null,
    oldVersion: previous?.category_version ?? null,
    newVersion: next.category_version ?? null,
    reason: !previous
      ? "new_dataset"
      : beforeHash !== afterHash
        ? "metadata_changed"
        : "classification_rules_changed",
    oldInputHash: beforeHash,
    newInputHash: afterHash,
    metadataChanges,
  };
}
export async function recordCategoryHistory(
  events: NonNullable<ReturnType<typeof categoryChange>>[],
) {
  const path = "reports/category-history.json";
  let history: { schemaVersion: number; events: typeof events } = {
    schemaVersion: 1,
    events: [],
  };
  try {
    history = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (history.schemaVersion !== 1 || !Array.isArray(history.events))
    throw Error("Invalid category history");
  const ids = new Set(history.events.map((event) => event.eventId));
  history.events.push(...events.filter((event) => !ids.has(event.eventId)));
  await mkdir("reports", { recursive: true });
  await writeFile(`${path}.pending`, JSON.stringify(history, null, 2) + "\n");
  await rename(`${path}.pending`, path);
  await writeFile(
    "reports/category-changes.json",
    JSON.stringify({ events }, null, 2) + "\n",
  );
}
