'use client';

import { cn } from 'cn';
import type { ShapeTool } from './shape-editor-tools';

const TOOLS: { tool: ShapeTool; label: string; hint: string; for: ('line' | 'polygon')[] }[] = [
  { tool: 'draw', label: 'Draw a shape', hint: 'Click corner by corner', for: ['polygon'] },
  { tool: 'draw', label: 'Draw a line', hint: 'Click point by point; click the last one again to finish', for: ['line'] },
  { tool: 'rectangle', label: 'Rectangle', hint: 'Click two opposite corners', for: ['polygon'] },
  { tool: 'edit', label: 'Edit corners', hint: 'Drag corners; click a midpoint to add one', for: ['line', 'polygon'] },
  { tool: 'move', label: 'Move', hint: 'Drag the whole piece', for: ['line', 'polygon'] },
  { tool: 'cut', label: 'Cut a hole', hint: 'Draw inside a piece', for: ['polygon'] },
  { tool: 'remove', label: 'Remove a piece', hint: 'Click the piece', for: ['line', 'polygon'] },
];

/** geoman's modes as labelled rows (screens 16–17); the active one has a sun ring. */
export function ShapeToolRows({ shape, active, onChoose, compact = false }: {
  shape: 'line' | 'polygon'; active: ShapeTool | null; onChoose: (tool: ShapeTool) => void; compact?: boolean;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {TOOLS.filter((t) => t.for.includes(shape)).map((t) => (
        <li key={t.label}>
          <button type="button" aria-pressed={active === t.tool} onClick={() => onChoose(t.tool)}
            className={cn('flex w-full flex-col items-start rounded-[18px] border px-3.5 text-left', compact ? 'py-1.5' : 'py-2',
              active === t.tool ? 'border-sun bg-white/12' : 'border-transparent hover:bg-white/8')}>
            <span className="text-[15px] font-semibold">{t.label}</span>
            {!compact && <span className="text-xs text-white/70">{t.hint}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
