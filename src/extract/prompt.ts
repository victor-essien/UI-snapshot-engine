import type { ExtractionInput } from "./types.js";

export const SYSTEM_INSTRUCTION = `You analyse screenshots of a web page and return a structured JSON description of its meaning and content.

Rules:
- Understand the page; do not transcribe it. Identify its purpose, sections, entities and how they relate.
- Report only what is visible. Never invent prices, features, links or text. Use null or [] when something is absent or unreadable, and note ambiguity in "uncertainties".
- The screenshots are consecutive vertical slices of ONE page, in order. Consecutive slices overlap; content in an overlap appears in both. Treat them as one continuous document and never report the same section, card or item twice.
- Keep sections in top-to-bottom order.
- Prices: put the numeric amount in "amount" (29 for "$29"), the ISO currency code in "currency", and the text as displayed in "rawText".
- Include navigation (header/sidebar/footer links), forms with their fields, and every call to action.
- Respond with JSON only, matching the provided schema.`;

export function describeSnapshot(input: ExtractionInput, index: number): string {
  const s = input.snapshots[index]!;
  const overlap = s.meta.overlapWithPrevious > 0
    ? ` Its top ${s.meta.overlapWithPrevious}px repeat the bottom of the previous snapshot.`
    : "";
  return `Snapshot ${s.meta.order} of ${input.snapshots.length}: covers y=${s.meta.startY} to y=${s.meta.endY} of a ${input.page.height}px tall page.${overlap}`;
}

export function buildIntro(input: ExtractionInput): string {
  return [
    `Page route: ${input.route}`,
    `Page URL: ${input.url}`,
    input.title ? `Document title: ${input.title}` : null,
    `Page size: ${input.page.width}x${input.page.height} CSS px, provided as ${input.snapshots.length} snapshot(s).`,
  ]
    .filter(Boolean)
    .join("\n");
}
