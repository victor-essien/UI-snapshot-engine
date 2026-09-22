import { extractPages } from "./extract/index.js";
import type { Extractor, RouteExtractionResult } from "./extract/types.js";
import { snapshot, type SnapshotDeps } from "./pipeline/snapshot.js";
import type { RunResult, SnapshotOptions } from "./types.js";

export interface AnalyzeOptions extends SnapshotOptions {
  extractor: Extractor;
  extractionConcurrency?: number;
}

export interface AnalyzeResult {
  run: RunResult;
  extractions: RouteExtractionResult[];
}

/** Capture -> prepare -> extract in one call. */
export async function analyze(options: AnalyzeOptions, deps: SnapshotDeps = {}): Promise<AnalyzeResult> {
  const { extractor, extractionConcurrency, ...snapshotOptions } = options;
  const run = await snapshot(snapshotOptions, deps);
  const extractions = await extractPages(run.pages, extractor, { concurrency: extractionConcurrency });
  return { run, extractions };
}

export { snapshot, mapPool } from "./pipeline/snapshot.js";
export type { SnapshotDeps } from "./pipeline/snapshot.js";
export { extractPages, extractRoute, loadExtractionInput } from "./extract/index.js";
export { GeminiExtractor, DEFAULT_GEMINI_MODEL } from "./extract/gemini.js";
export type { GeminiExtractorOptions, GeminiClientLike } from "./extract/gemini.js";
export { PageExtractionSchema, extractionJsonSchema } from "./extract/schema.js";
export type { PageExtraction } from "./extract/schema.js";
export type * from "./extract/types.js";
export { createPlaywrightCapturer } from "./capture/playwright.js";
export { planTiles } from "./capture/tiling.js";
export type * from "./capture/types.js";
export { routeToSlug } from "./prepare/store.js";
export { EngineError } from "./errors.js";
export type { ErrorCode, ErrorInfo } from "./errors.js";
export { SnapshotOptionsSchema } from "./types.js";
export type * from "./types.js";
