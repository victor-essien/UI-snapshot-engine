import path from "node:path";
import { createPlaywrightCapturer } from "../capture/playwright.js";
import type { PageCapturer } from "../capture/types.js";
import { EngineError, toErrorInfo } from "../errors.js";
import { assignSlugs, persistPage, writeJsonAtomic } from "../prepare/store.js";
import {
  SnapshotOptionsSchema,
  type PageSnapshotResult,
  type ResolvedSnapshotOptions,
  type RunResult,
  type SnapshotOptions,
} from "../types.js";
import { promises as fs } from "node:fs";

export interface SnapshotDeps {
  /** Override the browser layer (used for tests and alternative browsers). */
  capturer?: PageCapturer;
}

export function parseOptions(input: SnapshotOptions): ResolvedSnapshotOptions {
  const parsed = SnapshotOptionsSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new EngineError("INVALID_INPUT", `Invalid snapshot options: ${issues.join("; ")}`);
  }
  return { ...parsed.data, routes: [...new Set(parsed.data.routes)] };
}

/**
 * Capture + prepare. Never throws for a bad route: each route yields either a
 * success (with metadata) or a `{ status: "failed", error }` entry.
 * Only invalid options (a developer error) throw.
 */
export async function snapshot(input: SnapshotOptions, deps: SnapshotDeps = {}): Promise<RunResult> {
  const opts = parseOptions(input);
  const outDir = path.resolve(opts.outDir);
  const slugs = assignSlugs(opts.routes);
  const capturer = deps.capturer ?? createPlaywrightCapturer();
  const startedAt = new Date();

  try {
    const pages = await mapPool(opts.routes, opts.concurrency, (route) =>
      captureRoute(route, slugs.get(route)!, opts, outDir, capturer),
    );
    const failed = pages.filter((p) => p.status === "failed").length;
    const result: RunResult = {
      baseUrl: opts.baseUrl,
      outDir,
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      summary: { total: pages.length, ok: pages.length - failed, failed },
      pages,
    };
    await fs.mkdir(outDir, { recursive: true });
    await writeJsonAtomic(path.join(outDir, "manifest.json"), result);
    return result;
  } finally {
    if (!deps.capturer) await capturer.close();
  }
}

async function captureRoute(
  route: string,
  slug: string,
  opts: ResolvedSnapshotOptions,
  outDir: string,
  capturer: PageCapturer,
): Promise<PageSnapshotResult> {
  let url: string | undefined;
  try {
    try {
      url = new URL(route, opts.baseUrl).href;
    } catch (cause) {
      throw new EngineError("INVALID_INPUT", `Cannot resolve route "${route}" against ${opts.baseUrl}`, { cause });
    }
    const captured = await capturer.capture({
      url,
      viewport: opts.viewport,
      tile: opts.tile,
      maxPageHeight: opts.maxPageHeight,
      navigationTimeoutMs: opts.navigationTimeoutMs,
      settleTimeoutMs: opts.settleTimeoutMs,
      failOnHttpError: opts.failOnHttpError,
    });
    try {
      return await persistPage({
        outDir,
        slug,
        route,
        url,
        viewport: opts.viewport,
        captured,
        capturedAt: new Date(),
      });
    } catch (cause) {
      throw new EngineError("STORAGE_FAILED", `Could not write snapshots: ${(cause as Error).message}`, { cause });
    }
  } catch (err) {
    return { route, status: "failed", ...(url ? { url } : {}), error: toErrorInfo(err, "CAPTURE_FAILED") };
  }
}

/** Runs `fn` over `items` with bounded concurrency, preserving input order. */
export async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
