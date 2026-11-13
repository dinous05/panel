// Vertical-strip export: each image keeps its natural rendered height at the shared
// output width. Move by exactly the current image height so adjacent clips join
// without changing their requested duration or introducing a blank viewport.
export function webtoonTileSize(sourceWidth, sourceHeight, outputWidth = 1920, widthPct = 100) {
  const srcW = Math.max(1, Number(sourceWidth) || 1);
  const srcH = Math.max(1, Number(sourceHeight) || 1);
  const width = Math.max(1, Math.round((Number(outputWidth) || 1920) * Math.max(0.4, Math.min(1, (Number(widthPct) || 100) / 100))));
  return { width, height: Math.max(1, Math.round(width * srcH / srcW)) };
}

export function webtoonScrollPlan(tileHeights, index, viewportHeight = 1080) {
  const heights = (Array.isArray(tileHeights) ? tileHeights : [])
    .map(value => Math.max(1, Math.round(Number(value) || 1)));
  const startIndex = Math.max(0, Math.min(heights.length, Math.floor(Number(index) || 0)));
  const viewport = Math.max(1, Math.round(Number(viewportHeight) || 1080));
  const advancePx = startIndex < heights.length - 1 ? heights[startIndex] : 0;
  const requiredHeight = advancePx + viewport;
  let tileCount = 0;
  let contentHeight = 0;
  while (startIndex + tileCount < heights.length && contentHeight < requiredHeight) {
    contentHeight += heights[startIndex + tileCount];
    tileCount++;
  }
  return {
    startIndex,
    advancePx,
    tileCount,
    contentHeight,
    requiredHeight,
    needsPadding: contentHeight < requiredHeight,
  };
}
