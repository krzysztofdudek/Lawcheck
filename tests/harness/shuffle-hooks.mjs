let target = '';

export function initialize(data) {
  target = data.target;
}

// A test file that imports node:test gets tests/harness/shuffled-test.mjs instead, which holds the tests it registers and runs them in the order of LAWCHECK_SHUFFLE.
export async function resolve(specifier, context, next) {
  if (specifier === 'node:test' && typeof context.parentURL === 'string' && /\.test\.[cm]?[jt]s$/.test(context.parentURL)) return { url: target, shortCircuit: true };
  return next(specifier, context);
}
