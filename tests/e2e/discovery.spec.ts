import { test, expect } from "@playwright/test";
import { installApi } from "./helpers";
import { emptyDiscovery } from "../discovery-fixture";

test("search submission and category/publisher filters lead to filtered results", async ({
  page,
}) => {
  const api = await installApi(page);
  await page.goto("/");
  await page.getByRole("searchbox").fill("gardens");
  await page.getByRole("searchbox").press("Enter");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.locator(".dataset-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear search", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Transportation");
  await expect(
    page.getByRole("link", { name: "Street centerlines", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await page
    .getByRole("button", { name: "Clear all filters", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Publisher", exact: true })
    .selectOption("Test County");
  await expect(page.locator(".dataset-card")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "Budget allocations", exact: true }),
  ).toBeVisible();
  expect(api.queries).toHaveLength(0);
});

test("section navigation returns from a dataset without treating section names as dataset IDs", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/#county%2Fbudget");
  await expect(
    page.getByRole("heading", { name: "Budget allocations", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Browse data", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Tampa Bay Open Data Explorer",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dataset not found" }),
  ).toHaveCount(0);
});

test("search and filters intersect, reset, and never request records", async ({
  page,
}) => {
  const api = await installApi(page);
  await page.goto("/");
  await expect(page.locator(".dataset-card")).toHaveCount(3);
  await page
    .getByRole("combobox", { name: "Publisher", exact: true })
    .selectOption("Test City");
  await expect(page.locator(".dataset-card")).toHaveCount(2);
  await page
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Finance");
  await expect(
    page.getByRole("heading", { name: "No datasets match these filters." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("searchbox").fill("gardens");
  await expect(page.locator(".dataset-card")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await page
    .getByRole("combobox", { name: "Data type", exact: true })
    .selectOption("nonspatial");
  await expect(
    page.getByRole("link", { name: "Budget allocations", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".dataset-card")).toHaveCount(1);
  expect(api.queries).toHaveLength(0);
});

test("invalid catalog fails visibly instead of showing a partial collection", async ({
  page,
}) => {
  await installApi(page);
  await page.route("**/catalog.json", (route) =>
    route.fulfill({ json: { datasets: [] } }),
  );
  await page.goto("/");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".dataset-card")).toHaveCount(0);
});

test("unknown dataset route has a working return link", async ({ page }) => {
  await installApi(page);
  await page.goto("/#missing%2Fdataset");
  await expect(
    page.getByRole("heading", { name: "Dataset not found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to the catalog" }).click();
  await expect(page.locator(".dataset-card")).toHaveCount(3);
});

test("keyboard skip link focuses the current detail page without changing routes", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/#county%2Fbudget");
  await expect(
    page.getByRole("heading", { name: "Budget allocations", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Budget allocations", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/#county%2Fbudget$/);
});

test("freshness distinguishes a published check from incomplete discovery and publisher update times", async ({
  page,
}) => {
  await installApi(page);
  await page.route("**/api/discovery", (route) =>
    route.fulfill({
      json: {
        ...emptyDiscovery,
        lastSuccessfulRunAt: "2026-11-04T12:00:00.000Z",
        refresh: {
          startedAt: "2026-11-04T11:00:00.000Z",
          finishedAt: emptyDiscovery.generatedAt,
          outcome: "partial",
          verified: 23,
          curatedErrors: 1,
          changes: { added: [], updated: [], retained: 0 },
        },
      },
    }),
  );
  await page.goto("/");
  const status = page.locator(".discovery-status");
  await expect(status).toContainText("Last checked");
  await expect(status).toContainText("23 datasets verified");
  await status
    .getByRole("link", { name: "Coverage details", exact: true })
    .click();
  await expect(
    page.getByText("23 in the latest recorded attempt", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Discovery coverage unavailable", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/They are not verification dates/)).toBeVisible();
});
