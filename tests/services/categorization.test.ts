import { describe, expect, it } from "vitest";
import { dataset } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";
import {
  categoryNames,
  normalizeMetadata,
  canonicalCategory,
  predictCategory,
} from "../../src/services/discovery/categorization";
import {
  classifyDataset,
  categorizeReport,
} from "../../src/services/discovery/classify-catalog";
const metadata = (title: string) => ({
  ...dataset,
  title,
  category: null,
  description: null,
  tags: [],
});
describe("metadata categorization", () => {
  it.each([
    ["Bike lanes", "Transportation"],
    ["Building permits", "Development"],
    ["Zoning", "Planning"],
    ["Zoning2019", "Planning"],
    ["CWP_Amendments", "Planning"],
    ["S_BFE", "Hazards"],
    ["Countywide_SSServiceProviders", "Utilities"],
    ["MoonLake_FLU_2025", "Planning"],
    ["ROW", "Transportation"],
    ["ADU Existing Allowable Areas", "Housing"],
    ["TampaMuseum", "Public facilities"],
    ["TampaTheatre", "Public facilities"],
    ["MappedAreasofFlooding", "Hazards"],
    ["Countywide_WWTreatment_CollectionAreas", "Utilities"],
    ["WWTP2026", "Utilities"],
    ["MoonLake_Water_Control_Valve", "Utilities"],
    ["MoonLake_Water_System_Valve", "Utilities"],
    ["Affordable housing", "Housing"],
    ["Wetlands habitat", "Environment"],
    ["Stormwater infrastructure", "Infrastructure"],
    ["Water mains", "Utilities"],
    ["Police districts", "Public safety"],
    ["Park trails", "Recreation"],
    ["Flood evacuation routes", "Hazards"],
    ["Administrative boundaries", "Boundaries"],
    ["Solid waste collection", "Solid waste"],
    ["Libraries", "Public facilities"],
    ["Public health clinics", "Health"],
    ["Census tracts", "Demographics"],
    ["Voting precincts", "Government"],
    ["Septic", "Utilities"],
    ["Potable Service Connection", "Utilities"],
    ["Reclaimed Pump", "Utilities"],
    ["Sec605_Runway_Protection_Zone", "Transportation"],
    ["GOPASCO Bus Stops", "Transportation"],
    ["Pharmacy", "Health"],
    ["Healthcare_Facilities", "Health"],
    ["MultiFamily Layer", "Housing"],
    ["Renter Occupied Units", "Housing"],
    ["Mangroves", "Environment"],
    ["LimitofModerateWaveAction", "Hazards"],
    ["Yard Waste Pickup", "Solid waste"],
    ["Florida State Senate Districts", "Boundaries"],
    ["Area Median Income", "Demographics"],
  ])("classifies %s", (title, expected) => {
    expect(predictCategory(metadata(title)).category).toBe(expected);
  });
  it("normalizes punctuation, HTML, case, plurals and CamelCase", () => {
    expect(normalizeMetadata("<b>ParkTrails</b> / CAF\u00c9")).toBe(
      "park trail cafe",
    );
    expect(predictCategory(metadata("PCEM_EvacRoute")).category).toBe(
      "Hazards",
    );
    expect(predictCategory(metadata("ParkTrail")).category).toBe("Recreation");
  });
  it.each([
    "",
    "City public area map data",
    "Police wetland",
    "MoonLake_Gauges",
  ])("abstains on weak or conflicting title %s", (title) => {
    expect(predictCategory(metadata(title)).category).toBe("Uncategorized");
  });
  it("matches whole words and exact phrases", () => {
    expect(predictCategory(metadata("WWResearch")).category).toBe(
      "Uncategorized",
    );
    expect(predictCategory(metadata("Roadrunner surveys")).category).toBe(
      "Uncategorized",
    );
    expect(predictCategory(metadata("Storm surge")).signals).toContain(
      "title:storm surge",
    );
  });
  it("uses tags, descriptions and fields without repeating keywords to inflate scores", () => {
    const input = {
      ...metadata("Inventory"),
      tags: ["clinic"],
      description: "clinic",
      fields: [{ name: "clinic", type: "string" }],
    };
    expect(predictCategory(input).category).toBe("Uncategorized");
    expect(
      predictCategory({ ...input, tags: ["clinic", "health"] }).category,
    ).toBe("Health");
    expect(
      predictCategory({
        ...metadata("Inventory"),
        description: "police ".repeat(100),
      }).category,
    ).toBe("Uncategorized");
  });
  it("does not classify layers from shared land-use boilerplate alone", () => {
    expect(
      predictCategory({
        ...metadata("MoonLake_Gauges"),
        description: "Land use and zoning",
        tags: ["land use", "zoning"],
      }).category,
    ).toBe("Uncategorized");
  });
  it.each([
    ["Environmental Lands Acquisition and Management Program", "Environment"],
    ["Median household income for ages 18 to 22", "Demographics"],
    ["Select assets for the flood risk assessment", "Hazards"],
    ["Accela inspection zones during the permiting process", "Development"],
    ["Code Enforcement Cases Map Service", "Development"],
    ["Current and adopted zoning districts", "Planning"],
    [
      "Geographic boundaries of special districts within Hillsborough County",
      "Boundaries",
    ],
    ["Transportation Improvement Projects", "Transportation"],
    ["Emergency Management Shelters", "Hazards"],
    ["Adopt a Drain public facing web maps", "Infrastructure"],
  ])("recognizes specific layer context: %s", (description, category) => {
    expect(
      predictCategory({ ...metadata("survey"), description }).category,
    ).toBe(category);
    expect(
      predictCategory({
        ...metadata("survey"),
        fields: [{ name: "question", type: "string", alias: description }],
      }).category,
    ).toBe(category);
  });
  it.each(["SchoolsSidewalks", "SchoolsSidewalksParcels"])(
    "uses the main subject for %s",
    (title) => {
      expect(predictCategory(metadata(title)).category).toBe("Transportation");
    },
  );
  it("is deterministic and does not mutate inputs", () => {
    const input = metadata("Bike lanes");
    const copy = JSON.stringify(input);
    expect(predictCategory(input)).toEqual(predictCategory(input));
    expect(JSON.stringify(input)).toBe(copy);
  });
  it("updates NLP assignments when metadata changes without using the previous output as evidence", () => {
    const first = classifyDataset(metadata("Bike lanes"));
    const second = classifyDataset(
      { ...first, title: "Wetlands" },
      { previous: first },
    );
    expect(first.category_source).toBe("nlp");
    expect(second.category).toBe("Environment");
    expect(classifyDataset(second)).toEqual(second);
  });
  it("does not trust an earlier semantic prediction as publisher evidence", () => {
    const result = classifyDataset({
      ...metadata("Unknown"),
      category: "Housing",
      category_source: "semantic",
    });
    expect(result.category).toBe("Uncategorized");
    expect(result.source_category).toBeNull();
  });
  it("honors explicit overrides above curated, publisher and NLP categories", () => {
    const result = classifyDataset(metadata("Wetlands"), {
      curated: dataset,
      overrides: { [dataset.id]: "Housing" },
    });
    expect(result.category).toBe("Housing");
    expect(result.category_source).toBe("override");
    expect(
      classifyDataset(metadata("Wetlands"), { curated: dataset })
        .category_source,
    ).toBe("curated");
    expect(
      classifyDataset(metadata("Wetlands"), { curated: dataset }).category,
    ).toBe("Recreation");
    expect(() =>
      classifyDataset(dataset, { overrides: { [dataset.id]: "Typo" } }),
    ).toThrow("Unknown override");
  });
  it("normalizes trusted publisher aliases and retains trusted previous categories", () => {
    expect(canonicalCategory("/Categories/Parks & Recreation")).toBe(
      "Recreation",
    );
    const previous = { ...dataset, category_source: "publisher" as const };
    expect(classifyDataset(metadata("Wetlands"), { previous }).category).toBe(
      "Recreation",
    );
    expect(
      classifyDataset({ ...metadata("Bike lanes"), category: "Uncategorized" })
        .category,
    ).toBe("Transportation");
    expect(
      classifyDataset({ ...metadata("Wetlands"), category: "PUBLIC SAFETY" })
        .category,
    ).toBe("Public safety");
  });
  it("allows a deliberate Uncategorized override", () => {
    expect(
      classifyDataset(metadata("Police"), {
        overrides: { [dataset.id]: "Uncategorized" },
      }).category_source,
    ).toBe("override");
  });
  it("classifies real checked and discovered metadata and preserves verification dates", async () => {
    const { default: checked } = await import("../../public/catalog.json");
    const { default: discovered } = await import("../../public/discovery.json");
    const { parseCatalog } = await import("../../src/services/catalog");
    const { discoverySchema } =
      await import("../../src/services/discovery/types");
    const curated = parseCatalog(checked).datasets;
    const previous = discoverySchema.parse(discovered);
    const { report, review } = categorizeReport(
      previous,
      curated,
      previous,
      false,
    );
    expect(report.datasets.length).toBe(previous.datasets.length);
    expect(report.generatedAt).toBe(previous.generatedAt);
    expect(
      report.curatedUpdates!.find((d) => d.id === curated[0].id)!.category,
    ).toBe(curated[0].category);
    expect(
      report.datasets.every((d) => categoryNames.includes(d.category!)),
    ).toBe(true);
    expect(review.total).toBeGreaterThan(400);
    expect(review.sources.curated).toBe(52);
    expect(report.datasets.map((d) => d.lastVerifiedAt)).toEqual(
      previous.datasets.map((d) => d.lastVerifiedAt),
    );
  });
  it("includes ambiguities and changed categories in review reports", () => {
    const previous = {
      ...emptyDiscovery,
      datasets: [
        { ...metadata("Bike lanes"), validationStatus: "discovered" as const },
      ],
    };
    const result = categorizeReport(
      {
        ...previous,
        datasets: [{ ...previous.datasets[0], title: "Police wetland" }],
      },
      [],
      previous,
    );
    expect(result.review.review[0].reason).toBe("ambiguous");
    expect(result.review.changes[0].category).toBe("Uncategorized");
    expect(result.review.counts.Uncategorized).toBe(1);
    expect(result.report.refresh).toBeUndefined();
  });
  it("applies reviewed categories to checked entries without trusting legacy unclassified updates", async () => {
    const { federatedCatalog } =
      await import("../../src/services/federated-catalog");
    const { catalog } = await import("../fixtures");
    const update = {
      ...dataset,
      category: "Housing",
      category_source: "override" as const,
    };
    expect(
      federatedCatalog(catalog, { ...emptyDiscovery, curatedUpdates: [update] })
        .datasets[0].category,
    ).toBe("Housing");
    expect(
      federatedCatalog(catalog, {
        ...emptyDiscovery,
        curatedUpdates: [{ ...dataset, category: "Housing" }],
      }).datasets[0].category,
    ).toBe(dataset.category);
  });
});
