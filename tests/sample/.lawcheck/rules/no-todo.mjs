export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      if (text.includes('TODO') && !/#\d/.test(text)) findings.push({ file: file.path, line: index + 1, message: 'TODO without an issue number' });
    });
  }
  return findings;
}
