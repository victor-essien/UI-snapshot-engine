import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planTiles } from "../src/capture/tiling.js";
import { assignSlugs, persistPage, pngDimensions, routeToSlug } from "../src/prepare/store.js";
import { fakePng } from "./helpers.js";

describe("routeToSlug", () => {
  it.each([
    ["/", "index"],
    ["/pricing", "pricing"],
    ["/pricing/", "pricing"],
    ["/docs/getting-started", "docs__getting-started"],
    ["http://localhost:3000/about", "about"],
  ])("%s -> %s", (route, slug) => expect(routeToSlug(route)).toBe(slug));

  it("adds a stable hash for query strings and unusual characters", () => {
    const a = routeToSlug("/search?q=a");
    expect(a).toMatch(/^search-[0-9a-f]{6}$/);
    expect(a).toBe(routeToSlug("/search?q=a"));
    expect(a).not.toBe(routeToSlug("/search?q=b"));
  });

  it("neutralises path traversal", () => {
    expect(routeToSlug("/..")).not.toContain("/");
    expect(routeToSlug("/../../etc")).not.toContain("/");
    expect(routeToSlug("/..")).toBe("dot");
  });

  it("assignSlugs disambiguates colliding routes", () => {
    const slugs = assignSlugs(["/pricing", "/pricing/"]);
    expect(new Set(slugs.values()).size).toBe(2);
  });
});

describe("pngDimensions", () => {
  it("reads IHDR", () => expect(pngDimensions(fakePng(1440, 3000))).toEqual({ width: 1440, height: 3000 }));
  it("returns null for non-PNG data", () => expect(pngDimensions(Buffer.from("nope"))).toBeNull());
});

describe("persistPage", () => {
  let dir: string;
  beforeEach(async () => void (dir = await mkdtemp(path.join(tmpdir(), "snap-"))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("writes PNGs and metadata with positions and overlap", async () => {
    const tiles = planTiles(5800, { maxHeight: 3000, overlap: 300 }).map((t) => ({
      ...t,
      data: fakePng(1440, t.endY - t.startY),
    }));
    const result = await persistPage({
      outDir: dir,
      slug: "pricing",
      route: "/pricing",
      url: "http://x/pricing",
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      captured: { finalUrl: "http://x/pricing", title: "Pricing", pageWidth: 1440, pageHeight: 5800, truncated: false, warnings: [], tiles },
      capturedAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(result.snapshots.map((s) => [s.file, s.order, s.startY, s.endY, s.overlapWithPrevious])).toEqual([
      ["snapshot-1.png", 1, 0, 3000, 0],
      ["snapshot-2.png", 2, 2700, 5700, 300],
      ["snapshot-3.png", 3, 5400, 5800, 300],
    ]);
    expect(result.snapshots[2]).toMatchObject({ height: 400, pixelHeight: 400, pixelWidth: 1440 });

    const onDisk = JSON.parse(await readFile(path.join(dir, "pricing", "metadata.json"), "utf8"));
    expect(onDisk.route).toBe("/pricing");
    expect(onDisk.page).toEqual({ width: 1440, height: 5800 });
    expect((await readFile(path.join(dir, "pricing", "snapshot-1.png"))).length).toBeGreaterThan(0);
  });
});
