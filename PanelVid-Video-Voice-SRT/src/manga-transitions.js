export const MANGA_TRANSITIONS = Object.freeze([
  { value: 'none', label: 'Không hiệu ứng' },
  { value: 'fade', label: 'Mờ dần' },
  { value: 'slide-left', label: 'Trượt sang trái' },
  { value: 'slide-right', label: 'Trượt sang phải' },
  { value: 'slide-up', label: 'Trượt lên trên' },
  { value: 'slide-down', label: 'Trượt xuống dưới' },
  { value: 'zoom-in', label: 'Zoom vào' },
  { value: 'zoom-out', label: 'Zoom ra' },
  { value: 'flash-white', label: 'Flash trắng' },
]);

const VALID = new Set(MANGA_TRANSITIONS.map(item => item.value));
export function normalizeMangaTransition(value, fallback = 'none') {
  return VALID.has(value) ? value : fallback;
}
