#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { edits } = require('./lib/native-tools.cjs');

const root = path.resolve(__dirname, '..');
const selected = new Set([
  'omd-apply', 'omd-remember', 'omd-learn', 'omd-feel', 'omd-restraint',
  'omd-slop-audit', 'omd-humanize', 'omd-autopilot', 'omd-harness',
  'omd-designer-review', 'omd-final-qa', 'omd-orchestrator',
]);

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (input.length > 2 * 1024 * 1024) process.exit(0);
});
process.stdin.on('error', () => process.exit(0));
process.stdin.on('end', () => {
  try {
    const payload = JSON.parse(input || '{}');
    const event = process.argv[2] || payload.hook_event_name;
    const host = payload.host || process.env.OMD_HOST || (process.env.PLUGIN_ROOT ? 'codex' : 'claude-code');
    const cwd = path.resolve(payload.project_dir || (host === 'claude-code' && process.env.CLAUDE_PROJECT_DIR) || payload.cwd || process.cwd());
    const deadline = performance.now() + 650;
    const contexts = [];
    const installed = [...selected].filter(name => fs.existsSync(path.join(root, 'skills', name, 'SKILL.md')));
    function run(script, body = payload) {
      const remaining = deadline - performance.now();
      if (remaining < 20) return;
      const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
        input: JSON.stringify(body), encoding: 'utf8', cwd,
        env: { ...process.env, OMD_PROJECT_DIR: cwd, OMD_HOST: host },
        timeout: Math.min(400, Math.floor(remaining)), maxBuffer: 128 * 1024,
        killSignal: 'SIGKILL',
      });
      if (result.error || result.status !== 0 || !result.stdout.trim()) return;
      try {
        let context = JSON.parse(result.stdout).hookSpecificOutput?.additionalContext;
        if (typeof context !== 'string') return;
        // Never direct the model to an unavailable plugin skill.
        for (const name of selected) {
          if (!installed.includes(name)) context = context.replaceAll(`omd:${name}`, `the ${name.slice(4)} workflow (not bundled here)`);
        }
        contexts.push(context);
      } catch { /* Advisory hooks fail open. */ }
    }
    if (event === 'SessionStart' || event === 'TurnStart') {
      if (event === 'SessionStart' || payload.session_start) {
        contexts.push([
          'OMD project authority: read DESIGN.md and pending .omd/preferences.md before design work.',
          'Pending preferences override DESIGN.md until the user approves folding them in.',
          'Capture explicit corrections with the installed remember skill. Edit drift is inferred, not an explicit correction.',
          `Installed plugin skills: ${installed.map(name => `omd:${name}`).join(', ') || '(none)'}.`,
          'These are installed omd namespace names, not upstream omd:apply / omd:remember aliases.',
          'Use native read/edit/write tools. Ask a conversational question if the host has no question tool.',
          'Use native delegation only when available. Otherwise read the bundled agent role prose and perform the role sequentially.',
          'No CLI, catalog fetch, automatic installation, or profile configuration is required.',
        ].join('\n'));
        run('session-state-loader.cjs');
      }
    }
    if (event === 'UserPromptSubmit' || event === 'TurnStart') run('skill-activation.cjs');
    if (event === 'PostToolUse') {
      for (const edit of edits(payload)) run('post-edit-watch.cjs', { tool_name: 'Edit', tool_input: edit });
    }
    if (event === 'Stop') run('session-end-foldin.cjs');
    if (contexts.length) {
      let context = contexts.join('\n\n');
      for (const name of installed) {
        const native = host === 'pi' ? `/skill:${name}` : host === 'codex' ? `$${name}` : `omd:${name}`;
        context = context.replaceAll(`omd:${name}`, native);
      }
      process.stdout.write(JSON.stringify({ hookSpecificOutput: {
        hookEventName: event === 'TurnStart' ? 'UserPromptSubmit' : event,
        additionalContext: context,
      } }));
    }
  } catch { /* Malformed input and missing project paths must not block tools. */ }
});
