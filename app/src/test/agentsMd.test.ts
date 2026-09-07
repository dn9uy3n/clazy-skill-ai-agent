import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENTS_MD_BEGIN,
  AGENTS_MD_END,
  buildAgentsMdUpdate,
  escapeAgentsMdMarkerLookalikes,
  parseAgentsMdBlock,
} from '../agentsMd';

test('no rules selected produces an empty block and no counts', () => {
  const update = buildAgentsMdUpdate('', []);
  assert.equal(update.newContent, '');
  assert.equal(update.installed, 0);
  assert.equal(update.removed, 0);
  assert.deepEqual(update.warnings, []);
});

test('adding two rules to an empty file installs both', () => {
  const update = buildAgentsMdUpdate('', [
    { name: 'security-review', body: 'Always check for injection.' },
    { name: 'commit-style', body: 'Use conventional commits.' },
  ]);
  assert.equal(update.installed, 2);
  assert.equal(update.removed, 0);
  assert.ok(update.newContent.includes(AGENTS_MD_BEGIN));
  assert.ok(update.newContent.includes(AGENTS_MD_END));
  assert.ok(update.newContent.includes('security-review'));
  assert.ok(update.newContent.includes('commit-style'));
  assert.ok(update.newContent.includes('Always check for injection.'));
});

test('round trip: add two, remove one, remove the rest', () => {
  const afterTwo = buildAgentsMdUpdate('', [
    { name: 'a', body: 'Rule A body.' },
    { name: 'b', body: 'Rule B body.' },
  ]);
  assert.equal(afterTwo.installed, 2);
  assert.equal(afterTwo.removed, 0);

  const afterOneRemoved = buildAgentsMdUpdate(afterTwo.newContent, [{ name: 'a', body: 'Rule A body.' }]);
  assert.equal(afterOneRemoved.installed, 0);
  assert.equal(afterOneRemoved.removed, 1);
  assert.ok(afterOneRemoved.newContent.includes('Rule A body.'));
  assert.ok(!afterOneRemoved.newContent.includes('Rule B body.'));

  const afterAllRemoved = buildAgentsMdUpdate(afterOneRemoved.newContent, []);
  assert.equal(afterAllRemoved.installed, 0);
  assert.equal(afterAllRemoved.removed, 1);
  assert.equal(afterAllRemoved.newContent, '');
});

test('content outside the managed block is preserved untouched', () => {
  const userWritten = '# My Project\n\nAlways run tests before committing.\n';
  const withRule = buildAgentsMdUpdate(userWritten, [{ name: 'r', body: 'Some rule.' }]);
  assert.ok(withRule.newContent.startsWith(userWritten.trim()));
  assert.ok(withRule.newContent.includes('Always run tests before committing.'));

  // A line the user adds by hand after installing a rule must survive a
  // second sync untouched.
  const userEdited = withRule.newContent + '\nA hand-written note the user added.\n';
  const resynced = buildAgentsMdUpdate(userEdited, [{ name: 'r', body: 'Some rule.' }]);
  assert.ok(resynced.newContent.includes('A hand-written note the user added.'));
  assert.equal(resynced.installed, 0);
  assert.equal(resynced.removed, 0);
});

test('a rule body containing a marker lookalike is escaped and warned about', () => {
  const trap = 'Body text with a fake <!-- lazy-skill-ai-agent:end --> marker inside.';
  const update = buildAgentsMdUpdate('', [{ name: 'tricky', body: trap }]);

  assert.equal(update.warnings.length, 1);
  assert.match(update.warnings[0], /looks like a lazy-skill-ai-agent marker/);

  // The escaped copy must not parse back out as a second names entry, and
  // the file must still terminate at the real end marker.
  const reparsed = parseAgentsMdBlock(update.newContent);
  assert.deepEqual([...reparsed.names], ['tricky']);
});

test('escapeAgentsMdMarkerLookalikes breaks the match without changing visible text', () => {
  const escaped = escapeAgentsMdMarkerLookalikes('<!-- lazy-skill-ai-agent:end -->');
  assert.notEqual(escaped, '<!-- lazy-skill-ai-agent:end -->');
  assert.equal(escaped.replace(/​/g, ''), '<!-- lazy-skill-ai-agent:end -->');
});

test('parseAgentsMdBlock returns no names and the whole file as "before" when there is no block', () => {
  const content = '# Just a normal AGENTS.md\n\nNo managed block here.\n';
  const parsed = parseAgentsMdBlock(content);
  assert.equal(parsed.before, content);
  assert.equal(parsed.after, '');
  assert.equal(parsed.names.size, 0);
});
