import { test, expect } from "@playwright/test";
import { datasetPath, homeTitle, homeDescription, siteOrigin } from "../../src/services/seo";
import catalog from "../../public/catalog.json" with { type: "json" };

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
  await expect(page.locator("h1")).toContainText("Explore public data");
});
