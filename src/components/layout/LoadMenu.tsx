// src/components/layout/LoadMenu.tsx

import { FileJson, Link2 } from "lucide-react";

import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

export interface LoadMenuProps {
  onLoadJson: () => void;
  onLoadLink: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function LoadMenuContent({
  onLoadJson,
  onLoadLink,
  onCloseAutoFocus,
}: LoadMenuProps) {
  return (
    <DropdownMenuContent
      align="start"
      side="bottom"
      className="w-64"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <DropdownMenuItem className="gap-2 py-1.5" onSelect={onLoadJson}>
        <FileJson className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col">
          <span className="text-sm leading-tight">Load JSON</span>
          <span className="text-xs leading-snug text-muted-foreground">
            Import a saved rawBit file
          </span>
        </span>
      </DropdownMenuItem>

      <DropdownMenuItem className="gap-2 py-1.5" onSelect={onLoadLink}>
        <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex min-w-0 flex-col">
          <span className="text-sm leading-tight">Load link</span>
          <span className="text-xs leading-snug text-muted-foreground">
            Open in a new rawBit tab
          </span>
        </span>
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
