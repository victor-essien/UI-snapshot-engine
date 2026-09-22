import type { ErrorInfo } from "../errors.js";
import type { SnapshotMeta } from "../types.js";
import type { PageExtraction } from "./schema.js";

export interface ExtractionInput {
  route: string;
  url: string;
  title: string;
  page: { width: number; height: number };
  /** In top-to-bottom order. */
  snapshots: Array<{ meta: SnapshotMeta; data: Buffer; mimeType: "image/png" }>;
}

/** The AI layer's contract. Implement it to plug in a different vision model. */
export interface Extractor {
  readonly model: string;
  extract(input: ExtractionInput): Promise<PageExtraction>;
}

export interface RouteExtractionSuccess {
  route: string;
  status: "ok";
  url: string;
  model: string;
  extractedAt: string;
  snapshotCount: number;
  extraction: PageExtraction;
}

export interface RouteExtractionFailure {
  route: string;
  status: "failed";
  /** Which stage failed: the snapshot could not be taken, or the model call failed. */
  stage: "capture" | "extract";
  error: ErrorInfo;
}

export type RouteExtractionResult = RouteExtractionSuccess | RouteExtractionFailure;
