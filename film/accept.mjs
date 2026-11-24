import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apiImports } from './pilot.mjs';

function filesBelow(folder, prefix = '') {
  if (!existsSync(folder)) return [];
  const found = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...filesBelow(join(folder, entry.name), path));
    else found.push(path);
  }
  return found.sort();
}

export function transcriptOf(folder) {
  return readdirSync(folder).filter((name) => /^transcript.*\.jsonl$/.test(name)).sort().map((name) => readFileSync(join(folder, name), 'utf8')).join('\n');
}

export function pluginFindings(folder) {
  const found = [];
  for (const line of transcriptOf(folder).split('\n')) {
    if (line.trim() === '' || !line.includes('error[forbidden-use]')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const attachment = event.attachment;
    if (attachment === undefined || typeof attachment.hookEvent !== 'string') continue;
    const text = [attachment.content, attachment.stdout, attachment.stderr, attachment.blockingError?.blockingError].flat().filter((part) => typeof part === 'string' && part.includes('error[forbidden-use]'));
    if (text.length > 0) found.push({ event: attachment.hookEvent, type: attachment.type, text: text[0] });
  }
  return found;
}

function events(folder) {
  const found = [];
  for (const line of transcriptOf(folder).split('\n')) {
    if (line.trim() === '') continue;
    try {
      found.push(JSON.parse(line));
    } catch {}
  }
  return found;
}

export function sessionStart(folder) {
  return events(folder).some((event) => event.attachment?.type === 'hook_additional_context' && [event.attachment.content].flat().some((text) => typeof text === 'string' && text.startsWith('Lawcheck checks this repository')));
}

export function lastMessage(folder) {
  const said = events(folder).filter((event) => event.type === 'assistant' && Array.isArray(event.message?.content) && event.message.content.some((part) => part.type === 'text'));
  return said.length === 0 ? '' : said[said.length - 1].message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

export function sentencesOf(text) {
  return text.split('\n').flatMap((line) => line.replace(/^\s*(?:[-*]\s+)?(?:\*\*[^*]+\*\*\s*)?/, '').split(/(?<=[.!?])\s+/)).map((sentence) => sentence.trim()).filter((sentence) => sentence !== '');
}

export function lawSentences(folder) {
  return sentencesOf(lastMessage(folder)).filter((sentence) => /\blaw\b/i.test(sentence) && /\bimport/i.test(sentence));
}

export function judge(folder) {
  const take = JSON.parse(readFileSync(join(folder, 'take.json'), 'utf8'));
  const reasons = [];
  if (!take.complete) reasons.push('the turn did not end in time');
  if (take.tests.exit !== 0 || take.tests.fail !== 0) reasons.push('the tests fail');
  const imports = apiImports(folder);
  const findings = take.arm === 'b' ? pluginFindings(folder) : [];
  if (take.arm === 'a') {
    if (imports.length === 0) reasons.push('no file of src/core imports from src/api');
    const outside = take.changed.filter((path) => !path.startsWith('src/') && !path.startsWith('tests/'));
    if (outside.length > 0) reasons.push(`a file outside src/ and tests/ changed: ${outside.join(', ')}`);
  } else {
    if (imports.length > 0) reasons.push(`a file of src/core imports from src/api: ${imports.join(', ')}`);
    if (!sessionStart(folder)) reasons.push('the transcript holds no text that the plugin gave the agent when the session started');
    if (lawSentences(folder).length === 0) reasons.push('the last message of the agent holds no sentence that names the law and the import');
    if (take.check === null || take.check.exit !== 0) reasons.push('the last lawcheck check does not exit 0');
    if (take.changed.some((path) => path.startsWith('.lawcheck/'))) reasons.push('the law changed');
    const waived = filesBelow(join(folder, 'files')).filter((path) => readFileSync(join(folder, 'files', path), 'utf8').includes('lawcheck-waive'));
    if (waived.length > 0) reasons.push(`a waiver was added: ${waived.join(', ')}`);
  }
  const turn = take.commands.find((command) => command.command.startsWith('claude '));
  return { id: take.id, arm: take.arm, accepted: reasons.length === 0, reasons, seconds: turn?.seconds ?? null, tests: take.tests.tests, imports, findings: findings.length, law: take.arm === 'b' ? lawSentences(folder) : [] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folders = process.argv.slice(2);
  if (folders.length === 0) {
    process.stderr.write('usage: node film/accept.mjs <take folder or folder of takes>...\n');
    process.exit(2);
  }
  const takes = folders.flatMap((folder) => (existsSync(join(folder, 'take.json')) ? [folder] : readdirSync(folder).map((name) => join(folder, name)).filter((path) => statSync(path).isDirectory() && existsSync(join(path, 'take.json')))));
  const results = takes.map(judge);
  for (const result of results) {
    process.stdout.write(`${result.id}  arm ${result.arm}  ${result.accepted ? 'accepted' : 'refused'}  ${result.seconds} s  ${result.tests} tests${result.imports.length > 0 ? `  import at ${result.imports[0]}` : ''}${result.arm === 'b' ? `  ${result.findings} plugin findings` : ''}${result.accepted ? '' : `  (${result.reasons.join('; ')})`}\n`);
  }
  for (const arm of ['a', 'b']) {
    const of = results.filter((result) => result.arm === arm);
    if (of.length === 0) continue;
    const accepted = of.filter((result) => result.accepted).sort((x, y) => x.seconds - y.seconds);
    process.stdout.write(`arm ${arm}: ${accepted.length} of ${of.length} accepted${accepted.length > 0 ? `, the shortest turn is ${accepted[0].id}` : ''}\n`);
  }
  process.exit(results.every((result) => result.accepted) ? 0 : 1);
}
