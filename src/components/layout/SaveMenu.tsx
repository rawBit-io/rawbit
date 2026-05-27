// src/components/layout/SaveMenu.tsx
// The Save button's dropdown content. A compact flat list: the reloadable save,
// then the two one-way LLM exports under a shared "LLM · one-way" header (so the
// per-item text doesn't repeat "LLM" / "one-way"). The hold-S / hold-L shortcut
// still works from the toolbar button; it's documented in Help, not shown here.
// Item text is matched by the unit + e2e tests — see the matchers there.

import { FileCode, FileSliders, Save } from "lucide-react";

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export interface SaveMenuProps {
  onSave: () => void;
  onSaveSimplified: () => void | Promise<void>;
  onSaveLlmExport: () => void | Promise<void>;
  onCloseAutoFocus?: (event: Event) => void;
}

const EXPORTS = [
  {
    label: "Simplified",
    detail: "Metadata removed, ~50% smaller",
    icon: FileSliders,
  },
  {
    label: "Simplified + backend code",
    detail: "Includes each node's function source",
    icon: FileCode,
  },
];

export function SaveMenuContent({
  onSave,
  onSaveSimplified,
  onSaveLlmExport,
  onCloseAutoFocus,
}: SaveMenuProps) {
  const handlers = [
    () => void onSaveSimplified(),
    () => void onSaveLlmExport(),
  ];

  return (
    <DropdownMenuContent
      align="start"
      side="bottom"
      className="w-64"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <DropdownMenuItem className="gap-2 py-1.5" onSelect={onSave}>
        <Save className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col">
          <span className="text-sm leading-tight">Save</span>
          <span className="text-xs leading-snug text-muted-foreground">
            Reloadable rawBit JSON
          </span>
        </span>
      </DropdownMenuItem>

      <DropdownMenuSeparator className="my-1" />
      <DropdownMenuLabel className="px-2 pb-0.5 pt-0.5 text-[10px] font-medium uppercase tracking-normal text-muted-foreground">
        LLM · one-way
      </DropdownMenuLabel>

      {EXPORTS.map((action, index) => {
        const Icon = action.icon;
        return (
          <DropdownMenuItem
            key={action.label}
            className="gap-2 py-1.5"
            onSelect={handlers[index]}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex min-w-0 flex-col">
              <span className="text-sm leading-tight">{action.label}</span>
              <span className="text-xs leading-snug text-muted-foreground">
                {action.detail}
              </span>
            </span>
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuContent>
  );
}
