export const TEST_NUMBERS = String.raw`tests? \d+(?:(?:,\s*|\s+and\s+|,\s+and\s+)\d+)*`;

const LEADING = new RegExp(`^${TEST_NUMBERS}`);

export function leadingTestNumbers(name: string): string[] {
  return LEADING.exec(name)?.[0].match(/\d+/g) ?? [];
}
