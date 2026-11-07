import { test, expect, type Page } from "@playwright/test";
import { installApi } from "./helpers";
import { dataset } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";
const successful = "2026-11-05T10:00:00.000Z";
const partial = {
  ...emptyDiscovery,
  generatedAt: "2026-11-05T12:00:00.000Z",
  lastSuccessfulRunAt: successful,
  datasets: [
    {
      ...dataset,
      id: "arcgis:status:10",
      layerId: 10,
      portalId: "city",
      validationStatus: "discovered",
      lastVerifiedAt: successful,
    },
  ],
  refresh: {
    startedAt: "2026-11-05T09:00:00.000Z",
    finishedAt: successful,
    outcome: "partial",
    verified: 23,
    curatedErrors: 1,
    changes: { added: [], updated: [], retained: 0 },
  },
  runs: [
    {
      portalId: "city",
      startedAt: "2026-11-05T09:00:00.000Z",
      finishedAt: successful,
      complete: false,
      itemsScanned: 40,
      layersInspected: 46,
      datasetsFound: 46,
      totalItems: 400,
      nextStart: 41,
      issues: [
        {
          portalId: "city",
          kind: "truncated",
          message: "Discovery budget reached",
        },
        {
          portalId: "city",
          kind: "truncated",
          message: "Discovery budget reached",
        },
        {
          portalId: "city",
          kind: "security",
          message: "Unregistered service location",
          endpoint: "https://example.test/" + "long-source-name-".repeat(30),
        },
      ],
    },
  ],
};
async function installStatus(page: Page, body: unknown = partial) {
  await installApi(page);
  await page.clock.setFixedTime(new Date("2026-11-05T12:00:00Z"));
  await page.route("**/api/discovery", (r) => r.fulfill({ json: body }));
}
test("quiet summary links to focused status view with collapsed publisher diagnostics and original reports", async ({
  page,
}) => {
  await installStatus(page);
  await page.goto("/?pageSize=10&q=parks");
  const summary = page.locator(".discovery-status");
  await expect(summary).toContainText("23 datasets verified");
  await expect(summary).not.toContainText("Partial");
  await expect(summary).not.toContainText("latest attempt");
  await expect(summary.locator("time")).toHaveText("November 5, 2026");
  await expect(summary.locator("time")).toHaveAttribute("datetime", successful);
  await expect(summary).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(summary).toHaveCSS("border-top-width", "0px");
  await expect(summary).toHaveCSS("font-size", "12px");
  await expect(
    page.getByText("Discovery budget reached", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results/catalog-status-after.png" });
  const link = page.getByRole("link", {
    name: "Coverage details",
    exact: true,
  });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Catalog Health", exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(/#catalog-status$/);
  await expect(
    page.getByRole("heading", { name: "Catalog Health", exact: true }),
  ).toHaveCSS("font-size", "28px");
  await expect(
    page.getByRole("link", { name: "Latest scheduled discovery report" }),
  ).toHaveCSS("text-decoration-line", "underline");
  await expect(
    page.getByText("23 in the latest recorded attempt", { exact: true }),
  ).toBeVisible();
  const publisher = page.locator(".publisher-scan");
  await expect(publisher).not.toHaveAttribute("open");
  await publisher.locator(":scope > summary").click();
  await expect(publisher).toContainText(
    "City of Tampa: 40 services scanned; 46 datasets discovered; Partial scan",
  );
  await expect(
    publisher.getByText("Scan limit reached (2 occurrences).", { exact: true }),
  ).toBeVisible();
  await expect(
    publisher.getByText("Discovery budget reached", { exact: true }),
  ).toBeHidden();
  await publisher
    .getByText("Technical explanation", { exact: true })
    .first()
    .click();
  await expect(
    publisher.getByText("Discovery budget reached", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Latest scheduled discovery report" }),
  ).toHaveAttribute("href", "/api/discovery");
  await expect(
    page.getByRole("link", { name: "Discovery report", exact: true }),
  ).toHaveAttribute("href", "/discovery.json");
  await expect(
    page.getByRole("link", { name: "Browser access verification results" }),
  ).toHaveAttribute("href", "/access.json");
  await page.getByRole("link", { name: "Return to datasets" }).click();
  await expect(page.getByRole("searchbox")).toHaveValue("parks");
  await expect(
    page.getByRole("combobox", { name: "Rows per page:" }),
  ).toHaveValue("10");
});
test("status views handle healthy, stale, failed and unavailable metadata honestly", async ({
  page,
}) => {
  await installStatus(page, {
    ...partial,
    complete: true,
    runs: [{ ...partial.runs[0], complete: true, issues: [] }],
    refresh: { ...partial.refresh, outcome: "success", curatedErrors: 0 },
  });
  await page.goto("/#catalog-status");
  await expect(
    page.locator(".catalog-metadata").getByText("Healthy", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Configured sources fully scanned", { exact: true }),
  ).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-11-08T12:00:00Z"));
  await page.reload();
  await expect(
    page.locator(".catalog-metadata").getByText("Stale", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/discovery", (r) =>
    r.fulfill({
      json: {
        ...partial,
        lastSuccessfulRunAt: null,
        datasets: [],
        refresh: { ...partial.refresh, outcome: "failed", verified: 0 },
      },
    }),
  );
  await page.reload();
  await expect(
    page.locator(".catalog-metadata").getByText("Unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("0 in the latest recorded attempt", { exact: true }),
  ).toBeVisible();
  await page.route("**/api/discovery", (r) =>
    r.fulfill({ json: emptyDiscovery }),
  );
  await page.goto("/");
  await expect(page.locator(".discovery-status")).toContainText(
    "Verification status unavailable",
  );
  await expect(page.locator(".discovery-status time")).toHaveCount(0);
});
test("mobile summary stays within two lines and long publisher diagnostics wrap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installStatus(page);
  await page.goto("/");
  const status = page.locator(".discovery-status");
  await expect(status).toHaveCSS("text-align", "left");
  await expect(status).toHaveCSS("font-size", "12px");
  const height = (await status.boundingBox())!.height;
  const lineHeight = await status.evaluate((e) =>
    parseFloat(getComputedStyle(e).lineHeight),
  );
  expect(height).toBeLessThanOrEqual(lineHeight * 2 + 6 + 1);
  await page.screenshot({
    path: "test-results/catalog-status-after-mobile.png",
  });
  await page
    .getByRole("link", { name: "Coverage details", exact: true })
    .click();
  await page.locator(".publisher-scan > summary").click();
  await page.getByText("Technical explanation", { exact: true }).last().click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/catalog-status-details-mobile.png",
    fullPage: true,
  });
});
