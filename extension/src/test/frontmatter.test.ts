import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstLine, parseFrontmatter, parseYamlMap, toDisplayString } from '../frontmatter';

// This hand-written parser has no yaml library backing it and, before this
// suite, was validated once by a throwaway script diffing it against
// js-yaml over a real ~800-skill corpus, then never checked again. These
// cases pin the behavior documented in the file's own header comment.

test('plain scalar name and description', () => {
  const doc = parseFrontmatter('---\nname: commit\ndescription: Auto-generate commit messages\n---\nBody text.');
  assert.equal(doc.frontmatter.name, 'commit');
  assert.equal(doc.frontmatter.description, 'Auto-generate commit messages');
  assert.equal(doc.body, 'Body text.');
});

test('no frontmatter block returns an empty map and the whole trimmed content as body', () => {
  const doc = parseFrontmatter('# Just a heading\n\nNo frontmatter here.\n');
  assert.deepEqual(doc.frontmatter, {});
  assert.equal(doc.body, '# Just a heading\n\nNo frontmatter here.');
});

test('a UTF-8 BOM at the start does not break the leading --- anchor', () => {
  const doc = parseFrontmatter('﻿---\nname: bommed\n---\nBody');
  assert.equal(doc.frontmatter.name, 'bommed');
});

test('folded block scalar (>-) joins lines with spaces and strips the trailing newline', () => {
  const raw = ['name: x', 'description: >-', '  Use this skill when the user', '  mentions dashboards.', ''].join(
    '\n',
  );
  const fm = parseYamlMap(raw);
  assert.equal(fm.description, 'Use this skill when the user mentions dashboards.');
});

test('literal block scalar (|) preserves line breaks', () => {
  const raw = ['description: |', '  Line one.', '  Line two.', ''].join('\n');
  const fm = parseYamlMap(raw);
  assert.equal(fm.description, 'Line one.\nLine two.\n');
});

test('a double-quoted scalar that wraps across lines is folded back together', () => {
  const raw = ['description: "This is a long description', '  that wraps onto a second physical line."'].join(
    '\n',
  );
  const fm = parseYamlMap(raw);
  assert.equal(fm.description, 'This is a long description that wraps onto a second physical line.');
});

test('a single-quoted scalar unescapes doubled quotes', () => {
  const fm = parseYamlMap("name: 'it''s a trap'");
  assert.equal(fm.name, "it's a trap");
});

test('a flow sequence parses as an array of scalars', () => {
  const fm = parseYamlMap('tags: [a, b, "c d"]');
  assert.deepEqual(fm.tags, ['a', 'b', 'c d']);
});

test('a nested mapping value is skipped (result is null), not misread as a scalar', () => {
  const raw = ['metadata:', '  type: feedback', 'name: still-readable'].join('\n');
  const fm = parseYamlMap(raw);
  assert.equal(fm.metadata, null);
  assert.equal(fm.name, 'still-readable');
});

test('a block sequence of scalars parses as an array', () => {
  const raw = ['aliases:', '  - one', '  - two', 'name: after'].join('\n');
  const fm = parseYamlMap(raw);
  assert.deepEqual(fm.aliases, ['one', 'two']);
  assert.equal(fm.name, 'after');
});

test('a plain scalar absorbs an indented continuation line into its own value, not a sibling key', () => {
  // An indented line right after a plain scalar looks like it could be a
  // sibling `key: value`, but the multi-line plain-scalar continuation rule
  // (see the "Plain scalar, possibly continued..." branch) folds it into
  // the *previous* key's value instead — it never becomes its own key.
  const raw = ['name: top', '  fake: nope'].join('\n');
  const fm = parseYamlMap(raw);
  assert.equal(fm.name, 'top fake: nope');
  assert.equal('fake' in fm, false);
});

test('a very long single-line description (real ZCode skill shape) round-trips verbatim', () => {
  // Mirrors the style zcode-configuration-guide/SKILL.md ships with: one
  // long, single-line, comma-heavy description with no wrapping.
  const longDescription =
    "Use when configuring ZCode's extension resources (MCP servers, slash commands, skills, hooks, and plugins) or instruction files such as AGENTS.md in the ZCode client. Explains where each resource is configured at the user and workspace scope, the discovery order, precedence, and merge rules, plus guidance on which location to choose.";
  const raw = `name: zcode-configuration-guide\ndescription: ${longDescription}`;
  const fm = parseYamlMap(raw);
  assert.equal(fm.description, longDescription);
  assert.equal((fm.description as string).length, longDescription.length);
});

test('toDisplayString collapses internal whitespace and joins arrays', () => {
  assert.equal(toDisplayString('a\n  b   c'), 'a b c');
  assert.equal(toDisplayString(['a', 'b', '']), 'a, b');
  assert.equal(toDisplayString(null), '');
  assert.equal(toDisplayString(42), '42');
});

test('firstLine returns the first non-blank line, trimmed', () => {
  assert.equal(firstLine('\n\n  Hello there  \nSecond line'), 'Hello there');
  assert.equal(firstLine('   \n   '), '');
});
