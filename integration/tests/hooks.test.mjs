import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const integration = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fork = path.dirname(integration);

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'omd-hooks-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const plugin = path.join(base, 'plugin with spaces');
  const cwd = path.join(base, 'project with spaces');
  fs.cpSync(path.join(integration, 'adapters'), plugin, { recursive: true });
  fs.mkdirSync(cwd);
  for (const name of ['omd-apply', 'omd-autopilot', 'omd-harness', 'omd-remember', 'omd-learn']) {
    fs.mkdirSync(path.join(plugin, 'skills', name), { recursive: true });
    fs.copyFileSync(path.join(fork, 'skills', name, 'SKILL.md'), path.join(plugin, 'skills', name, 'SKILL.md'));
  }
  return { plugin, cwd, base };
}

function invoke(f, event, payload = {}) {
  const child = spawnSync(process.execPath, [path.join(f.plugin, 'hooks/bridge.cjs'), event], {
    input: JSON.stringify({ cwd: f.cwd, ...payload }), encoding: 'utf8', timeout: 2500,
    env: { ...process.env, CLAUDE_PROJECT_DIR: f.cwd, PLUGIN_ROOT: '' },
  });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout.trim() ? JSON.parse(child.stdout).hookSpecificOutput.additionalContext : '';
}

function design(f) {
  fs.writeFileSync(path.join(f.cwd, 'DESIGN.md'), '# Design\nColor #112233\nRadius 8px\n## Motion\nFast 150ms\n');
}
function preferences(f) {
  const name = path.join(f.cwd, '.omd/preferences.md');
  return fs.existsSync(name) ? fs.readFileSync(name, 'utf8') : '';
}
function entry(id, scope, confidence, age = 5000) {
  const ts = new Date(Date.now() - age).toISOString();
  return `## ${ts} preference ${id}\n\n\`\`\`omd-meta\nid: ${id}\ntimestamp: ${ts}\nscope: ${scope}\nsignal: user-statement\nconfidence: ${confidence}\nstatus: pending\n\`\`\`\n\nPreference ${id}\n\n`;
}

test('native edit transports persist inferred drift without rewriting DESIGN.md', t => {
  const f = fixture(t);
  design(f);
  const original = fs.readFileSync(path.join(f.cwd, 'DESIGN.md'), 'utf8');
  const cases = [
    ['Write', { file_path: 'claude.css', content: 'color:#abcdef' }],
    ['write', { path: 'pi.css', content: 'border-radius:24px' }],
    ['edit', { path: 'edit.css', newText: 'transition-duration:300ms' }],
    ['write_file', { path: 'hermes.css', content: 'color:#fedcba' }],
    ['patch', { path: 'replace.css', mode: 'replace', new_string: 'color:#123456' }],
    ['patch', { mode: 'patch', patch: '*** Begin Patch\n*** Add File: v4a.css\n+color:#654321\n*** End Patch' }],
    ['apply_patch', { input: '*** Begin Patch\n*** Update File: codex.css\n@@\n-color:#112233\n+color:#aabbdd\n*** End Patch' }],
    ['MultiEdit', { file_path: 'multi.css', edits: [{ new_string: 'color:#ddccbb' }] }],
  ];
  for (const [tool_name, tool_input] of cases) {
    const context = invoke(f, 'PostToolUse', { host: 'pi', tool_name, tool_input });
    assert.match(context, /OMD WATCH/);
    assert.match(context, /\/skill:omd-remember/);
    assert.doesNotMatch(context, /omd remember|AskUserQuestion/);
  }
  const entries = require(path.join(f.plugin, 'hooks/lib/preferences-parser.cjs')).parsePreferences(preferences(f));
  assert.equal(entries.length, cases.length);
  assert.ok(entries.every(e => e.confidence === 'inferred' && e.raw.source_agent === 'pi'));
  assert.equal(fs.readFileSync(path.join(f.cwd, 'DESIGN.md'), 'utf8'), original);
  invoke(f, 'PostToolUse', { tool_name: 'Write', tool_input: cases[0][1] });
  assert.equal(require(path.join(f.plugin, 'hooks/lib/preferences-parser.cjs')).countPending(preferences(f)), cases.length);
});

