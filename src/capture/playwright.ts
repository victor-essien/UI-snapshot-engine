import { chromium, errors as pwErrors, type Browser, type Page } from "playwright";
import { EngineError } from "../errors.js";
import { planTiles } from "./tiling.js";
import type { CapturedPage, CaptureRequest, PageCapturer } from "./types.js";

const FREEZE_CSS = `
*, *::before, *::after {
  animation-duration: 0s !important;
  animation-delay: 0s !important;
  transition: none !important;
  scroll-behavior: auto !important;
  caret-color: transparent !important;
}`;

export function createPlaywrightCapturer(): PageCapturer {
  let browserPromise: Promise<Browser> | undefined;

  const getBrowser = (): Promise<Browser> => {
    // Memoised so concurrent routes share one launch.
    browserPromise ??= chromium.launch({ headless: true }).catch((cause) => {
      browserPromise = undefined;
      throw new EngineError(
        "BROWSER_LAUNCH_FAILED",
        `Could not launch Chromium: ${cause instanceof Error ? cause.message : String(cause)}. ` +
          `Run "npx playwright install chromium" if the browser is missing.`,
        { cause },
      );
    });
    return browserPromise;
  };

  return {
    async capture(req: CaptureRequest): Promise<CapturedPage> {
      const browser = await getBrowser();
      const context = await browser.newContext({
        viewport: { width: req.viewport.width, height: req.viewport.height },
        deviceScaleFactor: req.viewport.deviceScaleFactor,
        reducedMotion: "reduce",
      });
      try {
        const page = await context.newPage();
        const warnings: string[] = [];
        await navigate(page, req);
        await settle(page, req, warnings);
        return await screenshotTiles(page, req, warnings);
      } finally {
        await context.close().catch(() => undefined);
      }
    },

    async close() {
      const pending = browserPromise;
      browserPromise = undefined;
      if (pending) await (await pending.catch(() => undefined))?.close();
    },
  };
}

async function navigate(page: Page, req: CaptureRequest): Promise<void> {
  let status: number | undefined;
  try {

    const response = await page.goto(req.url, {
      waitUntil: "load",
      timeout: req.navigationTimeoutMs,
    });
    status = response?.status();
    const html = await page.content();
  } catch (cause) {
    if (cause instanceof pwErrors.TimeoutError) {
      throw new EngineError(
        "NAVIGATION_TIMEOUT",
        `Timed out after ${req.navigationTimeoutMs}ms loading ${req.url}`,
        { cause },
      );
    }
    throw new EngineError(
      "NAVIGATION_FAILED",
      `Failed to load ${req.url}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (req.failOnHttpError && status !== undefined && status >= 400) {
    throw new EngineError("HTTP_ERROR", `${req.url} responded with HTTP ${status}`);
  }
}

/**
 * Best-effort: nothing in here is allowed to fail the capture. Whatever we
 * could not settle is reported as a warning instead.
 */
async function settle(page: Page, req: CaptureRequest, warnings: string[]): Promise<void> {
  const deadline = Date.now() + req.settleTimeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  try {
    await page.addStyleTag({ content: FREEZE_CSS });
    await page.waitForLoadState("networkidle", { timeout: Math.min(3000, remaining()) }).catch(() => {
      warnings.push("Network did not go idle; continued anyway.");
    });

    // Force lazy images to load, then walk the page so IntersectionObserver
    // based content (reveal-on-scroll, infinite sections) is triggered.
    await page.evaluate(() => {
      document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]').forEach((img) => {
        img.loading = "eager";
      });
    });
    await page.evaluate(
      async ({ step, cap, budget }) => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const started = Date.now();
        const height = () =>
          Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0);
        for (let y = 0; y < Math.min(height(), cap) && Date.now() - started < budget; y += step) {
          window.scrollTo(0, y);
          await sleep(120);
        }
        window.scrollTo(0, 0);
      },
      { step: Math.max(200, req.viewport.height - 100), cap: req.maxPageHeight, budget: remaining() },
    );

    await page.evaluate(async (budget) => {
      const pending = Array.from(document.images).filter((img) => !img.complete);
      const loaded = Promise.all(
        pending.map(
          (img) =>
            new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            }),
        ),
      );
      await Promise.race([loaded, new Promise((r) => setTimeout(r, budget))]);
      await document.fonts?.ready;
    }, remaining());

    // Wait for the document height to stop changing.
    let last = -1;
    let stableTicks = 0;
    while (stableTicks < 2 && remaining() > 0) {
      const h = await measureHeight(page);
      stableTicks = h === last ? stableTicks + 1 : 0;
      last = h;
      await page.waitForTimeout(200);
    }
    if (stableTicks < 2) warnings.push("Page height was still changing when the settle budget ran out.");
  } catch (cause) {
    warnings.push(`Settling was interrupted: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function measureHeight(page: Page): Promise<number> {
  return page.evaluate(() =>
    Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight ?? 0),
  );
}

async function screenshotTiles(
  page: Page,
  req: CaptureRequest,
  warnings: string[],
): Promise<CapturedPage> {
  try {
    const measured = await measureHeight(page);
    const truncated = measured > req.maxPageHeight;
    if (truncated) {
      warnings.push(`Page is ${measured}px tall; truncated to maxPageHeight (${req.maxPageHeight}px).`);
    }
    const pageHeight = Math.max(1, Math.min(measured, req.maxPageHeight));
    const pageWidth = req.viewport.width;
    const html = await page.content().catch((cause) => {
     warnings.push(`Could not capture page HTML: ${cause instanceof Error ? cause.message : String(cause)}`);
    return "";
});
const bodyOnlyHtml = html.replace(/<head[^>]*>[\s\S]*?<\/head>/i, "");
    const tiles = [];
    for (const plan of planTiles(pageHeight, req.tile)) {
      const data = await page.screenshot({
        type: "png",
        fullPage: true,
        animations: "disabled",
        caret: "hide",
        clip: { x: 0, y: plan.startY, width: pageWidth, height: plan.endY - plan.startY },
      });
      tiles.push({ ...plan, data });
    }
    return {
      finalUrl: page.url(),
      title: await page.title(),
      html: bodyOnlyHtml,
      pageWidth,
      pageHeight,
      truncated,
      warnings,
      tiles,
    };
  } catch (cause) {
    if (cause instanceof EngineError) throw cause;
    throw new EngineError(
      "CAPTURE_FAILED",
      `Screenshot failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}
