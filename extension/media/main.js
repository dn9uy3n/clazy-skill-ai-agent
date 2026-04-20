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
let selectedItemId = null;
/** @type {Set<string>} */
let checkedSkillIds = new Set();
/** @type {Set<string>} */
let checkedRuleIds = new Set();

const dirList = document.getElementById('dir-list');
const ruleFileList = document.getElementById('rule-file-list');
const skillList = document.getElementById('skill-list');
const ruleList = document.getElementById('rule-list');
const filterInput = /** @type {HTMLInputElement} */ (document.getElementById('filter-input'));
const ruleFilterInput = /** @type {HTMLInputElement} */ (document.getElementById('rule-filter-input'));
const descriptionBox = document.getElementById('skill-description');
const btnAddDir = document.getElementById('btn-add-dir');
const btnAddRuleFile = document.getElementById('btn-add-rule-file');
const btnCancel = document.getElementById('btn-cancel');
const btnApply = document.getElementById('btn-apply');
const platformRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="platform"]')
);

btnAddDir.addEventListener('click', () => vscode.postMessage({ command: 'addDirectory' }));
btnAddRuleFile.addEventListener('click', () => vscode.postMessage({ command: 'addRuleFile' }));

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

platformRadios.forEach(r =>
  r.addEventListener('change', () => {
    currentPlatform = r.value;
    vscode.postMessage({ command: 'changePlatform', platform: currentPlatform });
  }),
);

window.addEventListener('message', event => {
  const msg = event.data;
  if (msg.command === 'update') {
    skills = msg.skills;
    rules = msg.rules;
    directories = msg.directories;
    ruleFiles = msg.ruleFiles;
    currentPlatform = msg.platform;

    checkedSkillIds = new Set(skills.filter(s => s.isInstalled).map(s => s.id));
    checkedRuleIds = new Set(rules.filter(r => r.isInstalled).map(r => r.id));

    platformRadios.forEach(r => (r.checked = r.value === currentPlatform));

    renderDirectories();
    renderRuleFiles();
    renderSkills();
    renderRules();
  }
});

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
          <span class="skill-desc">${esc(truncate(s.description, 60))}</span>
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

function showDescription(id, kind) {
  const item = kind === 'rule' ? rules.find(r => r.id === id) : skills.find(s => s.id === id);
  if (!item) {
    descriptionBox.textContent = 'Item not found.';
    return;
  }

  const lines = [
    `Type: ${kind === 'rule' ? 'Rule' : 'Skill'}`,
    `Name: ${item.name}`,
    `Description: ${item.description}`,
    `Source: ${item.sourcePath}`,
    `Status: ${item.isInstalled ? 'Installed' : 'Not installed'}`,
    '',
    '--- Content ---',
    '',
    item.body || '(no content)',
  ];
  descriptionBox.textContent = lines.join('\n');
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
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

vscode.postMessage({ command: 'ready' });
