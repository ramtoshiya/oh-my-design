import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(join(tmpdir(), 'omd-package-'));
const plugin = join(scratch, 'installed', 'omd');
const project = join(scratch, 'consumer');
mkdirSync(project, { recursive: true });
after(() => rmSync(scratch, { recursive: true, force: true }));
const selection = JSON.parse(readFileSync(join(root, 'integration/selection.json'), 'utf8'));
function run(script, args = [], cwd = project) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NODE_PATH: '', OMD_AUTHORITY_CONTROLLER_RECEIPT: '', OMD_AUTHORITY_CONTROLLER_RUN_DIR: '' },
  });
}
function build(output) {
  const result = run(join(root, 'integration/build-plugin.mjs'), ['--out', output]);
  assert.equal(result.status, 0, result.stderr);
}
function files(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert.equal(entry.isSymbolicLink(), false, name);
    return entry.isDirectory() ? files(directory, name) : [name];
  }).sort();
}
const read = (name) => readFileSync(join(plugin, name), 'utf8');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
build(plugin);

// The package is the owning boundary for selection, deterministic projection,
// import closure, and instruction-byte preservation. Core adoption behavior is
// exercised separately by core-roundtrip.test.mjs, not repeated here.
test('build is deterministic, hash-complete, and safe to rebuild', () => {
  const other = join(scratch, 'second', 'omd');
  build(other);
  assert.deepEqual(files(plugin), files(other));
  for (const name of files(plugin)) assert.deepEqual(readFileSync(join(plugin, name)), readFileSync(join(other, name)), name);
  const manifest = JSON.parse(read('build-manifest.json'));
  assert.deepEqual(manifest.selection, selection);
  assert.deepEqual(Object.keys(manifest.files).sort(), files(plugin).filter((name) => name !== 'build-manifest.json'));
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(digest(readFileSync(join(plugin, name))), hash, name);
  build(other);
  assert.deepEqual(readFileSync(join(plugin, 'build-manifest.json')), readFileSync(join(other, 'build-manifest.json')));
  const protectedDir = join(scratch, 'user-owned');
  mkdirSync(protectedDir);
  writeFileSync(join(protectedDir, 'keep.txt'), 'owned by user\n');
  const denied = run(join(root, 'integration/build-plugin.mjs'), ['--out', protectedDir]);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /not owned by this builder/);
  assert.equal(readFileSync(join(protectedDir, 'keep.txt'), 'utf8'), 'owned by user\n');
});

test('install exposes exactly the selected skills and roles, without CLI or company catalog payloads', () => {
  assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).name, 'omd');
  const codex = JSON.parse(read('.codex-plugin/plugin.json'));
  assert.equal(codex.name, 'omd');
  assert.ok(existsSync(join(plugin, codex.hooks)), 'Codex hook manifest resolves inside the package');
  assert.match(read(codex.hooks.slice(2)), /\$\{PLUGIN_ROOT\}/, 'Codex uses its native plugin-root variable');
  assert.deepEqual(readdirSync(join(plugin, 'skills')).sort(), [...selection.skills].sort());
  assert.deepEqual(readdirSync(join(plugin, 'agents')).sort(), selection.agents.map((name) => `${name}.md`).sort());
  for (const name of files(plugin)) {
    assert.doesNotMatch(name, /^(?:src|dist|bin|web|data|references|docs|config|integration|node_modules)\//, name);
    assert.doesNotMatch(name, /(?:^|\/)(?:omd-(?:init|setup|update|sync|kr-writer|locale-adapter|codex-image|landing|aphrodite)|hangul)(?:\/|\.md$)/, name);
    assert.doesNotMatch(name, /(?:^|\/)(?:AGENTS|CLAUDE|CURRENT_STATE|JOURNAL)\.md$/, name);
    assert.equal(lstatSync(join(plugin, name)).isFile(), true, name);
  }
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.bin, undefined);
  assert.deepEqual(packageJson.optionalDependencies, { 'playwright-core': '1.61.1' });
  assert.equal(packageJson.scripts, undefined, 'installation must not run lifecycle scripts');
});

test('installed instructions have closed Markdown links, bundled helper paths, and real invocation IDs', () => {
  for (const name of files(plugin).filter((name) => name.endsWith('.md'))) {
    const text = read(name);
    // Examples in code fences and inline code describe user artifacts, not
    // links in the installed documentation. Check actual Markdown links only.
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');
    for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/g)) {
      const target = match[1];
      if (/^(?:[a-z]+:|#|\/)/i.test(target)) continue;
      const file = resolve(plugin, dirname(name), decodeURIComponent(target.split('#')[0]));
      assert.ok(file.startsWith(plugin + sep), `${name}: link escapes package: ${target}`);
      assert.ok(existsSync(file), `${name}: missing link: ${target}`);
    }
    if (!name.startsWith('skills/') && !name.startsWith('agents/')) continue;
    assert.doesNotMatch(text, /omd[:\-](?:kr-writer|locale-adapter|codex-image|asset-fetch|add-reference|init)\b/, name);
    assert.doesNotMatch(text, /reference-fingerprints\.json|oh-my-design-cli|omd design-md|omd check\b|npx --yes|@latest/, name);
    for (const match of text.matchAll(/\$OMD_ROOT\/((?:scripts|test-v2\/tools)\/[\w/-]+\.(?:cjs|mjs))/g)) {
      assert.ok(existsSync(join(plugin, match[1])), `${name}: missing helper ${match[1]}`);
    }
    for (const match of text.matchAll(/subagent_type:\s*"([^"]+)"/g)) {
      assert.ok(match[1].startsWith('omd:'), `${name}: missing Claude namespace`);
      assert.ok(selection.agents.includes(match[1].slice(4)), `${name}: unknown role ${match[1]}`);
    }
  }
});

