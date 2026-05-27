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
      { title: "Close tab", body: "Close a canvas tab when the X appears", icon: X },
    ],
  },
  {
    title: "Editing",
    items: [
      { title: "Copy", body: "Copy selected nodes, groups, and supported links", icon: Copy },
      { title: "Paste", body: "Paste copied canvas content", icon: ClipboardPaste },
      {
        title: "Connect",
        body: "Connect two selected nodes or copy compatible inputs",
        icon: Share2,
      },
      { title: "Group", body: "Wrap selected nodes into a group", icon: Square },
      {
        title: "Ungroup",
        body: "Break selected groups back into nodes",
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
        icon: Search,
      },
    ],
  },
  {
    title: "Sharing",
    items: [
      { title: "Share snapshot", body: "Create a shareable snapshot link", icon: Share },
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
        icon: Paintbrush,
      },
    ],
  },
];
