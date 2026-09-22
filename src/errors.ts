export type ErrorCode =
  | "INVALID_INPUT"
  | "BROWSER_LAUNCH_FAILED"
  | "NAVIGATION_TIMEOUT"
  | "NAVIGATION_FAILED"
  | "HTTP_ERROR"
  | "CAPTURE_FAILED"
  | "STORAGE_FAILED"
  | "NO_API_KEY"
  | "INPUT_TOO_LARGE"
  | "EXTRACTION_FAILED"
  | "INVALID_MODEL_OUTPUT";

export interface ErrorInfo {
  code: ErrorCode;
  message: string;
}

export class EngineError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EngineError";
  }
}

/** Normalises anything thrown into the `{ code, message }` shape used in results. */
export function toErrorInfo(err: unknown, fallback: ErrorCode): ErrorInfo {
  if (err instanceof EngineError) return { code: err.code, message: err.message };
  const message = err instanceof Error ? err.message : String(err);
  return { code: fallback, message };
}
