---
name: omd-orchestrator
description: "Coordinates advisory design, UX writing, humanization, slop audit, designer review, and final QA. The caller owns implementation and locale drafts. Keeps a two-round revision cap per critic gate."
metadata:
  internal: true
---

# omd:orchestrator

Coordinate specialists without transferring product-write authority away from
the caller. Read DESIGN.md and pending preferences at each stage. A valid bound
Core graph is canonical. Otherwise use the standalone DESIGN.md contract.

## Routing {:#routing}

| Request | Advisory role or caller action |
| --- | --- |
| UX copy strategy | `omd-ux-writer` |
| UI microcopy | `omd-microcopy` |
| Writing or localization | Caller drafts using the brief and `content-locales` |
| Naturalness or translation artifacts | `omd-humanizer` after the caller's draft |
| Context-free UI repetition | `omd-slop-auditor` |
| Interaction, focus, responsive behavior | `omd-ux-engineer` |
| Visual and system consistency | `omd-designer-review` |
| Accessibility | `omd-a11y-auditor` |
| Final evidence-based verdict | `omd-final-qa` |
| Asset advice | `omd-asset-curator` using approved assets and verified licenses |

Resolve native role IDs against the actual host roster. Claude plugin agents
use `omd:<role-id>`, for example `omd:omd-ux-writer`. If a role is unavailable,
read `../../agents/<role-id>.md` relative to this skill directory and apply its
perspective inline. Never claim an independent worker ran when it did not.
Do not install a CLI, writing worker, localization worker, or image service.

## Work packet {:#work-packet}

Freeze this packet before dispatch. Choose at most three relevant advisers.

```yaml
intent: audit | implement
task: <original user outcome>
consumer_route: <real route or null>
acceptance: []
protected_behaviors: []
protected_contract: <unchanged cardinality, state transitions, facts, authority>
visual_equity: []
evidence: []
unknowns: []
implementation_owner: caller-main-agent
verification:
  routes: []
  viewports: []
  states: []
  commands: []
```

Give each adviser only this packet and relevant evidence. Findings contain
`finding`, `evidence`, `smallest_useful_change`, `acceptance_check`, and
`unresolved`. Existing-UI bounded repair advice covers one or two risks, at
most three findings, and about 300 words. Preserve the protected behavior and
visual equity ledgers. Reject suggestions without original-task authority.

## Workflow {:#workflow}

1. Caller writes or localizes only the requested artifacts using the brief,
   approved sources, and DESIGN.md `content-locales` contract. Each locale is
   independent. Preserve facts, numbers, links, IDs, code, and protected spans.
2. When writing needs post-editing, run `omd-humanizer` for each locale. It does
   not invent facts or change project authority.
3. Run `omd-designer-review` on the actual artifact and current DESIGN.md.
   The caller revises it, with a maximum of two review rounds.
4. Run `omd-final-qa` read-only using its complete eight-item rubric. The caller
   revises it, with a separate maximum of two QA rounds. Each PASS needs
   evidence. Each FAIL needs a line reference, quote, and repair direction.
5. Return one prioritized handoff plus reviews, revision log, and unresolved
   checks. No upstream website paths, publication frontmatter, or locale
   conventions are required. Use the user's output paths.

UI delivery stays with the caller's `omd:apply` path. Advisory output is
`status: advice-ready`, not implementation completion. The caller edits the
product and verifies the same consumer route, viewport, and state before `done`.
Audit-only work may end with a report.

## Revision cap and authority {:#revision-cap}

Track `designer_review: {round: 0, max: 2}` and
`final_qa: {round: 0, max: 2}` in the work directory. After round two BLOCK,
stop and ask the actual user whether to revise scope, accept explicitly listed
known issues, or abort. Do not reset counters or force-pass on the user's behalf.
No round three. Critics never edit product files. The caller is the sole writer
for a given artifact, so locale work may run in parallel only on distinct files.

Record stage, role, status, artifact path, round, and user decisions in
`<work_dir>/.orchestrator.log`. Reviews go under `<work_dir>/.reviews/`.
Re-read DESIGN.md every stage. Do not treat memory or adviser agreement as proof.
Never skip designer review before final QA or accept a rubber-stamp verdict.
Never call advice delivery, a skipped browser check a pass, or an inferred
preference an explicit user correction.

Preference capture uses `omd:remember`. Reviewer-inferred candidates require
one batched consent question per run and remain `pending` with `signal: review`
and `confidence: inferred`. Folding remains `omd:learn`'s gated operation.