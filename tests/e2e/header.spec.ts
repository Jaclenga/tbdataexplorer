import { test, expect } from "@playwright/test";
import { installApi } from "./helpers";
const title = "Tampa Bay Open Data Explorer";
const subtitle =
  "Discover public datasets across the Tampa Bay area";
for (const width of [1440, 768, 390, 320]) {
  test(`text-only civic header fits ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installApi(page);
    await page.goto("/");
    const hero = page.locator(".hero");
    const heading = hero.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(title);
    await expect(hero.locator("p")).toHaveText(subtitle);
    await expect(heading.locator("span")).toHaveText("Tampa Bay");
    await expect(heading).toHaveCSS(
      "font-size",
      width <= 740 ? "30px" : "40px",
    );
    await expect(heading).toHaveCSS("font-weight", "700");
    await expect(page.locator(".hero-heading-row")).toHaveCSS(
      "margin-bottom",
      "14px",
    );
    await expect(hero.locator("p")).toHaveCSS("max-width", "750px");
    const catalogHeading = page.getByRole("heading", {
      name: "Browse datasets",
      exact: true,
    });
    expect((await heading.boundingBox())!.x).toBeCloseTo(
      (await catalogHeading.boundingBox())!.x,
      0,
    );
    await expect(
      hero.locator("img,svg,canvas,video,iframe,form,input"),
    ).toHaveCount(0);
    await expect(hero).toHaveCSS("background-image", "none");
    await expect(page.getByRole("searchbox")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 1440) {
      const height = (await hero.boundingBox())!.height;
      expect(height).toBeGreaterThanOrEqual(120);
      expect(height).toBeLessThanOrEqual(160);
      const titleBox = (await heading.boundingBox())!;
      const navBox = (await page
        .getByRole("navigation", { name: "Main navigation" })
        .boundingBox())!;
      expect(
        Math.abs(
          titleBox.y + titleBox.height / 2 - navBox.y - navBox.height / 2,
        ),
      ).toBeLessThanOrEqual(1);
      expect(navBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
    }
    if (width === 1440 || width === 390)
      await page.screenshot({ path: `test-results/hero-after-${width}.png` });
  });
}
test("header navigation supports keyboard use and leaves search in the catalog", async ({
  page,
}) => {
  await installApi(page);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    nav.getByRole("link", { name: "GitHub", exact: true }),
  ).toHaveAttribute("href", "https://github.com/Jaclenga/tbdataexplorer");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const browse = nav.getByRole("link", { name: "Browse data" });
  await expect(browse).toBeFocused();
  await expect(browse).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#catalog$/);
  await expect(
    page.getByRole("heading", { name: "Browse datasets", exact: true }),
  ).toBeInViewport();
  await expect(page.locator("#catalog").getByRole("searchbox")).toHaveCount(1);
});
