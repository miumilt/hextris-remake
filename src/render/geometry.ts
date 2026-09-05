export interface Point {
  readonly x: number;
  readonly y: number;
}

const HALF_HEX_ANGLE = Math.PI / 6;

export function hexPoints(center: Point, radius: number, rotationRad: number): Point[] {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = rotationRad + (index * Math.PI) / 3;
    return {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
  });
}

export function blockQuad(center: Point, angleRad: number, near: number, depth: number): Point[] {
  const normal = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  const tangent = { x: -normal.y, y: normal.x };
  const far = near + depth;
  const nearHalfWidth = near * Math.tan(HALF_HEX_ANGLE);
  const farHalfWidth = far * Math.tan(HALF_HEX_ANGLE);

  const pointAt = (distance: number, halfWidth: number, side: -1 | 1): Point => ({
    x: center.x + normal.x * distance + tangent.x * halfWidth * side,
    y: center.y + normal.y * distance + tangent.y * halfWidth * side,
  });

  return [
    pointAt(near, nearHalfWidth, -1),
    pointAt(near, nearHalfWidth, 1),
    pointAt(far, farHalfWidth, 1),
    pointAt(far, farHalfWidth, -1),
  ];
}
