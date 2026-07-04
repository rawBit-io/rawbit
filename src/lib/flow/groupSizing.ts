// src/lib/flow/groupSizing.ts
// ---------------------------------------------------------------------
// Pure group auto-fit: enlarge a "shadcnGroup" so all direct children fit.
// When a child sits left/above the padding origin, the group origin is
// compensated by the same shift so existing children keep their absolute
// canvas position — the frame grows top-left instead of jolting every
// child down-right (NB-05). Origin is relative to the group's own parent,
// so the same math holds for nested groups; growing an inner group can
// overflow its parent, hence the ancestor-cascading variant.
// ---------------------------------------------------------------------

import type { FlowNode } from "@/types";

const GROUP_PADDING = 32;

const asFiniteNumber = (value: unknown): number | undefined => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const getNodeDimension = (
  node: FlowNode,
  axis: "width" | "height",
  fallback: number
): number =>
  Math.max(
    asFiniteNumber(node.data?.[axis]) ?? 0,
    asFiniteNumber(node[axis]) ?? 0,
    asFiniteNumber(node.measured?.[axis]) ?? 0,
    fallback
  );

export const fitGroupToChildrenInNodes = (
  nodes: FlowNode[],
  groupId: string
): FlowNode[] => {
  const group = nodes.find(
    (node) => node.id === groupId && node.type === "shadcnGroup"
  );
  if (!group) return nodes;

  const children = nodes.filter((node) => node.parentId === groupId);
  if (!children.length) return nodes;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  children.forEach((child) => {
    const width = getNodeDimension(child, "width", 250);
    const height = getNodeDimension(child, "height", 150);
    minX = Math.min(minX, child.position.x);
    minY = Math.min(minY, child.position.y);
    maxX = Math.max(maxX, child.position.x + width);
    maxY = Math.max(maxY, child.position.y + height);
  });

  const shiftX = Math.max(0, GROUP_PADDING - minX);
  const shiftY = Math.max(0, GROUP_PADDING - minY);
  const currentWidth = getNodeDimension(group, "width", 300);
  const currentHeight = getNodeDimension(group, "height", 200);
  const nextWidth = Math.max(currentWidth, maxX + shiftX + GROUP_PADDING);
  const nextHeight = Math.max(currentHeight, maxY + shiftY + GROUP_PADDING);

  if (
    shiftX === 0 &&
    shiftY === 0 &&
    nextWidth === currentWidth &&
    nextHeight === currentHeight
  ) {
    return nodes;
  }

  return nodes.map((node) => {
    if (node.id === groupId) {
      return {
        ...node,
        ...(shiftX !== 0 || shiftY !== 0
          ? {
              position: {
                x: node.position.x - shiftX,
                y: node.position.y - shiftY,
              },
            }
          : {}),
        width: nextWidth,
        height: nextHeight,
        measured: {
          ...node.measured,
          width: nextWidth,
          height: nextHeight,
        },
        data: { ...node.data, width: nextWidth, height: nextHeight },
      };
    }

    if (node.parentId === groupId) {
      return {
        ...node,
        position: {
          x: node.position.x + shiftX,
          y: node.position.y + shiftY,
        },
      };
    }

    return node;
  });
};

/**
 * Fit `groupId`, then walk up the parent chain fitting each ancestor group
 * — growing/shifting an inner group can push it outside its parent's
 * frame. Cycle-guarded; returns the input array when nothing changed.
 */
export const fitGroupAndAncestorsInNodes = (
  nodes: FlowNode[],
  groupId: string
): FlowNode[] => {
  let current = nodes;
  const seen = new Set<string>();
  let gid: string | undefined = groupId;
  while (gid && !seen.has(gid)) {
    seen.add(gid);
    current = fitGroupToChildrenInNodes(current, gid);
    gid = current.find((node) => node.id === gid)?.parentId;
  }
  return current;
};
