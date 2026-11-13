export function parse(text: string): string[] {
  // split the text into lines
  const lines = text.split('\n');
  // drop the empty ones
  return lines.filter((line) => line.trim() !== '');
}
