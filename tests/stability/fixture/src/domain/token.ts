export function token(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2);
}
