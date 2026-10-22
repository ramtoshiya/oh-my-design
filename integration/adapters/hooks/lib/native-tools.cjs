'use strict';

// Translate successful native edits, not shell commands or tool results, to
// the watcher input. Detection and preference scoring stay in the shared hooks.
function edits(payload) {
  const name = payload.tool_name || payload.toolName || '';
  const input = payload.tool_input || payload.toolInput || {};
  if (payload.is_error || payload.status === 'error') return [];
  if (['Edit', 'Write', 'MultiEdit'].includes(name)) {
    if (name === 'MultiEdit' && Array.isArray(input.edits)) {
      return input.edits.map(edit => ({ ...edit, file_path: input.file_path }));
    }
    return [input];
  }
  if (['write', 'write_file'].includes(name)) {
    return [{ file_path: input.path, content: input.content }];
  }
  if (name === 'edit') {
    return [{ file_path: input.path, new_string: input.newText }];
  }
  if (name === 'patch' && input.mode !== 'patch' && !input.patch) {
    return [{ file_path: input.path, new_string: input.new_string }];
  }
  if (name === 'apply_patch' || (name === 'patch' && input.patch)) {
    const text = input.patch || input.input || input.command || (typeof input === 'string' ? input : '');
    const result = [];
    let current;
    for (const line of String(text).split('\n')) {
      const header = /^\*\*\* (?:Add|Update) File: (.+)$/.exec(line);
      if (header) {
        current = { file_path: header[1], content: '' };
        result.push(current);
      } else if (/^\*\*\* /.test(line)) {
        if (!line.startsWith('*** Move to:')) current = undefined;
      } else if (current && line.startsWith('+')) {
        current.content += line.slice(1) + '\n';
      }
    }
    return result;
  }
  return [];
}

module.exports = { edits };
