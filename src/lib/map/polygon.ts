function isInside(point: [number, number], polygon: Array<[number, number]>): boolean {
  const [px, py] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function cellsInPolygon(polygon: Array<[number, number]>, cols: number, rows: number): Array<{ col: number; row: number }> {
  const cells: Array<{ col: number; row: number }> = [];
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const center: [number, number] = [(col + 0.5) / cols, (row + 0.5) / rows];
      if (isInside(center, polygon)) cells.push({ col, row });
    }
  }
  return cells;
}
