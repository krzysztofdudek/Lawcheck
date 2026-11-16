let target = '';

export function initialize(data) {
  target = data.target;
}

// A test file that imports node:test gets tests/harness/shuffled-test.mjs instead, which holds the tests it registers and runs them in the order of LAWCHECK_SHUFFLE. The query names the importing file, because the runner reports a test at the file that called test() and the report must name the test file, not this one.
export async function resolve(specifier, context, next) {
  if (specifier === 'node:test' && typeof context.parentURL === 'string' && !context.parentURL.startsWith(target) && /\.test\.[cm]?[jt]s$/.test(context.parentURL)) return { url: `${target}?parent=${encodeURIComponent(context.parentURL)}`, shortCircuit: true };
  return next(specifier, context);
}
