import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { installApi } from "./helpers";
import { catalog, accessReport, dataset } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";
import type { Dataset } from "../../src/types";

test("compact rows, combined search/sort, keyboard expansion and persistent URL state", async ({
  page,
}) => {
  const api = await installApi(page);
  await page.goto("/?publisher=Test+City&sort=name-desc");
  await expect(page.locator(".dataset-card")).toHaveCount(2);
  await expect(page.locator(".dataset-card h3").first()).toHaveText(
    "Street centerlines",
  );
  const row = page.locator(".dataset-card").last();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(110);
  const toggle = row.getByRole("button", { name: /Show details/ });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(
    row.getByRole("button", { name: /Hide details/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(api.queries).toHaveLength(0);
  await page
    .getByRole("link", { name: "Explore dataset", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Neighborhood parks",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "Sort by" })).toHaveValue(
    "name-desc",
  );
  await expect(
    page.getByRole("combobox", { name: "Publisher", exact: true }),
  ).toHaveValue("Test City");
  await expect(
    page.getByRole("button", { name: /Hide details for Neighborhood/ }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("searchbox").fill("test/roads");
  await expect(page.locator(".dataset-card")).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Transportation");
  await page
    .getByRole("combobox", { name: "Data type", exact: true })
    .selectOption("spatial");
  await page
    .getByRole("combobox", { name: "Source platform", exact: true })
    .selectOption("arcgis");
  await expect(page.locator(".dataset-card")).toHaveCount(1);
  await expect(page).toHaveURL(/q=test%2Froads/);
  await page.reload();
  await expect(page.getByRole("searchbox")).toHaveValue("test/roads");
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await expect(page.locator(".dataset-card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Clear all filters", exact: true })
    .click();
  await expect(page.locator(".dataset-card")).toHaveCount(3);
});

test("pagination and sticky filters survive opening a dataset", async ({
  page,
}) => {
  await installApi(page);
  const rows = Array.from({ length: 110 }, (_, i) => ({
    ...dataset,
    id: `arcgis:test:${i}`,
    packageId: `external-${i}`,
    title: `Extra dataset ${String(i).padStart(3, "0")}`,
    layerId: i + 10,
    validationStatus: "discovered",
  }));
  await page.route("**/api/discovery", (route) =>
    route.fulfill({ json: { ...emptyDiscovery, datasets: rows } }),
  );
  await page.goto("/");
  await expect(page.locator(".dataset-card")).toHaveCount(20);
  await page
    .getByRole("combobox", { name: "Rows per page:" })
    .selectOption("100");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.locator(".dataset-card")).toHaveCount(13);
  await expect(page).toHaveURL(/page=2/);
  const row = page.locator(".dataset-card").nth(5);
  await row.scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  const sidebar = await page
    .getByRole("complementary", { name: "Dataset filters" })
    .boundingBox();
  expect(sidebar!.y).toBeGreaterThanOrEqual(20);
  expect(sidebar!.y).toBeLessThan(30);
  await row.getByRole("link").first().click();
  await page.getByRole("link", { name: /All datasets/ }).click();
  await expect(page.locator(".dataset-card")).toHaveCount(13);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(y - 100);
});

test("metadata details keep R code in exploration", async ({ page }) => {
  await installApi(page);
  const real = JSON.parse(readFileSync("public/catalog.json", "utf8"))
    .datasets as Dataset[];
  const checked = real.find((d) => d.id === "tampa/construction-permits")!;
  await page.route("**/catalog.json", (route) =>
    route.fulfill({
      json: { ...catalog, datasets: [...catalog.datasets, checked] },
    }),
  );
  await page.route("**/access.json", (route) =>
    route.fulfill({
      json: {
        ...accessReport,
        datasets: [
          ...accessReport.datasets,
          {
            ...accessReport.datasets[0],
            id: checked.id,
            endpoint: `${checked.serviceUrl}/${checked.layerId}`,
          },
        ],
      },
    }),
  );
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) =>
          sessionStorage.setItem("catalog-copy", text),
      },
    }),
  );
  await page.goto("/");
  const row = page.locator(".dataset-card").filter({
    has: page.getByRole("heading", { name: checked.title, exact: true }),
  });
  await row.getByRole("button", { name: /Show details/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "R code" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Explore dataset" })).toHaveCount(
    1,
  );
  await page.keyboard.press("Escape");
});

test("mobile filter panel and metadata drawer fit narrow screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApi(page);
  await page.goto("/");
  await expect(
    page.getByRole("combobox", { name: "Publisher", exact: true }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: /Show filters/ }).click();
  await page
    .getByRole("combobox", { name: "Data type", exact: true })
    .selectOption("nonspatial");
  await page.getByRole("button", { name: /Hide filters/ }).click();
  await page.getByRole("button", { name: /Show details/ }).click();
  await expect(
    page.getByText("Original dataset URL", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/catalog-expanded-mobile.png",
    fullPage: true,
  });
});

test("real government catalog titles do not overflow on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApi(page);
  const report = JSON.parse(readFileSync("public/discovery.json", "utf8"));
  await page.route("**/api/discovery", (route) =>
    route.fulfill({ json: report }),
  );
  await page.goto("/#catalog");
  await expect(page.locator(".dataset-card")).toHaveCount(20);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
