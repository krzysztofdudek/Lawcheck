#!/usr/bin/env node
// Node's permission model, turned on by --permission in NODE_OPTIONS, lets the entry file load and refuses every module it imports, so this file imports none of Lawcheck's own modules before it looks. It is CommonJS whatever package.json says: Node 24.2 to 24.6 under that model cannot read package.json, and would parse an ES module entry as CommonJS.
const COMMANDS = ['init', 'prime', 'check', 'explain', 'try', 'docs', 'doctor'];

function refuse(): void {
  const args = process.argv.slice(2);
  const command = COMMANDS.includes(args[0] ?? '') ? args[0]! : 'check';
  const message = "Node runs with --permission, set in NODE_OPTIONS, and under it Lawcheck cannot read its own files";
  const why = 'Lawcheck answers only where its rules and readers are known to run';
  const next = `start Lawcheck with NODE_OPTIONS free of --permission, then run lawcheck ${command === 'check' ? 'check' : `${command} again`}`;
  const text = args.includes('--json')
    ? JSON.stringify({ schema: 'lawcheck-error/1', errors: [{ code: 'unsupported-environment', file: null, line: null, message, why }], next: { command: null, text: next } }, null, 2) + '\n'
    : [`lawcheck: ERROR  ${message}`, '', `error[unsupported-environment]  ${message}`, `  why:  ${why}`, '', `next: ${next}`, ''].join('\n');
  process.stdout.write(text, () => process.exit(2));
}

if ((process as { permission?: unknown }).permission !== undefined) refuse();
else void import('./cli.js').then((cli) => cli.start());
