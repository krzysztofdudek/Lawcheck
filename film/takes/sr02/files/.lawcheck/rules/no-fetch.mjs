export async function check({ files }) {
  const findings = [];
  for (const file of files) {
    const { root } = await file.tree();
    if (root === null) continue;
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      const callee = node.type === 'call_expression' ? node.children.find((child) => child.field === 'function') : undefined;
      if (callee && file.text.slice(callee.start, callee.end) === 'fetch') findings.push({ line: node.line, message: 'calls fetch in core' });
      stack.push(...node.children);
    }
  }
  return findings;
}
