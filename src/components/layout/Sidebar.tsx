import React, { useState, useMemo } from "react";
import {
  Edit,
  FileCode,
  Shield,
  KeyRound,
  CheckCircle2,
  ArrowRightLeft,
  Hash,
  Search,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import type { NodeTemplate } from "@/types";
import { allSidebarNodes } from "@/components/sidebar-nodes";

// Import your array of custom flows
import {
  customFlows,
  type CustomFlowTemplate,
} from "@/my_tx_flows/customFlows";

export interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

function setSidebarDragPreview(
  dataTransfer: DataTransfer,
  sourceEl: Element
) {
  if (typeof document === "undefined" || !(sourceEl instanceof HTMLElement)) {
    return;
  }

  const rect = sourceEl.getBoundingClientRect();
  const computed = window.getComputedStyle(sourceEl);
  const ghost = sourceEl.cloneNode(true) as HTMLElement;

  Object.assign(ghost.style, {
    position: "fixed",
    top: "-1000px",
    left: "-1000px",
    pointerEvents: "none",
    zIndex: "2147483647",
    width: `${Math.max(1, rect.width)}px`,
    height: `${Math.max(1, rect.height)}px`,
    margin: "0",
    transform: "none",
    transition: "none",
    borderRadius: computed.borderRadius,
    overflow: "hidden",
    boxShadow: computed.boxShadow,
    opacity: "0.98",
  } as CSSStyleDeclaration);

  document.body.appendChild(ghost);
  dataTransfer.setDragImage(
    ghost,
    Math.min(18, Math.max(8, rect.width / 6)),
    Math.min(18, Math.max(8, rect.height / 4))
  );

  const cleanup = () => {
    ghost.remove();
    sourceEl.removeEventListener("dragend", cleanup);
  };
  sourceEl.addEventListener("dragend", cleanup, { once: true });
}

// Basic category definitions for your sidebar
const categories = [
  {
    id: "canvas-inputs",
    label: "Canvas & Inputs",
    icon: Edit,
    nodeFilter: (node: NodeTemplate) => node.category === "Canvas & Inputs",
  },
  {
    id: "encoding-script-data",
    label: "Encoding & Script Data",
    icon: ArrowRightLeft,
    nodeFilter: (node: NodeTemplate) =>
      node.category === "Encoding & Script Data",
  },
  {
    id: "transactions",
    label: "Transactions",
    icon: FileCode,
    nodeFilter: (node: NodeTemplate) => node.category === "Transactions",
  },
  {
    id: "keys-addresses",
    label: "Keys & Addresses",
    icon: KeyRound,
    nodeFilter: (node: NodeTemplate) => node.category === "Keys & Addresses",
  },
  {
    id: "hashes",
    label: "Hashes",
    icon: Hash,
    nodeFilter: (node: NodeTemplate) => node.category === "Hashes",
  },
  {
    id: "signing-verification",
    label: "Signing & Verification",
    icon: Shield,
    nodeFilter: (node: NodeTemplate) =>
      node.category === "Signing & Verification",
  },
  {
    id: "logic-checks",
    label: "Logic & Checks",
    icon: CheckCircle2,
    nodeFilter: (node: NodeTemplate) => node.category === "Logic & Checks",
  },
];

const MIN_NODES_FOR_SUBGROUPS = 5;
const subgroupAccordionClass =
  "ml-7 pl-2 space-y-1";
const subgroupTriggerClass =
  "rounded-md py-1.5 pl-2 pr-6 text-[14px] font-medium text-foreground hover:bg-accent/60 hover:no-underline data-[state=open]:bg-accent/40";
const subgroupLabelClass =
  "min-w-0 flex-1 whitespace-normal break-words pr-3 text-left leading-snug";
const subgroupContentClass = "pt-1 pb-1";
const subgroupItemsClass = "space-y-2 pb-1";
const TOP_LEVEL_FLOW_SECTION = "top-level";

const flowSections = [
  { id: "legacy-foundations", label: "Legacy Foundations" },
  {
    id: "scripts-timelocks-commitments",
    label: "Scripts, Timelocks & Commitments",
  },
  { id: "channels", label: "Channels" },
  { id: "segwit", label: "SegWit" },
  { id: "taproot-schnorr-musig", label: "Taproot, Schnorr & MuSig" },
  { id: "wallet-signing-labs", label: "Wallet & Signing Labs" },
  { id: "contributor-challenges", label: "Contributor / Challenge Flows" },
];

const searchCorrections: Record<string, string[]> = {
  un: ["uint", "unsigned"],
  unit: ["uint"],
  int: ["uint", "varint", "integer"],
  byte: ["bytes"],
  address: ["addr"],
  pubkey: ["public key", "pub key"],
  privkey: ["private key", "priv key"],
  transaction: ["tx"],
  sig: ["sign", "signature"],
  op: ["opcode", "Opcode"],
  len: ["length"],
  var: ["varint"],
  seq: ["sequence"],
  scr: ["script"],
};

function matchesSidebarSearch(searchableText: string, rawQuery: string) {
  const query = rawQuery.toLowerCase().trim();
  if (!query) return false;

  const text = searchableText.toLowerCase();
  if (text.includes(query)) return true;

  for (const [typo, corrections] of Object.entries(searchCorrections)) {
    if (
      query.startsWith(typo) &&
      corrections.some((correction) => text.includes(correction.toLowerCase()))
    ) {
      return true;
    }
  }

  const queryWords = query.split(/\s+/).filter(Boolean);
  if (queryWords.length > 1) {
    return queryWords.every((word) => text.includes(word));
  }

  return false;
}

function groupNodesBySubcategory(nodes: NodeTemplate[]) {
  const groups = new Map<string, NodeTemplate[]>();
  nodes.forEach((node) => {
    const label = node.subcategory?.trim() || "General";
    groups.set(label, [...(groups.get(label) ?? []), node]);
  });
  return Array.from(groups, ([label, items]) => ({ label, items }));
}

function getNodeDisplayGroups(nodes: NodeTemplate[]) {
  const groups = groupNodesBySubcategory(nodes);
  const namedGroups = groups.filter((group) => group.label !== "General");

  if (nodes.length < MIN_NODES_FOR_SUBGROUPS || namedGroups.length === 0) {
    return { subcategoryGroups: [], flatNodes: nodes };
  }

  return { subcategoryGroups: groups, flatNodes: [] };
}

function formatNodeCategory(node: NodeTemplate) {
  if (!node.subcategory || node.subcategory === "General") {
    return node.category;
  }
  return `${node.category} / ${node.subcategory}`;
}

function formatFlowLabel(flow: CustomFlowTemplate) {
  return flow.lessonNo ? `${flow.lessonNo}. ${flow.label}` : flow.label;
}

function getFlowSearchText(flow: CustomFlowTemplate) {
  return [
    flow.id,
    flow.label,
    flow.level,
    flow.lessonNo ? String(flow.lessonNo) : "",
    flow.lessonNo ? `lesson ${flow.lessonNo}` : "",
    flow.lessonNo ? `lesson ${flow.lessonNo} ${flow.label}` : "",
    ...flow.tags,
  ].join(" ");
}

// Use the existing SidebarProps from your code
export function Sidebar({ isOpen }: SidebarProps) {
  const [openCategories, setOpenCategories] = useState<string[]>([
    "canvas-inputs",
  ]);
  const [openSubcategories, setOpenSubcategories] = useState<
    Record<string, string[]>
  >({});
  const [openFlowSections, setOpenFlowSections] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const envBadge =
    (import.meta.env.VITE_ENV_LABEL &&
      import.meta.env.VITE_ENV_LABEL.trim()) ||
    (import.meta.env.DEV ? "local" : "");
  const envLabel = envBadge ? `(${envBadge})` : "";

  // Filter nodes by search (for the main node templates)
  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();

    return allSidebarNodes.filter((node) => {
      // Create a combined searchable text from all relevant fields
      const searchableText = [
        node.label,
        node.description || "",
        node.functionName,
        node.nodeData.title || "",
        node.category || "",
        node.subcategory || "",
        // Also include the label without special characters
        node.label.replace(/[→←\-_\s]/g, ""),
      ].join(" ");

      return matchesSidebarSearch(searchableText, query);
    });
  }, [searchQuery]);

  const filteredFlows = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return customFlows.filter((flow) =>
      matchesSidebarSearch(getFlowSearchText(flow), searchQuery)
    );
  }, [searchQuery]);

  const totalSearchResults = filteredNodes.length + filteredFlows.length;

  const groupedFlows = useMemo(() => {
    const groups = new Map<string, typeof customFlows>();
    customFlows.forEach((flow) => {
      if (flow.section === TOP_LEVEL_FLOW_SECTION) return;
      const section = flow.section || "other-flows";
      groups.set(section, [...(groups.get(section) ?? []), flow]);
    });

    const ordered = flowSections
      .map((section) => ({
        ...section,
        items: groups.get(section.id) ?? [],
      }))
      .filter((section) => section.items.length > 0);

    const otherFlows = groups.get("other-flows") ?? [];
    if (otherFlows.length) {
      ordered.push({ id: "other-flows", label: "Other Flows", items: otherFlows });
    }

    return ordered;
  }, []);
  const topLevelFlows = useMemo(
    () => customFlows.filter((flow) => flow.section === TOP_LEVEL_FLOW_SECTION),
    []
  );

  // Standard drag logic for normal single nodes
  const onDragStart = (event: React.DragEvent, node: NodeTemplate) => {
    const dragData = {
      type: node.type,
      functionName: node.functionName,
      nodeData: node.nodeData,
    };
    event.dataTransfer.setData(
      "application/reactflow",
      JSON.stringify(dragData)
    );
    event.dataTransfer.effectAllowed = "move";
    setSidebarDragPreview(event.dataTransfer, event.currentTarget);
  };

  const onFlowDragStart = (
    event: React.DragEvent,
    flow: CustomFlowTemplate
  ) => {
    const dragObj = {
      type: "calculation",
      functionName: "flow_template",
      nodeData: {
        flowData: flow.data,
        flowLabel: flow.label,
      },
    };
    event.dataTransfer.setData("application/reactflow", JSON.stringify(dragObj));
    event.dataTransfer.effectAllowed = "move";
    setSidebarDragPreview(event.dataTransfer, event.currentTarget);
  };

  const clearSearch = () => setSearchQuery("");

  const renderNodeCard = (node: NodeTemplate, className?: string) => (
    <div
      key={`${node.functionName}-${node.label}`}
      draggable
      onDragStart={(e) => onDragStart(e, node)}
      className={cn(
        "flex cursor-grab items-center rounded-md border bg-card p-3 hover:bg-accent transition-colors",
        className
      )}
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium">{node.label}</span>
        {node.description && (
          <span className="text-xs text-muted-foreground">
            {node.description}
          </span>
        )}
      </div>
    </div>
  );

  const renderSearchNodeCard = (node: NodeTemplate) => (
    <div
      key={`${node.functionName}-${node.label}`}
      draggable
      onDragStart={(e) => onDragStart(e, node)}
      className="flex cursor-grab items-center rounded-md border bg-card p-3 hover:bg-accent transition-colors"
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium">{node.label}</span>
        {node.description && (
          <span className="text-xs text-muted-foreground">
            {node.description}
          </span>
        )}
        <span className="text-xs text-muted-foreground mt-1">
          Category: {formatNodeCategory(node)}
        </span>
      </div>
    </div>
  );

  const renderFlowCard = (flow: CustomFlowTemplate, className?: string) => (
    <div
      key={flow.id}
      draggable
      onDragStart={(event) => onFlowDragStart(event, flow)}
      className={cn(
        "flex cursor-grab items-center rounded-md border bg-card p-3 hover:bg-accent transition-colors",
        className
      )}
    >
      <div className="flex flex-col">
        <span className="text-sm font-medium">{formatFlowLabel(flow)}</span>
        <span className="text-xs text-muted-foreground mt-1">
          Drag to place entire subgraph
        </span>
      </div>
    </div>
  );

  // Expand/collapse logic for categories
  const handleCategoryChange = (value: string) => {
    setOpenCategories((prev) => {
      if (prev.includes(value)) {
        return prev.filter((id) => id !== value);
      }
      return [...prev, value];
    });
  };

  const handleSubcategoryChange = (categoryId: string, value: string[]) => {
    setOpenSubcategories((prev) => ({
      ...prev,
      [categoryId]: value,
    }));
  };

  return (
    <div
      className={cn(
        "fixed left-0 top-0 z-20 h-screen flex flex-col transition-all duration-300 border-r bg-background select-none overflow-hidden",
        isOpen ? "w-64" : "w-0"
      )}
      data-testid="sidebar"
      style={{ pointerEvents: isOpen ? "auto" : "none" }}
    >
      {/* Header */}
      <div className="flex h-14 items-center px-6 border-b overflow-hidden">
        <span
          className={cn(
            "text-xl font-medium tracking-tight transition-opacity duration-300",
            isOpen ? "opacity-100" : "opacity-0"
          )}
        >
          raw
          <span
            className="text-primary"
            data-testid="sidebar-brand-bit"
          >
            <span className="inline-block rotate-[14deg]">₿</span>it
          </span>
          {envLabel && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {envLabel}
            </span>
          )}
        </span>
      </div>

      {/* Search box */}
      <div className="px-3 pt-2 pb-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            id="sidebar-search"
            name="sidebarSearch"
            placeholder="Search nodes..."
            className="pl-8 pr-8 h-8 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            /* Disable browser spell‑check and auto‑features */
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {searchQuery && (
            <button
              className="absolute right-2.5 top-2.5"
              onClick={clearSearch}
              aria-label="Clear search"
            >
              <X className="h-4 w-4 text-muted-foreground hover:text-foreground transition-colors" />
            </button>
          )}
        </div>
      </div>

      <div
        className={cn(
          "flex-1 overflow-y-auto p-3 transition-opacity duration-300",
          isOpen ? "opacity-100" : "opacity-0"
        )}
        style={{
          maxHeight: "calc(100vh - 6.5rem)",
        }}
      >
        {/* If searching, show filtered results instead of categories */}
        {searchQuery ? (
          <div className="space-y-2">
            {totalSearchResults > 0 ? (
              <>
                <div className="px-2 py-1.5 text-sm text-muted-foreground">
                  Found {totalSearchResults} result
                  {totalSearchResults !== 1 ? "s" : ""}
                </div>
                {filteredNodes.length > 0 && (
                  <div className="space-y-2">
                    {filteredFlows.length > 0 && (
                      <div className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">
                        Nodes
                      </div>
                    )}
                    {filteredNodes.map((node) => renderSearchNodeCard(node))}
                  </div>
                )}
                {filteredFlows.length > 0 && (
                  <div className="space-y-2">
                    {filteredNodes.length > 0 && (
                      <div className="px-2 py-1 text-xs font-medium uppercase text-muted-foreground">
                        Lessons
                      </div>
                    )}
                    {filteredFlows.map((flow) => renderFlowCard(flow))}
                  </div>
                )}
              </>
            ) : (
              <div className="p-4 text-sm text-muted-foreground rounded-md bg-muted/50 text-center">
                No matching nodes or lessons found
              </div>
            )}
          </div>
        ) : (
          // Normal Category View
          <Accordion
            type="multiple"
            value={openCategories}
            onValueChange={(value) => setOpenCategories(value)}
            className="w-full space-y-1"
          >
            {/* 1) Standard categories */}
            {categories.map((cat) => {
              const catNodes = allSidebarNodes.filter(cat.nodeFilter);
              const { subcategoryGroups, flatNodes } =
                getNodeDisplayGroups(catNodes);
              const useSubgroups = subcategoryGroups.length > 0;
              const CatIcon = cat.icon;

              return (
                <AccordionItem
                  key={cat.id}
                  value={cat.id}
                  className="border-none"
                >
                  <AccordionTrigger
                    className="flex items-center py-2 pl-2 pr-6 rounded-md hover:bg-accent hover:no-underline"
                    onClick={(e) => {
                      e.preventDefault();
                      handleCategoryChange(cat.id);
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-2 pr-4">
                      <CatIcon className="h-4 w-4 shrink-0 mt-0.5" />
                      <span className="text-[15px] font-medium whitespace-normal break-words">
                        {cat.label}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-0 pb-0 px-0">
                    {catNodes.length > 0 ? (
                      <div className="space-y-1.5 pb-0.5">
                        {flatNodes.map((node) => renderNodeCard(node, "ml-8"))}
                        {useSubgroups && (
                          <Accordion
                            type="multiple"
                            value={openSubcategories[cat.id] ?? []}
                            onValueChange={(value) =>
                              handleSubcategoryChange(cat.id, value)
                            }
                            className={subgroupAccordionClass}
                          >
                            {subcategoryGroups.map((group) => (
                              <AccordionItem
                                key={`${cat.id}-${group.label}`}
                                value={group.label}
                                className="border-none"
                              >
                                <AccordionTrigger
                                  className={subgroupTriggerClass}
                                >
                                  <span className={subgroupLabelClass}>
                                    {group.label}
                                  </span>
                                </AccordionTrigger>
                                <AccordionContent
                                  className={subgroupContentClass}
                                >
                                  <div className={subgroupItemsClass}>
                                    {group.items.map((node) =>
                                      renderNodeCard(node)
                                    )}
                                  </div>
                                </AccordionContent>
                              </AccordionItem>
                            ))}
                          </Accordion>
                        )}
                      </div>
                    ) : (
                      <div className="ml-4 p-3 text-sm text-muted-foreground rounded-md bg-muted/50">
                        No items available
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}

            {/* 2) My Custom Flows => also drag-and-drop */}
            <AccordionItem
              key="my-custom-flows"
              value="my-custom-flows"
              className="border-none"
            >
              <AccordionTrigger
                className="flex items-center py-2 pl-2 pr-6 rounded-md hover:bg-accent hover:no-underline"
                onClick={(e) => {
                  e.preventDefault();
                  handleCategoryChange("my-custom-flows");
                }}
              >
                <div className="flex min-w-0 flex-1 items-start gap-2 pr-4">
                  <FileCode className="h-4 w-4 shrink-0 mt-0.5" />
                  <span className="text-[15px] font-medium whitespace-normal break-words">
                    Flow Examples
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pt-0 pb-0 px-0">
                {customFlows.length > 0 ? (
                  <div className="space-y-1.5 pb-0.5">
                    {topLevelFlows.map((flow) => renderFlowCard(flow, "ml-8"))}
                    {groupedFlows.length > 0 && (
                      <Accordion
                        type="multiple"
                        value={openFlowSections}
                        onValueChange={setOpenFlowSections}
                        className={cn(subgroupAccordionClass, "pb-0.5")}
                      >
                        {groupedFlows.map((section) => (
                          <AccordionItem
                            key={section.id}
                            value={section.id}
                            className="border-none"
                          >
                            <AccordionTrigger className={subgroupTriggerClass}>
                              <span className={subgroupLabelClass}>
                                {section.label}
                              </span>
                            </AccordionTrigger>
                            <AccordionContent className={subgroupContentClass}>
                              <div className={subgroupItemsClass}>
                                {section.items.map((flow) =>
                                  renderFlowCard(flow)
                                )}
                              </div>
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    )}
                  </div>
                ) : (
                  <div className="ml-4 p-3 text-sm text-muted-foreground rounded-md bg-muted/50">
                    No custom flows found
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}
      </div>
    </div>
  );
}
