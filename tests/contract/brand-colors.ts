import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Tokens {
  colors: { dusk: Record<string, string>; paper: Record<string, string> };
  surfaces: string[];
  decorative: string[];
  syntax: Record<string, string>;
  terminal: Record<string, string>;
  fonts: Record<string, { family: string; fallback: string }>;
  radius: Record<string, number>;
  contrast: Array<{ mode: 'dusk' | 'paper'; foreground: string; on: string[]; minimum: number }>;
}

export interface Pair {
  mode: 'dusk' | 'paper';
  foreground: string;
  background: string;
  minimum: number;
}

const channel = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(((n >> 16) & 255) / 255) + 0.7152 * channel(((n >> 8) & 255) / 255) + 0.0722 * channel((n & 255) / 255);
}

export function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

export const pairsOf = (tokens: Tokens): Pair[] => tokens.contrast.flatMap((entry) => entry.on.map((background) => ({ mode: entry.mode, foreground: entry.foreground, background, minimum: entry.minimum })));

export function pairProblems(tokens: Tokens): string[] {
  const problems: string[] = [];
  for (const pair of pairsOf(tokens)) {
    const palette = tokens.colors[pair.mode];
    const front = palette[pair.foreground];
    const back = palette[pair.background];
    const name = `${pair.mode}: ${pair.foreground} on ${pair.background}`;
    if (front === undefined || back === undefined) problems.push(`${name}: a color the mode does not have`);
    else if (contrast(front, back) < pair.minimum) problems.push(`${name}: ${contrast(front, back).toFixed(2)}, below ${pair.minimum}`);
  }
  for (const mode of ['dusk', 'paper'] as const) {
    for (const role of Object.keys(tokens.colors[mode])) {
      if (tokens.surfaces.includes(role) || tokens.decorative.includes(role)) continue;
      if (!tokens.contrast.some((entry) => entry.mode === mode && entry.foreground === role)) problems.push(`${mode}: ${role} is in no pair as the color on a surface`);
    }
  }
  return problems;
}

const NAMED = new Set(
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'.split(' '),
);

const HEX = /(?<![\w&/#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const FUNCTION = /(?<![\w.-])(?:(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix)\(|color\(\s*(?:srgb|srgb-linear|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz|xyz-d50|xyz-d65|from)\b)/gi;
const PROPERTY = /(?<![\w-])((?:[a-z]+-)*color|background|border(?:-[a-z]+)*|outline(?:-[a-z]+)*|fill|stroke|stop-color|box-shadow|text-shadow|text-decoration|column-rule|flood-color|lighting-color)\s*[:=]\s*["']?([^;}"'\n]*)/gi;

export interface Found {
  line: number;
  value: string;
}

export function colorsIn(text: string, bareHex = true): Found[] {
  const found: Found[] = [];
  text.split('\n').forEach((line, index) => {
    const at = index + 1;
    if (bareHex) for (const match of line.matchAll(HEX)) found.push({ line: at, value: match[0] });
    for (const match of line.matchAll(FUNCTION)) found.push({ line: at, value: match[0] });
    for (const match of line.matchAll(PROPERTY)) {
      const value = match[2]!.replace(/(?:var|url)\([^)]*\)/gi, ' ');
      if (!bareHex) for (const hex of value.matchAll(HEX)) found.push({ line: at, value: hex[0] });
      for (const word of value.toLowerCase().match(/[a-z]+/g) ?? []) if (NAMED.has(word)) found.push({ line: at, value: word });
    }
  });
  return found.filter((entry, index) => found.findIndex((other) => other.line === entry.line && other.value === entry.value) === index);
}

const TEXT_FILE = /\.(?:css|scss|vue|[cm]?[jt]sx?|html|md|svg|json|ya?ml|txt|xml)$/;
const SKIPPED = ['node_modules', 'dist', 'cache', 'package-lock.json'];

export function filesBelow(root: string, folder: string): string[] {
  const start = join(root, folder);
  if (!existsSync(start)) return [];
  return readdirSync(start, { withFileTypes: true })
    .filter((entry) => !SKIPPED.includes(entry.name))
    .flatMap((entry) => {
      const path = `${folder}/${entry.name}`;
      return entry.isDirectory() ? filesBelow(root, path) : TEXT_FILE.test(entry.name) ? [path] : [];
    })
    .sort();
}

export function colorsOutside(root: string, folders: string[]): string[] {
  return folders.flatMap((folder) =>
    filesBelow(root, folder).flatMap((path) => colorsIn(readFileSync(join(root, path), 'utf8'), !path.endsWith('.md')).map((entry) => `${path}:${entry.line} ${entry.value}`)),
  );
}
