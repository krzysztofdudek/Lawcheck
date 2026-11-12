export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const call = text.match(/\bconsole\.(\w+)/);
      if (call) findings.push({ file: file.path, line: index + 1, message: `writes to the terminal with console.${call[1]}` });
    });
  }
  return findings;
}
