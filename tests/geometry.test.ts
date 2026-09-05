import { describe, expect, it } from 'vitest';
import { blockQuad, hexPoints } from '../src/render/geometry';

describe('hexPoints', () => {
  it('returns six equidistant clockwise points', () => {
    const points = hexPoints({ x: 0, y: 0 }, 10, 0);

    expect(points).toHaveLength(6);
    expect(points[0]).toEqual({ x: 10, y: 0 });
    expect(Math.hypot(points[3]!.x, points[3]!.y)).toBeCloseTo(10);
    expect(points[1]!.y).toBeGreaterThan(0);
  });

  it('keeps the supplied center and rotation in world coordinates', () => {
    const [point] = hexPoints({ x: 4, y: -2 }, 10, -Math.PI / 2);
    expect(point?.x).toBeCloseTo(4);
    expect(point?.y).toBeCloseTo(-12);
  });
});

describe('blockQuad', () => {
  it('makes a radial trapezoid whose inner edge aligns with a hex side', () => {
    const points = blockQuad({ x: 0, y: 0 }, -Math.PI / 2, 72, 24);

    expect(points).toHaveLength(4);
    expect(points[0]!.x).toBeCloseTo(-72 / Math.sqrt(3));
    expect(points[0]!.y).toBeCloseTo(-72);
    expect(points[1]!.x).toBeCloseTo(72 / Math.sqrt(3));
    expect(points[1]!.y).toBeCloseTo(-72);
    expect(points[2]!.x).toBeCloseTo(96 / Math.sqrt(3));
    expect(points[2]!.y).toBeCloseTo(-96);
    expect(points[3]!.x).toBeCloseTo(-96 / Math.sqrt(3));
    expect(points[3]!.y).toBeCloseTo(-96);
  });
});
