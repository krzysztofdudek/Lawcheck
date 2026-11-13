export function isExpired(start: Date, days: number, now: Date = new Date()): boolean {
  return now.getTime() - start.getTime() > days * 24 * 60 * 60 * 1000;
}
