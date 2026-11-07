import { z } from "zod";
import type { Dataset } from "../../types";
import { datasetSchema } from "../../types";

export const portalSchema = z.object({
  id: z.string().min(1),
  platform: z.enum(["arcgis", "ckan", "socrata", "csv", "json"]),
  root: z.url().startsWith("https://"),
  organizationId: z.string().optional(),
  publisher: z.string(),
  jurisdiction: z.string(),
  website: z.url(),
  evidenceUrl: z.url(),
  servicePrefixes: z.array(z.url()).min(1),
  resources: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        url: z.url().startsWith("https://"),
      }),
    )
    .optional(),
});
export type Portal = z.infer<typeof portalSchema>;
export const issueSchema = z.object({
  portalId: z.string(),
  endpoint: z.string().optional(),
  message: z.string(),
  kind: z.enum(["request", "unsupported", "truncated", "security", "schema"]),
});
export type DiscoveryIssue = z.infer<typeof issueSchema>;
export const portalRunSchema = z.object({
  portalId: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  complete: z.boolean(),
  itemsScanned: z.number().int().min(0),
  layersInspected: z.number().int().min(0),
  datasetsFound: z.number().int().min(0),
  totalItems: z.number().int().min(0).nullable(),
  nextStart: z.number().int().nullable(),
  issues: z.array(issueSchema),
});
export type PortalRun = z.infer<typeof portalRunSchema>;
export const discoverySchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.iso.datetime(),
    lastSuccessfulRunAt: z.iso.datetime().nullable(),
    complete: z.boolean(),
    datasets: z.array(datasetSchema),
    curatedUpdates: z.array(datasetSchema).optional(),
    runs: z.array(portalRunSchema),
    healthHistory: z
      .object({
        schemaVersion: z.literal(1),
        successfulAt: z.iso.datetime(),
        records: z.array(z.object({ id: z.string(), metadata: z.string() })),
        changes: z
          .object({
            added: z.number().int().nonnegative(),
            removed: z.number().int().nonnegative(),
            changed: z.number().int().nonnegative(),
          })
          .nullable(),
      })
      .optional(),
    refresh: z
      .object({
        startedAt: z.iso.datetime(),
        finishedAt: z.iso.datetime(),
        outcome: z.enum(["success", "partial", "failed"]),
        verified: z.number().int().nonnegative(),
        curatedErrors: z.number().int().nonnegative(),
        changes: z.object({
          added: z.array(z.string()),
          updated: z.array(z.string()),
          retained: z.number().int().nonnegative(),
        }),
      })
      .optional(),
  })
  .superRefine((report, context) => {
    if (
      new Set(report.datasets.map((d) => d.id)).size !== report.datasets.length
    )
      context.addIssue({ code: "custom", message: "Duplicate discovery IDs" });
    if (report.complete && report.runs.some((run) => !run.complete))
      context.addIssue({
        code: "custom",
        message: "Incomplete scans cannot be marked complete",
      });
    if (report.datasets.some((d) => d.validationStatus !== "discovered"))
      context.addIssue({
        code: "custom",
        message: "Discovery cannot grant curated status",
      });
  });
export type DiscoveryReport = z.infer<typeof discoverySchema>;
export interface DiscoveryOptions {
  query?: string;
  previousDatasets?: Dataset[];
  forceVerification?: boolean;
  maxItems: number;
  maxLayers: number;
  signal?: AbortSignal;
  now?: () => string;
}
