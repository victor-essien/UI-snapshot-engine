import { describe, expect, it } from "vitest";
import { extractionJsonSchema, PageExtractionSchema } from "../src/extract/schema.js";
import { sampleExtraction } from "./helpers.js";

describe("PageExtractionSchema", () => {
  it("accepts a complete pricing extraction", () => {
    expect(PageExtractionSchema.safeParse(sampleExtraction).success).toBe(true);
  });

  it("rejects an unknown pageType", () => {
    expect(PageExtractionSchema.safeParse({ ...sampleExtraction, pageType: "banana" }).success).toBe(false);
  });

  it("rejects a string where a numeric price is required", () => {
    const bad = structuredClone(sampleExtraction) as any;
    bad.sections[0].items[0].price.amount = "29";
    expect(PageExtractionSchema.safeParse(bad).success).toBe(false);
  });

  it("requires explicit nulls rather than missing fields", () => {
    const { summary: _s, ...missing } = sampleExtraction;
    expect(PageExtractionSchema.safeParse(missing).success).toBe(false);
  });
});

describe("extractionJsonSchema", () => {
  it("produces an object schema without $schema and lists all top-level fields as required", () => {
    const schema = extractionJsonSchema() as any;
    expect(schema.$schema).toBeUndefined();
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(["pageType", "title", "sections", "actions", "forms", "navigation"]));
  });
});
