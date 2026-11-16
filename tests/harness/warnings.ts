// Node 24.0 to 24.x before type stripping became stable warns once on standard error when it starts a .ts file. Only the suite's own .ts programs are started so; Lawcheck itself is JavaScript, so this one warning is taken out of their output alone, and every other line stays.
const TYPE_STRIPPING_WARNING = /^\(node:\d+\) ExperimentalWarning: Type Stripping is an experimental feature and might change at any time\n\(Use `node --trace-warnings \.\.\.` to show where the warning was created\)\n/gm;

export function withoutTypeStrippingWarning(text: string): string {
  return text.replace(TYPE_STRIPPING_WARNING, '');
}
