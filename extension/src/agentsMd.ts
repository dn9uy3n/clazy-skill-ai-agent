/**
 * Pure string logic for merging "rules" into a target platform's AGENTS.md,
 * split out from `skillInstaller.ts` so it has no `vscode` dependency and can
 * be unit-tested with `node:test` outside the extension host.
 *
 * ZCode (and any future `agents-md`-strategy platform, see `platforms.ts`)
 * has no rules folder — it only reads AGENTS.md into context. So a selected
 * "rule" is merged into a managed block inside that file, bounded by these
 * markers, rather than copied as a standalone file. Everything outside the
 * block is left exactly as the user wrote it.
 *
 * Mirror of app/src/agentsMd.ts — keep the two in sync.
 */

export const AGENTS_MD_BEGIN = '<!-- lazy-skill-ai-agent:begin — do not edit inside this block -->';
export const AGENTS_MD_END = '<!-- lazy-skill-ai-agent:end -->';
export const AGENTS_MD_RULE_END = '<!-- lazy-skill-ai-agent:rule-end -->';
const AGENTS_MD_RULE_NAME_RE = /<!--\s*lazy-skill-ai-agent:rule name="([^"]*)"\s*-->/g;
export const AGENTS_MD_MARKER_RE = /<!--\s*lazy-skill-ai-agent:/;

export function agentsMdRuleBeginTag(name: string): string {
  return `<!-- lazy-skill-ai-agent:rule name="${name.replace(/"/g, '&quot;')}" -->`;
}

/**
 * A rule body could itself contain text that looks like one of our markers
 * (accidentally or by copy-paste), which would otherwise be indistinguishable
 * from real structure on the next parse. Break any lookalike by inserting a
 * zero-width space (U+200B, invisible when rendered) so it no longer matches.
 */
export function escapeAgentsMdMarkerLookalikes(text: string): string {
  return text.replace(/<!--\s*lazy-skill-ai-agent:/g, '<!-- lazy-skill-ai-agent​:');
}

export interface AgentsMdBlock {
  before: string;
  after: string;
  names: Set<string>;
}

export function parseAgentsMdBlock(content: string): AgentsMdBlock {
  const beginIdx = content.indexOf(AGENTS_MD_BEGIN);
  if (beginIdx === -1) return { before: content, after: '', names: new Set() };

  const endIdx = content.indexOf(AGENTS_MD_END, beginIdx);
  const blockEnd = endIdx === -1 ? content.length : endIdx + AGENTS_MD_END.length;
  const block = content.slice(beginIdx, blockEnd);

  const names = new Set<string>();
  AGENTS_MD_RULE_NAME_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = AGENTS_MD_RULE_NAME_RE.exec(block))) {
    names.add(m[1].replace(/&quot;/g, '"'));
  }

  return { before: content.slice(0, beginIdx), after: content.slice(blockEnd), names };
}

export function rebuildAgentsMd(before: string, block: string, after: string): string {
  const trimmedBefore = before.replace(/\s+$/, '');
  const trimmedAfter = after.replace(/^\s+/, '');
  const parts = [trimmedBefore, block, trimmedAfter].filter(s => s.length > 0);
  if (parts.length === 0) return '';
  return parts.join('\n\n') + '\n';
}

export interface AgentsMdRuleInput {
  /** Already sanitized — the identity used both as the marker key and for dedup. */
  name: string;
  /** Raw rule body (frontmatter already stripped). */
  body: string;
}

export interface AgentsMdUpdate {
  newContent: string;
  installed: number;
  removed: number;
  warnings: string[];
}

/**
 * The entire pure core of a sync: given the file's current content and the
 * full set of rules that should end up in the managed block, compute the new
 * file content plus install/remove counts and any warnings — with no I/O.
 */
export function buildAgentsMdUpdate(currentContent: string, rules: AgentsMdRuleInput[]): AgentsMdUpdate {
  const { before, after, names: previousNames } = parseAgentsMdBlock(currentContent);

  const warnings: string[] = [];
  const entries: string[] = [];
  for (const rule of rules) {
    if (AGENTS_MD_MARKER_RE.test(rule.body)) {
      warnings.push(
        `Rule ${rule.name}: its body contains text that looks like a lazy-skill-ai-agent marker; it was escaped so the merged AGENTS.md stays parseable.`,
      );
    }
    entries.push(
      `${agentsMdRuleBeginTag(rule.name)}\n${escapeAgentsMdMarkerLookalikes(rule.body.trim())}\n${AGENTS_MD_RULE_END}`,
    );
  }

  const block = entries.length > 0 ? [AGENTS_MD_BEGIN, ...entries, AGENTS_MD_END].join('\n\n') : '';
  const newContent = rebuildAgentsMd(before, block, after);

  const newNames = new Set(rules.map(r => r.name));
  const installed = [...newNames].filter(n => !previousNames.has(n)).length;
  const removed = [...previousNames].filter(n => !newNames.has(n)).length;

  return { newContent, installed, removed, warnings };
}
