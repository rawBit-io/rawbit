import React, { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface EditableLabelProps {
  value: string;
  onCommit: (value: string) => void;
  onDraftChange?: (value: string | null) => void;
  editSignal?: number;
  maxLength?: number;
  className?: string;
  readOnlyStyle?: React.CSSProperties;
  editingClassName?: string;
  fontSize?: number;
  fallback?: string;
  sanitizeInput?: (value: string) => string;
}

/**
 * Reusable inline editable label used by node headers.
 * Supports double-click to edit with escape/enter handling and
 * optional font-size override.
 */
export function EditableLabel({
  value,
  onCommit,
  onDraftChange,
  editSignal,
  maxLength = 100,
  className = "",
  readOnlyStyle,
  editingClassName = "",
  fontSize = 16,
  fallback = "Group Node",
  sanitizeInput = (nextValue) => nextValue,
}: EditableLabelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);
  const lastEditSignalRef = useRef(editSignal);

  useEffect(() => setTempValue(value), [value]);

  const labelStyle: React.CSSProperties = {
    fontSize,
    fontWeight: 400,
  };

  const startEditing = useCallback(() => {
    setTempValue(value);
    setIsEditing(true);
    onDraftChange?.(value);
  }, [onDraftChange, value]);

  const stopEditing = useCallback(() => {
    setIsEditing(false);
    onDraftChange?.(null);
  }, [onDraftChange]);

  const commit = useCallback(() => {
    onCommit(tempValue.trim().length ? tempValue : fallback);
    stopEditing();
  }, [fallback, onCommit, stopEditing, tempValue]);

  useEffect(() => {
    if (lastEditSignalRef.current === editSignal) return;
    lastEditSignalRef.current = editSignal;
    if (editSignal == null) return;
    startEditing();
  }, [editSignal, startEditing]);

  if (!isEditing) {
    return (
      <button
        className={cn(
          "text-left truncate w-full p-0 bg-transparent focus:outline-none",
          className
        )}
        style={{
          ...labelStyle,
          userSelect: "text",
          whiteSpace: "pre",
          ...readOnlyStyle,
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          startEditing();
        }}
        title="Double-click to rename"
      >
        {value || fallback}
      </button>
    );
  }

  return (
    <input
      className={cn(
        "w-full bg-transparent rounded-sm px-1 py-0.5 border border-input",
        "focus:outline-none focus:ring-2 focus:ring-primary",
        className,
        editingClassName
      )}
      style={labelStyle}
      autoFocus
      value={tempValue}
      maxLength={maxLength}
      onChange={(event) => {
        const nextValue = sanitizeInput(event.target.value);
        setTempValue(nextValue);
        onDraftChange?.(nextValue);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          commit();
        } else if (event.key === "Escape") {
          stopEditing();
        }
      }}
      onBlur={commit}
    />
  );
}
