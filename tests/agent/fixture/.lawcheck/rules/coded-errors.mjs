export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const thrown = text.match(/\bthrow\s+new\s+(\w+)/);
      if (thrown && thrown[1] !== 'ShopError') {
        findings.push({ file: file.path, line: index + 1, message: `throws ${thrown[1]}; core code throws ShopError with a code` });
      }
    });
  }
  return findings;
}
