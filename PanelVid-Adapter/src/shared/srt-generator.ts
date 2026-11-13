import type { LogicalPageDocument } from './logical-pages';
import type { ChapterMapping } from './types';

export interface SrtCuePlan { chapterKey: string; pageId: string; pageNumber: number; cueNumber: number; narration: string }

// PanelVid v8 parser accepts a positive cue window but its voice builder uses cue
// start anchors and real synthesized audio durations; cue end is not used there.
// Same-start cues are serialized in stable input order and chained by real audio.
export function buildChapterSrt(chapter: ChapterMapping, pages: LogicalPageDocument['pages']): string {
  const chapterPages = pages.filter(page => page.chapterKey === chapter.chapterKey);
  return chapterPages.map((page, index) => {
    const cueNumber = index + 1;
    const pageNumber = index + 1;
    return `${cueNumber}\n00:00:00,000 --> 00:00:00,001\n[TRANG ${pageNumber}]\n${page.beat.narration}`;
  }).join('\n\n') + (chapterPages.length ? '\n' : '');
}

export function listSrtCuePlan(chapter: ChapterMapping, pages: LogicalPageDocument['pages']): SrtCuePlan[] {
  return pages.filter(page => page.chapterKey === chapter.chapterKey).map((page, index) => ({
    chapterKey: chapter.chapterKey, pageId: page.id, pageNumber: index + 1, cueNumber: index + 1, narration: page.beat.narration
  }));
}
