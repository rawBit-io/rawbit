import React, { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useUnmountFlush } from "@/hooks/useUnmountFlush";

interface EditableLabelProps {
  value: string;
  onCommit: (value: string) => void;
  onDraftChange?: (value: string | null) => void;
  /**
   * When true, the PARENT is responsible for committing an in-progress edit on
   * unmount (e.g. GroupNode, which holds the draft via onDraftChange), so this
   * component skips its own unmount flush to avoid a double-commit. Defaults to
   * `onDraftChange != null` for back-compat; a consumer that uses onDraftChange
   * only for live preview (and does NOT own the flush) should pass `false`.
   */
  parentOwnsUnmountFlush?: boolean;
  editSignal?: number;
  maxLength?: number;
  className?: string;
  readOnlyStyle?: React.CSSProperties;
  editingClassName?: string;
  fontSize?: number;
  fallback?: string;
  sanitizeInput?: (value: string) => string;
  ariaLabel?: string;
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
  parentOwnsUnmountFlush,
  editSignal,
  maxLength = 100,
  className = "",
  readOnlyStyle,
  editingClassName = "",
  fontSize = 16,
  fallback = "Group Node",
  sanitizeInput = (nextValue) => nextValue,
  ariaLabel,
}: EditableLabelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);
  const lastEditSignalRef = useRef(editSignal);

  useEffect(() => setTempValue(value), [value]);

  // Flush an in-progress edit if the node is culled off-viewport before blur
  // fires — unless the parent owns that flush (see parentOwnsUnmountFlush).
  // Escape exits editing first, so cancelled edits never reach the flush.
  const ownedByParent = parentOwnsUnmountFlush ?? onDraftChange != null;
  useUnmountFlush({
    shouldFlush: !ownedByParent && isEditing && tempValue !== value,
    flush: () =>
      onCommit(tempValue.trim().length ? tempValue : fallback),
  });

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
        aria-label={ariaLabel}
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
      aria-label={ariaLabel}
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
