import type { CapturedPage, CaptureRequest, PageCapturer } from "../src/capture/types.js";
import { planTiles } from "../src/capture/tiling.js";
import { EngineError } from "../src/errors.js";
import { PageExtractionSchema, type PageExtraction } from "../src/extract/schema.js";

/** A buffer with a valid PNG signature + IHDR dimensions (not a decodable image). */
export function fakePng(width: number, height: number): Buffer {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

export const sampleExtraction: PageExtraction = PageExtractionSchema.parse({
  pageType: "pricing",
  title: "Pricing",
  summary: "Subscription plans for a SaaS product",
  sections: [
    {
      name: "Pricing Plans",
      kind: "plans",
      summary: null,
      headings: ["Pricing"],
      items: [
        {
          name: "Pro",
          description: null,
          price: { amount: 29, currency: "USD", billing: "monthly", rawText: "$29/mo" },
          features: ["Unlimited projects", "Team collaboration"],
          badges: [],
          action: { label: "Start Free Trial", type: "cta", target: null },
        },
      ],
      text: null,
      table: null,
      actions: [],
    },
  ],
  actions: [{ label: "Start Free Trial", type: "cta", target: null }],
  forms: [],
  navigation: { primary: [{ label: "Home", target: "/" }], secondary: [] },
  entities: [{ name: "Pro", type: "plan", description: null }],
  relationships: [{ subject: "Pro", relation: "costs", object: "$29/mo" }],
  uncertainties: [],
});

/** Fake browser: pages are described by height, or an error to throw. */
export function fakeCapturer(
  pages: Record<string, number | EngineError>,
  calls: string[] = [],
): PageCapturer {
  return {
    async capture(req: CaptureRequest): Promise<CapturedPage> {
      const path = new URL(req.url).pathname;
      calls.push(path);
      const spec = pages[path];
      if (spec === undefined) throw new Error(`no fake page for ${path}`);
      if (spec instanceof EngineError) throw spec;
      const tiles = planTiles(spec, req.tile).map((t) => ({
        ...t,
        data: fakePng(req.viewport.width, t.endY - t.startY),
      }));
      return {
        finalUrl: req.url,
        title: `Title of ${path}`,
        pageWidth: req.viewport.width,
        pageHeight: spec,
        truncated: false,
        warnings: [],
        tiles,
      };
    },
    async close() {},
  };
}
