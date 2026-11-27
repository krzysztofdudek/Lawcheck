import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { decodeTerminal, ROOT } from './edit.mjs';
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

const PROMPT_SIGN = /(?:^|[^\w])shop \$ (.*)$/;

export function outputsOf(folder, name = 'terminal') {
  const path = join(folder, `${name}.jsonl`);
  if (!existsSync(path)) return [];
  const runs = [];
  for (const line of decodeTerminal(readFileSync(path, 'utf8'))) {
    const sign = PROMPT_SIGN.exec(line.text);
    if (sign !== null) runs.push({ command: sign[1], lines: [] });
    else if (runs.length > 0) runs[runs.length - 1].lines.push(line.text);
  }
  return runs;
}

function outputOf(folder, command, name = 'terminal') {
  return outputsOf(folder, name).findLast((run) => run.command === command)?.lines ?? null;
}

const FINDING = /^(\S+):(\d+)\s+(?:error|warning)\[([\w-]+)\]/;
const REVIEWER_CALL = /\breviewer calls?\b/;

function findingsIn(lines) {
  return (lines ?? []).map((line) => FINDING.exec(line)).filter((match) => match !== null).map((match) => ({ at: `${match[1]}:${match[2]}`, code: match[3] }));
}

function readTaken(folder, path) {
  const file = join(folder, 'files', path);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function exitOf(marks, command) {
  return marks.findLast((mark) => mark.command === command)?.exit;
}

export function workflowOfDocs(root = ROOT) {
  const page = readFileSync(join(root, 'docs', 'ci.md'), 'utf8');
  const block = /<!-- example: ci-workflow -->\n```yaml\n([\s\S]*?)```/.exec(page);
  return block === null ? null : block[1];
}

function blockAfter(page, heading, lang, root = ROOT) {
  const text = readFileSync(join(root, 'docs', page), 'utf8');
  const at = text.indexOf(heading);
  const block = at < 0 ? null : new RegExp('```' + lang + '\n([\\s\\S]*?)```').exec(text.slice(at));
  return block === null ? null : block[1];
}

function quickStart(folder, take, reasons) {
  for (const command of ['npm install --global lawcheck', 'lawcheck init']) {
    if (exitOf(take.commands, command) !== 0) reasons.push(`${command} exits ${exitOf(take.commands, command)}`);
  }
  const files = [
    ['src/cli/print.ts', blockAfter('quick-start.md', 'Write the file of the command layer', 'ts')],
    ['.lawcheck/law.yaml', blockAfter('quick-start.md', '## 3. Add one may_use line', 'yaml')],
    ['src/core/receipt.ts', blockAfter('quick-start.md', '## 4. Write a file that breaks it', 'ts')],
  ];
  for (const [path, block] of files) if (block === null || readTaken(folder, path) !== block) reasons.push(`${path} is not the block of docs/quick-start.md`);
  if (!take.changed.includes('.lawcheck/.gitignore')) reasons.push('lawcheck init did not write .lawcheck/.gitignore');
  const found = findingsIn(outputOf(folder, 'lawcheck check'));
  if (exitOf(take.commands, 'lawcheck check') !== 1 || found.length !== 1 || found[0].at !== 'src/core/receipt.ts:1' || found[0].code !== 'forbidden-use') reasons.push('lawcheck check does not fail with one forbidden-use at src/core/receipt.ts:1');
}

function scriptRule(folder, take, reasons) {
  const rule = readTaken(folder, '.lawcheck/rules/no-fetch.mjs');
  if (rule === null) reasons.push('the session wrote no .lawcheck/rules/no-fetch.mjs');
  else {
    if (!/\.tree\(\)/.test(rule)) reasons.push('the rule does not ask for the syntax tree');
    const outside = [...rule.matchAll(/\b(?:import|from)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]).filter((specifier) => !specifier.startsWith('./'));
    if (outside.length > 0) reasons.push(`the rule imports from outside .lawcheck/rules/: ${outside.join(', ')}`);
  }
  if (!(outputOf(folder, 'lawcheck explain --rule no-fetch') ?? []).some((line) => /^\s+on types:\s+core$/.test(line))) reasons.push('lawcheck explain --rule no-fetch does not show the type core alone');
  const found = findingsIn(outputOf(folder, 'lawcheck try no-fetch'));
  if (found.length !== 1 || found[0].at !== 'src/core/cart.ts:3' || found[0].code !== 'no-fetch') reasons.push(`lawcheck try no-fetch finds ${found.map((item) => item.at).join(', ') || 'nothing'}, not src/core/cart.ts:3 alone`);
  const touched = take.changed.filter((path) => path.startsWith('src/'));
  if (touched.length > 0) reasons.push(`the session changed ${touched.join(', ')}`);
}

function reviewerRule(folder, take, reasons) {
  const config = readTaken(folder, '.lawcheck/config.yaml');
  if (config !== null) reasons.push('the session changed .lawcheck/config.yaml');
  const settings = parse(config ?? readFileSync(join(ROOT, 'film', 'fixture', 'chapters', 'write-a-reviewer-rule', 'refund', '.lawcheck', 'config.yaml'), 'utf8'));
  if (settings?.reviewer?.provider !== 'claude-code' || /key/i.test(JSON.stringify(settings))) reasons.push('the settings do not name claude-code alone, with no key');
  if (readTaken(folder, '.lawcheck/rules/clear-errors.md') === null) reasons.push('the session wrote no .lawcheck/rules/clear-errors.md');
  const law = parse(readTaken(folder, '.lawcheck/law.yaml') ?? '') ?? {};
  if (!(law.types?.core?.rules ?? []).includes('clear-errors')) reasons.push('the law does not list clear-errors on core');
  const found = findingsIn(outputOf(folder, 'lawcheck try clear-errors src/core/refund.ts'));
  if (!found.some((item) => item.at === 'src/core/refund.ts:2' && item.code === 'clear-errors')) reasons.push(`lawcheck try clear-errors finds ${found.map((item) => item.at).join(', ') || 'nothing'}, not src/core/refund.ts:2`);
  const review = outputOf(folder, 'lawcheck check --review --base main') ?? [];
  if (exitOf(take.commands, 'lawcheck check --review --base main') !== 0 || !review.some((line) => REVIEWER_CALL.test(line))) reasons.push('lawcheck check --review does not pass with a reviewer call');
  if (!take.changed.includes('.lawcheck/verdicts')) reasons.push('no pass was written to .lawcheck/verdicts');
  const plain = outputOf(folder, 'lawcheck check --base main') ?? [];
  if (exitOf(take.commands, 'lawcheck check --base main') !== 0 || plain.some((line) => REVIEWER_CALL.test(line))) reasons.push('the plain check does not pass without a reviewer call');
}

function continuousIntegration(folder, take, reasons) {
  const workflow = readTaken(folder, '.github/workflows/lawcheck.yml');
  if (workflow === null || workflow.trim() !== (workflowOfDocs() ?? '').trim()) reasons.push('.github/workflows/lawcheck.yml is not the block ci-workflow of docs/ci.md');
  const offline = take.offline;
  if (offline === undefined) reasons.push('the take has no part recorded with the network off');
  else {
    if (offline.network !== 'off') reasons.push('the network was on');
    if (offline.keys.length > 0) reasons.push(`the environment held ${offline.keys.join(', ')}`);
    const command = 'npx --no-install lawcheck check --base origin/main';
    const runs = outputsOf(folder, 'terminal-2').filter((run) => run.command === command);
    const exits = offline.commands.filter((mark) => mark.command === command).map((mark) => mark.exit);
    if (runs.length !== 2 || exits.length !== 2) reasons.push('the check of the job did not run on both branches');
    else {
      if (exits[0] !== 0 || runs[0].lines.some((line) => REVIEWER_CALL.test(line))) reasons.push('on refund the check does not pass without a reviewer call');
      if (exits[1] !== 1 || !findingsIn(runs[1].lines).some((item) => item.code === 'forbidden-use')) reasons.push('on discount the check does not fail with forbidden-use');
      if (!(outputOf(folder, 'echo $?', 'terminal-2') ?? []).includes('1')) reasons.push('echo $? does not print 1');
    }
  }
}

const JUDGES = { 'quick-start': quickStart, 'write-a-script-rule': scriptRule, 'write-a-reviewer-rule': reviewerRule, ci: continuousIntegration };

export function judgeChapter(folder) {
  const take = JSON.parse(readFileSync(join(folder, 'take.json'), 'utf8'));
  if (take.arm !== undefined) return { ...judge(folder), page: take.page };
  const reasons = [];
  if (!take.complete) reasons.push('a command did not end in time');
  const judgeOf = JUDGES[take.page];
  if (judgeOf === undefined) reasons.push(`no chapter has the page ${take.page}`);
  else judgeOf(folder, take, reasons);
  const waived = filesBelow(join(folder, 'files')).filter((path) => readFileSync(join(folder, 'files', path), 'utf8').includes('lawcheck-waive'));
  if (waived.length > 0) reasons.push(`a waiver was added: ${waived.join(', ')}`);
  const turn = take.commands.find((command) => command.command.startsWith('claude -p'));
  return { id: take.id, page: take.page, accepted: reasons.length === 0, reasons, seconds: turn?.seconds ?? null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const folders = process.argv.slice(2);
  if (folders.length === 0) {
    process.stderr.write('usage: node film/accept.mjs <take folder or folder of takes>...\n');
    process.exit(2);
  }
  const takes = folders.flatMap((folder) => (existsSync(join(folder, 'take.json')) ? [folder] : readdirSync(folder).map((name) => join(folder, name)).filter((path) => statSync(path).isDirectory() && existsSync(join(path, 'take.json')))));
  const results = takes.map((folder) => (JSON.parse(readFileSync(join(folder, 'take.json'), 'utf8')).page === undefined ? judge(folder) : judgeChapter(folder)));
  for (const result of results) {
    const facts = result.imports === undefined ? '' : `  ${result.tests} tests${result.imports.length > 0 ? `  import at ${result.imports[0]}` : ''}${result.arm === 'b' ? `  ${result.findings} plugin findings` : ''}`;
    process.stdout.write(`${result.id}  ${result.page ?? `arm ${result.arm}`}  ${result.accepted ? 'accepted' : 'refused'}  ${result.seconds} s${facts}${result.accepted ? '' : `  (${result.reasons.join('; ')})`}\n`);
  }
  for (const arm of ['a', 'b']) {
    const of = results.filter((result) => result.arm === arm && result.page === undefined);
    if (of.length === 0) continue;
    const accepted = of.filter((result) => result.accepted).sort((x, y) => x.seconds - y.seconds);
    process.stdout.write(`arm ${arm}: ${accepted.length} of ${of.length} accepted${accepted.length > 0 ? `, the shortest turn is ${accepted[0].id}` : ''}\n`);
  }
  process.exit(results.every((result) => result.accepted) ? 0 : 1);
}
