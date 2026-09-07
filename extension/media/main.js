// @ts-check

const vscode = acquireVsCodeApi();

/** @type {import('../src/types').SkillInfo[]} */
let skills = [];
/** @type {import('../src/types').RuleInfo[]} */
let rules = [];
/** @type {string[]} */
let directories = [];
/** @type {string[]} */
let ruleFiles = [];
let currentPlatform = 'claude-code';
/** @type {import('../src/types').PlatformMeta[]} */
let platforms = [];
let selectedItemId = null;
/** @type {Set<string>} */
let checkedSkillIds = new Set();
/** @type {Set<string>} */
let checkedRuleIds = new Set();
/** @type {{dir: string, count: number}[]} */
let dirStats = [];
/** @type {string[]} */
let scanErrors = [];

const dirList = document.getElementById('dir-list');
const ruleFileList = document.getElementById('rule-file-list');
const skillList = document.getElementById('skill-list');
const ruleList = document.getElementById('rule-list');
const filterInput = /** @type {HTMLInputElement} */ (document.getElementById('filter-input'));
const ruleFilterInput = /** @type {HTMLInputElement} */ (document.getElementById('rule-filter-input'));
const descriptionBox = document.getElementById('skill-description');
const statusMsg = document.getElementById('status-msg');
const btnAddDir = document.getElementById('btn-add-dir');
const btnAddRuleFile = document.getElementById('btn-add-rule-file');
const btnRefresh = /** @type {HTMLButtonElement} */ (document.getElementById('btn-refresh'));
const btnCancel = document.getElementById('btn-cancel');
const btnApply = document.getElementById('btn-apply');
const platformList = document.getElementById('platform-list');
const platformNote = document.getElementById('platform-note');
const ruleFilesSection = document.getElementById('rule-files-section');
const rulesSection = document.getElementById('rules-section');

btnAddDir.addEventListener('click', () => vscode.postMessage({ command: 'addDirectory' }));
btnAddRuleFile.addEventListener('click', () => vscode.postMessage({ command: 'addRuleFile' }));
btnRefresh.addEventListener('click', () => vscode.postMessage({ command: 'refresh' }));

statusMsg.addEventListener('click', () => {
  if (scanErrors.length) descriptionBox.textContent = scanErrors.join('\n');
});

btnCancel.addEventListener('click', () => {
  checkedSkillIds = new Set(skills.filter(s => s.isInstalled).map(s => s.id));
  checkedRuleIds = new Set(rules.filter(r => r.isInstalled).map(r => r.id));
  renderSkills();
  renderRules();
});

btnApply.addEventListener('click', () => {
  vscode.postMessage({
    command: 'apply',
    skillIds: Array.from(checkedSkillIds),
    ruleIds: Array.from(checkedRuleIds),
  });
});

filterInput.addEventListener('input', renderSkills);
ruleFilterInput.addEventListener('input', renderRules);

window.addEventListener('message', event => {
  const msg = event.data;

  if (msg.command === 'scanning') {
    btnRefresh.disabled = true;
    setStatus('Scanning...', false);
    return;
  }

  if (msg.command === 'body') {
    // Ignore a body that arrives after the user moved to another item.
    if (msg.id !== selectedItemId) return;
    renderDescription(msg.body);
    return;
  }

  if (msg.command === 'update') {
    skills = msg.skills;
    rules = msg.rules;
    directories = msg.directories;
    ruleFiles = msg.ruleFiles;
    currentPlatform = msg.platform;
    platforms = msg.platforms || [];
    dirStats = msg.dirStats || [];
    scanErrors = msg.errors || [];

    checkedSkillIds = new Set(skills.filter(s => s.isInstalled).map(s => s.id));
    checkedRuleIds = new Set(rules.filter(r => r.isInstalled).map(r => r.id));

    renderPlatforms();
    renderDirectories();
    renderRuleFiles();
    renderSkills();
    renderRules();

    btnRefresh.disabled = false;
    setStatus(summarizeScan(), scanErrors.length > 0);
  }
});

