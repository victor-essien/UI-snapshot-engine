export interface TilePlan {
  order: number;
  startY: number;
  endY: number;
}

/**
 * Splits a page of `pageHeight` CSS px into overlapping vertical tiles.
 * Consecutive tiles share `overlap` px so content cut at a boundary is
 * fully visible in at least one of them.
 */
export function planTiles(
  pageHeight: number,
  { maxHeight, overlap }: { maxHeight: number; overlap: number },
): TilePlan[] {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0) {
    throw new RangeError(`pageHeight must be a positive number, got ${pageHeight}`);
  }
  if (maxHeight <= 0 || overlap < 0 || overlap >= maxHeight) {
    throw new RangeError("require maxHeight > 0 and 0 <= overlap < maxHeight");
  }
  const height = Math.ceil(pageHeight);
  const step = maxHeight - overlap;
  const tiles: TilePlan[] = [];
  let startY = 0;
  for (;;) {
    const endY = Math.min(startY + maxHeight, height);
    tiles.push({ order: tiles.length + 1, startY, endY });
    if (endY >= height) break;
    startY += step;
  }
  return tiles;
}
