import type { FlowNode } from "@/types";
import type { Edge } from "@xyflow/react";

// Import your saved JSON
import savedFlow from "@/my_tx_flows/misc/empty.json";


// Then just cast them:
export const defaultNodes = savedFlow.nodes as FlowNode[];
export const defaultEdges = savedFlow.edges as Edge[];
