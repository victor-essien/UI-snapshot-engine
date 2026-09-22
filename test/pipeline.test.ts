import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyze, extractRoute, snapshot } from "../src/index.js";
import { EngineError } from "../src/errors.js";
import type { Extractor } from "../src/extract/types.js";
import { fakeCapturer, sampleExtraction } from "./helpers.js";

let outDir: string;
beforeEach(async () => void (outDir = await mkdtemp(path.join(tmpdir(), "run-"))));
afterEach(() => rm(outDir, { recursive: true, force: true }));

const base = () => ({ baseUrl: "http://localhost:3000", outDir });

describe("snapshot()", () => {
  it("captures every route and reports failures without aborting the run", async () => {
    const capturer = fakeCapturer({
      "/": 1500,
      "/pricing": 7000,
      "/dashboard": new EngineError("NAVIGATION_TIMEOUT", "Timed out after 30000ms"),
      "/products": 900,
    });
    const run = await snapshot({ ...base(), routes: ["/", "/pricing", "/dashboard", "/products"] }, { capturer });

    expect(run.summary).toEqual({ total: 4, ok: 3, failed: 1 });
    expect(run.pages.map((p) => p.route)).toEqual(["/", "/pricing", "/dashboard", "/products"]); // input order kept
    expect(run.pages[2]).toEqual({
      route: "/dashboard",
      status: "failed",
      url: "http://localhost:3000/dashboard",
      error: { code: "NAVIGATION_TIMEOUT", message: "Timed out after 30000ms" },
    });
    const pricing = run.pages[1]!;
    expect(pricing.status).toBe("ok");
    if (pricing.status === "ok") {
      expect(pricing.snapshots.map((s) => [s.startY, s.endY])).toEqual([[0, 3000], [2700, 5700], [5400, 7000]]);
    }
  });

  it("wraps unexpected errors as CAPTURE_FAILED", async () => {
    const run = await snapshot({ ...base(), routes: ["/nope"] }, { capturer: fakeCapturer({}) });
    expect(run.pages[0]).toMatchObject({ status: "failed", error: { code: "CAPTURE_FAILED" } });
  });

  it("writes a manifest.json summarising the run", async () => {
    await snapshot({ ...base(), routes: ["/"] }, { capturer: fakeCapturer({ "/": 800 }) });
    const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"));
    expect(manifest.summary.ok).toBe(1);
    expect(manifest.pages[0].snapshots[0].file).toBe("snapshot-1.png");
  });

  it("de-duplicates routes and applies option defaults", async () => {
    const calls: string[] = [];
    await snapshot({ ...base(), routes: ["/", "/", "/a"] }, { capturer: fakeCapturer({ "/": 500, "/a": 500 }, calls) });
    expect(calls.sort()).toEqual(["/", "/a"]);
  });

  it("respects a custom tile size", async () => {
    const run = await snapshot(
      { ...base(), routes: ["/"], tile: { maxHeight: 1000, overlap: 100 } },
      { capturer: fakeCapturer({ "/": 2500 }) },
    );
    const page = run.pages[0]!;
    expect(page.status === "ok" && page.snapshots.length).toBe(3);
  });

  it("runs routes with bounded concurrency", async () => {
    let active = 0;
    let peak = 0;
    const inner = fakeCapturer({ "/a": 500, "/b": 500, "/c": 500, "/d": 500 });
    const capturer = {
      capture: async (r: Parameters<typeof inner.capture>[0]) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((res) => setTimeout(res, 10));
        active--;
        return inner.capture(r);
      },
      close: async () => {},
    };
    await snapshot({ ...base(), routes: ["/a", "/b", "/c", "/d"], concurrency: 2 }, { capturer });
    expect(peak).toBe(2);
  });

  it.each([
    [{ baseUrl: "not a url", routes: ["/"] }],
    [{ baseUrl: "http://x.test", routes: [] }],
    [{ baseUrl: "http://x.test", routes: ["/"], tile: { maxHeight: 1000, overlap: 900 } }],
    [{ baseUrl: "http://x.test", routes: ["/"], viewport: { width: 10 } }],
  ])("throws INVALID_INPUT for bad options %#", async (opts) => {
    await expect(snapshot(opts as any, { capturer: fakeCapturer({}) })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("extraction stage", () => {
  const okExtractor: Extractor = { model: "fake-model", extract: async () => sampleExtraction };

  it("analyze() runs capture then extraction and keeps capture failures visible", async () => {
    const capturer = fakeCapturer({ "/pricing": 4000, "/dashboard": new EngineError("HTTP_ERROR", "HTTP 500") });
    const { run, extractions } = await analyze(
      { ...base(), routes: ["/pricing", "/dashboard"], extractor: okExtractor },
      { capturer },
    );
    expect(run.summary.failed).toBe(1);
    expect(extractions[0]).toMatchObject({ route: "/pricing", status: "ok", model: "fake-model", snapshotCount: 2 });
    expect(extractions[1]).toEqual({
      route: "/dashboard", status: "failed", stage: "capture",
      error: { code: "HTTP_ERROR", message: "HTTP 500" },
    });
  });

  it("passes the snapshots to the extractor in order with metadata", async () => {
    let seen: any;
    const spy: Extractor = { model: "spy", extract: async (i) => ((seen = i), sampleExtraction) };
    const run = await snapshot({ ...base(), routes: ["/pricing"] }, { capturer: fakeCapturer({ "/pricing": 5800 }) });
    await extractRoute(run.pages[0]!, spy);
    expect(seen.snapshots.map((s: any) => s.meta.order)).toEqual([1, 2, 3]);
    expect(seen.page).toEqual({ width: 1440, height: 5800 });
    expect(seen.snapshots[0].data.length).toBeGreaterThan(0);
  });

  it("turns extractor errors into a failed result instead of throwing", async () => {
    const failing: Extractor = {
      model: "x",
      extract: async () => {
        throw new EngineError("INVALID_MODEL_OUTPUT", "bad json");
      },
    };
    const run = await snapshot({ ...base(), routes: ["/"] }, { capturer: fakeCapturer({ "/": 500 }) });
    expect(await extractRoute(run.pages[0]!, failing)).toEqual({
      route: "/", status: "failed", stage: "extract",
      error: { code: "INVALID_MODEL_OUTPUT", message: "bad json" },
    });
  });
});
