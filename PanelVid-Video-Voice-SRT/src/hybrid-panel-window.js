export function appendHybridPanelCard(cards, card, maxPanels = 5) {
  const limit = Math.max(1, Math.min(10, Math.round(Number(maxPanels) || 5)));
  return [...(Array.isArray(cards) ? cards : []), card].slice(-limit);
}
