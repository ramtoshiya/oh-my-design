#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const selection = JSON.parse(readFileSync(join(source, 'integration/selection.json'), 'utf8'));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) {
  throw new Error('Usage: node integration/build-plugin.mjs [--out <generated-plugin-directory>]');
}
const output = resolve(args[1] || join(source, 'plugins/omd'));
if (output === source || source.startsWith(output + sep) ||
    ['skills', 'agents', 'scripts', 'spec', 'integration', 'test-v2'].some((name) =>
      output === join(source, name) || output.startsWith(join(source, name) + sep))) {
  throw new Error('Output must not replace source files');
}
if (existsSync(output)) {
  if (lstatSync(output).isSymbolicLink() ||
      !existsSync(join(output, 'build-manifest.json')) ||
      JSON.parse(readFileSync(join(output, 'build-manifest.json'), 'utf8')).generator !== 'omd-skill-plugin') {
    throw new Error('Refusing to replace a directory not owned by this builder');
  }
}
mkdirSync(dirname(output), { recursive: true });
const stage = mkdtempSync(join(dirname(output), '.omd-build-'));
const emitted = new Map();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';

function safeRelative(name) {
  if (isAbsolute(name) || name.split(/[\\/]/).some((part) => part === '..') || name.includes('\\')) {
    throw new Error(`Unsafe package path: ${name}`);
  }
  return name;
}
function emit(name, bytes) {
  safeRelative(name);
  if (emitted.has(name)) throw new Error(`Duplicate package path: ${name}`);
  const target = join(stage, name);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  emitted.set(name, sha256(bytes));
}
function files(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en')).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlink is not a package asset: ${join(root, name)}`);
    if (entry.isDirectory()) return files(root, name);
    if (!entry.isFile()) throw new Error(`Not a regular file: ${join(root, name)}`);
    return [name];
  });
}

