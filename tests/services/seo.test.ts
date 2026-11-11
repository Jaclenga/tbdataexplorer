import { describe, expect, it } from "vitest";
import { dataset } from "../fixtures";
import { datasetPath, pathDatasetId, datasetStructuredData, datasetDescription, pageMetadata, sitemapFiles, siteOrigin, jsonLd } from "../../src/services/seo";

describe("SEO output", () => {
  it("uses verified title and publisher when a source description is missing or blank", () => {
    for (const description of [null, "", "   "]) {
      const value = datasetDescription({ ...dataset, description });
      expect(value).toContain(dataset.title);
      expect(value).toContain(dataset.publisher);
    }
  });
  it("includes actual coverage and category even when source descriptions are duplicated", () => {
    const value = datasetDescription({ ...dataset, description: "Shared", coverage: "Pinellas County", category: "Housing" });
    expect(value).toContain(dataset.title);
    expect(value).toContain(dataset.publisher);
    expect(value).toContain("Pinellas County");
    expect(value).toContain("Housing");
    expect(value).not.toContain("Shared");
  });
  it("includes provided downloads and source modification dates", () => {
    const data = datasetStructuredData({ ...dataset, platform: "csv", resource: { url: "https://example.org/data.csv" }, sourceUpdatedAt: "2026-01-01T00:00:00Z" });
    expect(data.distribution?.[0]).toEqual({ "@type": "DataDownload", contentUrl: "https://example.org/data.csv", encodingFormat: "text/csv" });
    expect(data.dateModified).toBe("2026-01-01T00:00:00Z");
  });
  it.each(["tampa/parks", "arcgis:123:0", "city/a & b", "city/é", "city/~3A%:"])("round trips dataset identifiers: %s", (id) => {
    expect(pathDatasetId(datasetPath(id))).toBe(id);
  });
  it.each(["../secret", "city/../secret", "/secret", "city//parks"])("rejects unsafe identifiers: %s", (id) => {
    expect(() => datasetPath(id)).toThrow();
  });
  it("uses verified publisher fields without inventing ownership, license, or dates", () => {
    const data = datasetStructuredData(dataset);
    expect(data.publisher.name).toBe(dataset.publisher);
    expect(data.sameAs).toBe(dataset.sourceUrl);
    expect(data.dateModified).toBeUndefined();
    expect(data).not.toHaveProperty("license");
    expect(data.spatialCoverage).toBeUndefined();
  });
  it("escapes HTML and script boundaries in publisher metadata", () => {
    expect(jsonLd({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
    const html = pageMetadata('A "title" <script>', "Description & more", "/", {});
    expect(html).toContain('A &quot;title&quot; &lt;script&gt;');
    expect(html).toContain("Description &amp; more");
    expect(html).toContain(`href="${siteOrigin}/"`);
  });
  it("escapes and deduplicates sitemap URLs without fabricated lastmod", () => {
    const xml = sitemapFiles([siteOrigin + "/?a=1&b=2", siteOrigin + "/?a=1&b=2"]).get("sitemap.xml")!;
    expect(xml.match(/<url>/g)).toHaveLength(1);
    expect(xml).toContain("&amp;b=2");
    expect(xml).not.toContain("lastmod");
  });
  it("splits by URL count and emits a sitemap index", () => {
    const files = sitemapFiles([siteOrigin + "/", siteOrigin + "/a/", siteOrigin + "/b/"], 2);
    expect(files.size).toBe(3);
    expect(files.get("sitemap.xml")).toContain("<sitemapindex");
    expect(files.get("sitemap.xml")).toContain(siteOrigin + "/sitemap-2.xml");
    expect(files.get("sitemap-1.xml")?.match(/<url>/g)).toHaveLength(2);
  });
  it("splits by UTF-8 byte size as well as URL count", () => {
    const files = sitemapFiles([siteOrigin + "/a/", siteOrigin + "/b/"], 50000, 200);
    expect(files.size).toBe(3);
    expect(new TextEncoder().encode(files.get("sitemap-1.xml")).length).toBeLessThanOrEqual(200);
  });
});
