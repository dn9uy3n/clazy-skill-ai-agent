import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { DEFAULT_PLATFORM, getPlatform, isTargetPlatform, PLATFORMS, platformUiList } from '../platforms';
import { TargetPlatform } from '../types';

const PROJECT = path.join('proj'); // relative on purpose: works whether the test runs on Windows or POSIX

// The pre-refactor switches this registry replaced (skillInstaller.ts, before
// the platforms.ts extraction) — pinned here so the refactor can't silently
// change where an existing platform installs to.
const EXPECTED_SKILLS_DIR: Record<TargetPlatform, string> = {
  'claude-code': path.join(PROJECT, '.claude', 'skills'),
  antigravity: path.join(PROJECT, '.agent', 'skills'),
  cursor: path.join(PROJECT, '.cursor', 'skills'),
  zcode: path.join(PROJECT, '.zcode', 'skills'),
};

test('platform ids are unique', () => {
  const ids = PLATFORMS.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('getPlatform is total over every TargetPlatform member', () => {
  const allIds: TargetPlatform[] = ['claude-code', 'antigravity', 'cursor', 'zcode'];
  for (const id of allIds) {
    assert.equal(getPlatform(id).id, id);
  }
});

test('getPlatform falls back to the default for an unknown id', () => {
  // @ts-expect-error deliberately passing an invalid platform id
  assert.equal(getPlatform('made-up-tool').id, DEFAULT_PLATFORM);
});

test('isTargetPlatform accepts known ids and rejects garbage', () => {
  assert.equal(isTargetPlatform('zcode'), true);
  assert.equal(isTargetPlatform('claude-code'), true);
  assert.equal(isTargetPlatform('made-up-tool'), false);
  assert.equal(isTargetPlatform(42), false);
  assert.equal(isTargetPlatform(undefined), false);
});

test('skillsDir matches the legacy per-platform paths', () => {
  for (const [id, expected] of Object.entries(EXPECTED_SKILLS_DIR)) {
    assert.equal(getPlatform(id as TargetPlatform).skillsDir(PROJECT), expected);
  }
});

test('rules.kind is "agents-md" only for zcode', () => {
  for (const p of PLATFORMS) {
    if (p.id === 'zcode') {
      assert.equal(p.rules.kind, 'agents-md');
    } else {
      assert.equal(p.rules.kind, 'files');
    }
  }
});

test('legacy folder-based rule dirs match the pre-refactor switch', () => {
  const claudeCode = getPlatform('claude-code').rules;
  const antigravity = getPlatform('antigravity').rules;
  const cursor = getPlatform('cursor').rules;
  assert.equal(claudeCode.kind, 'files');
  assert.equal(antigravity.kind, 'files');
  assert.equal(cursor.kind, 'files');
  if (claudeCode.kind === 'files') {
    assert.equal(claudeCode.dir(PROJECT), path.join(PROJECT, '.claude', 'rules'));
  }
  // Deliberate asymmetry: .agent/skills (singular) but .agents/rules (plural).
  if (antigravity.kind === 'files') {
    assert.equal(antigravity.dir(PROJECT), path.join(PROJECT, '.agents', 'rules'));
  }
  if (cursor.kind === 'files') {
    assert.equal(cursor.dir(PROJECT), path.join(PROJECT, '.cursor', 'rules'));
  }
});

test('zcode has no rules folder and merges into AGENTS.md instead', () => {
  const rules = getPlatform('zcode').rules;
  assert.equal(rules.kind, 'agents-md');
  if (rules.kind === 'agents-md') assert.equal(rules.file(PROJECT), path.join(PROJECT, 'AGENTS.md'));
});

test('zcode skips the generated skills index; the other three write it', () => {
  assert.equal(getPlatform('zcode').writesSkillIndex, false);
  assert.equal(getPlatform('claude-code').writesSkillIndex, true);
  assert.equal(getPlatform('antigravity').writesSkillIndex, true);
  assert.equal(getPlatform('cursor').writesSkillIndex, true);
});

test('only zcode declares a description length cap', () => {
  assert.equal(getPlatform('zcode').maxDescriptionChars, 1024);
  assert.equal(getPlatform('claude-code').maxDescriptionChars, undefined);
  assert.equal(getPlatform('antigravity').maxDescriptionChars, undefined);
  assert.equal(getPlatform('cursor').maxDescriptionChars, undefined);
});

test('platformUiList returns every platform with an id, label, and (for zcode) an explanatory note', () => {
  // The Rules UI is identical for every platform (same "pick which configured
  // rules apply" checkbox list) — only the backend install target differs, so
  // the panel must never hide it for a platform. The AGENTS.md-merge behavior
  // is instead surfaced to the user only through zcode's note text.
  const list = platformUiList();
  assert.equal(list.length, PLATFORMS.length);
  for (const p of list) {
    assert.ok(p.id);
    assert.ok(p.label);
  }
  const zcode = list.find(p => p.id === 'zcode');
  assert.match(zcode?.note ?? '', /AGENTS\.md/);
});
