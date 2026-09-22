import { z } from "zod";

/*
 * Design note: every field is required, with `null` / `[]` meaning "absent".
 * Required-but-nullable schemas are the most reliable shape for constrained
 * JSON decoding, and they force the model to make an explicit decision.
 */

export const PageTypeSchema = z.enum([
  "landing", "pricing", "about", "product_list", "product_detail", "blog_post",
  "documentation", "dashboard", "form", "login", "checkout", "contact",
  "search_results", "error", "other",
]);

export const ActionSchema = z.object({
  label: z.string().describe("Visible text of the button or link."),
  type: z.enum(["cta", "link", "button", "submit", "other"]),
  target: z.string().nullable().describe("Destination URL/path if visible or obvious, else null."),
});

export const PriceSchema = z.object({
  amount: z.number().nullable().describe("Numeric amount, e.g. 29 for '$29'. Null if not numeric (e.g. 'Contact us')."),
  currency: z.string().nullable().describe("ISO 4217 code such as USD, or null if unclear."),
  billing: z.string().nullable().describe("e.g. monthly, yearly, one-time, per user/month."),
  rawText: z.string().nullable().describe("The price exactly as displayed."),
});

export const ItemSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  price: PriceSchema.nullable(),
  features: z.array(z.string()),
  badges: z.array(z.string()).describe("Labels such as 'Most popular' or 'New'."),
  action: ActionSchema.nullable().describe("Primary call to action attached to this item."),
});

export const TableSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
});

export const SectionSchema = z.object({
  name: z.string(),
  kind: z.enum(["hero", "plans", "features", "list", "table", "faq", "testimonials", "form", "text", "gallery", "footer", "other"]),
  summary: z.string().nullable(),
  headings: z.array(z.string()),
  items: z.array(ItemSchema).describe("Cards, plans, products, FAQ entries etc. Empty if not applicable."),
  text: z.string().nullable().describe("Key prose of the section, condensed. Not a transcript."),
  table: TableSchema.nullable(),
  actions: z.array(ActionSchema),
});

export const FormSchema = z.object({
  name: z.string().nullable(),
  purpose: z.string().nullable(),
  fields: z.array(
    z.object({
      label: z.string(),
      type: z.string().nullable().describe("text, email, password, select, checkbox, textarea..."),
      required: z.boolean().nullable(),
    }),
  ),
  submitLabel: z.string().nullable(),
});

export const NavItemSchema = z.object({ label: z.string(), target: z.string().nullable() });

export const EntitySchema = z.object({
  name: z.string(),
  type: z.string().describe("e.g. product, plan, company, person, feature, location."),
  description: z.string().nullable(),
});

export const RelationshipSchema = z.object({
  subject: z.string(),
  relation: z.string().describe("e.g. includes, costs, requires, links_to."),
  object: z.string(),
});

export const PageExtractionSchema = z.object({
  pageType: PageTypeSchema,
  title: z.string().describe("The page's own visible title/main heading."),
  summary: z.string().describe("One or two sentences on what the page is for."),
  sections: z.array(SectionSchema).describe("In top-to-bottom order."),
  actions: z.array(ActionSchema).describe("Page-level calls to action (not already inside a section item)."),
  forms: z.array(FormSchema),
  navigation: z.object({
    primary: z.array(NavItemSchema),
    secondary: z.array(NavItemSchema).describe("Footer and other secondary links."),
  }),
  entities: z.array(EntitySchema),
  relationships: z.array(RelationshipSchema),
  uncertainties: z.array(z.string()).describe("Anything cut off, unreadable, or ambiguous in the snapshots."),
});

export type PageExtraction = z.infer<typeof PageExtractionSchema>;

/** JSON Schema for constrained decoding (Gemini `responseJsonSchema`). */
export function extractionJsonSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(PageExtractionSchema) as Record<string, unknown>;
  return schema;
}
