import { test, expect } from "@playwright/test";
import { installApi } from "./helpers";
import { emptyDiscovery } from "../discovery-fixture";
test("health navigation, unknown history, publisher filtering and dataset links", async ({
  page,
}) => {
  await installApi(page);
  await page.route("**/api/discovery", (r) =>
    r.fulfill({ json: emptyDiscovery }),
  );
  await page.goto("/");
  await page.getByRole("link", { name: "Catalog Health", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coverage & quality", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Not yet available", { exact: true }),
  ).toHaveCount(3);
  const table = page.getByRole("table");
  await expect(table).toContainText("Test City");
  await page
    .getByRole("combobox", { name: "Sort publishers" })
    .selectOption("verified");
  await table.getByRole("link", { name: "Test City", exact: true }).click();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("publisher") === "Test City" &&
      url.hash === "#catalog",
  );
  await expect(page.getByRole("searchbox")).toBeVisible();
});
