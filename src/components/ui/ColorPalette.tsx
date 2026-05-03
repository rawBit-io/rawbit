// src/components/ui/ColorPalette.tsx

import React from "react";
import { Button } from "@/components/ui/button";
import { Ban } from "lucide-react";
import { cn } from "@/lib/utils";
import type { XYPosition } from "@xyflow/react";

interface ColorPaletteProps {
  isOpen: boolean;
  position: XYPosition;
  onColorSelect: (color: string | undefined) => void;
  onClose: () => void;
}

// --- Color Palette Definition ---
const defaultColors = [
  { name: "yellow", value: "#eab308" },
  { name: "teal", value: "#0d9488" },
  { name: "amber", value: "#b97a08" },
  { name: "sky", value: "#3a6ea5" },
  { name: "violet", value: "#6b4d8a" },
  { name: "green", value: "#2d7a3a" },
  { name: "accent", value: "#b34a1f" },
];

// --- Sizing Constants (Original Style with Fixed Width) ---
const PALETTE_WIDTH = "w-36"; // Fixed width (9rem = 36 × 4 = 144px)
const SWATCH_SIZE = "w-5 h-5"; // Same small swatches as original
const ICON_SIZE = "h-3 w-3"; // Same smaller icons as original
const GRID_COLUMNS = "grid-cols-4"; // Balanced rows with reset plus seven colors
const GAP_SIZE = "gap-1.5"; // Same spacing as original
const PADDING = "p-1.5"; // Same padding as original

export function ColorPalette({
  isOpen,
  position,
  onColorSelect,
}: ColorPaletteProps) {
  if (!isOpen) {
    return null;
  }

  // Stop propagation for interaction events within the palette
  const stopPropagation = (e: React.MouseEvent | React.WheelEvent) => {
    e.stopPropagation();
  };

  return (
    <div
      className="fixed z-50 nodrag" // High z-index, prevent underlying drag
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseDown={stopPropagation}
      onClick={stopPropagation}
      onWheel={stopPropagation}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* Container div with fixed width */}
      <div
        className={cn(
          "rounded-md border bg-popover text-popover-foreground shadow-md",
          PALETTE_WIDTH, // Add fixed width
          PADDING
        )}
      >
        {/* Grid for swatches */}
        <div className={cn("grid", GRID_COLUMNS, GAP_SIZE)}>
          {/* Reset Button */}
          <Button
            variant="outline"
            className={cn(
              "border-transparent bg-transparent p-0 flex items-center justify-center",
              "hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
              SWATCH_SIZE
            )}
            onClick={() => onColorSelect(undefined)}
            title="Remove border color"
          >
            <Ban className={cn("text-muted-foreground", ICON_SIZE)} />
          </Button>

          {/* Color Swatches */}
          {defaultColors.map(({ name, value }) => (
            <Button
              key={value}
              variant="ghost"
              className={cn(
                "p-0 border rounded",
                "hover:ring-1 hover:ring-offset-1 hover:ring-ring/50 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
                SWATCH_SIZE
              )}
              style={{ backgroundColor: value }}
              onClick={() => onColorSelect(value)}
              title={name}
              aria-label={`Select ${name}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
