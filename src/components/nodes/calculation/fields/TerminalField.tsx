import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useUnmountFlush } from "@/hooks/useUnmountFlush";

export interface TerminalFieldProps {
  label: string;
  placeholder?: string;
  value?: string;
  readOnly?: boolean;
  small?: boolean;
  rows?: number;
  autoResizeMaxRows?: number;
  maxDecimalValue?: number;
  onChange?: (val: string) => void;
  onFocus?: (val: string) => void;
  onBlur?: (val: string) => void;
  onLabelChange?: (val: string) => void;
  allowEmpty00?: boolean;
  allowEmptyBlank?: boolean;
  allowNull?: boolean;
  emptyLabel?: string;
  nullLabel?: string;
  comment?: string;
  is00?: boolean;
  isBlank?: boolean;
  isNull?: boolean;
  onToggle00?: (checked: boolean) => void;
  onToggleBlank?: (checked: boolean) => void;
  onToggleNull?: (checked: boolean) => void;
  fieldHandle?: React.ReactNode;
  className?: string;
  labelClassName?: string;
}

import { EditableLabel } from "./EditableLabel";

function terminalFieldPropsAreEqual(
  prev: TerminalFieldProps,
  next: TerminalFieldProps
) {
  return (
    prev.label === next.label &&
    prev.placeholder === next.placeholder &&
    prev.value === next.value &&
    prev.readOnly === next.readOnly &&
    prev.small === next.small &&
    prev.rows === next.rows &&
    prev.autoResizeMaxRows === next.autoResizeMaxRows &&
    prev.maxDecimalValue === next.maxDecimalValue &&
    prev.allowEmpty00 === next.allowEmpty00 &&
    prev.allowEmptyBlank === next.allowEmptyBlank &&
    prev.allowNull === next.allowNull &&
    prev.emptyLabel === next.emptyLabel &&
    prev.nullLabel === next.nullLabel &&
    prev.comment === next.comment &&
    prev.is00 === next.is00 &&
    prev.isBlank === next.isBlank &&
    prev.isNull === next.isNull &&
    prev.onChange === next.onChange &&
    prev.onFocus === next.onFocus &&
    prev.onBlur === next.onBlur &&
    prev.onLabelChange === next.onLabelChange &&
    prev.onToggle00 === next.onToggle00 &&
    prev.onToggleBlank === next.onToggleBlank &&
    prev.onToggleNull === next.onToggleNull &&
    prev.fieldHandle === next.fieldHandle &&
    prev.className === next.className &&
    prev.labelClassName === next.labelClassName
  );
}

/**
 * Terminal-style field (textarea + optional sentinel checkboxes).
 */
