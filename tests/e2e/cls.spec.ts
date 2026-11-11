import { mkdir, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import catalog from "../../public/catalog.json" with { type: "json" };
import discovery from "../../public/discovery.json" with { type: "json" };
import { datasetPath } from "../../src/services/seo";
import { layerResponse, record } from "../fixtures";

interface Shift {
  value: number;
  time: number;
  recentInput: boolean;
  phase: string;
  sources: { node: string; from: number; to: number }[];
}
interface Diagnostics {
  shifts: Shift[];
  about: { time: number; top: number }[];
  phase: string;
  supported: boolean;
}
declare global { interface Window { clsDiagnostics: Diagnostics } }

function cls(shifts: Shift[]) {
  let max = 0, sum = 0, start = 0, previous = 0;
  for (const entry of shifts.filter((entry) => !entry.recentInput)) {
    if (sum > 0 && entry.time - previous < 1000 && entry.time - start < 5000) sum += entry.value;
    else { sum = entry.value; start = entry.time; }
    previous = entry.time;
    max = Math.max(max, sum);
  }
  return max;
}

for (const width of [1440, 390]) {
  for (const slow of [false, true]) {
    for (const route of ["/", "/datasets", "/#about", datasetPath(catalog.datasets[0].id)]) {
      test(`CLS ${width}px ${slow ? "slow" : "normal"} ${route}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.addInitScript(() => {
          const state: Diagnostics = window.clsDiagnostics = {
            shifts: [], about: [], phase: "initial", supported: PerformanceObserver.supportedEntryTypes.includes("layout-shift"),
          };
          if (state.supported) new PerformanceObserver((list) => {
            for (const raw of list.getEntries()) {
              const entry = raw as PerformanceEntry & { value: number; hadRecentInput: boolean; sources: { node: Element | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[] };
              state.shifts.push({ value: entry.value, time: entry.startTime, recentInput: entry.hadRecentInput, phase: state.phase,
                sources: entry.sources.map((source) => ({ node: source.node?.id ? `#${source.node.id}` : `${source.node?.tagName}.${source.node?.className}`, from: source.previousRect.y, to: source.currentRect.y })),
              });
            }
          }).observe({ type: "layout-shift", buffered: true });
          const sample = () => {
            const element = document.getElementById("about");
            if (element) {
              const top = element.getBoundingClientRect().top + scrollY;
              if (!state.about.length || Math.abs(state.about.at(-1)!.top - top) > 1) state.about.push({ time: performance.now(), top });
            }
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        await page.route("**/*", async (request) => {
          const url = new URL(request.request().url());
          if (slow && request.request().resourceType() === "script") await new Promise((resolve) => setTimeout(resolve, 350));
          if (["/catalog.json", "/access.json", "/api/discovery", "/discovery.json"].includes(url.pathname)) {
            if (slow) await new Promise((resolve) => setTimeout(resolve, 1200));
            if (url.pathname.includes("discovery")) return request.fulfill({ json: discovery });
          }
          // Deterministic publisher latency and records, without external network variability.
          const dataset = catalog.datasets[0];
          if (url.href.startsWith(`${dataset.serviceUrl}/${dataset.layerId}`)) {
            await new Promise((resolve) => setTimeout(resolve, slow ? 1200 : 50));
            return request.fulfill({ json: url.pathname.endsWith("/query")
              ? { features: [record(1), record(2)], exceededTransferLimit: false }
              : layerResponse });
          }
          if (url.pathname === "/api/arcgis") return request.abort();
          return request.continue();
        });
        await page.goto(route);
        if (route.startsWith("/datasets/")) await expect(page.getByText("2 records loaded", { exact: false })).toBeVisible({ timeout: 15000 });
        else await expect(page.getByRole("searchbox")).toBeEditable();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(slow ? 3000 : 1000);
        if (route === "/" && !slow) await testInfo.attach("loaded-page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
        const initial = await page.evaluate(() => structuredClone(window.clsDiagnostics));
        expect(initial.supported).toBe(true);
        if (!route.startsWith("/datasets/")) {
          await page.evaluate(() => { window.clsDiagnostics.phase = "interaction"; });
          await page.getByRole("searchbox").click();
          await page.getByRole("searchbox").fill("parks");
          await page.waitForTimeout(700);
          await page.getByRole("searchbox").click();
          await page.getByRole("searchbox").fill("");
          await page.waitForTimeout(700);
          if (width < 740) await page.getByRole("button", { name: /Show filters/ }).click();
          const publisher = page.getByRole("combobox", { name: "Publisher", exact: true });
          // Native keyboard input is trusted. selectOption() dispatches a
          // synthetic change without hadRecentInput, misclassifying expected
          // synchronous filtering as an unexpected layout shift.
          await publisher.focus();
          await publisher.press("Home");
          for (let option = 0; option < 3; option++) await publisher.press("ArrowDown");
          await expect(publisher).toHaveValue("City of Tampa");
          await page.waitForTimeout(700);
          await publisher.press("Home");
          await expect(publisher).toHaveValue("");
          await page.waitForTimeout(700);
        }
        const all = await page.evaluate(() => window.clsDiagnostics);
        const result = { width, slow, route, initialCLS: cls(initial.shifts), interactionCLS: cls(all.shifts.filter((entry) => entry.phase === "interaction")),
          aboutTravel: initial.about.length ? Math.max(...initial.about.map((entry) => entry.top)) - Math.min(...initial.about.map((entry) => entry.top)) : 0,
          fontRequests: await page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /\.(woff2?|ttf|otf)(\?|$)/.test(entry.name)).length), ...all };
        console.log("CLS_RESULT " + JSON.stringify({ width, slow, route, initialCLS: result.initialCLS, interactionCLS: result.interactionCLS, aboutTravel: result.aboutTravel }));
        await testInfo.attach("layout-shifts", { body: JSON.stringify(result, null, 2), contentType: "application/json" });
        if (process.env.CLS_REPORT_DIR) {
          await mkdir(process.env.CLS_REPORT_DIR, { recursive: true });
          await writeFile(`${process.env.CLS_REPORT_DIR}/${width}-${slow}-${encodeURIComponent(route)}.json`, JSON.stringify(result, null, 2));
        }
        if (!process.env.CLS_AUDIT_ONLY) {
          expect(result.initialCLS).toBeLessThan(0.1);
          if (!route.startsWith("/datasets/")) expect(result.aboutTravel).toBeLessThanOrEqual(2);
          expect(result.interactionCLS).toBeLessThan(0.1);
        }
      });
    }
  }
}