/**
 * The radios are built from `platforms` (sent by the host on every scan)
 * instead of being hardcoded in the HTML, so adding a target tool is a
 * registry entry in platforms.ts, not an edit here or in webviewPanel.ts.
 */
function renderPlatforms() {
  platformList.innerHTML = platforms
    .map(p => {
      const checked = p.id === currentPlatform ? 'checked' : '';
      return `
        <label class="radio-label">
          <input type="radio" name="platform" value="${escAttr(p.id)}" ${checked}>
          ${esc(p.label)}
        </label>`;
    })
    .join('');

  platformList.querySelectorAll('input[type="radio"]').forEach(r => {
    r.addEventListener('change', () => {
      currentPlatform = /** @type {HTMLInputElement} */ (r).value;
      vscode.postMessage({ command: 'changePlatform', platform: currentPlatform });
    });
  });

  const current = platforms.find(p => p.id === currentPlatform);
  platformNote.textContent = current && current.note ? current.note : '';
  platformNote.hidden = !current || !current.note;

  const supportsRules = !current || current.supportsRuleFiles;
  ruleFilesSection.hidden = !supportsRules;
  rulesSection.hidden = !supportsRules;
}

function summarizeScan() {
  const parts = [
    `${skills.length} skill${skills.length === 1 ? '' : 's'}` +
      (dirStats.length
        ? ` from ${dirStats.length} director${dirStats.length === 1 ? 'y' : 'ies'}`
        : ''),
  ];
  if (rules.length) parts.push(`${rules.length} rules`);
  if (scanErrors.length) parts.push(`${scanErrors.length} problem(s) — click here`);
  return parts.join(' · ');
}

function setStatus(text, isError) {
  statusMsg.textContent = text;
  statusMsg.classList.toggle('status-error', !!isError);
  statusMsg.style.cursor = scanErrors.length ? 'pointer' : 'default';
}

function renderDirectories() {
  if (directories.length === 0) {
    dirList.innerHTML = '<div class="empty-state">No directories. Click "+ Add Directory" to start.</div>';
    return;
  }
  dirList.innerHTML = directories
    .map(
      dir => `
    <div class="dir-item">
      <span class="dir-path" title="${esc(dir)}">${esc(dir)}</span>
      <button class="btn-remove" data-dir="${escAttr(dir)}" title="Remove">×</button>
    </div>`,
    )
    .join('');
  dirList.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const dir = /** @type {HTMLElement} */ (e.currentTarget).dataset.dir;
      vscode.postMessage({ command: 'removeDirectory', directory: dir });
    });
  });
}

function renderRuleFiles() {
  if (ruleFiles.length === 0) {
    ruleFileList.innerHTML = '<div class="empty-state">No rule files. Click "+ Add Rule File".</div>';
    return;
  }
  ruleFileList.innerHTML = ruleFiles
    .map(
      file => `
    <div class="dir-item">
      <span class="dir-path" title="${esc(file)}">${esc(file)}</span>
      <button class="btn-remove" data-file="${escAttr(file)}" title="Remove">×</button>
    </div>`,
    )
    .join('');
  ruleFileList.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const file = /** @type {HTMLElement} */ (e.currentTarget).dataset.file;
      vscode.postMessage({ command: 'removeRuleFile', file });
    });
  });
}

