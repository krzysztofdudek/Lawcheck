const MAX = 160;
const MIN = 70;

export const plain = (text: string): string =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*?([^*]+)\*\*?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

function paragraphs(markdown: string): string[] {
  const out: string[] = [];
  let fenced = false;
  let current: string[] = [];
  const close = (): void => {
    if (current.length > 0) out.push(plain(current.join(' ')));
    current = [];
  };
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      close();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (line.trim() === '' || /^(#|\||- |\* |\d+\. |>|<)/.test(line.trim())) close();
    else current.push(line.trim());
  }
  close();
  return out;
}

const sentences = (paragraph: string): string[] => paragraph.split(/(?<=[.!?])\s+(?=[A-Za-z`"'(])/).filter((sentence) => /[.!?]$/.test(sentence));

export function describe(markdown: string, taken: string[] = []): string {
  let text = '';
  for (const paragraph of paragraphs(markdown)) {
    for (const sentence of sentences(paragraph).filter((s) => !taken.includes(s))) {
      const next = text === '' ? sentence : `${text} ${sentence}`;
      if (next.length > MAX) return text.length >= MIN ? text : next.slice(0, MAX - 1).replace(/\s+\S*$/, '') + '…';
      text = next;
    }
    if (text.length >= MIN) return text;
  }
  return text;
}
