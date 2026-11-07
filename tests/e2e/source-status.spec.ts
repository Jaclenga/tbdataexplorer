import { test, expect } from "@playwright/test";
import { installApi } from "./helpers";
import { dataset, fields } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";
const checked = "2026-11-09T18:00:00.000Z";
const success = {
  status: "verified" as const,
  lastCheckedAt: checked,
  lastSuccessfulAt: checked,
  httpStatus: 200,
  responseTimeMs: 12,
  errorType: null,
  errorMessage: null,
};
const failed = {
  ...success,
  status: "failed" as const,
  lastSuccessfulAt: "2026-11-08T18:00:00.000Z",
  httpStatus: null,
  errorType: "timeout" as const,
  errorMessage: "private diagnostic https://private.test/?token=secret",
};
for (const [label, verification] of [
  ["Verified", success],
  ["Failed", failed],
  [
    "Stale",
    {
      ...failed,
      lastCheckedAt: "2026-11-01T18:00:00.000Z",
      lastSuccessfulAt: "2026-10-31T18:00:00.000Z",
    },
  ],
  ["Not checked", undefined],
] as const) {
  test(`source status shows ${label} from persisted checks in the existing details panel`, async ({
    page,
  }) => {
    await installApi(page);
    await page.clock.setFixedTime(new Date("2026-11-10T18:00:00Z"));
    await page.route("**/api/discovery", (r) =>
      r.fulfill({
        json: {
          ...emptyDiscovery,
          curatedUpdates: [{ ...dataset, fields, verification }],
        },
      }),
    );
    await page.goto("/#test%2Fparks");
    await page
      .getByText("About this dataset & source terms", { exact: true })
      .click();
    const status = page.getByRole("region", {
      name: "Source status",
      exact: true,
    });
    await expect(status.getByText(label, { exact: true })).toBeVisible();
    await expect(status).not.toContainText("secret");
    await expect(status).not.toContainText("private.test");
    if (label === "Failed") {
      await expect(status).toContainText(
        "Source verification timed out during the most recent check.",
      );
      await expect(status).toContainText("November 8, 2026");
    }
    if (label === "Stale") {
      await expect(status).toContainText("Current availability is unknown.");
      await expect(status.getByText("Failed", { exact: true })).toBeVisible();
      await expect(status).toContainText("Source verification timed out");
    }
    if (label === "Not checked")
      await expect(status).toContainText("Source has not yet been verified.");
  });
}
test("metadata drawer uses published status even when live metadata succeeds and fits mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const api = await installApi(page);
  await page.goto("/?q=parks");
  await page.getByRole("button", { name: /Show details/ }).click();
  const drawer = page.getByRole("dialog");
  const status = drawer.getByRole("region", {
    name: "Source status",
    exact: true,
  });
  await expect(status).toContainText("Source has not yet been verified.");
  expect(api.queries).toHaveLength(0);
  expect(
    await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
});
