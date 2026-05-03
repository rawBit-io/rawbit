import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import { Sidebar } from "../Sidebar";
import type { NodeTemplate } from "@/types";
import { createDataTransfer } from "@/test-utils/dom";

function createSidebarNodes(): NodeTemplate[] {
  const transactionBuilders: NodeTemplate[] = Array.from(
    { length: 5 },
    (_, index) => ({
      functionName: `tx_builder_${index}`,
      label: `TX Builder ${index + 1}`,
      nodeData: { title: `TX Builder ${index + 1}` },
      category: "Transactions",
      subcategory: "Builders",
      type: "calculation",
    })
  );

  return [
    {
      functionName: "uint_to_hex",
      label: "Uint Parser",
      nodeData: { title: "Uint Parser" },
      category: "Canvas & Inputs",
      subcategory: "General",
      type: "calculation",
      description: "Parses uint values",
    },
    {
      functionName: "hash_util",
      label: "Hash Node",
      nodeData: { title: "Hash Node" },
      category: "Hashes",
      subcategory: "General",
      type: "calculation",
    },
    {
      functionName: "tx_parser",
      label: "TX Parser",
      nodeData: { title: "TX Parser" },
      category: "Transactions",
      subcategory: "Parsing & Inspection",
      type: "calculation",
    },
    ...transactionBuilders,
  ];
}

function createCustomFlows() {
  return [
    {
      id: "custom-flow",
      label: "Custom Flow",
      data: {
        nodes: [],
        edges: [],
      },
      section: "legacy-foundations",
      lessonNo: 1,
      level: "intro",
      tags: ["legacy"],
    },
    {
      id: "intro-flow",
      label: "Intro",
      data: {
        nodes: [],
        edges: [],
      },
      section: "top-level",
      lessonNo: 0,
      level: "intro",
      tags: ["intro"],
    },
  ];
}

const customFlowFixture = createCustomFlows();

vi.mock("@/components/sidebar-nodes", () => ({
  allSidebarNodes: createSidebarNodes(),
}));

vi.mock("@/my_tx_flows/customFlows", () => ({
  customFlows: createCustomFlows(),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ENV_LABEL", "staging");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const renderSidebar = () => render(<Sidebar isOpen onToggle={() => undefined} />);

  it("shows environment badge when label is set", () => {
    renderSidebar();
    expect(screen.getByText(/raw/i)).toHaveTextContent(/raw₿it\s*\(staging\)/i);
    expect(screen.getByTestId("sidebar-brand-bit")).toHaveClass("text-primary");
  });

  it("supports typo-tolerant search results", () => {
    renderSidebar();
    const input = screen.getByPlaceholderText("Search nodes...");
    fireEvent.change(input, { target: { value: "un" } });
    expect(screen.getByText("Uint Parser")).toBeInTheDocument();
    expect(screen.getByText(/Found 1 result/i)).toBeInTheDocument();
  });

  it("shows matching flow examples in search results", () => {
    renderSidebar();
    const input = screen.getByPlaceholderText("Search nodes...");
    fireEvent.change(input, { target: { value: "custom" } });

    const customFlowCard = screen.getByText("1. Custom Flow").closest("div");
    expect(customFlowCard).not.toBeNull();
    expect(screen.getByText("Drag to place entire subgraph")).toBeInTheDocument();
    expect(screen.getByText(/Found 1 result/i)).toBeInTheDocument();
  });

  it("emits drag payloads for standard nodes", () => {
    renderSidebar();
    const card = screen.getByText("Uint Parser").closest("div");
    expect(card).not.toBeNull();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(card!, { dataTransfer });
    fireEvent.dragEnd(card!);

    const payload = dataTransfer.getData("application/reactflow");
    const parsed = JSON.parse(payload);
    expect(parsed).toMatchObject({
      functionName: "uint_to_hex",
      nodeData: { title: "Uint Parser" },
    });
  });

  it("keeps small categories flat and renders subgrouped categories only as dropdowns", () => {
    renderSidebar();

    expect(screen.getByText("Uint Parser")).toBeInTheDocument();
    expect(screen.queryByText("General")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Transactions"));

    expect(screen.getByText("Builders")).toBeInTheDocument();
    expect(screen.getByText("Parsing & Inspection")).toBeInTheDocument();
    expect(screen.queryByText("TX Parser")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Parsing & Inspection"));
    expect(screen.getByText("TX Parser")).toBeInTheDocument();
  });

  it("renders Flow Examples accordion and drag payload includes subgraph data", () => {
    renderSidebar();

    const examplesTrigger = screen.getByText("Flow Examples");
    fireEvent.click(examplesTrigger);
    expect(screen.getByText("Intro")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Legacy Foundations/i })
    ).toBeInTheDocument();
    expect(screen.queryByText("1. Custom Flow")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Legacy Foundations/i }));
    const customFlowCard = screen.getByText("1. Custom Flow").closest("div");
    expect(customFlowCard).not.toBeNull();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(customFlowCard!, { dataTransfer });
    fireEvent.dragEnd(customFlowCard!);
    const payload = dataTransfer.getData("application/reactflow");
    const parsed = JSON.parse(payload);

    expect(parsed).toMatchObject({
      type: "calculation",
      functionName: "flow_template",
      nodeData: { flowLabel: "Custom Flow", flowData: customFlowFixture[0].data },
    });
  });
});
