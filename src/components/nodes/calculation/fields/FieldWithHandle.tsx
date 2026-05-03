import React, { useCallback } from "react";

import { Handle, Position } from "@xyflow/react";

import {
  SENTINEL_EMPTY,
  SENTINEL_FORCE00,
  SENTINEL_NULL,
} from "@/lib/nodes/constants";

export interface FieldWithHandleProps {
  handleId: string;
  connected?: boolean;
  label: string;
  placeholder?: string;
  value?: string;
  readOnly?: boolean;
  small?: boolean;
  rows?: number;
  autoResizeMaxRows?: number;
  onChange?: (val: string) => void;
  onLabelChange?: (val: string) => void;
  handleOffset?: number;
  disableHandle?: boolean;
  allowEmpty00?: boolean;
  allowEmptyBlank?: boolean;
  allowNull?: boolean;
  emptyLabel?: string;
  nullLabel?: string;
  comment?: string;
}

import { TerminalField } from "./TerminalField";

function fieldWithHandlePropsAreEqual(
  prev: FieldWithHandleProps,
  next: FieldWithHandleProps
) {
  return (
    prev.handleId === next.handleId &&
    prev.connected === next.connected &&
    prev.label === next.label &&
    prev.placeholder === next.placeholder &&
    prev.value === next.value &&
    prev.readOnly === next.readOnly &&
    prev.small === next.small &&
    prev.rows === next.rows &&
    prev.autoResizeMaxRows === next.autoResizeMaxRows &&
    prev.comment === next.comment &&
    prev.onChange === next.onChange &&
    prev.onLabelChange === next.onLabelChange &&
    prev.handleOffset === next.handleOffset &&
    prev.disableHandle === next.disableHandle &&
    prev.allowEmpty00 === next.allowEmpty00 &&
    prev.allowEmptyBlank === next.allowEmptyBlank &&
    prev.allowNull === next.allowNull &&
    prev.emptyLabel === next.emptyLabel &&
    prev.nullLabel === next.nullLabel
  );
}

/** Field + left target handle wrapper. */
export const FieldWithHandle = React.memo(function FieldWithHandleComponent({
  handleId,
  connected,
  label,
  placeholder,
  value,
  readOnly,
  small,
  rows,
  autoResizeMaxRows,
  comment,
  onChange,
  onLabelChange,
  handleOffset = 0,
  disableHandle = false,
  allowEmpty00 = false,
  allowEmptyBlank = false,
  allowNull = false,
  emptyLabel,
  nullLabel,
}: FieldWithHandleProps) {
  const displayValue =
    value === SENTINEL_EMPTY ||
    value === SENTINEL_FORCE00 ||
    value === SENTINEL_NULL
      ? value === SENTINEL_EMPTY
        ? emptyLabel ?? "empty"
        : value === SENTINEL_FORCE00
        ? "00"
        : nullLabel ?? "null"
      : value;

  const toggle00 = useCallback(
    (checked: boolean) => onChange?.(checked ? SENTINEL_FORCE00 : ""),
    [onChange]
  );

  const toggleBlank = useCallback(
    (checked: boolean) => onChange?.(checked ? SENTINEL_EMPTY : ""),
    [onChange]
  );

  const toggleNull = useCallback(
    (checked: boolean) => onChange?.(checked ? SENTINEL_NULL : ""),
    [onChange]
  );

  const forceReadOnly =
    connected ||
    value === SENTINEL_FORCE00 ||
    value === SENTINEL_EMPTY ||
    value === SENTINEL_NULL;

  return (
    <div className="relative mb-3">
      {!disableHandle && (
        <Handle
          type="target"
          position={Position.Left}
          id={handleId}
          className="!h-3 !w-3 !border-2 !border-primary !bg-background"
          style={{
            position: "absolute",
            left: handleOffset,
            top: "50%",
            transform: "translate(-50%, -50%)",
          }}
        />
      )}

      <TerminalField
        label={label}
        placeholder={placeholder}
        value={displayValue}
        readOnly={readOnly || forceReadOnly}
        small={small}
        rows={rows}
        autoResizeMaxRows={autoResizeMaxRows}
        comment={comment}
        onChange={onChange}
        onLabelChange={onLabelChange}
        allowEmpty00={allowEmpty00}
        allowEmptyBlank={allowEmptyBlank}
        allowNull={allowNull}
        emptyLabel={emptyLabel}
        nullLabel={nullLabel}
        is00={value === SENTINEL_FORCE00}
        isBlank={value === SENTINEL_EMPTY}
        isNull={value === SENTINEL_NULL}
        onToggle00={toggle00}
        onToggleBlank={toggleBlank}
        onToggleNull={toggleNull}
      />
    </div>
  );
}, fieldWithHandlePropsAreEqual);