const commands = {
  'prepare-review': 'prepare-design-md-core-review.cjs',
  'approve-review': 'prepare-design-md-core-review.cjs" --approve',
  compile: 'compile-design-md-core.cjs',
  adopt: 'adopt-design-md-core.cjs',
};
function portableText(text) {
  // Preserve authority gates and receipt paths while translating the public
  // command syntax to its provider-free helper interface.
  text = text.replace(/omd design-md prepare-checkpoint\s+([^\s`]+)([^`\n]*?)\s+--out\s+([^\s`]+)/g,
    'node "$OMD_ROOT/scripts/adopt-design-md-core.cjs" $1 --prepare-checkpoint $3$2');
  text = text.replace(/omd design-md (prepare-review|approve-review|compile|adopt)\b/g, (_, command) => {
    const helper = commands[command];
    return `node "$OMD_ROOT/scripts/${helper}${helper.includes('"') ? '' : '"'}`;
  });
  text = text.replace(/\.agents\/skills\//g, '$OMD_ROOT/skills/');
  text = text.replace(/node test-v2\/tools\/([\w-]+\.mjs)/g, 'node "$OMD_ROOT/test-v2/tools/$1"');
  text = text.replace(/`(?:scripts\/)?([\w-]+\.cjs) (<[^`]+)`/g,
    '`node "$OMD_ROOT/scripts/$1" $2`');
  text = text.replace(/scripts\/reflow-artifact\.mjs finalize/g, '<current-skill-dir>/scripts/reflow-artifact.mjs finalize');
  return text;
}
function portableHelper(name, bytes) {
  if (name !== 'scripts/design-council-prime.cjs') return bytes;
  // Change process labels before the ledger freezes them. Identity, evidence,
  // authority, confidence, dispositions, and approval logic stay untouched.
  let text = bytes.toString();
  const labels = [
    ["'Live reference capture'", "'Approved visual evidence'"],
    ["'Catalog-only'", "'Current product and approved assets'"],
    ['Marketing composition benefits from live evidence', 'Marketing composition benefits from approved visual evidence'],
    ['Catalog grounding is the smallest sufficient process for the detected surface.', 'Current product and approved assets are the smallest sufficient evidence for the detected surface.'],
  ];
  for (const [before, after] of labels) {
    if (!text.includes(before)) throw new Error(`Council portability projection needs review: ${before}`);
    text = text.replaceAll(before, after);
  }
  return text;
}
const runtime = `## Installed runtime {:#installed-runtime}

Resolve OMD_ROOT from this installed file, never from the user's working
project. A skill directory is OMD_ROOT/skills/<skill-id>. An agent file is
OMD_ROOT/agents/<role-id>. Read sibling skills at OMD_ROOT/skills/<skill-id>/SKILL.md
and role bodies at OMD_ROOT/agents/<role-id>.md. Helpers live at
OMD_ROOT/scripts and browser measurements at OMD_ROOT/test-v2/tools. Set
OMD_ROOT to that absolute installed plugin directory before shell examples.
Do not install, update, or diagnose an OmD CLI. Node runs the bundled helpers.
Keep the user's project as cwd and pass its paths explicitly.

Skill and role names are preserved. Resolve invocation IDs using the actual
host roster. Claude plugin agents use omd:<role-id>, for example
omd:omd-master. A skill named omd-apply is exposed as omd:omd-apply in Claude.
Legacy omd:<short-name> prose denotes the selected omd-<short-name> skill,
not a separate command. Use the actual loaded invocation ID.
If native roles are unavailable, read the bundled role body and use its lens
inline without claiming independent execution. Preserve council result identity
fields and every checkpoint. If a required role file or helper is missing,
report the incomplete package rather than inventing evidence.

Specialists are advisory to the caller and may write only their designated
run artifacts. They never acquire authority to change product files or the
canonical system. An explicit task output path is not product-write authority.
Browser checks require the optional local dependency and an existing browser.
Never install dependencies or download a browser implicitly. Unavailable checks
remain skipped or failed under their owning gate, never passed.

`;
function instructions(text, role = false) {
  text = portableText(text);
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error('Instruction is missing YAML frontmatter');
  const frontmatter = role ? match[1].split('\n').filter((line) => !line.startsWith('omd_managed:')).join('\n') : match[1];
  return `---\n${frontmatter}\n---\n\n${runtime}${text.slice(match[0].length).trimStart()}`;
}

try {
  for (const skill of selection.skills) {
    const root = join(source, 'skills', safeRelative(skill));
    for (const name of files(root)) {
      // Host metadata, fixtures, and self-tests remain useful, but never ship caches.
      if (name.split('/').some((part) => ['node_modules', '__pycache__', '.DS_Store'].includes(part))) continue;
      const bytes = readFileSync(join(root, name));
      emit(`skills/${skill}/${name}`, name === 'SKILL.md' ? instructions(bytes.toString()) :
        name.endsWith('.md') ? portableText(bytes.toString()) : bytes);
    }
  }
  for (const role of selection.agents) {
    emit(`agents/${safeRelative(role)}.md`, instructions(readFileSync(join(source, 'agents', role + '.md'), 'utf8'), true));
  }

  const queue = [...selection.helpers];
  const visited = new Set();
  while (queue.length) {
    const name = safeRelative(queue.shift());
    if (visited.has(name)) continue;
    visited.add(name);
    const bytes = readFileSync(join(source, name));
    if (lstatSync(join(source, name)).isSymbolicLink()) throw new Error(`Symlink helper: ${name}`);
    emit(name, portableHelper(name, bytes));
    const text = bytes.toString();
    // Static literal relative imports only. Dynamic data assets are explicitly
    // selected below, including all seven schemas and the adopter's validator.
    const imports = /(?:require\s*\(\s*|from\s+|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g;
    for (const match of text.matchAll(imports)) {
      const dependency = relative(source, resolve(source, dirname(name), match[1])).split(sep).join('/');
      queue.push(safeRelative(dependency));
    }
  }
  for (const name of selection.assets) emit(name, readFileSync(join(source, safeRelative(name))));

  const adapters = join(source, 'integration/adapters');
  if (existsSync(adapters)) {
    for (const name of files(adapters)) {
      if (name.split('/').some((part) => ['__pycache__', 'node_modules', '.DS_Store'].includes(part))) continue;
      emit(name, readFileSync(join(adapters, name)));
    }
  }
  emit('.claude-plugin/plugin.json', json({
    name: selection.name,
    description: 'Graph-first project design, preferences, bounded delivery, and evidence-based review.',
    license: 'MIT',
  }));
  emit('.codex-plugin/plugin.json', json({
    name: selection.name,
    description: 'Graph-first project design, preferences, bounded delivery, and evidence-based review.',
    license: 'MIT',
    hooks: './hooks/codex.json',
  }));
  emit('package.json', json({
    name: 'omd-skill-runtime',
    private: true,
    description: 'Optional browser measurement dependency. Core helpers use only Node built-ins.',
    engines: { node: '>=22' },
    optionalDependencies: selection.optionalDependencies,
  }));
  emit('README.md', readFileSync(join(source, 'integration/README.md')));
  const manifest = {
    generator: 'omd-skill-plugin',
    selection,
    files: Object.fromEntries([...emitted].sort(([a], [b]) => a.localeCompare(b, 'en'))),
  };
  emit('build-manifest.json', json(manifest));
  if (existsSync(output)) rmSync(output, { recursive: true });
  renameSync(stage, output);
  console.log(json({ output, files: emitted.size, skills: selection.skills.length, agents: selection.agents.length }));
} catch (error) {
  rmSync(stage, { recursive: true, force: true });
  throw error;
}
