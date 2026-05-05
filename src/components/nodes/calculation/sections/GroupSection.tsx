import React from "react";

import { FixedSizeList as List } from "react-window";

import { Button } from "@/components/ui/button";
import { Minus, Plus } from "lucide-react";
import {
  FIELD_ROW_HEIGHT,
  VIRTUALIZE_THRESHOLD,
  VIRTUAL_MAX_HEIGHT,
  VIRTUAL_OVERSCAN,
} from "@/lib/nodes/constants";
import { cn } from "@/lib/utils";
import type { FieldDefinition, GroupDefinition } from "@/types";

import { EditableLabel } from "../fields/EditableLabel";

interface GroupSectionProps {
  group: GroupDefinition;
  instanceKeys: number[];
  title: string;
  onTitleCommit: (title: string) => void;
  canIncrement: boolean;
  canDecrement: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  renderField: (offset: number, field: FieldDefinition, index: number) => React.ReactNode;
  headerDivider?: boolean;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  instanceClassName?: string;
  compactControls?: boolean;
}

export function GroupSection({
  group,
  instanceKeys,
  title,
  onTitleCommit,
  canIncrement,
  canDecrement,
  onIncrement,
  onDecrement,
  renderField,
  headerDivider = true,
  className,
  headerClassName,
  titleClassName,
  instanceClassName,
  compactControls = false,
}: GroupSectionProps) {
  const totalFields = instanceKeys.length * group.fields.length;
  const hasInstances = instanceKeys.length > 0;
  const showInstanceLabels = Boolean(group.instanceLabelPrefix);
  const shouldVirtualize =
    totalFields > VIRTUALIZE_THRESHOLD && !showInstanceLabels;

  const renderVirtualItem = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const instanceIndex = Math.floor(index / group.fields.length);
    const fieldIndex = index % group.fields.length;
    const offset = instanceKeys[instanceIndex];
    const field = group.fields[fieldIndex];

    return (
      <div
        key={`${group.title}-virtual-${index}`}
        style={{
          ...style,
          paddingLeft: 16,
          paddingBottom: 12,
          boxSizing: "border-box",
        }}
      >
        {renderField(offset, field, fieldIndex)}
      </div>
    );
  };

  const buttonClassName = compactControls
    ? "h-7 px-2"
    : !headerDivider
      ? "h-6 px-2"
      : undefined;
  const iconClassName = compactControls
    ? "h-3.5 w-3.5"
    : headerDivider
      ? "h-4 w-4"
      : "h-3 w-3";

  return (
    <div className={cn("mb-6 space-y-3", className)}>
      <div
        className={cn(
          "mb-3 flex items-center justify-between",
          headerDivider && "border-b border-border pb-2",
          headerClassName
        )}
      >
        <EditableLabel
          value={title}
          onCommit={onTitleCommit}
          className={titleClassName ?? (headerDivider ? "text-lg" : "text-sm")}
        />
        {group.expandable && (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className={buttonClassName}
              onClick={onDecrement}
              disabled={!canDecrement}
            >
              <Minus className={iconClassName} />
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={buttonClassName}
              onClick={onIncrement}
              disabled={!canIncrement}
            >
              <Plus className={iconClassName} />
            </Button>
          </div>
        )}
      </div>

      {hasInstances && (
        shouldVirtualize ? (
          <List
            height={Math.min(totalFields * FIELD_ROW_HEIGHT, VIRTUAL_MAX_HEIGHT)}
            itemCount={totalFields}
            itemSize={FIELD_ROW_HEIGHT}
            width="100%"
            overscanCount={VIRTUAL_OVERSCAN}
          >
            {renderVirtualItem}
          </List>
        ) : (
          instanceKeys.map((offset, instanceIndex) => (
            <div
              key={`${group.title}-${offset}`}
              className={cn("mb-4 space-y-3 pl-4", instanceClassName)}
            >
              {showInstanceLabels && (
                <div className="text-sm font-semibold text-primary">
                  {`> ${group.instanceLabelPrefix} ${instanceIndex}`}
                </div>
              )}
              {group.fields.map((field, index) => renderField(offset, field, index))}
            </div>
          ))
        )
      )}
    </div>
  );
}