function renderSkills() {
  const filter = filterInput.value.toLowerCase().trim();
  const filtered = skills.filter(
    s => !filter || s.name.toLowerCase().includes(filter) || s.description.toLowerCase().includes(filter),
  );

  if (filtered.length === 0) {
    skillList.innerHTML =
      skills.length === 0
        ? '<div class="empty-state">No skills found. Add a directory containing skill subfolders.</div>'
        : '<div class="empty-state">No skills match the filter.</div>';
    return;
  }

  skillList.innerHTML = filtered
    .map(s => {
      const checked = checkedSkillIds.has(s.id) ? 'checked' : '';
      const selected = s.id === selectedItemId ? 'selected' : '';
      return `
        <div class="skill-item ${selected}" data-id="${escAttr(s.id)}" data-kind="skill">
          <input type="checkbox" ${checked} data-id="${escAttr(s.id)}" data-kind="skill" />
          <span class="skill-name">${esc(s.name)}</span>
          <span class="skill-desc" title="${escAttr(s.description)}">${esc(truncate(s.description, 60))}</span>
          <span class="skill-source">${esc(basename(s.sourceDir))}</span>
        </div>`;
    })
    .join('');

  attachListItemHandlers(skillList);
}

function renderRules() {
  const filter = ruleFilterInput.value.toLowerCase().trim();
  const filtered = rules.filter(
    r => !filter || r.name.toLowerCase().includes(filter) || r.description.toLowerCase().includes(filter),
  );

  if (filtered.length === 0) {
    ruleList.innerHTML =
      rules.length === 0
        ? '<div class="empty-state">No rules. Add a rule file above.</div>'
        : '<div class="empty-state">No rules match the filter.</div>';
    return;
  }

  ruleList.innerHTML = filtered
    .map(r => {
      const checked = checkedRuleIds.has(r.id) ? 'checked' : '';
      const selected = r.id === selectedItemId ? 'selected' : '';
      return `
        <div class="skill-item ${selected}" data-id="${escAttr(r.id)}" data-kind="rule">
          <input type="checkbox" ${checked} data-id="${escAttr(r.id)}" data-kind="rule" />
          <span class="skill-name">${esc(r.name)}</span>
          <span class="skill-desc">${esc(truncate(r.description, 60))}</span>
          <span class="skill-source">${esc(basename(r.sourcePath))}</span>
        </div>`;
    })
    .join('');

  attachListItemHandlers(ruleList);
}

function attachListItemHandlers(container) {
  container.querySelectorAll('.skill-item').forEach(item => {
    const id = /** @type {HTMLElement} */ (item).dataset.id;
    const kind = /** @type {HTMLElement} */ (item).dataset.kind;

    item.addEventListener('click', e => {
      if (/** @type {HTMLElement} */ (e.target).tagName === 'INPUT') return;
      selectedItemId = id;
      renderSkills();
      renderRules();
      showDescription(id, kind);
    });

    const checkbox = /** @type {HTMLInputElement} */ (item.querySelector('input[type="checkbox"]'));
    checkbox.addEventListener('change', () => {
      const set = kind === 'rule' ? checkedRuleIds : checkedSkillIds;
      if (checkbox.checked) set.add(id);
      else set.delete(id);
    });
  });
}

/** Markdown bodies are fetched per item so the scan payload stays small. */
function showDescription(id, kind) {
  const item = kind === 'rule' ? rules.find(r => r.id === id) : skills.find(s => s.id === id);
  if (!item) {
    descriptionBox.textContent = 'Item not found.';
    return;
  }
  renderDescription('Loading...');
  vscode.postMessage({ command: 'getBody', id, sourcePath: item.sourcePath });
}

function renderDescription(bodyText) {
  const item =
    skills.find(s => s.id === selectedItemId) || rules.find(r => r.id === selectedItemId);
  if (!item) return;
  const isRule = rules.some(r => r.id === selectedItemId);

  descriptionBox.textContent = [
    `Type: ${isRule ? 'Rule' : 'Skill'}`,
    `Name: ${item.name}`,
    `Description: ${item.description}`,
    `Source: ${item.sourcePath}`,
    `Status: ${item.isInstalled ? 'Installed' : 'Not installed'}`,
    '',
    '--- Content ---',
    '',
    bodyText || '(no content)',
  ].join('\n');
}

function basename(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}
function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) {
  // `&` must go first, otherwise the entities emitted below get double-escaped.
  // Ids now embed full directory paths, which can legitimately contain `&`.
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

vscode.postMessage({ command: 'ready' });
