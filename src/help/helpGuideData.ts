// src/help/helpGuideData.ts
// Data for the "Help" reference: a static overview of every toolbar function,
// grouped. Consumed by the help menu's reference list.

import type { ComponentType } from "react";
import {
  ClipboardPaste,
  Copy,
  FileText,
  FileUp,
  Globe,
  MapPinned,
  Paintbrush,
  Palette,
  Save,
  Search,
  Share,
  Share2,
  Square,
  SquareMousePointer,
  SquareSplitVertical,
  X,
} from "lucide-react";

export type HelpIcon = ComponentType<{ className?: string }>;

export type HelpGuideItem = {
  title: string;
  body: string;
  moreInfo?: string[];
  icon: HelpIcon;
};

export type HelpGuideGroup = {
  title: string;
  items: HelpGuideItem[];
};

export const HELP_GUIDE_GROUPS: HelpGuideGroup[] = [
  {
    title: "Workspace",
    items: [
      {
        title: "Load",
        body: "Load a rawBit JSON file or open a shared rawBit link",
        moreInfo: [
          "Load JSON restores a normal rawBit save file.",
          "Load link accepts a rawBit link or share id and opens it in a new canvas tab.",
          "Simplified and LLM exports are one-way files; use normal Save when you need something loadable again.",
        ],
        icon: FileUp,
      },
      {
        title: "Save",
        body: "Save, share, or export the current flow",
        moreInfo: [
          "Save creates the normal rawBit JSON file that can be loaded back into rawBit.",
          "Share creates a link to the current flow. Create a new share after changes you want others to see.",
          "Simplified export creates a compact LLM-ready file with metadata removed, usually about 50% smaller.",
          "Simplified + backend also includes each node's backend function code for harder debugging or review.",
          "Hold S and click Save for simplified export, or hold L and click Save for simplified + backend.",
          "Both export modes include all nodes when nothing is selected, or only selected nodes and selected group contents when a selection is active.",
          "Simplified exports cannot be loaded back into rawBit.",
        ],
        icon: Save,
      },
      {
        title: "Close tab",
        body: "Close tabs or reset the workspace",
        moreInfo: [
          "Click the tab X to close that canvas tab.",
          "In the close dialog, use the dropdown arrow to change what will happen before confirming.",
          "The menu can close this tab, close all tabs, close other tabs, or reset the workspace.",
          "Reset workspace clears all tab data.",
          "Closing removes tab data from the workspace; save or share first if you need to keep it.",
        ],
        icon: X,
      },
    ],
  },
  {
    title: "Editing",
    items: [
      {
        title: "Copy",
        body: "Copy selected nodes, groups, and their connections",
        moreInfo: [
          "Use Ctrl/Cmd+C to copy the current selection.",
          "Copying a group also includes the nodes inside it.",
          "Copy includes the edges between copied nodes and groups.",
          "Copied content can be pasted inside the current tab or another tab.",
        ],
        icon: Copy,
      },
      {
        title: "Paste",
        body: "Place copied content on the canvas",
        moreInfo: [
          "Choose Paste, then click the canvas where the copied nodes should appear.",
          "Paste recreates only connections inside the copied selection.",
          "Paste with incoming connections also reconnects existing outside nodes into the pasted copy.",
          "Press Esc to cancel placement before clicking.",
          "Ctrl/Cmd+V pastes immediately near the cursor.",
        ],
        icon: ClipboardPaste,
      },
      {
        title: "Connect",
        body: "Wire two selected nodes or copy compatible inputs",
        moreInfo: [
          "Select exactly two nodes, then open Connect.",
          "Connect Edge lets you choose one source output and one or more free target inputs.",
          "Copy Inputs duplicates compatible incoming wires from the source node to the target node.",
          "Use the swap button when rawBit picked the opposite source and target direction.",
          "Inputs that are already wired are skipped.",
        ],
        icon: Share2,
      },
      {
        title: "Group",
        body: "Wrap selected nodes into a group",
        moreInfo: [
          "Select one or more top-level nodes, then click Group or press Ctrl/Cmd+G.",
          "rawBit creates a group around the selection and keeps the nodes inside it.",
          "Moving the group moves its child nodes with it.",
          "Dropping a node into a group can also make it part of that group.",
          "Groups do not nest inside other groups.",
        ],
        icon: Square,
      },
      {
        title: "Ungroup",
        body: "Break selected groups back into nodes",
        moreInfo: [
          "Select a group, then click Ungroup or press Ctrl/Cmd+U to remove the group container.",
          "The nodes inside stay in the same canvas positions and become selected.",
          "Selecting child nodes inside a group ungroups only those nodes.",
          "Edges stay connected to the same nodes.",
          "If only one group exists, Ungroup can target that group even without an explicit group selection.",
        ],
        icon: SquareSplitVertical,
      },
    ],
  },
  {
    title: "Canvas view",
    items: [
      {
        title: "Colour palette",
        body: "Apply colors to selected nodes or groups",
        icon: Palette,
      },
      {
        title: "Selection tool",
        body: "Toggle box selection, or hold S while dragging",
        icon: SquareMousePointer,
      },
      { title: "Info nodes", body: "Show or hide text info nodes", icon: FileText },
      {
        title: "Minimap",
        body: "Show or hide the map of the whole canvas",
        icon: MapPinned,
      },
      {
        title: "Search",
        body: "Open the search panel for nodes and labels",
        moreInfo: [
          "Search looks through node id, title, function name, comments, results, text info content, and input values.",
          "Multiple words are matched together, in any order.",
          "Wrap text in quotes to search for that exact phrase.",
          "Search for partial to find nodes with unwired inputs.",
          "Click a result to center that node and highlight the matched text when possible.",
        ],
        icon: Search,
      },
    ],
  },
  {
    title: "Sharing",
    items: [
      {
        title: "Share snapshot",
        body: "Create a shareable snapshot link",
        moreInfo: [
          "Share creates a read-only link to the current tab's flow.",
          "The link captures the current snapshot; changes made later need a new share link.",
          "The snapshot includes nodes, groups, edges, layout, and script debug steps.",
          "Temporary UI state such as search marks and highlights is removed before sharing.",
          "Anyone with the link can open the shared flow in rawBit.",
        ],
        icon: Share,
      },
      {
        title: "Community links",
        body: "Open rawBit links and contact channels",
        icon: Globe,
      },
    ],
  },
  {
    title: "Appearance",
    items: [
      {
        title: "Skin",
        body: "Choose the UI skin and canvas edge styling",
        moreInfo: [
          "Choose Shadcn, Paper Ledger, or Midnight Signal for the app appearance.",
          "The same menu adjusts edge thickness, normal edge opacity, and dashed edge opacity.",
          "Group fill controls how visible group backgrounds are.",
          "Edge and group controls follow the active light or dark theme mode.",
          "Skin and canvas style settings are saved in this browser.",
        ],
        icon: Paintbrush,
      },
    ],
  },
];
