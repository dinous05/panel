export function scenesFromPanelImages(pages, makeId = () => crypto.randomUUID()) {
  return pages.map((page, index) => ({
    id: makeId(),
    pageIndex: Number.isInteger(page.index) ? page.index : index,
    groupIndex: Number.isInteger(page.pageGroupIndex) ? page.pageGroupIndex : (Number.isInteger(page.index) ? page.index : index),
    crop: { x: 0, y: 0, w: 100, h: 100 },
    autoCrop: { x: 0, y: 0, w: 100, h: 100 },
    label: `Panel ${index + 1}`,
    manual: false,
    duration: null,
    fullFrame: false,
  }));
}
