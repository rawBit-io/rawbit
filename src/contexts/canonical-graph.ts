import { createContext, useContext } from "react";
import type { Edge } from "@xyflow/react";

import type { FlowNode } from "@/types";

export interface CanonicalGraphContextValue {
  nodes: FlowNode[];
  edges: Edge[];
}

export const CanonicalGraphContext =
  createContext<CanonicalGraphContextValue | null>(null);

export function useCanonicalGraph() {
  return useContext(CanonicalGraphContext);
}
