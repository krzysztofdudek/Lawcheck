const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const block = (selector, lines) => `${selector} {\n${lines.map((line) => `  ${line}`).join('\n')}\n}\n`;

const colors = (palette) => Object.entries(palette).map(([role, value]) => `--lc-${kebab(role)}: ${value};`);

export function css(tokens, paperSelector = '[data-theme="paper"]') {
  const fonts = Object.entries(tokens.fonts).map(([role, font]) => `--lc-font-${role}: "${font.family}", ${font.fallback};`);
  const radius = Object.entries(tokens.radius).map(([role, pixels]) => `--lc-radius-${role}: ${pixels}px;`);
  return `${block(':root', [...colors(tokens.colors.dusk), ...fonts, ...radius])}\n${block(paperSelector, colors(tokens.colors.paper))}`;
}
