import { test, expect } from "@playwright/test";
import { datasetPath, homeTitle, homeDescription, datasetsTitle, datasetsDescription, datasetDescription, siteOrigin } from "../../src/services/seo";
import catalogJson from "../../public/catalog.json" with { type: "json" };
import { parseCatalog } from "../../src/services/catalog";
const catalog = parseCatalog(catalogJson);

test("homepage, sitemap, and dataset metadata work without JavaScript", async ({ browser, baseURL, request }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page).toHaveTitle(homeTitle);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", homeDescription);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", siteOrigin + "/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("main")).toContainText("Browse datasets");
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain(`Sitemap: ${siteOrigin}/sitemap.xml`);
  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const xml = await sitemap.text();
  expect(await page.evaluate((value) => new DOMParser().parseFromString(value, "application/xml").querySelector("parsererror")?.textContent ?? null, xml)).toBeNull();
  const dataset = catalog.datasets[0];
  expect(xml).toContain(siteOrigin + datasetPath(dataset.id));
  expect(xml).not.toContain("<lastmod>");
  expect(xml).toContain(`<loc>${siteOrigin}/datasets</loc>`);
  await page.goto(datasetPath(dataset.id));
  await expect(page.locator("h1")).toHaveText(dataset.title);
  await expect(page.getByRole("link", { name: "Original source" })).toHaveAttribute("href", dataset.sourceUrl);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", siteOrigin + datasetPath(dataset.id));
  const data = JSON.parse(await page.locator('#structured-data').textContent() ?? "{}");
  expect(data["@type"]).toBe("Dataset");
  expect(data.publisher.name).toBe(dataset.publisher);
  await context.close();
});

test("stable dataset paths load the interactive explorer", async ({ page }) => {
  const dataset = catalog.datasets[0];
  await page.goto(datasetPath(dataset.id));
  await expect(page.locator("h1")).toHaveText(dataset.title);
  await expect(page.getByRole("tab", { name: "Use in R" })).toBeVisible();
  await page.getByRole("link", { name: "All datasets" }).click();
  await expect(page.locator("h1")).toHaveText("Tampa Bay Open Data Explorer");
});

for (const javaScriptEnabled of [false, true]) {
  test(`/datasets has canonical SEO with JavaScript ${javaScriptEnabled}`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled, baseURL });
    const page = await context.newPage();
    await page.goto("/datasets?sort=name-desc&page=2");
    await expect(page).toHaveTitle(datasetsTitle);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", datasetsDescription);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", siteOrigin + "/datasets");
    await expect(page.locator("h1")).toHaveText("Tampa Bay Open Data & GIS Datasets");
    await page.reload();
    await expect(page).toHaveTitle(datasetsTitle);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    for (const dataset of catalog.datasets.slice(0, 2)) {
      await page.goto(datasetPath(dataset.id) + "?view=map");
      await expect(page).toHaveTitle(`${dataset.title} | Tampa Bay Open Data Explorer`);
      await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", datasetDescription(dataset));
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", siteOrigin + datasetPath(dataset.id));
      await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    }
    await context.close();
  });
}
