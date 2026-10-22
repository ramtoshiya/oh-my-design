# OmD skill plugin

This plugin uses the current agent session for project design and delivery.
It does not need the OmD CLI, a source checkout, a company reference catalog,
or a separate model provider. Node.js 22 or later runs the bundled Core helpers.

## Workflows

- `omd-apply` changes existing UI against DESIGN.md and pending preferences.
- `omd-autopilot` owns bounded autonomous delivery for a new surface.
- `omd-harness` guides design through mandatory journey, system, and validation
  approvals. Its master role can run natively or inline.
- `omd-remember` records scoped corrections. `omd-learn` folds approved pending
  preferences through the graph-first compiler and atomic adopter.
- `omd-feel`, `omd-restraint`, and `omd-slop-audit` provide interaction craft,
  measured restraint, and contextual pattern review. Autopilot's full numbered
  gates, component-craft, and generic preset contracts are included.
- `omd-humanize` post-edits the caller's writing and localization. It does not
  require separate writing or locale workers. Review roles remain advisory.

Names are preserved. In Claude Code the plugin namespace is `omd`, so invoke
`/omd:omd-apply` or `/omd:omd-harness`. Native agent IDs use
`omd:omd-master`, `omd:omd-ux-writer`, and the corresponding preserved role ID.
Other hosts should use their actual loaded skill and role roster. When a host
cannot invoke a role, read its bundled `agents/<role-id>.md` body inline without
claiming an independent agent ran.

## Start a project system

Read the brief, current product, existing DESIGN.md, and user-approved assets.
If DESIGN.md is missing, `omd-apply` offers a small system setup using
`omd-autopilot`, or `omd-harness` when the user wants guided checkpoints. No
company picker is required. Ask for authority to establish a project system,
or retain a clearly scoped surface-local contract when authority is withheld.

Derive philosophy, decision IDs and rationales, tokens, component specs, and
layout grammar from that evidence. Presets are reusable guidance, not facts
about a company. Unknown facts stay absent. Author graph, provenance, and
coverage drafts under `.omd/runs/<run-id>/system/`. Never hand-edit generated
DESIGN.md, manifests, claims, or hashes. Keep the exact owner approval and
checkpoint chain even when the caller owns implementation.

For direct helper use, set `OMD_ROOT` to the absolute installed plugin directory
(two levels above an installed skill directory). Keep the user's project as
cwd. The following placeholders denote actual draft and fresh output paths:

```sh
node "$OMD_ROOT/scripts/prepare-design-md-core-review.cjs" <graph> --provenance <provenance> --coverage <coverage> --out-dir <review>
```

Show the exact preview to the actual project owner. Only after their approval:

```sh
node "$OMD_ROOT/scripts/prepare-design-md-core-review.cjs" --approve <review>/review-request.json --reviewer <actual-owner-id> --out <approval> --authority-transition-approved
node "$OMD_ROOT/scripts/compile-design-md-core.cjs" <review>/input-graph.json --provenance <review>/provenance.json --coverage <review>/coverage.json --review-receipt <approval> --out-dir <fresh-package> --adopt
node "$OMD_ROOT/scripts/adopt-design-md-core.cjs" <fresh-package> --prepare-checkpoint <checkpoint> --reviewer <actual-owner-id> --authority-transition-approved
node "$OMD_ROOT/scripts/adopt-design-md-core.cjs" <fresh-package> --project-root <project-root> --checkpoint-receipt <checkpoint>
node "$OMD_ROOT/scripts/validate-project-design-system.cjs" <project-root> <run-dir>
```

A compiler pass proves structural and binding conformance, not source truth,
asset licensing, accessibility, or visual quality. Preserve those separate
checks. Existing legacy systems require staged lossless migration, not a rewrite.

## Optional browser measurements

Core helpers and preference hooks use only built-in runtime modules. Render
integrity, text contrast, and restraint measurements need the exact optional
local dependency `playwright-core` 1.61.1 plus a compatible browser.
Nothing installs dependencies or downloads a browser
on invocation. A person who wants those measurements can install the declared
package locally in the installed plugin directory:

```sh
npm install --prefix "$OMD_ROOT" --ignore-scripts --no-audit --no-fund
```

This is an optional dependency setup, not an OmD CLI install. No global install
is needed. Render-integrity and text-contrast use the matching Playwright cache
first and existing Google Chrome otherwise. `OMD_BROWSER=chrome` explicitly
chooses Chrome for those tools. Restraint requires the matching Playwright
Chromium and accepts `PW_CORE` for an existing Playwright module. Browser setup
is described in [Playwright's browser documentation](https://playwright.dev/docs/browsers).
If browser execution is unavailable, report the check as unavailable or failed
under its owning gate. Do not replace measured contrast or geometry with guesses.

```sh
node "$OMD_ROOT/test-v2/tools/render-integrity.mjs" <page.html>
node "$OMD_ROOT/test-v2/tools/text-contrast.mjs" <page.html>
node "$OMD_ROOT/skills/omd-restraint/scripts/selftest.mjs"
```

The reflow runner additionally needs an existing `browser-harness` connection
that accepts its bundled Python program. If that named connection is
unavailable, follow `omd-apply`'s explicit source-fallback
protocol. Never claim browser proof from static fallback.

## Preference hooks

Host adapters load pending preferences, capture off-system edit drift as inferred
observations, and suggest folding recurring corrections at the existing threshold.
Explicit corrections are recorded through `omd-remember`. Hooks never mutate
DESIGN.md or fold preferences themselves. Folding requires user approval through
`omd-learn`. Review-derived inferences require consent before recording.

Claude Code uses `hooks/hooks.json`. Codex's manifest selects `hooks/codex.json`,
which uses Codex's native plugin-root variable. Pi loads `hooks/pi.ts` as an
extension alongside the selected skill directories. Hermes loads `plugin.yaml`
and `__init__.py` as a native plugin. Its skill names use the `omd` namespace.
Both native adapters use the same bounded Node hooks and preserve tool results.

## Rebuild and verify the fork

From the fork root, run:

```sh
node integration/build-plugin.mjs
node --test integration/tests/package.test.mjs integration/tests/core-roundtrip.test.mjs
```

`integration/selection.json` owns the selected roots. The builder follows their
literal relative imports, includes explicit schema assets, copies available
`integration/adapters` content to the plugin root, and writes `plugins/omd`.
Use `--out <fresh-directory>` for an isolated build. It refuses to overwrite a
directory without its own build manifest. Output is deterministic and contains
no upstream CLI runtime, TypeScript source, website, or company DESIGN.md files.
Root fork files are development input, not installed plugin content.

Instruction projection replaces public CLI examples with bundled Node helpers
and adds installed-path and native-role routing rules. The council helper's
visual-grounding process labels use current product and approved assets instead
of catalog selection. Its IDs, evidence, authority classification, confidence,
dispositions, hash freezing, and user-approval logic are unchanged.

The build manifest lists SHA-256 hashes for every payload file. Tests exercise
package selection, link and import closure, preserved numbered gates, isolated
helpers, and the provider-free approval/adoption chain. Browser measurements
require the optional setup above and are not part of the dependency-free suite.
