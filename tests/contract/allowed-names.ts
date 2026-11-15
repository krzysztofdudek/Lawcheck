// The one list of capitalised names a docs page may use outside code. A tool that is not here fails
// `docs-names.test.ts`; adding one needs a ruling in spec/questions.md that says why a page names it.
export const ALLOWED_NAMES: Record<string, string[]> = {
  'the tool and the library its readers come from (question 77)': ['Lawcheck', 'Runes'],
  'languages the readers handle': ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'Kotlin', 'C#', 'C++', 'C', 'PHP', 'Ruby'],
  'formats and standards': ['URL', 'API', 'HTTP', 'ES', 'JSON', 'YAML', 'UTF-8', 'NUL', 'CI', 'MCP', 'WASI'],
  'platforms and ecosystems the pages describe': ['Node', 'Composer', 'GitHub'],
};
