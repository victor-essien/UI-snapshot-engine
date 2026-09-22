import type { TileConfig, Viewport } from "../types.js";

export interface CaptureRequest {
  url: string;
  viewport: Viewport;
  tile: TileConfig;
  maxPageHeight: number;
  navigationTimeoutMs: number;
  settleTimeoutMs: number;
  failOnHttpError: boolean;
}

export interface CapturedTile {
  order: number;
  startY: number;
  endY: number;
  data: Buffer;
}

export interface CapturedPage {
  finalUrl: string;
  title: string;
  pageWidth: number;
  pageHeight: number;
  truncated: boolean;
  warnings: string[];
  tiles: CapturedTile[];
}

/**
 * The browser layer's contract. The rest of the engine only depends on this,
 * so the browser can be swapped or faked without touching prepare/extract.
 */
export interface PageCapturer {
  capture(request: CaptureRequest): Promise<CapturedPage>;
  close(): Promise<void>;
}
