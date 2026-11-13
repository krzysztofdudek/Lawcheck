const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function isOpen(at: Date): boolean {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: zone }).format(at));
  return hour >= 9 && hour < 17;
}
