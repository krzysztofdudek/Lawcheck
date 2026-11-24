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

// Copilot CLI's tools that write a file name it in path; str_replace_editor also reads one, with the command view.
const COPILOT_WRITERS = ['create', 'edit', 'str_replace_editor'];

function copilotArgs(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function copilotFiles(input) {
  const args = copilotArgs(input.toolArgs);
  if (input.toolName === 'apply_patch') {
    const patch = typeof args === 'string' ? args : Object.values(args ?? {}).find((value) => typeof value === 'string' && value.includes('*** Begin Patch'));
    return patchFiles({ ...input, tool_name: 'apply_patch', tool_input: { command: patch } });
  }
  if (!COPILOT_WRITERS.includes(input.toolName) || args === null || typeof args !== 'object' || args.command === 'view') return [];
  return typeof args.path === 'string' && args.path !== '' ? [fromStart(input, args.path)] : [];
}

function stringOr(value) {
  return typeof value === 'string' ? value : null;
}

function claudeContext(event, text) {
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

export const HOSTS = {
  'claude-code': {
    setup: '/lawcheck:setup',
    sessionId: (input) => input.session_id,
    context: claudeContext,
    tellsUser: true,
    returned: (input) => input.stop_hook_active === true,
    promptId: (input) => stringOr(input.prompt_id),
    editedFiles: claudeFiles,
    handBack: (text) => ({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: text } }),
    switches: { check_after_edit: 'CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT', check_before_stop: 'CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP' },
  },
  codex: {
    setup: '$lawcheck:setup',
    sessionId: (input) => input.session_id,
    context: claudeContext,
    tellsUser: true,
    returned: (input) => input.stop_hook_active === true,
    promptId: (input) => stringOr(input.turn_id),
    editedFiles: patchFiles,
    handBack: (text) => ({ decision: 'block', reason: text }),
    switches: { check_after_edit: 'LAWCHECK_PLUGIN_CHECK_AFTER_EDIT', check_before_stop: 'LAWCHECK_PLUGIN_CHECK_BEFORE_STOP' },
  },
  copilot: {
    setup: '/lawcheck:setup',
    sessionId: (input) => input.sessionId,
    context: (event, text) => ({ additionalContext: text }),
    tellsUser: false,
    returned: (input) => input.stop_hook_active === true,
    promptId: () => null,
    editedFiles: copilotFiles,
    handBack: (text) => ({ decision: 'block', reason: text }),
    switches: { check_after_edit: 'LAWCHECK_PLUGIN_CHECK_AFTER_EDIT', check_before_stop: 'LAWCHECK_PLUGIN_CHECK_BEFORE_STOP' },
    // Copilot CLI caps the text of postToolUse hooks at 10 KB, so the text after an edit is held to 10,000 bytes of UTF-8.
    editLimit: { most: 10000, size: (text) => Buffer.byteLength(text, 'utf8') },
  },
};

// Cursor runs the hooks of the Claude Code plugin as they are, with no --host, so the hook knows Cursor by cursor_version in its input and HOSTS does not list it. Cursor sends no stop_hook_active: loop_count counts the follow-ups of a turn, and a stop whose status is not completed is the user's stop or an error.
export const CURSOR = {
  setup: '/lawcheck:setup',
  sessionId: (input) => input.session_id,
  context: claudeContext,
  tellsUser: false,
  returned: (input) => typeof input.loop_count === 'number' && input.loop_count > 0,
  ends: (input) => input.status === undefined || input.status === 'completed',
  promptId: () => null,
  editedFiles: claudeFiles,
  handBack: (text) => ({ decision: 'block', reason: text }),
  switches: { check_after_edit: 'CLAUDE_PLUGIN_OPTION_CHECK_AFTER_EDIT', check_before_stop: 'CLAUDE_PLUGIN_OPTION_CHECK_BEFORE_STOP' },
};

export { startDir };
