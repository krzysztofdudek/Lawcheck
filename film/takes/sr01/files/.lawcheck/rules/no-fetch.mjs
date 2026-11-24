export async function check({ files: [file] }) {
  const { root } = await file.tree();
  if (root === null) return [];
  const findings = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    const callee = node.type === 'call_expression' ? node.children.find((child) => child.field === 'function') : undefined;
    if (callee && file.text.slice(callee.start, callee.end) === 'fetch') findings.push({ line: node.line, message: 'calls fetch outside the api layer' });
    stack.push(...node.children);
  }
  return findings;
}
