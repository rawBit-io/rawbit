export const TEXT_INFO_TEMPLATE_WIDTH = 300;
export const TEXT_INFO_TEMPLATE_HEIGHT = 200;

export function finiteTextInfoDimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

export function isTextInfoTemplateSize(
  width: number | undefined,
  height: number | undefined
): boolean {
  return (
    width === TEXT_INFO_TEMPLATE_WIDTH && height === TEXT_INFO_TEMPLATE_HEIGHT
  );
}

export function shouldPreferTextInfoNodeGeometry({
  dataWidth,
  dataHeight,
  nodeWidth,
  nodeHeight,
}: {
  dataWidth: unknown;
  dataHeight: unknown;
  nodeWidth: unknown;
  nodeHeight: unknown;
}): boolean {
  const resolvedDataWidth = finiteTextInfoDimension(dataWidth);
  const resolvedDataHeight = finiteTextInfoDimension(dataHeight);
  const resolvedNodeWidth = finiteTextInfoDimension(nodeWidth);
  const resolvedNodeHeight = finiteTextInfoDimension(nodeHeight);

  const dataSizeIsMissing =
    resolvedDataWidth === undefined && resolvedDataHeight === undefined;
  const dataSizeIsMissingOrTemplate =
    dataSizeIsMissing ||
    isTextInfoTemplateSize(resolvedDataWidth, resolvedDataHeight);
  const nodeSizeIsCompleteAndCustom =
    resolvedNodeWidth !== undefined &&
    resolvedNodeHeight !== undefined &&
    !isTextInfoTemplateSize(resolvedNodeWidth, resolvedNodeHeight);

  return dataSizeIsMissingOrTemplate && nodeSizeIsCompleteAndCustom;
}

export function resolveTextInfoDimensions({
  dataWidth,
  dataHeight,
  nodeWidth,
  nodeHeight,
  fallbackWidth,
  fallbackHeight,
}: {
  dataWidth: unknown;
  dataHeight: unknown;
  nodeWidth: unknown;
  nodeHeight: unknown;
  fallbackWidth: number;
  fallbackHeight: number;
}): { width: number; height: number } {
  const resolvedDataWidth = finiteTextInfoDimension(dataWidth);
  const resolvedDataHeight = finiteTextInfoDimension(dataHeight);
  const resolvedNodeWidth = finiteTextInfoDimension(nodeWidth);
  const resolvedNodeHeight = finiteTextInfoDimension(nodeHeight);

  if (
    shouldPreferTextInfoNodeGeometry({
      dataWidth: resolvedDataWidth,
      dataHeight: resolvedDataHeight,
      nodeWidth: resolvedNodeWidth,
      nodeHeight: resolvedNodeHeight,
    })
  ) {
    return {
      width: resolvedNodeWidth ?? fallbackWidth,
      height: resolvedNodeHeight ?? fallbackHeight,
    };
  }

  return {
    width: resolvedDataWidth ?? resolvedNodeWidth ?? fallbackWidth,
    height: resolvedDataHeight ?? resolvedNodeHeight ?? fallbackHeight,
  };
}
