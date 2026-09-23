import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CapturedPage } from "../capture/types.js";
import type { PageSnapshotSuccess, SnapshotMeta, Viewport } from "../types.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Reads width/height from the PNG IHDR chunk without decoding the image. */
export function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const shortHash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 6);

/** "/" -> "index", "/a/b" -> "a__b"; anything unusual gets a hash suffix. */
export function routeToSlug(route: string): string {
  const noOrigin = route.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
  const pathPart = noOrigin.split(/[?#]/)[0] ?? "";
  const segments = pathPart.split("/").filter(Boolean);
  let slug = segments.map((s) => s.replace(/[^a-zA-Z0-9._-]/g, "-")).join("__") || "index";
  if (/^\.+$/.test(slug)) slug = "dot";
  const unusual = /[?#]/.test(noOrigin) || /[^a-zA-Z0-9/._-]/.test(pathPart) || slug.includes("____");
  return unusual ? `${slug}-${shortHash(route)}` : slug;
}

/** Gives every route a unique directory name, even if slugs collide. */
export function assignSlugs(routes: string[]): Map<string, string> {
  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const route of routes) {
    let slug = routeToSlug(route);
    if (used.has(slug)) slug = `${slug}-${shortHash(route)}`;
    used.add(slug);
    result.set(route, slug);
  }
  return result;
}

export async function persistPage(args: {
  outDir: string;
  slug: string;
  route: string;
  url: string;
  viewport: Viewport;
  captured: CapturedPage;
  capturedAt: Date;
}): Promise<PageSnapshotSuccess> {
  const { captured } = args;
  const directory = path.resolve(args.outDir, args.slug);
  await fs.rm(directory, { recursive: true, force: true });
  await fs.mkdir(directory, { recursive: true });

   
 let htmlFile: string | null = null;
if (captured.html) {
  htmlFile = `${args.slug}.html`;
  await fs.writeFile(path.join(directory, htmlFile), captured.html, "utf8");
}

  const snapshots: SnapshotMeta[] = [];
  for (const tile of captured.tiles) {
    const file = `snapshot-${tile.order}.png`;
    await fs.writeFile(path.join(directory, file), tile.data);
    const previous = snapshots[snapshots.length - 1];
    const dims = pngDimensions(tile.data);
    const height = tile.endY - tile.startY;
    snapshots.push({
      file,
      order: tile.order,
      startY: tile.startY,
      endY: tile.endY,
      width: captured.pageWidth,
      height,
      pixelWidth: dims?.width ?? Math.round(captured.pageWidth * args.viewport.deviceScaleFactor),
      pixelHeight: dims?.height ?? Math.round(height * args.viewport.deviceScaleFactor),
      overlapWithPrevious: previous ? Math.max(0, previous.endY - tile.startY) : 0,
    });
  }

  const result: PageSnapshotSuccess = {
    route: args.route,
    status: "ok",
    url: args.url,
    finalUrl: captured.finalUrl,
    title: captured.title,
    capturedAt: args.capturedAt.toISOString(),
    page: { width: captured.pageWidth, height: captured.pageHeight },
    viewport: args.viewport,
    truncated: captured.truncated,
    warnings: captured.warnings,
    directory,
    htmlFile,
    snapshots,
  };
  await writeJsonAtomic(path.join(directory, "metadata.json"), result);
  return result;
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
