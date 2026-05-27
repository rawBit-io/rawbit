// src/help/helpGuideData.ts
// Data for the "Help" reference: a static overview of every toolbar function,
// grouped. Consumed by the help menu's reference list.

import type { ComponentType } from "react";
import {
  Check,
  CircleHelp,
  ClipboardPaste,
  Copy,
  FileText,
  FileUp,
  Github,
  Globe,
  History,
  Mail,
  MapPinned,
  Minus,
  Moon,
  Paintbrush,
  Palette,
  PanelLeft,
  Plus,
  Redo,
  Save,
  Search,
  Share,
  Share2,
  Square,
  SquareMousePointer,
  SquareSplitVertical,
  Sun,
  Twitter,
  Undo,
  X,
  Youtube,
} from "lucide-react";

import { HelpDiscordIcon } from "./HelpDiscordIcon";

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
      { title: "Sidebar", body: "Open or collapse the node library", icon: PanelLeft },
      { title: "Load", body: "Import a saved rawBit JSON flow", icon: FileUp },
      {
        title: "Save",
        body: "Click Save for a reloadable flow, or hold S / L while clicking Save for LLM-ready exports",
        moreInfo: [
          "Save creates the normal rawBit JSON file that can be loaded back into rawBit.",
          "S + Save creates a compact LLM-ready export with metadata removed, usually about 50% smaller.",
          "L + Save creates a deeper LLM-ready export that also includes backend code for every node.",
          "Use L when the question depends on how node functions work internally.",
          "Both export modes include all nodes when nothing is selected, or only selected nodes and selected group contents when a selection is active.",
          "Simplified and LLM exports are one-way exports; they cannot be loaded back into rawBit.",
        ],
        icon: Save,
      },
      { title: "New tab", body: "Create another canvas tab", icon: Plus },
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
      { title: "Undo", body: "Step back through canvas changes", icon: Undo },
      { title: "Redo", body: "Replay an undone canvas change", icon: Redo },
      { title: "History", body: "Open the undo and redo history panel", icon: History },
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
      { title: "GitHub", body: "Open the project repository", icon: Github },
      { title: "X / Twitter", body: "Open rawBit social updates", icon: Twitter },
      { title: "YouTube", body: "Open rawBit videos and demos", icon: Youtube },
      { title: "Discord", body: "Join the community chat", icon: HelpDiscordIcon },
      { title: "Email", body: "Contact rawBit by email", icon: Mail },
      { title: "Help", body: "Open this panel and guided demos", icon: CircleHelp },
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
      {
        title: "Selected skin",
        body: "Marks the active skin inside the skin menu",
        icon: Check,
      },
      {
        title: "Decrease",
        body: "Lower edge thickness or opacity in the skin menu",
        icon: Minus,
      },
      {
        title: "Increase",
        body: "Raise edge thickness or opacity in the skin menu",
        icon: Plus,
      },
      { title: "Light mode", body: "Switch to the light theme", icon: Sun },
      { title: "Dark mode", body: "Switch to the dark theme", icon: Moon },
    ],
  },
];
