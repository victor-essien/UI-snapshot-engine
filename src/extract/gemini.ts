import {
  GoogleGenAI,
  type GenerateContentParameters,
  type GenerateContentResponse,
} from "@google/genai";
import { EngineError } from "../errors.js";
import { buildIntro, describeSnapshot, SYSTEM_INSTRUCTION } from "./prompt.js";
import { extractionJsonSchema, PageExtractionSchema, type PageExtraction } from "./schema.js";
import type { ExtractionInput, Extractor } from "./types.js";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

/** The one SDK method we use; lets tests inject a fake without network access. */
export interface GeminiClientLike {
  models: { generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse> };
}

export interface GeminiExtractorOptions {
  apiKey?: string;
  /** Verify the current model name in Google's docs; it changes often. */
  model?: string;
  client?: GeminiClientLike;
  /** Extra attempts after the first (transient API errors and invalid output). */
  maxRetries?: number;
  retryDelayMs?: number;
  temperature?: number;
  /** Refuse to send more snapshots than this in one request. */
  maxSnapshotsPerRequest?: number;
  /** Refuse requests whose images exceed this many bytes (inline-data limit guard). */
  maxInlineBytes?: number;
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";

export class GeminiExtractor implements Extractor {
  readonly model: string;
  private readonly client: GeminiClientLike;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly temperature: number | undefined;
  private readonly maxSnapshots: number;
  private readonly maxBytes: number;
  private readonly jsonSchema = extractionJsonSchema();

  constructor(options: GeminiExtractorOptions = {}) {
    this.model = options.model ?? DEFAULT_GEMINI_MODEL;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.temperature = options.temperature;
    this.maxSnapshots = options.maxSnapshotsPerRequest ?? 12;
    this.maxBytes = options.maxInlineBytes ?? 18 * 1024 * 1024;

    if (options.client) {
      this.client = options.client;
    } else {
      const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
      if (!apiKey) {
        throw new EngineError("NO_API_KEY", "Set GEMINI_API_KEY (or GOOGLE_API_KEY) or pass apiKey to GeminiExtractor.");
      }
      this.client = new GoogleGenAI({ apiKey });
    }
  }

  async extract(input: ExtractionInput): Promise<PageExtraction> {
    this.assertWithinLimits(input);

    let repairNote: string | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) await sleep(this.retryDelayMs * 2 ** (attempt - 1));
      try {
        const response = await this.client.models.generateContent(this.buildRequest(input, repairNote));
        const parsed = parseModelOutput(response);
        if (parsed.ok) return parsed.value;
        // Ask again, telling the model what was wrong with its last answer.
        repairNote = parsed.problem;
        lastError = new EngineError("INVALID_MODEL_OUTPUT", parsed.problem);
      } catch (err) {
        if (!isTransient(err)) {
          throw new EngineError("EXTRACTION_FAILED", `Gemini request failed: ${errMsg(err)}`, { cause: err });
        }
        lastError = err;
      }
    }
    if (lastError instanceof EngineError) throw lastError;
    throw new EngineError("EXTRACTION_FAILED", `Gemini request failed after retries: ${errMsg(lastError)}`, {
      cause: lastError,
    });
  }

  private assertWithinLimits(input: ExtractionInput): void {
    if (input.snapshots.length === 0) {
      throw new EngineError("INVALID_INPUT", "No snapshots to extract from.");
    }
    if (input.snapshots.length > this.maxSnapshots) {
      throw new EngineError(
        "INPUT_TOO_LARGE",
        `${input.snapshots.length} snapshots exceed maxSnapshotsPerRequest (${this.maxSnapshots}). ` +
          `Use a larger tile.maxHeight or a lower maxPageHeight.`,
      );
    }
    const bytes = input.snapshots.reduce((sum, s) => sum + s.data.length, 0);
    if (bytes > this.maxBytes) {
      throw new EngineError("INPUT_TOO_LARGE", `Snapshots total ${bytes} bytes, above maxInlineBytes (${this.maxBytes}).`);
    }
  }

  private buildRequest(input: ExtractionInput, repairNote?: string): GenerateContentParameters {
    const parts: Array<Record<string, unknown>> = [{ text: buildIntro(input) }];
    input.snapshots.forEach((s, i) => {
      parts.push({ text: describeSnapshot(input, i) });
      parts.push({ inlineData: { mimeType: s.mimeType, data: s.data.toString("base64") } });
    });
    if (repairNote) {
      parts.push({
        text: `Your previous answer was rejected: ${repairNote}\nReturn corrected JSON that matches the schema exactly.`,
      });
    }
    return {
      model: this.model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseJsonSchema: this.jsonSchema,
        ...(this.temperature !== undefined ? { temperature: this.temperature } : {}),
      },
    } as GenerateContentParameters;
  }
}

type Parsed = { ok: true; value: PageExtraction } | { ok: false; problem: string };

export function parseModelOutput(response: GenerateContentResponse): Parsed {
  const text = response.text?.trim();
  if (!text) {
    const reason = response.candidates?.[0]?.finishReason ?? "unknown";
    return { ok: false, problem: `empty response (finishReason: ${reason})` };
  }
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(text));
  } catch (e) {
    return { ok: false, problem: `response was not valid JSON (${errMsg(e)})` };
  }
  const result = PageExtractionSchema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const issues = result.error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, problem: `response did not match the schema: ${issues}` };
}

const stripCodeFence = (s: string) => s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function isTransient(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(errMsg(err));
}
