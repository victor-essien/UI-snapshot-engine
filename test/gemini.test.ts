import type { GenerateContentParameters, GenerateContentResponse } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import { EngineError } from "../src/errors.js";
import { GeminiExtractor, type GeminiClientLike } from "../src/extract/gemini.js";
import type { ExtractionInput } from "../src/extract/types.js";
import { fakePng, sampleExtraction } from "./helpers.js";

const reply = (text: string | undefined): GenerateContentResponse => ({ text }) as GenerateContentResponse;

function input(tileCount: number): ExtractionInput {
  return {
    route: "/pricing",
    url: "http://x/pricing",
    title: "Pricing",
    page: { width: 1440, height: 3000 * tileCount },
    snapshots: Array.from({ length: tileCount }, (_, i) => ({
      mimeType: "image/png" as const,
      data: fakePng(1440, 3000),
      meta: {
        file: `snapshot-${i + 1}.png`, order: i + 1, startY: i * 2700, endY: i * 2700 + 3000,
        width: 1440, height: 3000, pixelWidth: 1440, pixelHeight: 3000, overlapWithPrevious: i === 0 ? 0 : 300,
      },
    })),
  };
}

function extractorWith(responses: Array<GenerateContentResponse | Error>, extra = {}) {
  const generateContent = vi.fn<(p: GenerateContentParameters) => Promise<GenerateContentResponse>>(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more fake responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const client: GeminiClientLike = { models: { generateContent } };
  return { generateContent, extractor: new GeminiExtractor({ client, retryDelayMs: 0, ...extra }) };
}

const json = JSON.stringify(sampleExtraction);

describe("GeminiExtractor", () => {
  it("returns a validated extraction", async () => {
    const { extractor } = extractorWith([reply(json)]);
    expect(await extractor.extract(input(1))).toEqual(sampleExtraction);
  });

  it("sends tiles in order, each preceded by its position label, with schema-constrained JSON config", async () => {
    const { extractor, generateContent } = extractorWith([reply(json)]);
    await extractor.extract(input(3));
    const req = generateContent.mock.calls[0]![0] as any;
    const parts = req.contents[0].parts;
    expect(parts.filter((p: any) => p.inlineData)).toHaveLength(3);
    const labels = parts.filter((p: any) => p.text?.startsWith("Snapshot")).map((p: any) => p.text);
    expect(labels[0]).toContain("Snapshot 1 of 3");
    expect(labels[1]).toContain("Snapshot 2 of 3");
    expect(labels[1]).toContain("top 300px repeat");
    // label immediately precedes its image
    expect(parts[1].text).toContain("Snapshot 1");
    expect(parts[2].inlineData.mimeType).toBe("image/png");
    expect(req.config.responseMimeType).toBe("application/json");
    expect(req.config.responseJsonSchema.type).toBe("object");
    expect(req.config.temperature).toBeUndefined();
  });

  it("tolerates a markdown-fenced JSON reply", async () => {
    const { extractor } = extractorWith([reply("```json\n" + json + "\n```")]);
    expect(await extractor.extract(input(1))).toEqual(sampleExtraction);
  });

  it("re-asks with the validation problem when output is invalid, then succeeds", async () => {
    const { extractor, generateContent } = extractorWith([reply('{"pageType":"banana"}'), reply(json)]);
    expect(await extractor.extract(input(1))).toEqual(sampleExtraction);
    const second = JSON.stringify(generateContent.mock.calls[1]![0]);
    expect(second).toContain("previous answer was rejected");
  });

  it("fails with INVALID_MODEL_OUTPUT when output never validates", async () => {
    const { extractor, generateContent } = extractorWith([reply("nope"), reply("nope"), reply("nope")]);
    await expect(extractor.extract(input(1))).rejects.toMatchObject({ code: "INVALID_MODEL_OUTPUT" });
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("treats an empty (e.g. blocked) response as invalid output", async () => {
    const { extractor } = extractorWith([reply(undefined), reply(json)]);
    expect(await extractor.extract(input(1))).toEqual(sampleExtraction);
  });

  it("retries transient API errors (429/503)", async () => {
    const { extractor, generateContent } = extractorWith([
      Object.assign(new Error("rate limited"), { status: 429 }),
      Object.assign(new Error("unavailable"), { status: 503 }),
      reply(json),
    ]);
    expect(await extractor.extract(input(1))).toEqual(sampleExtraction);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it("does not retry permanent errors (e.g. bad API key)", async () => {
    const { extractor, generateContent } = extractorWith([Object.assign(new Error("API key not valid"), { status: 400 })]);
    await expect(extractor.extract(input(1))).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("gives up with EXTRACTION_FAILED when transient errors persist", async () => {
    const err = () => Object.assign(new Error("unavailable"), { status: 503 });
    const { extractor } = extractorWith([err(), err(), err()]);
    await expect(extractor.extract(input(1))).rejects.toMatchObject({ code: "EXTRACTION_FAILED" });
  });

  it("refuses oversized requests before calling the API", async () => {
    const { extractor, generateContent } = extractorWith([reply(json)], { maxSnapshotsPerRequest: 2 });
    await expect(extractor.extract(input(3))).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("requires an API key when no client is injected", () => {
    const saved = { g: process.env.GEMINI_API_KEY, k: process.env.GOOGLE_API_KEY };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      expect(() => new GeminiExtractor()).toThrow(EngineError);
    } finally {
      if (saved.g) process.env.GEMINI_API_KEY = saved.g;
      if (saved.k) process.env.GOOGLE_API_KEY = saved.k;
    }
  });
});