export const TerminalField = React.memo(function TerminalFieldComponent({
  label,
  placeholder,
  value,
  readOnly,
  small,
  rows,
  autoResizeMaxRows,
  maxDecimalValue,
  onChange,
  onFocus,
  onBlur,
  onLabelChange,
  allowEmpty00,
  allowEmptyBlank,
  allowNull,
  emptyLabel,
  nullLabel,
  comment,
  is00,
  isBlank,
  isNull,
  onToggle00,
  onToggleBlank,
  onToggleNull,
  fieldHandle,
  className,
  labelClassName,
}: TerminalFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const focusedRef = useRef(false);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(
    null
  );
  const textareaRows = autoResizeMaxRows ? 1 : rows ?? 3;
  const normalizedValue = value ?? "";
  const [draftValue, setDraftValue] = useState(normalizedValue);

  const clampDecimalValue = useCallback(
    (nextValue: string) => {
      if (
        maxDecimalValue === undefined ||
        !Number.isSafeInteger(maxDecimalValue) ||
        maxDecimalValue < 0 ||
        !/^\d+$/.test(nextValue)
      ) {
        return nextValue;
      }

      return BigInt(nextValue) > BigInt(maxDecimalValue)
        ? String(maxDecimalValue)
        : nextValue;
    },
    [maxDecimalValue]
  );

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;

    const onWheel = (event: WheelEvent) => {
      if (document.activeElement === ta) {
        event.stopPropagation();
        ta.scrollTop += event.deltaY;
      }
    };

    ta.addEventListener("wheel", onWheel, { passive: false });
    return () => ta.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    if (!focusedRef.current || readOnly) {
      setDraftValue(normalizedValue);
    }
  }, [normalizedValue, readOnly]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta || !autoResizeMaxRows) return;

    const computed = window.getComputedStyle(ta);
    const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
    const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
    const maxHeight =
      lineHeight * autoResizeMaxRows +
      paddingTop +
      paddingBottom +
      borderTop +
      borderBottom;

    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
    ta.style.overflowY = ta.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [autoResizeMaxRows, draftValue]);

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const selection = pendingSelectionRef.current;
    if (!ta || document.activeElement !== ta || !selection) return;

    const start = Math.min(selection.start, ta.value.length);
    const end = Math.min(selection.end, ta.value.length);
    ta.setSelectionRange(start, end);
    pendingSelectionRef.current = null;
  }, [draftValue]);

  const handleTextareaChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = clampDecimalValue(event.target.value);
      pendingSelectionRef.current = {
        start: event.target.selectionStart ?? nextValue.length,
        end: event.target.selectionEnd ?? nextValue.length,
      };
      setDraftValue(nextValue);
      onChange?.(nextValue);
    },
    [clampDecimalValue, onChange]
  );

  const handleTextareaFocus = useCallback(
    (event: React.FocusEvent<HTMLTextAreaElement>) => {
      focusedRef.current = true;
      setDraftValue(event.target.value);
      onFocus?.(event.target.value);
    },
    [onFocus]
  );

  const handleTextareaBlur = useCallback(
    (event: React.FocusEvent<HTMLTextAreaElement>) => {
      focusedRef.current = false;
      pendingSelectionRef.current = null;
      const nextValue = clampDecimalValue(event.target.value);
      setDraftValue(nextValue);
      onBlur?.(nextValue);
    },
    [clampDecimalValue, onBlur]
  );

  // Nodes unmount off-viewport (onlyRenderVisibleElements) without firing
  // blur, so blur-committing call sites (e.g. the Script Viewer hex field)
  // would silently lose the draft. Mirror a real blur on unmount — but only
  // for a focused, editable field with an actual pending change; readOnly
  // fields must never write back (a connected field's displayed upstream
  // value is not the user's edit).
  // Only a focused, editable field with a real pending change flushes on
  // unmount — readOnly (connected) fields must never write their displayed
  // upstream value back (that would reintroduce DA-05).
  useUnmountFlush({
    shouldFlush:
      focusedRef.current && !readOnly && draftValue !== normalizedValue,
    flush: () => onBlur?.(draftValue),
  });

  if (comment) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn("mb-3 cursor-help", className)}>
              <div
                className={cn(
                  "mb-1 flex items-center justify-between font-mono text-sm text-primary",
                  labelClassName
                )}
              >
                {onLabelChange ? (
                  <EditableLabel value={label} onCommit={onLabelChange} />
                ) : (
                  label
                )}

                <div className="flex items-center gap-3">
                  {allowEmpty00 && (
                    <div
                      className={cn(
                        "flex items-center gap-1 select-none",
                        is00 && "opacity-70"
                      )}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={is00}
                        onCheckedChange={(checked) => onToggle00?.(!!checked)}
                        className="h-4 w-4 rounded-sm border border-primary data-[state=checked]:bg-background data-[state=checked]:text-black dark:data-[state=checked]:text-white"
                      />
                      00
                    </div>
                  )}

                  {allowEmptyBlank && (
                    <div
                      className={cn(
                        "flex items-center gap-1 select-none",
                        isBlank && "opacity-70"
                      )}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={isBlank}
                        onCheckedChange={(checked) =>
                          onToggleBlank?.(!!checked)
                        }
                        className="h-4 w-4 rounded-sm border border-primary data-[state=checked]:bg-background data-[state=checked]:text-black dark:data-[state=checked]:text-white"
                      />
                      {emptyLabel ?? "Ø"}
                    </div>
                  )}

                  {allowNull && (
                    <div
                      className={cn(
                        "flex items-center gap-1 select-none",
                        isNull && "opacity-70"
                      )}
                      onPointerDownCapture={(event) => event.stopPropagation()}
                    >
                      <Checkbox
                        checked={isNull}
                        onCheckedChange={(checked) => onToggleNull?.(!!checked)}
                        className="h-4 w-4 rounded-sm border border-primary data-[state=checked]:bg-background data-[state=checked]:text-black dark:data-[state=checked]:text-white"
                      />
                      {nullLabel ?? "null"}
                    </div>
                  )}
                </div>
              </div>

              <div className="relative">
                {fieldHandle}
                <textarea
                  ref={textareaRef}
                  className={cn(
                    "field-surface nodrag block w-full resize-none rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
                    "text-sm p-2 font-mono transition-colors",
                    small ? "w-32" : "w-full",
                    (isBlank || is00 || isNull) && "text-muted-foreground",
                    readOnly ? "border-input" : "border-dashed border-input"
                  )}
                  placeholder={placeholder}
                  value={draftValue}
                  readOnly={readOnly}
                  rows={textareaRows}
                  inputMode={
                    maxDecimalValue === undefined ? undefined : "numeric"
                  }
                  spellCheck={false}
                  onChange={handleTextareaChange}
                  onFocus={handleTextareaFocus}
                  onBlur={handleTextareaBlur}
                  style={{
                    maxHeight: autoResizeMaxRows ? undefined : "200px",
                    overflowY: autoResizeMaxRows ? "hidden" : "auto",
                    cursor: readOnly ? "not-allowed" : "text",
                  }}
                />
              </div>
            </div>
          </TooltipTrigger>

          <TooltipContent side="top" align="center" className="max-w-xs">
            {comment}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className={cn("mb-3", className)}>
      <div
        className={cn(
          "mb-1 flex items-center justify-between font-mono text-sm text-primary",
          labelClassName
        )}
      >
        {onLabelChange ? (
          <EditableLabel value={label} onCommit={onLabelChange} />
        ) : (
          label
        )}

        <div className="flex items-center gap-3">
          {allowEmpty00 && (
            <div
              className={cn(
                "flex items-center gap-1 select-none",
                is00 && "opacity-70"
              )}
              onPointerDownCapture={(event) => event.stopPropagation()}
            >
              <Checkbox
                checked={is00}
                onCheckedChange={(checked) => onToggle00?.(!!checked)}
                className="h-4 w-4 rounded-sm border border-primary data-[state=checked]:bg-background data-[state=checked]:text-black dark:data-[state=checked]:text-white"
              />
              00
            </div>
          )}

          {allowEmptyBlank && (
            <div
              className={cn(
                "flex items-center gap-1 select-none",
                isBlank && "opacity-70"
              )}
              onPointerDownCapture={(event) => event.stopPropagation()}
            >
              <Checkbox
                checked={isBlank}
                onCheckedChange={(checked) => onToggleBlank?.(!!checked)}
                className="h-4 w-4 rounded-sm border border-primary data-[state=checked]:bg-background data-[state=checked]:text-black dark:data-[state=checked]:text-white"
              />
              {emptyLabel ?? "Ø"}
            </div>
          )}

          {allowNull && (
            <div
              className={cn(
                "flex items-center gap-1 select-none",
                isNull && "opacity-70"
              )}
              onPointerDownCapture={(event) => event.stopPropagation()}
            >
              <Checkbox
                checked={isNull}
                onCheckedChange={(checked) => onToggleNull?.(!!checked)}
                className="h-4 w-4 rounded-sm border border-primary data-[state=checked]:bg-background data-[state=checked]:text-black dark:data-[state=checked]:text-white"
              />
              {nullLabel ?? "null"}
            </div>
          )}
        </div>
      </div>

      <div className="relative">
        {fieldHandle}
        <textarea
          ref={textareaRef}
          className={cn(
            "field-surface nodrag block w-full resize-none rounded-md border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring",
            "text-sm p-2 font-mono transition-colors",
            small ? "w-32" : "w-full",
            (is00 || isBlank || isNull) && "text-muted-foreground",
            readOnly ? "border-input" : "border-dashed border-input"
          )}
          placeholder={placeholder}
          value={draftValue}
          readOnly={readOnly}
          rows={textareaRows}
          inputMode={maxDecimalValue === undefined ? undefined : "numeric"}
          spellCheck={false}
          onChange={handleTextareaChange}
          onFocus={handleTextareaFocus}
          onBlur={handleTextareaBlur}
          style={{
            maxHeight: autoResizeMaxRows ? undefined : "200px",
            overflowY: autoResizeMaxRows ? "hidden" : "auto",
            cursor: readOnly ? "not-allowed" : "text",
          }}
        />
      </div>
    </div>
  );
},
terminalFieldPropsAreEqual);
