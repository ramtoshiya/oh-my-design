import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repo = resolve(import.meta.dirname, '../..');
const fixture = join(repo, 'spec/fixtures/design-md-core-v2/.omd/system/graph.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

function json(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function execute(runtime, script, args, cwd, expected = 0) {
  const result = spawnSync(process.execPath, [join(runtime, 'scripts', script), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
  assert.equal(result.status, expected, `${script}: ${result.stderr}\n${result.stdout}`);
  return result;
}

test('isolated helpers preserve owner review and adopt an updated graph without the CLI or catalog', () => {
  const root = mkdtempSync(join(tmpdir(), 'omd-core-roundtrip-'));
  try {
    const runtime = join(root, 'installed-plugin');
    cpSync(join(repo, 'plugins/omd'), runtime, { recursive: true });
    const project = join(root, 'consumer');
    mkdirSync(project);
    assert.equal(existsSync(join(runtime, 'dist')), false);
    assert.equal(existsSync(join(runtime, 'web/references')), false);

    const graph = JSON.parse(readFileSync(fixture, 'utf8'));
    delete graph.projection;
    delete graph.extensions;
    graph.governance.decisions[0].path = 'typography_assets.roles.0.family';
    const groups = ['experience', 'foundations', 'typography-assets', 'components-states', 'layout-platforms', 'content-locales', 'governance'];
    const checks = ['portable_core_structure', 'bound_system_authority', 'token_reference_closure', 'contrast', 'component_state_coverage', 'responsive_320_200', 'reduced_motion', 'assets_fonts_licenses', 'implementation_contract_complete', 'unknown_absence', 'opaque_extension_preservation'];
    const provenance = {
      schema_version: '2.0.0',
      decisions: [{ path: 'typography_assets.roles.0.family', source_class: 'unresolved', evidence: [] }],
    };
    // These are fixture declarations for package-integrity tests, not runtime UI proof.
    const coverage = {
      schema_version: '2.0.0',
      groups: Object.fromEntries(groups.map((group) => [group, { status: 'covered', evidence: ['fixture-evidence.md'] }])),
      checks: Object.fromEntries(checks.map((check) => [check, { pass: true, method: 'controller-computed-system-graph-v2' }])),
    };
    writeFileSync(join(project, 'fixture-evidence.md'), 'Distribution fixture. No browser or product behavior is certified.\n');

    function adoptRound(round) {
      const inputs = join(root, `inputs-${round}`);
      const review = join(root, `review-${round}`);
      const compiled = join(root, `compiled-${round}`);
      const approval = join(root, `approval-${round}.json`);
      const checkpoint = join(root, `checkpoint-${round}.json`);
      json(join(inputs, 'graph.json'), graph);
      json(join(inputs, 'provenance.json'), provenance);
      json(join(inputs, 'coverage.json'), coverage);
      execute(runtime, 'prepare-design-md-core-review.cjs', [
        join(inputs, 'graph.json'), '--provenance', join(inputs, 'provenance.json'),
        '--coverage', join(inputs, 'coverage.json'), '--out-dir', review,
      ], project);
      assert.equal(existsSync(join(review, '.omd/system/manifest.json')), false);
      const before = existsSync(join(project, 'DESIGN.md')) ? readFileSync(join(project, 'DESIGN.md'), 'utf8') : null;
      const denied = execute(runtime, 'compile-design-md-core.cjs', [
        join(review, 'input-graph.json'), '--provenance', join(review, 'provenance.json'),
        '--coverage', join(review, 'coverage.json'), '--out-dir', compiled, '--adopt',
      ], project, 1);
      assert.match(denied.stderr, /review-receipt/);
      assert.equal(existsSync(compiled), false);
      assert.equal(existsSync(join(project, 'DESIGN.md')) ? readFileSync(join(project, 'DESIGN.md'), 'utf8') : null, before);

      execute(runtime, 'prepare-design-md-core-review.cjs', [
        '--approve', join(review, 'review-request.json'), '--reviewer', 'distribution-fixture-owner',
        '--out', approval, '--authority-transition-approved',
      ], project);
      execute(runtime, 'compile-design-md-core.cjs', [
        join(review, 'input-graph.json'), '--provenance', join(review, 'provenance.json'),
        '--coverage', join(review, 'coverage.json'), '--review-receipt', approval,
        '--out-dir', compiled, '--adopt',
      ], project);
      execute(runtime, 'adopt-design-md-core.cjs', [
        compiled, '--prepare-checkpoint', checkpoint, '--reviewer', 'distribution-fixture-owner',
        '--authority-transition-approved',
      ], project);
      execute(runtime, 'adopt-design-md-core.cjs', [
        compiled, '--project-root', project, '--checkpoint-receipt', checkpoint,
      ], project);
      const design = readFileSync(join(project, 'DESIGN.md'));
      const installedGraphBytes = readFileSync(join(project, '.omd/system/graph.json'));
      const installedGraph = JSON.parse(installedGraphBytes);
      const manifest = JSON.parse(readFileSync(join(project, '.omd/system/manifest.json')));
      assert.equal(design.toString(), readFileSync(join(review, 'DESIGN.md'), 'utf8'));
      assert.equal(installedGraph.projection.sha256, hash(design));
      assert.equal(manifest.artifacts.graph.sha256, hash(installedGraphBytes));
      assert.equal(manifest.artifacts.design_md.sha256, hash(design));
      assert.equal(manifest.authority.canonical, 'system-graph');
      return { compiled, checkpoint, design, installedGraph };
    }

    const first = adoptRound(1);
    graph.content_locales.voice = ['Direct', 'Specific', 'Blameless'];
    const second = adoptRound(2);
    assert.notEqual(second.design.toString(), first.design.toString());
    assert.deepEqual(second.installedGraph.content_locales.voice, graph.content_locales.voice);

    const tamperedGraph = join(second.compiled, '.omd/system/graph.json');
    writeFileSync(tamperedGraph, `${readFileSync(tamperedGraph, 'utf8')}\n`);
    execute(runtime, 'adopt-design-md-core.cjs', [
      second.compiled, '--project-root', project, '--checkpoint-receipt', second.checkpoint,
    ], project, 1);
    assert.deepEqual(readFileSync(join(project, 'DESIGN.md')), second.design);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
