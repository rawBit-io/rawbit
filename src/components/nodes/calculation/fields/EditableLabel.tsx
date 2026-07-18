import React, { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { useUnmountFlush } from "@/hooks/useUnmountFlush";

interface EditableLabelProps {
  value: string;
  onCommit: (value: string) => void;
  maxLength?: number;
  className?: string;
}

/** Inline editable label used for node titles and field captions. */
export function EditableLabel({
  value,
  onCommit,
  maxLength = 100,
  className = "",
}: EditableLabelProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [tmp, setTmp] = useState(value);

  useEffect(() => setTmp(value), [value]);

  // Flush an in-progress edit if the node is culled off-viewport before blur
  // fires. Escape resets tmp to value first (cancelled edits never commit);
  // the tmp !== value guard keeps no-op commits (and their snapshots) away.
  useUnmountFlush({
    shouldFlush: isEditing && tmp !== value,
    flush: () => onCommit(tmp || ""),
  });

  const commit = useCallback(() => {
    onCommit(tmp || "");
    setIsEditing(false);
  }, [onCommit, tmp]);

  const onKey = useCallback<React.KeyboardEventHandler<HTMLInputElement>>(
    (event) => {
      if (event.key === "Enter") commit();
      if (event.key === "Escape") {
        setTmp(value);
        setIsEditing(false);
      }
    },
    [commit, value]
  );

  return isEditing ? (
    <input
      value={tmp}
      onChange={(event) => setTmp(event.target.value.slice(0, maxLength))}
      onBlur={commit}
      onKeyDown={onKey}
      autoFocus
      className={cn(
        "nodrag w-full p-1 bg-transparent focus:outline-none focus:ring-2 focus:ring-primary",
        className
      )}
      style={{ userSelect: "text" }}
      draggable={false}
      onPointerDownCapture={(event) => event.stopPropagation()}
    />
  ) : (
    <div
      className={cn("cursor-pointer", className)}
      style={{ whiteSpace: "pre-wrap", userSelect: "none" }}
      title="Double click to edit"
      onDoubleClick={() => setIsEditing(true)}
    >
      {`> ${value}`}
    </div>
  );
}