test('allowed, protected, failed, and unsupported tool edits do not create preferences', t => {
  const f = fixture(t);
  design(f);
  for (const payload of [
    { tool_name: 'Write', tool_input: { file_path: 'clean.css', content: 'color:#112233;border-radius:8px;transition-duration:150ms' } },
    { tool_name: 'terminal', tool_input: { command: 'color:#aabbcc' } },
    { tool_name: 'Write', tool_input: { file_path: '.omd/state.css', content: 'color:#aabbcc' } },
    { tool_name: 'Write', tool_input: { file_path: 'failed.css', content: 'color:#aabbcc' }, status: 'error' },
    { tool_name: 'Write', tool_input: { file_path: 'logic.ts', content: 'const color = "#aabbcc"' } },
  ]) invoke(f, 'PostToolUse', payload);
  assert.equal(preferences(f), '');
});

test('Stop uses scope, confidence, and recency, then restores proposals and respects snooze', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.cwd, '.omd'));
  const pref = path.join(f.cwd, '.omd/preferences.md');
  fs.writeFileSync(pref, ['color', 'motion', 'typography'].flatMap(scope =>
    Array.from({ length: 3 }, (_, i) => entry(`${scope}${i}`, scope, scope === 'motion' ? 'inferred' : 'explicit', scope === 'typography' ? 9 * 86400000 : 5000))).join(''));
  invoke(f, 'Stop');
  const proposalPath = path.join(f.cwd, '.omd/foldin-proposal.json');
  let proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
  assert.equal(proposal.status, 'proposed');
  assert.deepEqual(proposal.scopes.map(s => s.scope), ['color']);
  assert.equal(proposal.scopes[0].score, 120);
  assert.equal(proposal.scopes[0].count, 3);
  const restored = invoke(f, 'SessionStart');
  assert.match(restored, /Pending preferences: 9/);
  assert.match(restored, /OMD FOLD-IN PROPOSAL/);
  assert.match(restored, /omd:omd-learn/);
  assert.match(restored, /snoozed_at/);
  assert.doesNotMatch(restored, /AskUserQuestion/);
  proposal = { ...proposal, status: 'snoozed', snoozed_at: new Date().toISOString() };
  fs.writeFileSync(proposalPath, JSON.stringify(proposal));
  invoke(f, 'Stop');
  assert.equal(JSON.parse(fs.readFileSync(proposalPath, 'utf8')).status, 'snoozed');
  assert.doesNotMatch(invoke(f, 'SessionStart'), /OMD FOLD-IN PROPOSAL/);
  fs.appendFileSync(pref, entry('new-color', 'color', 'explicit', -1000));
  invoke(f, 'Stop');
  assert.equal(JSON.parse(fs.readFileSync(proposalPath, 'utf8')).status, 'proposed');
});

