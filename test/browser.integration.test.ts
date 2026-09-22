import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { snapshot } from "../src/index.js";

// These tests need a real Chromium ("npx playwright install chromium").
// Where none can be launched they are skipped, not failed.
const chromiumAvailable = await chromium
  .launch()
  .then(async (b) => (await b.close(), true))
  .catch(() => false);

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const longPage = `<!doctype html><title>Long page</title>
<body style="margin:0">
${Array.from({ length: 7 }, (_, i) => `<section style="height:1000px;background:hsl(${i * 50},70%,80%)"><h2>Section ${i + 1}</h2></section>`).join("")}
<img loading="lazy" id="lazy" alt="lazy" src="/lazy.png" style="display:block;width:100px;height:100px">
<div id="late"></div>
<script>setTimeout(()=>{document.getElementById('late').style.height='500px'},300)</script>
</body>`;

describe.skipIf(!chromiumAvailable)("Playwright capture (real Chromium)", () => {
  let server: Server;
  let baseUrl: string;
  let outDir: string;
  let lazyRequested = false;

  beforeAll(async () => {
    outDir = await mkdtemp(path.join(tmpdir(), "browser-"));
    server = createServer((req, res) => {
      if (req.url === "/long") return void res.setHeader("content-type", "text/html").end(longPage);
      if (req.url === "/lazy.png") {
        lazyRequested = true;
        return void res.setHeader("content-type", "image/png").end(Buffer.from(PNG, "base64"));
      }
      if (req.url === "/hang") return; // never responds
      if (req.url === "/short") return void res.setHeader("content-type", "text/html").end("<title>S</title><h1>Hi</h1>");
      res.statusCode = 404;
      res.end("not found");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    server.close();
    await rm(outDir, { recursive: true, force: true });
  });

  it("splits a tall page into overlapping tiles, triggers lazy images and waits for late layout", async () => {
    const run = await snapshot({ baseUrl, routes: ["/long"], outDir, tile: { maxHeight: 3000, overlap: 300 } });
    const page = run.pages[0]!;
    expect(page.status).toBe("ok");
    if (page.status !== "ok") return;
    expect(lazyRequested).toBe(true);
    expect(page.title).toBe("Long page");
    expect(page.page.height).toBeGreaterThanOrEqual(7600); // 7000 + 100 img + 500 late div
    expect(page.snapshots.length).toBeGreaterThanOrEqual(3);
    expect(page.snapshots[1]!.overlapWithPrevious).toBe(300);
    for (const s of page.snapshots) {
      expect(s.pixelWidth).toBe(1440);
      expect(s.pixelHeight).toBe(s.height);
    }
  });

  it("captures a short page as a single snapshot", async () => {
    const run = await snapshot({ baseUrl, routes: ["/short"], outDir });
    const page = run.pages[0]!;
    expect(page.status === "ok" && page.snapshots.length).toBe(1);
  });

  it("reports HTTP errors, timeouts and unreachable hosts per route without aborting", async () => {
    const run = await snapshot({
      baseUrl,
      routes: ["/missing", "/hang", "/short", "http://127.0.0.1:1/"],
      outDir,
      navigationTimeoutMs: 1500,
    });
    const byRoute = Object.fromEntries(run.pages.map((p) => [p.route, p]));
    expect(byRoute["/missing"]).toMatchObject({ status: "failed", error: { code: "HTTP_ERROR" } });
    expect(byRoute["/hang"]).toMatchObject({ status: "failed", error: { code: "NAVIGATION_TIMEOUT" } });
    expect(byRoute["/short"]).toMatchObject({ status: "ok" });
    expect(byRoute["http://127.0.0.1:1/"]).toMatchObject({ status: "failed", error: { code: "NAVIGATION_FAILED" } });
  });

  it("truncates pages taller than maxPageHeight and flags it", async () => {
    const run = await snapshot({ baseUrl, routes: ["/long"], outDir, maxPageHeight: 4000 });
    const page = run.pages[0]!;
    expect(page.status === "ok" && page.truncated).toBe(true);
    expect(page.status === "ok" && page.page.height).toBe(4000);
  });
});

describe("Playwright capture without a browser", () => {
  it.skipIf(chromiumAvailable)("reports BROWSER_LAUNCH_FAILED for every route instead of throwing", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "nobrowser-"));
    try {
      const run = await snapshot({ baseUrl: "http://127.0.0.1:1", routes: ["/a", "/b"], outDir });
      expect(run.summary).toEqual({ total: 2, ok: 0, failed: 2 });
      expect(run.pages.every((p) => p.status === "failed" && p.error.code === "BROWSER_LAUNCH_FAILED")).toBe(true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });
});
