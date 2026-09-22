import { promises as fs } from "node:fs";
import path from "node:path";
import { EngineError, toErrorInfo } from "../errors.js";
import { mapPool } from "../pipeline/snapshot.js";
import type { PageSnapshotResult, PageSnapshotSuccess } from "../types.js";
import type { ExtractionInput, Extractor, RouteExtractionResult } from "./types.js";

export async function loadExtractionInput(page: PageSnapshotSuccess): Promise<ExtractionInput> {
  const snapshots = [...page.snapshots].sort((a, b) => a.order - b.order);
  return {
    route: page.route,
    url: page.finalUrl || page.url,
    title: page.title,
    page: page.page,
    snapshots: await Promise.all(
      snapshots.map(async (meta) => ({
        meta,
        mimeType: "image/png" as const,
        data: await fs.readFile(path.join(page.directory, meta.file)),
      })),
    ),
  };
}

/** Extracts structured data from one route. Never throws. */
export async function extractRoute(page: PageSnapshotResult, extractor: Extractor): Promise<RouteExtractionResult> {
  if (page.status === "failed") {
    return { route: page.route, status: "failed", stage: "capture", error: page.error };
  }
  try {
    const input = await loadExtractionInput(page).catch((cause) => {
      throw new EngineError("EXTRACTION_FAILED", `Could not read snapshots: ${(cause as Error).message}`, { cause });
    });
    const extraction = await extractor.extract(input);
    return {
      route: page.route,
      status: "ok",
      url: input.url,
      model: extractor.model,
      extractedAt: new Date().toISOString(),
      snapshotCount: input.snapshots.length,
      extraction,
    };
  } catch (err) {
    return { route: page.route, status: "failed", stage: "extract", error: toErrorInfo(err, "EXTRACTION_FAILED") };
  }
}

export async function extractPages(
  pages: PageSnapshotResult[],
  extractor: Extractor,
  options: { concurrency?: number } = {},
): Promise<RouteExtractionResult[]> {
  return mapPool(pages, options.concurrency ?? 2, (page) => extractRoute(page, extractor));
}
