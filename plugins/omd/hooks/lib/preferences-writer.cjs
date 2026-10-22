#!/usr/bin/env node
// Shared writer for .omd/preferences.md — appends entries in the EXACT
// canonical format the omd:remember skill writes (skills/omd-remember/SKILL.md).
// The remember format is the single source of truth; this writer must stay
// byte-compatible with what lib/preferences-parser.cjs reads:
//
//   ## <ISO timestamp> — <slug>
//
//   ```omd-meta
//   id: pref_<base36 timestamp>_<8 hex chars>
//   timestamp: <ISO timestamp>
//   scope: <scope>
//   signal: ambient
//   confidence: inferred
//   status: pending
//   source_agent: claude-code
//   source_context: "src/components/Button.tsx"
//   ```
//
//   <body>

'use strict';

const { readState, writeState } = require('./safe-persistence.cjs');
const crypto = require('node:crypto');
const { parsePreferences } = require('./preferences-parser.cjs');

// Same header omd:remember creates on first write (SKILL.md Step 5).
const FILE_HEADER =
  '---\n' +
  'schema: omd.preferences/v1\n' +
  'design_md_hash_at_creation:\n' +
  '---\n' +
  '\n' +
  '# Preference Log\n';

/** Slug rule from omd:remember SKILL.md Step 4. */
function slugify(s) {
  return (
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'entry'
  );
}

/** Normalize a body for dedup comparison (case/whitespace-insensitive). */
function normalizeBody(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Append a canonical entry to <dir>/.omd/preferences.md.
 * Creates the file (with its frontmatter header) if missing.
 * Dedup: if an existing entry has the same scope AND the same normalized body
 * within the last 24h, skip — returns { written: false, reason: 'duplicate' }.
 */
function appendEntry({ dir, scope, signal, confidence, body, sourceAgent, sourceContext }) {
  if (!dir || !scope || !body) {
    return { written: false, reason: 'invalid-args', id: '' };
  }
  let text = readState(dir, 'preferences.md');

  const now = Date.now();
  const norm = normalizeBody(body);
  for (const e of parsePreferences(text)) {
    if (e.scope !== scope) continue;
    if (normalizeBody(e.body) !== norm) continue;
    if (!Number.isNaN(e.timestamp) && now - e.timestamp <= 24 * 3600 * 1000) {
      return { written: false, reason: 'duplicate', id: e.raw.id || '' };
    }
  }

  const ts = new Date(now).toISOString();
  // id rule from omd:remember SKILL.md Step 3: pref_<base36 ts>_<8 hex chars>.
  const id =
    'pref_' + now.toString(36) + '_' + crypto.randomBytes(4).toString('hex');
  const metaLines = [
    `id: ${id}`,
    `timestamp: ${ts}`,
    `scope: ${scope}`,
    `signal: ${signal || 'ambient'}`,
    `confidence: ${confidence || 'inferred'}`,
    'status: pending',
    `source_agent: ${sourceAgent || 'claude-code'}`,
  ];
  if (sourceContext) {
    metaLines.push(`source_context: ${JSON.stringify(sourceContext)}`);
  }
  const entry = [
    `## ${ts} — ${slugify(body)}`,
    '',
    '```omd-meta',
    ...metaLines,
    '```',
    '',
    String(body).trim(),
    '',
  ].join('\n');

  if (!text) text = FILE_HEADER;
  if (!text.endsWith('\n')) text += '\n';
  if (!writeState(dir, 'preferences.md', text + '\n' + entry)) {
    return { written: false, reason: 'unsafe-or-unwritable', id: '' };
  }
  return { written: true, id };
}

module.exports = { appendEntry };
