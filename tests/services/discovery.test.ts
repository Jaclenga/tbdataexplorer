import { describe, it, expect, vi } from "vitest";
import { dataset, catalog, layerResponse } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";
import { discoverArcGIS } from "../../src/services/discovery/arcgis";
import { discoverPortal } from "../../src/services/discovery";
import {
  discoverySchema,
  portalSchema,
  type Portal,
} from "../../src/services/discovery/types";
import {
  mergeDatasets,
  preservePrevious,
} from "../../src/services/discovery/identity";
import { federatedCatalog } from "../../src/services/federated-catalog";
import { externalDescriptor } from "../../src/services/discovery/external";
import { searchCatalog } from "../../src/services/catalog";

export const portal: Portal = {
  id: "test",
  platform: "arcgis",
  root: "https://data.example.test/sharing/rest",
  organizationId: "organization",
  publisher: "Test government",
  jurisdiction: "Test county",
  website: "https://data.example.test",
  evidenceUrl: "https://data.example.test/about",
  servicePrefixes: ["https://data.example.test/services/"],
};
const item = (
  id = "a".repeat(32),
  overrides: Record<string, unknown> = {},
) => ({
  id,
  title: "Public service",
  type: "Feature Service",
  url: "https://data.example.test/services/Parks/FeatureServer",
  access: "public",
  orgId: "organization",
  modified: 1700000000000,
  description: "<p>Public <b>parks</b></p>",
  tags: ["parks"],
  ...overrides,
});
const options = { maxItems: 10, maxLayers: 10 };
function api(
  pages: unknown[],
  service: unknown = {
    layers: [{ id: 0, name: "Parks" }],
    tables: [{ id: 1, name: "Budgets" }],
  },
  metadata: unknown = layerResponse,
) {
  let index = 0;
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/search")) return Response.json(pages[index++]);
    if (/\/(FeatureServer|MapServer)$/.test(url.pathname))
      return Response.json(service);
    return Response.json(metadata);
  });
}
const page = (results: unknown[], nextStart = -1, total = results.length) => ({
  results,
  nextStart,
  total,
});
describe("registered ArcGIS discovery", () => {
  it("supports a portal item pointing directly at one layer without expanding unrelated layers", async () => {
    api([
      page([
        item(undefined, {
          url: "https://data.example.test/services/Parks/MapServer/7",
          title: "Specific layer",
        }),
      ]),
    ]);
    const result = await discoverArcGIS(portal, options);
    expect(result.datasets[0]).toMatchObject({
      serviceUrl: "https://data.example.test/services/Parks/MapServer",
      layerId: 7,
      title: "Specific layer",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.run.complete).toBe(true);
  });
  it("discovers FeatureServer layers and nonspatial tables using live metadata only", async () => {
    api([page([item()])]);
    const result = await discoverPortal(portal, options);
    expect(result.datasets).toHaveLength(2);
    expect(result.run.complete).toBe(true);
    expect(result.datasets[0]).toMatchObject({
      validationStatus: "discovered",
      verified: null,
      title: "Parks",
      description: "Public parks",
      sourceUpdatedKind: "portal-item",
      queryable: true,
    });
    expect(result.datasets[0].lastVerifiedAt).toBeTruthy();
    const urls = vi
      .mocked(fetch)
      .mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.some((url) => url.pathname.endsWith("/query"))).toBe(false);
    expect(urls[0].searchParams.get("q")).toContain("orgid:organization");
    expect(urls[0].searchParams.get("q")).toContain("access:public");
  });
  it("follows search pagination and expands MapServer leaf layers", async () => {
    api(
      [
        page([item()], 2, 2),
        page(
          [
            item("b".repeat(32), {
              type: "Map Service",
              url: "https://data.example.test/services/Roads/MapServer",
            }),
          ],
          -1,
          2,
        ),
      ],
      {
        layers: [
          { id: 5, name: "Group", subLayerIds: [7] },
          { id: 7, name: "Street", subLayerIds: null },
        ],
      },
    );
    const result = await discoverArcGIS(portal, {
      ...options,
      query: "roads:(public)",
    });
    expect(result.datasets).toHaveLength(2);
    expect(result.datasets[1].serviceUrl).toContain("MapServer");
    expect(result.run.itemsScanned).toBe(2);
    expect(result.run.complete).toBe(true);
  });
  it.each([
    { access: "private" },
    { orgId: "another" },
    { url: "https://127.0.0.1/private/FeatureServer" },
    { url: "https://data.example.test/unregistered/FeatureServer" },
    {
      url: "https://data.example.test/services/Foo/FeatureServer?token=secret",
    },
    { url: "https://data.example.test/services/Example/ImageServer" },
  ])(
    "rejects private, cross-organization, or unregistered services %j",
    async (overrides) => {
      api([page([item(undefined, overrides)])]);
      const result = await discoverArcGIS(portal, options);
      expect(result.datasets).toEqual([]);
      expect(result.run.complete).toBe(false);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    },
  );
  it("ignores unsupported search item types and missing URLs", async () => {
    api([
      page([
        item(undefined, { type: "Web Map" }),
        item("b".repeat(32), { url: null }),
      ]),
    ]);
    expect((await discoverArcGIS(portal, options)).datasets).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("marks bounded service and layer scans partial", async () => {
    api([page([item()], 2, 100)]);
    const result = await discoverArcGIS(portal, { maxItems: 1, maxLayers: 1 });
    expect(result.datasets).toHaveLength(1);
    expect(result.run.complete).toBe(false);
    expect(result.run.issues.some((i) => i.kind === "truncated")).toBe(true);
  });
  it("reuses recent structural checks for unchanged publisher revisions", async () => {
    api([page([item()])]);
    const first = await discoverArcGIS(portal, options);
    const previous = structuredClone(first.datasets);
    api([page([item()])]);
    vi.mocked(fetch).mockClear();
    const second = await discoverArcGIS(portal, {
      ...options,
      previousDatasets: previous,
    });
    expect(second.datasets).toEqual(previous);
    expect(fetch).toHaveBeenCalledTimes(2); // Search and service metadata, no repeated layer checks.
  });
  it("detects repeated pagination cursors", async () => {
    api([page([item()], 1, 2)]);
    const result = await discoverArcGIS(portal, options);
    expect(result.run.issues[0].message).toContain("repeated a cursor");
  });
  it("detects repeated items on different pages", async () => {
    api([page([item()], 2, 2), page([item()], -1, 2)]);
    const result = await discoverArcGIS(portal, options);
    expect(result.run.issues[0].message).toContain("repeated a service");
  });
  it("rejects empty pages with more results", async () => {
    api([page([], 2, 5)]);
    expect(
      (await discoverArcGIS(portal, options)).run.issues[0].message,
    ).toContain("empty page");
  });
  it.each([0, -2, 1.5])("rejects invalid search cursors %s", async (next) => {
    api([page([], next)]);
    expect((await discoverArcGIS(portal, options)).run.complete).toBe(false);
  });
  it("retains other service results after schema changes and metadata failures", async () => {
    api(
      [page([item()])],
      { layers: [{ id: 0, name: "Bad" }] },
      { fields: "changed" },
    );
    const result = await discoverArcGIS(portal, options);
    expect(result.run.issues[0].kind).toBe("schema");
    expect(result.datasets).toEqual([]);
  });
  it("rejects unsupported geometry instead of mislabeling it", async () => {
    api([page([item()])], undefined, {
      ...layerResponse,
      geometryType: "esriGeometryMesh",
    });
    expect(
      (await discoverArcGIS(portal, options)).run.issues[0].message,
    ).toContain("geometry");
  });
  it("reports search HTTP failures without deleting a previous index", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 403 }));
    const result = await discoverArcGIS(portal, options);
    expect(result.run.totalItems).toBeNull();
    expect(result.run.complete).toBe(false);
    expect(result.run.issues).toHaveLength(1);
  });
  it("reports service errors and rejects missing organization configuration", async () => {
    api([page([item()])], { error: { code: 499, message: "Token required" } });
    expect(
      (await discoverArcGIS(portal, options)).run.issues[0].message,
    ).toContain("499");
    expect(
      (await discoverArcGIS({ ...portal, organizationId: undefined }, options))
        .run.complete,
    ).toBe(false);
  });
  it.each([
    { maxItems: 0, maxLayers: 2 },
    { maxItems: 2, maxLayers: -1 },
  ])("requires bounded positive budgets %j", async (limits) => {
    await expect(discoverArcGIS(portal, limits)).rejects.toThrow("positive");
  });
  it("propagates cancellation", async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      discoverArcGIS(portal, { ...options, signal: c.signal }),
    ).rejects.toThrow();
  });
});
describe("catalog identity and provenance", () => {
  const discovered = {
    ...dataset,
    id: "arcgis:automatic:0",
    validationStatus: "discovered" as const,
    lastVerifiedAt: "2026-11-04T12:00:00.000Z",
    sourceUpdatedAt: "2024-01-01T00:00:00.000Z",
    sourceUpdatedKind: "records" as const,
  };
  it("deduplicates discovered endpoints and always keeps curated IDs and titles", () => {
    const result = mergeDatasets(
      [dataset],
      [discovered, { ...discovered, id: "duplicate" }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: dataset.id,
      title: dataset.title,
      validationStatus: "curated",
      lastVerifiedAt: discovered.lastVerifiedAt,
      sourceUpdatedAt: discovered.sourceUpdatedAt,
    });
  });
  it("retains prior metadata during failures and adds newly published layers", () => {
    expect(preservePrevious([discovered], [])).toEqual([discovered]);
    const newer = { ...discovered, title: "Updated" };
    const another = { ...discovered, id: "new", layerId: 99 };
    expect(preservePrevious([discovered], [newer, another])).toEqual([
      newer,
      another,
    ]);
  });
  it("only accepts curated updates for the same ID and canonical endpoint", () => {
    const report = {
      ...emptyDiscovery,
      curatedUpdates: [
        {
          ...dataset,
          title: "Remote title",
          lastVerifiedAt: discovered.lastVerifiedAt,
        },
      ],
    };
    const result = federatedCatalog(catalog, report);
    expect(result.datasets[0]).toMatchObject({
      title: dataset.title,
      lastVerifiedAt: discovered.lastVerifiedAt,
    });
    expect(
      federatedCatalog(catalog, {
        ...report,
        curatedUpdates: [{ ...dataset, layerId: 99 }],
      }).datasets[0].layerId,
    ).toBe(dataset.layerId);
  });
  it("keeps new discoveries separate and supports provenance/platform filters", () => {
    const d = { ...discovered, layerId: 90 };
    const result = federatedCatalog(catalog, {
      ...emptyDiscovery,
      datasets: [d],
    });
    expect(result.datasets).toHaveLength(4);
    expect(
      searchCatalog(result.datasets, {
        query: "",
        publisher: "",
        category: "",
        spatial: "",
        verification: "discovered",
        platform: "arcgis",
      }),
    ).toEqual([d]);
  });
  it("rejects discovery indexes granting curated status or lying about completeness", () => {
    expect(
      discoverySchema.safeParse({ ...emptyDiscovery, datasets: [dataset] })
        .success,
    ).toBe(false);
    expect(
      discoverySchema.safeParse({
        ...emptyDiscovery,
        datasets: [discovered, discovered],
      }).success,
    ).toBe(false);
    expect(
      portalSchema.safeParse({ ...portal, root: "http://unsafe.test" }).success,
    ).toBe(false);
  });
});
describe("additional platform discovery", () => {
  const other = (platform: Portal["platform"]): Portal => ({
    ...portal,
    platform,
    root: "https://data.example.test",
    servicePrefixes: ["https://data.example.test/"],
  });
  it("discovers CKAN DataStore resources and validates live field metadata", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("package_search")
        ? Response.json({
            success: true,
            result: {
              count: 1,
              results: [
                {
                  id: "package",
                  title: "Public package",
                  resources: [
                    {
                      id: "resource",
                      url: "https://data.example.test/file.csv",
                      format: "CSV",
                      datastore_active: true,
                    },
                  ],
                },
              ],
            },
          })
        : Response.json({
            success: true,
            result: {
              fields: [{ id: "_id", type: "int4" }],
              records: [],
              total: 0,
            },
          }),
    );
    const result = await discoverPortal(other("ckan"), options);
    expect(result.run.complete).toBe(true);
    expect(result.datasets[0]).toMatchObject({
      platform: "ckan",
      validationStatus: "discovered",
      resource: { id: "resource" },
    });
  });
  it("discovers bounded CSV resources from a CKAN package", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("package_search")
        ? Response.json({
            success: true,
            result: {
              count: 1,
              results: [
                {
                  id: "package",
                  title: "Public",
                  resources: [
                    {
                      id: "r",
                      url: "https://data.example.test/file.csv",
                      format: "CSV",
                    },
                  ],
                },
              ],
            },
          })
        : new Response("Name\nPark"),
    );
    const result = await discoverPortal(other("ckan"), options);
    expect(result.datasets[0].platform).toBe("csv");
  });
  it("discovers Socrata public datasets scoped to the registered domain", async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      String(input).includes("api/catalog")
        ? Response.json({
            resultSetSize: 1,
            results: [
              {
                resource: { id: "abcd-1234", name: "Permits" },
                metadata: { domain: "data.example.test" },
              },
            ],
          })
        : Response.json({
            columns: [
              { fieldName: "permit", name: "Permit", dataTypeName: "text" },
            ],
          }),
    );
    const result = await discoverPortal(other("socrata"), options);
    expect(result.run.complete).toBe(true);
    expect(result.datasets[0].resource?.url).toContain(
      "/resource/abcd-1234.json",
    );
  });
  it("supports an explicit file manifest while refusing unregistered URLs", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Name\nPark"));
    const result = await discoverPortal(
      {
        ...other("csv"),
        resources: [
          {
            id: "a",
            title: "Parks",
            url: "https://data.example.test/parks.csv",
          },
          { id: "b", title: "Private", url: "https://evil.test/private.csv" },
        ],
      },
      options,
    );
    expect(result.datasets).toHaveLength(1);
    expect(result.run.issues).toHaveLength(1);
    expect(result.run.complete).toBe(false);
  });
  it("records platform API failures and respects discovery bounds", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 400 }));
    expect(
      (await discoverPortal(other("ckan"), options)).run.totalItems,
    ).toBeNull();
    vi.mocked(fetch).mockResolvedValue(new Response("Name\nPark"));
    const result = await discoverPortal(
      {
        ...other("csv"),
        resources: [
          { id: "a", title: "A", url: "https://data.example.test/a" },
          { id: "b", title: "B", url: "https://data.example.test/b" },
        ],
      },
      { maxItems: 1, maxLayers: 1 },
    );
    expect(result.run.issues[0].kind).toBe("truncated");
  });
  it("creates distinct external resource identities", () => {
    const d = externalDescriptor(
      other("json"),
      "r",
      "Name",
      "https://data.example.test/a.json",
    );
    expect(mergeDatasets([], [d, { ...d, id: "same-url" }])).toHaveLength(1);
  });
});
