export function cells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|') || trimmed.length < 2) return null;
  const out: string[] = [];
  let cell = '';
  for (let i = 1; i < trimmed.length - 1; i++) {
    const c = trimmed[i]!;
    if (c === '\\' && trimmed[i + 1] === '|') { cell += '|'; i++; continue; }
    if (c === '|') { out.push(cell.trim()); cell = ''; continue; }
    cell += c;
  }
  out.push(cell.trim());
  return out;
}

export function isRule(row: string[]): boolean {
  return row.every((c) => /^:?-{3,}:?$/.test(c));
}

export function plain(cell: string): string {
  const m = /^`([^`]*)`$/.exec(cell.trim());
  return (m ? m[1]! : cell).trim();
}

export type Row = { key: string; text: string; line: number };

export function invariantRows(text: string): Row[] {
  const rows: Row[] = [];
  text.split('\n').forEach((line, index) => {
    const row = cells(line);
    if (!row) return;
    const id = plain(row[0]!);
    if (/^I-[A-Za-z0-9][\w-]*$/.test(id)) rows.push({ key: id, text: line.trim(), line: index + 1 });
  });
  return rows;
}

export type TableRow = { key: string; text: string; line: number };

export function tableRows(text: string, header: string): TableRow[] {
  const rows: TableRow[] = [];
  const lines = text.split('\n');
  let heading = '';
  let fence: string | null = null;
  let inside = false;
  const seen = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) { if (marker !== undefined && line.trim().startsWith(fence)) fence = null; continue; }
    if (marker !== undefined) { fence = marker; inside = false; continue; }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { heading = h[1]!.trim(); inside = false; seen.clear(); continue; }
    const row = cells(line);
    if (!row) { inside = false; continue; }
    if (!inside) {
      const next = cells(lines[i + 1] ?? '');
      if (next && isRule(next) && plain(row[0]!) === header) { inside = true; i++; }
      continue;
    }
    const first = plain(row[0]!);
    const n = (seen.get(first) ?? 0) + 1;
    seen.set(first, n);
    rows.push({ key: `row ${first}${n > 1 ? ` (${n})` : ''} under "${heading}"`, text: row.join(' | '), line: i + 1 });
  }
  return rows;
}

export function rulings(text: string): Set<string> {
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    const m = /^##\s+(\d+)\.\s/.exec(line);
    if (m) out.add(m[1]!);
  }
  return out;
}

export type Block = { key: string; content: string; line: number };

export function fencedBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let heading = '';
  let ordinal = 0;
  let lastComment: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    if (h) { heading = h[1]!.trim(); ordinal = 0; lastComment = null; continue; }
    const id = /^<!--\s*example:\s*([\w.-]+)\s*-->\s*$/.exec(line.trim());
    if (id) { lastComment = id[1]!; continue; }
    const fence = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (!fence) { if (line.trim() !== '') lastComment = null; continue; }
    const marker = fence[2]!;
    const start = i;
    const body: string[] = [];
    i++;
    while (i < lines.length && !lines[i]!.trim().startsWith(marker)) { body.push(lines[i]!); i++; }
    ordinal++;
    const key = lastComment ? `example ${lastComment}` : `block ${ordinal} under "${heading}"`;
    blocks.push({ key, content: `${fence[3]!.trim()}\n${body.join('\n')}`, line: start + 1 });
    lastComment = null;
  }
  return blocks;
}

export type Record = {
  line: number;
  date: string;
  what: string;
  kind: string;
  reason: string;
  anchor: string;
  approvedBy: string;
  raw: string;
};

export type Ledger = { header: string[] | null; records: Record[]; malformed: Array<{ line: number; raw: string; why: string }> };

export const RECORD_HEADER = ['Date', 'What', 'Kind', 'Reason', 'Anchor', 'Approved by'];

export function readWeakenings(text: string, firstLine = 1): Ledger {
  const out: Ledger = { header: null, records: [], malformed: [] };
  text.split('\n').forEach((line, index) => {
    const row = cells(line);
    if (!row) return;
    if (!out.header) { out.header = row; return; }
    if (isRule(row)) return;
    const at = firstLine + index;
    if (row.length !== RECORD_HEADER.length) { out.malformed.push({ line: at, raw: line, why: `it has ${row.length} cells, the table has ${RECORD_HEADER.length}` }); return; }
    const [date, what, kind, reason, anchor, approvedBy] = row.map(plain) as [string, string, string, string, string, string];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { out.malformed.push({ line: at, raw: line, why: 'its date is not YYYY-MM-DD' }); return; }
    if (!what || !kind || !reason || !anchor || !approvedBy) { out.malformed.push({ line: at, raw: line, why: 'a cell is empty' }); return; }
    out.records.push({ line: at, date, what, kind, reason, anchor, approvedBy, raw: line });
  });
  return out;
}
