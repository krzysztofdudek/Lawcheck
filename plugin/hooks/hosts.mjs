import { isAbsolute, resolve } from 'node:path';

const PATH_TOOLS = { Write: 'file_path', Edit: 'file_path', NotebookEdit: 'notebook_path' };
// The headers of apply_patch that name a file the patch leaves on disk; a deleted file and the old name of a moved one are gone after it.
const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/;

function startDir(input) {
  return typeof input.cwd === 'string' && input.cwd !== '' ? input.cwd : process.cwd();
}

function fromStart(input, value) {
  return isAbsolute(value) ? value : resolve(startDir(input), value);
}

function claudeFiles(input) {
  const key = PATH_TOOLS[input.tool_name];
  if (key === undefined) return [];
  const value = input.tool_input?.[key];
  return typeof value === 'string' && value !== '' ? [fromStart(input, value)] : [];
}

function patchFiles(input) {
  if (input.tool_name !== 'apply_patch') return [];
  const patch = input.tool_input?.command;
  if (typeof patch !== 'string') return [];
  const found = [];
  for (const line of patch.split('\n')) {
    const header = PATCH_FILE.exec(line.endsWith('\r') ? line.slice(0, -1) : line);
    if (header === null || header[1].trim() === '') continue;
    const path = fromStart(input, header[1].trim());
    if (!found.includes(path)) found.push(path);
  }
  return found;
}

function stringOr(value) {
  return typeof value === 'string' ? value : null;
}

export const HOSTS = {
  'claude-code': {
    promptId: (input) => stringOr(input.prompt_id),
    editedFiles: claudeFiles,
    handBack: (text) => ({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } }),
    switchName: (name) => `CLAUDE_PLUGIN_OPTION_${name}`,
  },
  codex: {
    promptId: (input) => stringOr(input.turn_id),
    editedFiles: patchFiles,
    handBack: (text) => ({ decision: 'block', reason: text }),
    switchName: (name) => `LAWCHECK_PLUGIN_${name}`,
  },
};

export { startDir };
