import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readEdit, ROOT, words } from './edit.mjs';

// The address of a speech service that speaks the API of OpenAI's audio endpoints, such as VoiceStudio; it stays out of the repository.
const SERVICE = 'LAWCHECK_FILM_VOICE';

export function narrationOf(segment) {
  return (segment.narration ?? []).map((line) => line.text).join(' ');
}

export function voiceKey(edit, segment) {
  const { name, language, speed, pause } = edit.voice;
  return createHash('sha256').update(JSON.stringify({ sentences: (segment.narration ?? []).map((line) => line.text), name, language, speed, pause })).digest('hex');
}

function wavParts(buffer) {
  let format;
  for (let at = 12; at + 8 <= buffer.length; ) {
    const id = buffer.toString('latin1', at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    if (id === 'fmt ') format = buffer.subarray(at + 8, at + 8 + size);
    if (id === 'data') {
      if (format === undefined) break;
      // A streamed WAV says 0 or 0xFFFFFFFF for a data size it did not know yet; its data then runs to the end of the file.
      const end = size === 0 || size === 0xffffffff || at + 8 + size > buffer.length ? buffer.length : at + 8 + size;
      return { format, data: buffer.subarray(at + 8, end), byteRate: format.readUInt32LE(8), blockAlign: format.readUInt16LE(12) };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('not a WAV file with a fmt and a data chunk');
}

export function wavSeconds(buffer) {
  const { data, byteRate } = wavParts(buffer);
  return data.length / byteRate;
}

// The engine sometimes runs two sentences into one breath, so each sentence is spoken alone and the sentences are joined with the same pause.
export function joinWav(buffers, pause) {
  const parts = buffers.map(wavParts);
  const [first] = parts;
  if (parts.some((part) => !part.format.equals(first.format))) throw new Error('the sentences came back in different audio formats');
  const gap = Buffer.alloc(Math.round((pause * first.byteRate) / first.blockAlign) * first.blockAlign);
  const data = Buffer.concat(parts.flatMap((part, index) => (index === 0 ? [part.data] : [gap, part.data])));
  const head = Buffer.alloc(8);
  head.write('fmt ', 0, 'latin1');
  head.writeUInt32LE(first.format.length, 4);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(4 + 8 + first.format.length + 8 + data.length, 4);
  riff.write('WAVE', 8, 'latin1');
  const chunk = Buffer.alloc(8);
  chunk.write('data', 0, 'latin1');
  chunk.writeUInt32LE(data.length, 4);
  return Buffer.concat([riff, head, first.format, chunk, data]);
}

// joinWav puts exactly `pause` seconds of digital silence between two sentences, so a run of zero samples that long marks where one sentence ends and the next begins; any other count of runs means the file was not made that way.
export function sentenceSpans(buffer, count, pause) {
  const { data, byteRate, blockAlign } = wavParts(buffer);
  const gap = Math.round((pause * byteRate) / blockAlign) * blockAlign;
  const runs = [];
  let from = -1;
  for (let at = 0; at <= data.length; at += blockAlign) {
    let quiet = at < data.length;
    for (let i = 0; quiet && i < blockAlign; i++) if (data[at + i] !== 0) quiet = false;
    if (quiet && from < 0) from = at;
    if (!quiet && from >= 0) {
      if (at - from >= gap && from > 0 && at < data.length) runs.push([from, at]);
      from = -1;
    }
  }
  if (runs.length !== count - 1) return undefined;
  const seconds = data.length / byteRate;
  return Array.from({ length: count }, (_, index) => ({
    start: index === 0 ? 0 : runs[index - 1][1] / byteRate,
    end: index === count - 1 ? seconds : runs[index][0] / byteRate,
  }));
}

export function windowOf(edit, segment) {
  return segment.end - segment.start - edit.voice.lead - edit.voice.tail;
}

function narrated(edit) {
  return (edit.chapters ?? []).flatMap((chapter) => chapter.timeline.filter((segment) => narrationOf(segment) !== '').map((segment) => ({ page: chapter.page, segment })));
}

export function voiceProblems(edit, folder) {
  const index = join(folder, 'voice.json');
  const spoken = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')).segments : {};
  const problems = [];
  for (const { page, segment } of narrated(edit)) {
    const file = join(folder, page, `${segment.id}.wav`);
    const entry = spoken[`${page}/${segment.id}`];
    if (entry === undefined || !existsSync(file)) {
      problems.push(`the narration of ${page} ${segment.id} has no voice; node film/voice.mjs speaks it`);
      continue;
    }
    if (entry.key !== voiceKey(edit, segment)) problems.push(`the voice of ${page} ${segment.id} was spoken from other words or settings; node film/voice.mjs speaks it again`);
    const seconds = wavSeconds(readFileSync(file));
    const room = windowOf(edit, segment);
    if (seconds > room + 1e-9) problems.push(`the voice of ${page} ${segment.id} lasts ${seconds.toFixed(2)} s, and its frame leaves it ${room.toFixed(2)} s`);
  }
  return problems;
}

export function voiceClips(edit, page, folder) {
  const chapter = edit.chapters.find((entry) => entry.page === page);
  return chapter.timeline.filter((segment) => narrationOf(segment) !== '').map((segment) => ({
    id: segment.id,
    file: join(folder, page, `${segment.id}.wav`),
    start: Number((segment.start + edit.voice.lead).toFixed(3)),
    seconds: wavSeconds(readFileSync(join(folder, page, `${segment.id}.wav`))),
  }));
}

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

// A transcriber writes the numbers it hears as digits, and the narration says them in words.
export function sameWords(text, heard) {
  const spelled = heard.replaceAll('%', ' percent').replace(/\b\d+\b/g, (number) => NUMBERS[Number(number)] ?? number);
  return words(text).join('') === words(spelled).join('');
}

async function call(base, path, init) {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(`${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response;
}

async function speak(edit, base, folder, only) {
  const voices = (await (await call(base, '/v1/audio/voices')).json()).voices;
  const voice = voices.find((entry) => entry.name === edit.voice.name);
  if (voice === undefined) throw new Error(`the speech service has no voice named ${edit.voice.name}`);
  const index = join(folder, 'voice.json');
  const spoken = existsSync(index) ? JSON.parse(readFileSync(index, 'utf8')) : { segments: {} };
  const report = [];
  // One request at a time: the service runs on one machine that other work shares.
  for (const { page, segment } of narrated(edit)) {
    const name = `${page}/${segment.id}`;
    if (only.length > 0 && !only.includes(page) && !only.includes(name)) continue;
    const key = voiceKey(edit, segment);
    const file = join(folder, page, `${segment.id}.wav`);
    if (only.length === 0 && spoken.segments[name]?.key === key && existsSync(file)) continue;
    const text = narrationOf(segment);
    const sentences = [];
    for (const line of segment.narration) {
      const body = { input: line.text, voice: voice.voice_id, speed: edit.voice.speed, language: edit.voice.language, response_format: 'wav' };
      sentences.push(Buffer.from(await (await call(base, '/v1/audio/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).arrayBuffer()));
    }
    const audio = joinWav(sentences, edit.voice.pause);
    mkdirSync(join(folder, page), { recursive: true });
    writeFileSync(file, audio);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/wav' }), `${segment.id}.wav`);
    form.append('response_format', 'text');
    form.append('language', edit.voice.language);
    const heard = (await (await call(base, '/v1/audio/transcriptions', { method: 'POST', body: form })).text()).trim();
    spoken.segments[name] = { key, text, heard };
    writeFileSync(index, `${JSON.stringify(spoken, null, 2)}\n`);
    const same = sameWords(text, heard);
    report.push(`${name}: ${wavSeconds(audio).toFixed(2)} s of ${windowOf(edit, segment).toFixed(2)} s${same ? ', heard word for word' : `, heard otherwise: ${heard}`}`);
  }
  return report;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const pick = args.indexOf('--only');
  if (at < 0 || args[at + 1] === undefined || (pick >= 0 && args[pick + 1] === undefined) || args.some((arg, index) => arg.startsWith('--') && arg !== '--out' && arg !== '--only' && index !== at + 1 && index !== pick + 1)) {
    process.stderr.write('usage: node film/voice.mjs --out <folder outside the repository> [--only <page>|<page>/<segment>,...]\n');
    process.exit(2);
  }
  const base = process.env[SERVICE]?.replace(/\/+$/, '');
  if (!base) {
    process.stderr.write(`film/voice.mjs: ${SERVICE} names no speech service; set it to the address of one that speaks the audio API of OpenAI\n`);
    process.exit(2);
  }
  const edit = readEdit(ROOT);
  const folder = resolve(args[at + 1]);
  const only = pick >= 0 ? args[pick + 1].split(',') : [];
  for (const line of await speak(edit, base, folder, only)) process.stdout.write(`film/voice.mjs: ${line}\n`);
  const problems = voiceProblems(edit, folder);
  process.stdout.write(problems.length === 0 ? `film/voice.mjs: every narrated frame has its voice in ${folder}, and each fits its frame\n` : problems.map((problem) => `film/voice.mjs: ${problem}\n`).join(''));
  process.exit(problems.length === 0 ? 0 : 1);
}
