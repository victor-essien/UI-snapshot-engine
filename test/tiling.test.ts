import { describe, expect, it } from "vitest";
import { planTiles } from "../src/capture/tiling.js";

const cfg = { maxHeight: 3000, overlap: 300 };

describe("planTiles", () => {
  it("returns a single tile for short pages", () => {
    expect(planTiles(1200, cfg)).toEqual([{ order: 1, startY: 0, endY: 1200 }]);
  });

  it("returns a single tile when the page is exactly maxHeight", () => {
    expect(planTiles(3000, cfg)).toEqual([{ order: 1, startY: 0, endY: 3000 }]);
  });

  it("splits with overlap, matching the spec's example (0-3000, 2700-5800)", () => {
    expect(planTiles(5800, cfg)).toEqual([
      { order: 1, startY: 0, endY: 3000 },
      { order: 2, startY: 2700, endY: 5700 },
      { order: 3, startY: 5400, endY: 5800 },
    ]);
  });

  it("never leaves a gap and always ends exactly at the page bottom", () => {
    for (const h of [3001, 5699, 5700, 5701, 12345, 39999]) {
      const tiles = planTiles(h, cfg);
      expect(tiles[0]!.startY).toBe(0);
      expect(tiles.at(-1)!.endY).toBe(h);
      tiles.slice(1).forEach((t, i) => {
        const prev = tiles[i]!;
        expect(prev.endY - t.startY).toBe(cfg.overlap); // consistent overlap
        expect(t.endY).toBeGreaterThan(prev.endY); // always progresses
        expect(t.endY - t.startY).toBeLessThanOrEqual(cfg.maxHeight);
      });
    }
  });

  it("rounds fractional heights up so the last pixel row is captured", () => {
    expect(planTiles(1000.4, cfg)[0]!.endY).toBe(1001);
  });

  it("supports zero overlap", () => {
    expect(planTiles(6000, { maxHeight: 3000, overlap: 0 })).toHaveLength(2);
  });

  it("rejects invalid input", () => {
    expect(() => planTiles(0, cfg)).toThrow(RangeError);
    expect(() => planTiles(NaN, cfg)).toThrow(RangeError);
    expect(() => planTiles(100, { maxHeight: 100, overlap: 100 })).toThrow(RangeError);
  });
});
