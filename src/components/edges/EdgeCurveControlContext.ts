import { createContext, createElement, useContext, type ReactNode } from "react";

export interface EdgeCurvePoint {
  x: number;
  y: number;
}

type EdgeCurveControlCommit = (
  edgeId: string,
  offset: EdgeCurvePoint | null
) => void;

const EdgeCurveControlContext = createContext<EdgeCurveControlCommit | null>(
  null
);

export function EdgeCurveControlProvider({
  children,
  onControlPointCommit,
}: {
  children: ReactNode;
  onControlPointCommit: EdgeCurveControlCommit;
}) {
  return createElement(
    EdgeCurveControlContext.Provider,
    { value: onControlPointCommit },
    children
  );
}

export const useEdgeCurveControlCommit = (): EdgeCurveControlCommit | null =>
  useContext(EdgeCurveControlContext);
