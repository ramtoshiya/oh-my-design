# Master intake and production transition

Read only when the deterministic council handoff is unavailable, the task
contains a URL or Figma input, or the user explicitly shifts to production.

## Intake {:#intake}

1. Read `.omd/context.json` when present. Otherwise inspect project metadata,
   UI files, token sources, the brief, and approved assets without writing.
2. Empty greenfield work enters SLOT_GATE. Existing code enters CONTEXT_DETECT.
   A URL enters URL_EXTRACT. A prior run enters LOAD_STATE/CONTINUE.
3. Fast-exit may propose a reversible plan while leaving unresolved facts absent.
   It never bypasses mandatory Phase 3, Phase 5, or ship checkpoints.
4. Derive generic design decisions from the brief and actual product. Preset
   contracts are component guidance, not a catalog of company DESIGN.md files.

## URL and Figma evidence {:#url-figma}

Inspect observable colors, declared fonts, spacing, and composition with
confidence labels. Marketing evidence does not become product fact without an
explicit bridge. If extraction fails, ask for inspectable artifacts or continue
with authorized generic proposals. Do not invent source IDs or brand values.
Figma guidance requires inspectable tokens or supplied exports before it can
authorize exact values.

## Production transition {:#production-transition}

1. Read the prototype for observable atmosphere, motion, and voice signals.
2. Compare those signals with the brief, current DESIGN.md, and approved assets.
   Record proposed changes and unknowns. Do not choose a company catalog base.
3. Preserve an existing DESIGN.md before any approved replacement.
4. Apply only user-authorized delta axes. Unmentioned axes remain unchanged.
5. Keep source evidence for voice, narrative, principles, personas, states,
   fonts, and motion. Unknown facts stay absent from prescriptive Core fields.
6. Record source paths, approved deltas, preserved sections, unresolved paths,
   predecessor, and timestamp in the run manifest.
7. Follow the graph-first review, compiler, checkpoint, atomic-adoption, and
   final-validator chain. No manual DESIGN.md, manifest, or binding edits.
8. Continue asset advice, microcopy, accessibility, and delivery only within
   the approved scope. No upstream site publication or channel-shim sync step.