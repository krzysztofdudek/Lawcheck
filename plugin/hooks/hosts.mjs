import { isAbsolute, resolve } from 'node:path';

const PATH_TOOLS = { Write: 'file_path', Edit: 'file_path', NotebookEdit: 'notebook_path' };
// The headers of apply_patch that name a file the patch leaves on disk; a deleted file and the old name of a moved one are gone after it.
const PATCH_FILE = /^\*\*\* (?:Add File|Update File|Move to): (.+)$/;

// Cursor runs a plugin's hooks from the plugin's own folder and gives the session start and the prompt no cwd, so the workspace it names stands in.
function startDir(input) {
  if (typeof input.cwd === 'string' && input.cwd !== '') return input.cwd;
  const root = Array.isArray(input.workspace_roots) ? input.workspace_roots[0] : undefined;
  return typeof root === 'string' && root !== '' ? root : process.cwd();
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
    tellsUser: true,
    returned: (input) => input.stop_hook_active === true,
    promptId: (input) => stringOr(input.prompt_id),
    editedFiles: claudeFiles,
    handBack: (text) => ({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } }),
    switches: { check_after_edit: 'CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT', check_before_stop: 'CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP' },
  },
  codex: {
    tellsUser: true,
    returned: (input) => input.stop_hook_active === true,
    promptId: (input) => stringOr(input.turn_id),
    editedFiles: patchFiles,
    handBack: (text) => ({ decision: 'block', reason: text }),
    switches: { check_after_edit: 'LAWCHECK_PLUGIN_CHECK_AFTER_EDIT', check_before_stop: 'LAWCHECK_PLUGIN_CHECK_BEFORE_STOP' },
  },
};

// Cursor runs the hooks of the Claude Code plugin as they are, with no --host, so the hook knows Cursor by cursor_version in its input and HOSTS does not list it. Cursor sends no stop_hook_active: loop_count counts the follow-ups of a turn, and a stop whose status is not completed is the user's stop or an error.
export const CURSOR = {
  tellsUser: false,
  returned: (input) => typeof input.loop_count === 'number' && input.loop_count > 0,
  ends: (input) => input.status === undefined || input.status === 'completed',
  promptId: () => null,
  editedFiles: claudeFiles,
  handBack: (text) => ({ decision: 'block', reason: text }),
  switches: { check_after_edit: 'CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT', check_before_stop: 'CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP' },
};

export { startDir };
