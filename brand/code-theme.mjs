const SCOPES = {
  keyword: ['keyword', 'storage', 'constant.language', 'support.type.primitive'],
  name: ['entity.name', 'support', 'variable.other.property', 'meta.object-literal.key', 'entity.other.attribute-name'],
  string: ['string', 'constant.other.symbol', 'markup.inline.raw'],
  comment: ['comment'],
  punctuation: ['punctuation', 'meta.brace', 'keyword.operator', 'meta.delimiter'],
};

export function codeTheme(tokens) {
  const dusk = tokens.colors.dusk;
  const color = (role) => dusk[tokens.syntax[role]];
  return {
    name: 'lawcheck',
    type: 'dark',
    fg: dusk.text,
    bg: dusk.code,
    colors: {
      'editor.foreground': dusk.text,
      'editor.background': dusk.code,
      'editorLineNumber.foreground': dusk.textQuiet,
    },
    tokenColors: [
      { settings: { foreground: color('default'), background: dusk.code } },
      ...Object.entries(SCOPES).map(([role, scope]) => ({ scope, settings: { foreground: color(role) } })),
    ],
  };
}