test('preference persistence rejects symlinks and nonregular targets at the bridge boundary', async t => {
  for (const name of ['preferences.md', 'timeline.md', 'foldin-proposal.json']) {
    for (const kind of ['design-symlink', 'outside-symlink', 'directory']) {
      await t.test(`${name}: ${kind}`, t => {
        const f = fixture(t);
        design(f);
        const designPath = path.join(f.cwd, 'DESIGN.md');
        const original = fs.readFileSync(designPath);
        const outside = path.join(f.base, 'outside.md');
        fs.writeFileSync(outside, 'outside must not change\n');
        const protectedBytes = fs.readFileSync(outside);
        fs.mkdirSync(path.join(f.cwd, '.omd'));
        if (name !== 'preferences.md') {
          fs.writeFileSync(path.join(f.cwd, '.omd/preferences.md'),
            Array.from({ length: 3 }, (_, i) => entry(`color${i}`, 'color', 'explicit')).join(''));
        }
        const target = path.join(f.cwd, '.omd', name);
        if (kind === 'directory') fs.mkdirSync(target);
        else fs.symlinkSync(kind === 'design-symlink' ? '../DESIGN.md' : outside, target);
        invoke(f, name === 'preferences.md' ? 'PostToolUse' : 'Stop', {
          tool_name: 'Write', tool_input: { file_path: 'card.css', content: 'color:#abcdef' },
        });
        assert.deepEqual(fs.readFileSync(designPath), original);
        assert.deepEqual(fs.readFileSync(outside), protectedBytes);
        if (name === 'timeline.md') {
          assert.equal(JSON.parse(fs.readFileSync(path.join(f.cwd, '.omd/foldin-proposal.json'), 'utf8')).status, 'proposed');
        }
        if (name === 'foldin-proposal.json') {
          assert.match(fs.readFileSync(path.join(f.cwd, '.omd/timeline.md'), 'utf8'), /fold_in_proposal/);
        }
        if (kind === 'directory') assert.deepEqual(fs.readdirSync(target), []);
        else assert.ok(fs.lstatSync(target).isSymbolicLink());
      });
    }
  }
  for (const event of ['PostToolUse', 'Stop']) {
    await t.test(`${event}: .omd directory symlink`, t => {
      const f = fixture(t);
      design(f);
      const original = fs.readFileSync(path.join(f.cwd, 'DESIGN.md'));
      const outside = path.join(f.base, 'outside');
      fs.mkdirSync(outside);
      const seed = {
        'preferences.md': Array.from({ length: 3 }, (_, i) => entry(`color${i}`, 'color', 'explicit')).join(''),
        'timeline.md': 'protected timeline\n',
        'foldin-proposal.json': '{}\n',
      };
      for (const [name, text] of Object.entries(seed)) fs.writeFileSync(path.join(outside, name), text);
      fs.symlinkSync(outside, path.join(f.cwd, '.omd'));
      invoke(f, event, { tool_name: 'Write', tool_input: { file_path: 'card.css', content: 'color:#abcdef' } });
      for (const [name, text] of Object.entries(seed)) assert.equal(fs.readFileSync(path.join(outside, name), 'utf8'), text);
      assert.deepEqual(fs.readFileSync(path.join(f.cwd, 'DESIGN.md')), original);
      assert.deepEqual(fs.readdirSync(outside).sort(), Object.keys(seed).sort());
    });
  }
});

test('activation routes to installed skills only and never bootstraps files', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.plugin, 'skills/omd-init'), { recursive: true });
  fs.writeFileSync(path.join(f.plugin, 'skills/omd-init/SKILL.md'), 'excluded');
  const context = invoke(f, 'TurnStart', { session_start: true, prompt: 'Design a card layout' });
  assert.match(context, /Use installed omd:omd-apply/);
  assert.match(context, /bounded setup, reuse, or explicitly authorized surface-local scope/);
  assert.match(context, /Pending preferences override DESIGN.md/);
  assert.doesNotMatch(context, /omd:init|omd:omd-init|kr-writer|locale-adapter/);
  assert.deepEqual(fs.readdirSync(f.cwd), []);
  assert.equal(invoke(f, 'UserPromptSubmit', { prompt: 'Search for cardinal numbers' }), '');
  design(f);
  assert.equal(invoke(f, 'UserPromptSubmit', { prompt: 'Design a card' }), '');
});

test('Claude and Codex registrations execute relative to the plugin root, including spaces', t => {
  const f = fixture(t);
  for (const [file, variable] of [['hooks/hooks.json', 'CLAUDE_PLUGIN_ROOT'], ['hooks/codex.json', 'PLUGIN_ROOT']]) {
    const hooks = JSON.parse(fs.readFileSync(path.join(f.plugin, file), 'utf8')).hooks;
    const command = hooks.UserPromptSubmit[0].hooks[0].command;
    const result = spawnSync('/bin/sh', ['-c', command], {
      env: { ...process.env, PLUGIN_ROOT: '', CLAUDE_PROJECT_DIR: f.cwd, [variable]: f.plugin }, input: JSON.stringify({ cwd: f.cwd, prompt: 'Design a page' }),
      encoding: 'utf8', timeout: 2500,
    });
    assert.equal(result.status, 0, result.stderr);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(context, /OMD GATE/);
    assert.ok(context.includes(variable === 'PLUGIN_ROOT' ? '$omd-harness' : 'omd:omd-harness'));
  }
});

test('malformed input and stalled hook children fail open within the event budget', t => {
  const f = fixture(t);
  const malformed = spawnSync(process.execPath, [path.join(f.plugin, 'hooks/bridge.cjs'), 'PostToolUse'], { input: 'not json', encoding: 'utf8', timeout: 2500 });
  assert.equal(malformed.status, 0);
  assert.equal(malformed.stdout, '');
  fs.writeFileSync(path.join(f.plugin, 'hooks/post-edit-watch.cjs'), 'setInterval(() => {}, 1000)');
  const start = performance.now();
  assert.equal(invoke(f, 'PostToolUse', { tool_name: 'Write', tool_input: { file_path: 'slow.css', content: 'color:#abcdef' } }), '');
  assert.ok(performance.now() - start < 1500);
  assert.equal(preferences(f), '');
});

