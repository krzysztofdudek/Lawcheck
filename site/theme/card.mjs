import { CATEGORY, FINDING, HEIGHT, WIDTH } from './og.mjs';

export const CARD = {
  url: 'https://lawcheck.dev/og.png',
  width: WIDTH,
  height: HEIGHT,
  maxBytes: 300 * 1024,
  alt: `The Lawcheck mark and name, the line "${CATEGORY}", and the first line of one finding: ${FINDING.place} ${FINDING.code}, ${FINDING.text}.`,
};

export const cardHead = () => [
  ['meta', { property: 'og:image', content: CARD.url }],
  ['meta', { property: 'og:image:type', content: 'image/png' }],
  ['meta', { property: 'og:image:width', content: String(CARD.width) }],
  ['meta', { property: 'og:image:height', content: String(CARD.height) }],
  ['meta', { property: 'og:image:alt', content: CARD.alt }],
  ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
];

const SIGNATURE = '89504e470d0a1a0a';

export function pngProblems(bytes) {
  if (bytes.subarray(0, 8).toString('hex') !== SIGNATURE) return ['og.png is not a PNG file'];
  const out = [];
  const [width, height] = [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (width !== CARD.width || height !== CARD.height) out.push(`og.png is ${width} by ${height}, not ${CARD.width} by ${CARD.height}`);
  if (bytes.length >= CARD.maxBytes) out.push(`og.png has ${bytes.length} bytes, not under ${CARD.maxBytes}`);
  return out;
}

const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const metaOf = (html, attribute, name) => [...html.matchAll(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`, 'g'))].map((match) => decode(match[1]));

export function cardProblems(html, page) {
  const out = [];
  const expected = { 'og:image': CARD.url, 'og:image:type': 'image/png', 'og:image:width': String(CARD.width), 'og:image:height': String(CARD.height), 'og:image:alt': CARD.alt };
  for (const [property, value] of Object.entries(expected)) {
    const found = metaOf(html, 'property', property);
    if (found.length !== 1 || found[0] !== value) out.push(`${page}: ${property} is ${JSON.stringify(found)}, not ${JSON.stringify(value)} once`);
  }
  const card = metaOf(html, 'name', 'twitter:card');
  if (card.length !== 1 || card[0] !== 'summary_large_image') out.push(`${page}: twitter:card is ${JSON.stringify(card)}, not summary_large_image once`);
  return out;
}
