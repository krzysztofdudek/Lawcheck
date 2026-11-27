import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GITHUB, LINK, REPOSITORY } from './brand.ts';

interface ChapterFile {
  name: string;
  sha256: string;
  bytes: number;
}

export interface Chapter {
  page: string;
  number: number;
  seconds: number;
  transcript: string[];
  files: { mp4: ChapterFile; vtt: ChapterFile; jpg: ChapterFile };
  release?: string;
}

// The chapters are attachments of a GitHub release, listed with their hashes in film/published.json; no video enters the repository.
// LAWCHECK_FILM_DIR names a folder that node film/render.mjs wrote, for a preview of chapters no release holds yet.
const local = process.env.LAWCHECK_FILM_DIR;

function listed(): { chapters: Chapter[] } {
  return JSON.parse(readFileSync(local ? join(local, 'chapters.json') : join(REPOSITORY, 'film', 'published.json'), 'utf8')) as { chapters: Chapter[] };
}

export function chapters(): Chapter[] {
  return listed().chapters;
}

export function chapterOf(page: string) {
  const chapter = chapters().find((entry) => entry.page === page);
  if (!chapter) return undefined;
  const url = (file: ChapterFile) => `${LINK.landing}film/${file.name}`;
  return { number: chapter.number, total: chapters().length, seconds: Math.round(chapter.seconds), video: url(chapter.files.mp4), track: url(chapter.files.vtt), poster: url(chapter.files.jpg), transcript: chapter.transcript };
}

async function bytesOf(item: { release?: string }, what: string, file: ChapterFile): Promise<Buffer> {
  if (local) return readFileSync(join(local, file.name));
  if (!item.release) throw new Error(`film/published.json: ${what} names no release that holds ${file.name}`);
  const answer = await fetch(`${GITHUB}/releases/download/${item.release}/${file.name}`);
  if (!answer.ok) throw new Error(`the release ${item.release} answers ${answer.status} for ${file.name}`);
  return Buffer.from(await answer.arrayBuffer());
}

export async function writeChapterFiles(folder: string): Promise<void> {
  mkdirSync(folder, { recursive: true });
  const items = chapters().map((chapter) => ({ item: chapter as { release?: string; files: Record<string, ChapterFile> }, what: `the chapter ${chapter.page}` }));
  for (const { item, what } of items) {
    for (const file of Object.values(item.files)) {
      const bytes = await bytesOf(item, what, file);
      const hash = createHash('sha256').update(bytes).digest('hex');
      if (hash !== file.sha256) throw new Error(`${file.name} has the hash ${hash}, and film/published.json names ${file.sha256}`);
      writeFileSync(join(folder, file.name), bytes);
    }
  }
}
