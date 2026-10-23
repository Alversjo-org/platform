'use client';

import { useRef, useState } from 'react';
import { replaceAreaCellsAction } from '@/app/areas/[id]/cells/actions';
import { Button } from '@/components/ui/button';
import { GRID_COLS, GRID_ROWS, MAP_IMAGE_SRC } from '@/lib/map/constants';
import { cellRect } from '@/lib/map/grid';

function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function CellPicker({ areaId, initialCells }: { areaId: string; initialCells: Array<{ col: number; row: number }> }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialCells.map((c) => cellKey(c.col, c.row))));
  const [saved, setSaved] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const cellWidth = 1 / GRID_COLS;
  const cellHeight = 1 / GRID_ROWS;

  function handleClick(e: React.MouseEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const fracX = (e.clientX - bounds.left) / bounds.width;
    const fracY = (e.clientY - bounds.top) / bounds.height;
    const col = Math.min(GRID_COLS - 1, Math.max(0, Math.floor(fracX * GRID_COLS)));
    const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor(fracY * GRID_ROWS)));
    const key = cellKey(col, row);
    setSaved(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSave() {
    const cells = [...selected].map((key) => {
      const [col, row] = key.split(',').map(Number);
      return { col, row };
    });
    await replaceAreaCellsAction(areaId, cells);
    setSaved(true);
  }

  return (
    <div>
      <div className="relative w-full">
        <img src={MAP_IMAGE_SRC} alt="Alversjö map" className="w-full" />
        <svg ref={svgRef} viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <pattern id="cell-picker-grid" width={cellWidth} height={cellHeight} patternUnits="userSpaceOnUse">
              <rect width={cellWidth} height={cellHeight} fill="none" stroke="white" strokeOpacity={0.3} strokeWidth={0.0005} />
            </pattern>
          </defs>
          {[...selected].map((key) => {
            const [col, row] = key.split(',').map(Number);
            const r = cellRect(col, row);
            return (
              <rect
                key={key}
                x={r.x0}
                y={r.y0}
                width={r.x1 - r.x0}
                height={r.y1 - r.y0}
                fill="hsl(200, 80%, 55%)"
                fillOpacity={0.55}
              />
            );
          })}
          <rect width="1" height="1" fill="url(#cell-picker-grid)" onClick={handleClick} style={{ cursor: 'crosshair' }} />
        </svg>
      </div>
      <div className="mt-4 flex items-center gap-4">
        <Button onClick={handleSave}>Save</Button>
        {saved && <span className="text-sm text-muted-foreground">Saved</span>}
      </div>
    </div>
  );
}
