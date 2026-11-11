import { describe, expect, it, vi } from "vitest";
import { loadAppData } from "../../src/services/load-app-data";
import { catalog, accessReport } from "../fixtures";
import { emptyDiscovery } from "../discovery-fixture";

describe("application startup data", () => {
  it("provides a complete validated initial render, including discovery", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input);
      return Response.json(path.endsWith("catalog.json") ? catalog : path.endsWith("access.json") ? accessReport : emptyDiscovery);
    });
    const state = await loadAppData("/", new AbortController().signal);
    expect(state.catalog.datasets).toHaveLength(catalog.datasets.length);
    expect(state.access).toEqual(accessReport);
    expect(state.discovery).toEqual(emptyDiscovery);
    expect(state.discoveryWarning).toBeNull();
  });
  it("rejects incomplete or invalid core inputs instead of mounting a partial catalog", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("Unavailable", { status: 503 }));
    await expect(loadAppData("/", new AbortController().signal)).rejects.toThrow("could not be loaded");
    vi.mocked(fetch).mockImplementation(async () => Response.json({}));
    await expect(loadAppData("/", new AbortController().signal)).rejects.toThrow();
  });
});
