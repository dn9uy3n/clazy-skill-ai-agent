import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstLine, parseFrontmatter, toDisplayString } from '../frontmatter';

// This parser is js-yaml-backed (CORE_SCHEMA), unlike the VS Code extension's
// hand-written one — same contract (name/description in, ParsedDoc out), but
// worth its own suite since it also surfaces an `error` field the hand-written
// parser doesn't have.

test('plain scalar name and description', () => {
  const doc = parseFrontmatter('---\nname: commit\ndescription: Auto-generate commit messages\n---\nBody text.');
  assert.equal(doc.frontmatter.name, 'commit');
  assert.equal(doc.frontmatter.description, 'Auto-generate commit messages');
  assert.equal(doc.body, 'Body text.');
  assert.equal(doc.error, undefined);
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

test('folded block scalar (>-) joins lines with spaces', () => {
  const doc = parseFrontmatter(
    '---\nname: x\ndescription: >-\n  Use this skill when the user\n  mentions dashboards.\n---\nBody',
  );
  assert.equal(doc.frontmatter.description, 'Use this skill when the user mentions dashboards.');
});

test('literal block scalar (|) preserves line breaks', () => {
  const doc = parseFrontmatter('---\ndescription: |\n  Line one.\n  Line two.\n---\nBody');
  assert.equal(doc.frontmatter.description, 'Line one.\nLine two.\n');
});

test('a flow sequence parses as an array of scalars', () => {
  const doc = parseFrontmatter('---\ntags: [a, b, "c d"]\n---\nBody');
  assert.deepEqual(doc.frontmatter.tags, ['a', 'b', 'c d']);
});

test('a nested mapping is preserved as-is (unlike the hand-written parser, which skips it)', () => {
  const doc = parseFrontmatter('---\nmetadata:\n  type: feedback\nname: still-readable\n---\nBody');
  assert.deepEqual(doc.frontmatter.metadata, { type: 'feedback' });
  assert.equal(doc.frontmatter.name, 'still-readable');
});

test('invalid YAML sets `error` instead of throwing, and body still comes through', () => {
  const doc = parseFrontmatter('---\nname: [unclosed\n---\nBody text.');
  assert.ok(doc.error);
  assert.deepEqual(doc.frontmatter, {});
  assert.equal(doc.body, 'Body text.');
});

test('a frontmatter block that is a scalar, not a mapping, is reported as an error', () => {
  const doc = parseFrontmatter('---\njust a string\n---\nBody');
  assert.ok(doc.error);
  assert.match(doc.error as string, /not a key\/value mapping/);
});

test('a very long single-line description (real ZCode skill shape) round-trips verbatim', () => {
  const longDescription =
    "Use when configuring ZCode's extension resources (MCP servers, slash commands, skills, hooks, and plugins) or instruction files such as AGENTS.md in the ZCode client. Explains where each resource is configured at the user and workspace scope, the discovery order, precedence, and merge rules, plus guidance on which location to choose.";
  const doc = parseFrontmatter(`---\nname: zcode-configuration-guide\ndescription: ${longDescription}\n---\nBody`);
  assert.equal(doc.frontmatter.description, longDescription);
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