test('Pi native callbacks deliver visible context and preserve structured tool results', async t => {
  const f = fixture(t);
  design(f);
  const handlers = new Map();
  const ctx = { cwd: f.cwd };
  if (process.env.PI_SDK_ROOT) {
    const sdk = process.env.PI_SDK_ROOT;
    const { loadExtensions } = await import(pathToFileURL(path.join(sdk, 'dist/core/extensions/loader.js')).href);
    const { ExtensionRunner } = await import(pathToFileURL(path.join(sdk, 'dist/core/extensions/runner.js')).href);
    const { SessionManager } = await import(pathToFileURL(path.join(sdk, 'dist/core/session-manager.js')).href);
    const loaded = await loadExtensions([path.join(f.plugin, 'hooks/pi.ts')], f.cwd);
    assert.deepEqual(loaded.errors, []);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, f.cwd, SessionManager.inMemory(f.cwd), {});
    const errors = [];
    runner.onError(error => errors.push(error));
    t.after(() => assert.deepEqual(errors, []));
    handlers.set('before_agent_start', async event => {
      const result = await runner.emitBeforeAgentStart(event, { cwd: f.cwd, tools: [], skills: [], contextFiles: [] });
      return result.messages.length ? { message: result.messages[0] } : undefined;
    });
    handlers.set('tool_result', event => runner.emitToolResult({ type: 'tool_result', toolCallId: 'test', ...event }));
    handlers.set('session_switch', () => runner.emit({ type: 'session_switch', reason: 'new' }));
    handlers.set('agent_end', () => runner.emit({ type: 'agent_end', messages: [] }));
  } else {
    const { default: hooks } = await import(pathToFileURL(path.join(f.plugin, 'hooks/pi.ts')).href);
    hooks({ on: (name, callback) => handlers.set(name, callback) });
  }
  const start = await handlers.get('before_agent_start')({ messageType: 'user', prompt: 'Adjust the card' }, ctx);
  assert.match(start.message.content, /OMD project authority/);
  assert.match(start.message.content, /\/skill:omd-harness/);
  assert.equal(start.message.display, true);
  const target = path.join(f.cwd, 'native.css');
  fs.writeFileSync(target, 'color:#abcdef');
  const result = await handlers.get('tool_result')({ toolName: 'write', input: { path: target, content: 'color:#abcdef' }, content: [{ type: 'text', text: 'written' }], structuredContent: { saved: true }, details: { original: true }, isError: false }, ctx);
  assert.equal(fs.readFileSync(target, 'utf8'), 'color:#abcdef');
  assert.equal(result.content[0].text, 'written');
  assert.match(result.content[1].text, /OMD WATCH/);
  assert.deepEqual(result.structuredContent, { saved: true });
  assert.deepEqual(result.details, { original: true });
  const clean = await handlers.get('tool_result')({ toolName: 'write', input: { path: target, content: 'color:#112233' }, content: [], isError: false }, ctx);
  assert.equal(clean, undefined);
  assert.equal(await handlers.get('before_agent_start')({ messageType: 'custom', message: {} }, ctx), undefined);
  await handlers.get('session_switch')();
  assert.match((await handlers.get('before_agent_start')({ messageType: 'user', prompt: '' }, ctx)).message.content, /OMD project authority/);
  await handlers.get('agent_end')({}, ctx);
  assert.equal(fs.existsSync(path.join(f.cwd, '.omd/foldin-proposal.json')), false);
  for (const source of ["console.log('malformed')", 'setInterval(() => {}, 1000)']) {
    fs.writeFileSync(path.join(f.plugin, 'hooks/bridge.cjs'), source);
    const before = performance.now();
    assert.equal(await handlers.get('tool_result')({ toolName: 'write', input: { path: target, content: 'color:#abcdef' }, content: [{ type: 'text', text: 'saved' }], isError: false }, ctx), undefined);
    assert.ok(performance.now() - before < 1600);
    assert.equal(fs.readFileSync(target, 'utf8'), 'color:#abcdef');
  }
});
