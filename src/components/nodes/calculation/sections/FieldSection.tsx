import React from "react";

import { FixedSizeList as List } from "react-window";

import {
  FIELD_ROW_HEIGHT,
  VIRTUALIZE_THRESHOLD,
  VIRTUAL_MAX_HEIGHT,
  VIRTUAL_OVERSCAN,
} from "@/lib/nodes/constants";
import { cn } from "@/lib/utils";
import type { FieldDefinition } from "@/types";

interface FieldSectionProps {
  fields?: FieldDefinition[];
  scope: string;
  paddingLeft?: number;
  className?: string;
  getItemClassName?: (field: FieldDefinition, index: number) => string | undefined;
  renderField: (field: FieldDefinition, index: number) => React.ReactNode;
}

export function FieldSection({
  fields,
  scope,
  paddingLeft = 0,
  className,
  getItemClassName,
  renderField,
}: FieldSectionProps) {
  if (!fields || fields.length === 0) return null;

  if (fields.length > VIRTUALIZE_THRESHOLD) {
    const height = Math.min(fields.length * FIELD_ROW_HEIGHT, VIRTUAL_MAX_HEIGHT);
    return (
      <List
        height={height}
        itemCount={fields.length}
        itemSize={FIELD_ROW_HEIGHT}
        width="100%"
        overscanCount={VIRTUAL_OVERSCAN}
      >
        {({ index, style }: { index: number; style: React.CSSProperties }) => (
          <div
            key={`${scope}-${index}`}
            style={{
              ...style,
              paddingLeft,
              paddingBottom: 12,
              boxSizing: "border-box",
            }}
            className={getItemClassName?.(fields[index], index)}
          >
            {renderField(fields[index], index)}
          </div>
        )}
      </List>
    );
  }

  return (
    <div className={cn("space-y-3", paddingLeft ? "pl-4" : "", className)}>
      {fields.map((field, index) => (
        <div
          key={`${scope}-${field.index}`}
          className={getItemClassName?.(field, index)}
        >
          {renderField(field, index)}
        </div>
      ))}
    </div>
  );
}
