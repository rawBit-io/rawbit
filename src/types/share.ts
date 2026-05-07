import type { XYPosition } from "@xyflow/react";

export type SharedNodeData = Record<string, unknown>;

export interface SharedNode {
  id: string;
  type?: string;
  position: XYPosition;
  data: SharedNodeData;
  parentId?: string;
  extent?: unknown;
  width?: number;
  height?: number;
  dragHandle?: string;
}

export interface SharedEdge extends Record<string, unknown> {
  source: string;
  target: string;
}

export type SharedNodes<TNode extends SharedNode = SharedNode> = TNode[];
export type SharedEdges<TEdge extends SharedEdge = SharedEdge> = TEdge[];

export interface ShareGraph<
  TNode extends SharedNode = SharedNode,
  TEdge extends SharedEdge = SharedEdge
> {
  nodes: SharedNodes<TNode>;
  edges: SharedEdges<TEdge>;
}

export interface SharePayload<
  TNode extends SharedNode = SharedNode,
  TEdge extends SharedEdge = SharedEdge
> {
  name: string;
  schemaVersion: number;
  nodes: SharedNodes<TNode>;
  edges: SharedEdges<TEdge>;
}