test('runtime literal relative imports are closed and no upstream TypeScript runtime is needed', () => {
  for (const name of files(plugin).filter((name) => /\.(?:cjs|mjs|js)$/.test(name))) {
    const text = read(name);
    for (const match of text.matchAll(/(?:require\s*\(\s*|from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g)) {
      const dependency = resolve(plugin, dirname(name), match[1]);
      assert.ok(dependency.startsWith(plugin + sep), `${name}: escaping import`);
      assert.ok(existsSync(dependency), `${name}: missing ${match[1]}`);
      assert.doesNotMatch(relative(plugin, dependency), /^(?:src|dist)\//);
    }
  }
  // Loading the actual schema gate reads the seven runtime schema files.
  const schema = run('-e', [`const gate=require(${JSON.stringify(join(plugin, 'scripts/design-md-core-schema.cjs'))}); const findings=gate.validateCoreGraph({}); if(!Array.isArray(findings) || !findings.some(f => f.keyword === 'required')) process.exit(1); console.log('invalid graph rejected');`]);
  assert.equal(schema.status, 0, schema.stderr);
  assert.match(schema.stdout, /invalid graph rejected/);
});

test('all numbered quality gates and component contracts survive the package projection', () => {
  const gatePath = 'skills/omd-autopilot/references/slop-gates.md';
  const source = readFileSync(join(root, gatePath), 'utf8');
  assert.equal(read(gatePath), source, 'numbered gates are shipped losslessly');
  const ids = [...source.matchAll(/^- (G(?:S)?\d+[a-z]?)\b/gm)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'gate IDs must be unique');
  assert.deepEqual(ids, [
    'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8',
    'G10', 'G11', 'G12', 'G13', 'G14', 'G15', 'G16', 'G17', 'G18', 'G19',
    'G22', 'G23', 'G24', 'G25', 'G26', 'G27', 'G28', 'G30', 'G31',
    'G37', 'G38', 'G38a', 'G39', 'G40', 'G41', 'G42', 'G43', 'G44',
    'G45', 'G46', 'G47', 'G48', 'G49', 'G34', 'G50', 'G51', 'G55', 'G56',
    'GS1', 'GS2', 'GS3', 'GS4', 'GS5', 'GS6', 'GS7', 'GS8',
  ], 'public gate IDs may not disappear or be renumbered');
  for (const name of files(join(root, 'skills/omd-autopilot/references'))) {
    if (name !== 'component-craft.md' && !name.startsWith('presets/')) continue;
    if (name === 'presets/INDEX.md') continue;
    const relativePath = `skills/omd-autopilot/references/${name}`;
    assert.equal(read(relativePath), readFileSync(join(root, relativePath), 'utf8'), relativePath);
  }
  const qa = read('skills/omd-final-qa/SKILL.md').replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');
  assert.deepEqual([...qa.matchAll(/^### \[(\d)\]/gm)].map((match) => Number(match[1])), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('isolated project analysis and authority bootstrap run without a CLI or source checkout', () => {
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'consumer-fixture', private: true }));
  writeFileSync(join(project, 'index.html'), '<!doctype html><title>Tasks</title><main><h1>Tasks</h1><button>Add task</button></main>');
  const runDir = join(project, '.omd/runs/package-smoke');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'task.md'), 'Create a new generic task dashboard from scratch. I authorize establishing a project design system. Preserve unknown product facts as absent.');
  for (const helper of ['ctx-prime.cjs', 'design-council-prime.cjs']) {
    const result = run(join(plugin, 'scripts', helper), [project, runDir]);
    assert.equal(result.status, 0, `${helper}: ${result.stderr}`);
  }
  const context = JSON.parse(readFileSync(join(runDir, 'ctx-prime.json'), 'utf8'));
  assert.ok(context.surface_inventory.some((surface) => JSON.stringify(surface).includes('index.html')));
  const ledger = JSON.parse(readFileSync(join(runDir, 'council/decision-ledger.json'), 'utf8'));
  const grounding = ledger.decisions.find((decision) => decision.id === 'visual-grounding');
  assert.equal(grounding.disposition, 'auto');
  assert.equal(grounding.proposed_value, 'Current product and approved assets');
  assert.ok(grounding.evidence.length > 0, 'process defaults retain real evidence');
  assert.equal(existsSync(join(project, 'DESIGN.md')), false, 'analysis cannot grant project-write authority');
  const reflow = run(join(plugin, 'skills/omd-apply/scripts/reflow-artifact.mjs'));
  assert.equal(reflow.status, 2);
  assert.match(reflow.stderr, /usage: reflow-artifact/);
  assert.equal(existsSync(join(project, 'DESIGN.md')), false);
});
