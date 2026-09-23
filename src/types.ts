import { z } from "zod";
import type { ErrorInfo } from "./errors.js";

/* ---------- Options ---------- */

export const ViewportSchema = z.object({
  width: z.number().int().min(200).max(4000).default(1440),
  height: z.number().int().min(200).max(4000).default(900),
  deviceScaleFactor: z.number().min(1).max(3).default(1),
});

export const TileConfigSchema = z
  .object({
    /** Max height (CSS px) of one snapshot image. */
    maxHeight: z.number().int().min(500).max(8000).default(3000),
    /** Rows (CSS px) shared between consecutive snapshots so the LLM keeps context. */
    overlap: z.number().int().min(0).default(300),
  })
  .refine((t) => t.overlap < t.maxHeight / 2, {
    message: "tile.overlap must be less than half of tile.maxHeight",
    path: ["overlap"],
  });

export const SnapshotOptionsSchema = z.object({
  baseUrl: z.url(),
  routes: z.array(z.string().min(1)).min(1),
  viewport: ViewportSchema.prefault({}),
  tile: TileConfigSchema.prefault({}),
  outDir: z.string().min(1).default(".snapshots"),
  /** Pages taller than this are truncated (and flagged) to keep runs bounded. */
  maxPageHeight: z.number().int().min(1000).default(40_000),
  navigationTimeoutMs: z.number().int().positive().default(30_000),
  /** Budget for lazy-load scrolling, image loading and layout stabilisation. */
  settleTimeoutMs: z.number().int().positive().default(10_000),
  failOnHttpError: z.boolean().default(true),
  concurrency: z.number().int().min(1).max(8).default(1),
});

export type SnapshotOptions = z.input<typeof SnapshotOptionsSchema>;
export type ResolvedSnapshotOptions = z.output<typeof SnapshotOptionsSchema>;
export type Viewport = z.output<typeof ViewportSchema>;
export type TileConfig = z.output<typeof TileConfigSchema>;

/* ---------- Results ---------- */

export interface SnapshotMeta {
  /** File name, relative to the page directory. */
  file: string;
  order: number;
  /** Position within the original page, in CSS px. */
  startY: number;
  endY: number;
  /** Snapshot size in CSS px. */
  width: number;
  height: number;
  /** Actual image size in device pixels (from the PNG header). */
  pixelWidth: number;
  pixelHeight: number;
  /** How many CSS px at the top repeat the end of the previous snapshot. */
  overlapWithPrevious: number;
}

export interface PageSnapshotSuccess {
  route: string;
  status: "ok";
  url: string;
  finalUrl: string;
  title: string;
  capturedAt: string;
  page: { width: number; height: number };
  viewport: Viewport;
  /** True when the page exceeded `maxPageHeight` and the bottom was dropped. */
  truncated: boolean;
  warnings: string[];
  /** Absolute path of the directory holding the PNGs and metadata.json. */
  directory: string;
  htmlFile: string | null;
  snapshots: SnapshotMeta[];
}

export interface PageSnapshotFailure {
  route: string;
  status: "failed";
  url?: string;
  error: ErrorInfo;
}

export type PageSnapshotResult = PageSnapshotSuccess | PageSnapshotFailure;

export interface RunResult {
  baseUrl: string;
  outDir: string;
  startedAt: string;
  finishedAt: string;
  summary: { total: number; ok: number; failed: number };
  pages: PageSnapshotResult[];
}
