// @ts-check
const api = window.lazyApi;

let config = { skillDirectories: [], ruleFiles: [], platform: 'claude-code' };
let platforms = [];
let skills = [];
let rules = [];
let selectedItemId = null;
let checkedSkillIds = new Set();
let checkedRuleIds = new Set();
let scanErrors = [];
// The watcher can fire repeatedly while a sync client writes; one scan at a time.
let scanning = false;
let rescanQueued = false;
// Guards against a slow body fetch landing after the user picked another item.
let bodyRequestToken = 0;

const projectPathEl = document.getElementById('project-path');
const dirList = document.getElementById('dir-list');
const ruleFileList = document.getElementById('rule-file-list');
const skillList = document.getElementById('skill-list');
const ruleList = document.getElementById('rule-list');
const filterInput = document.getElementById('filter-input');
const ruleFilterInput = document.getElementById('rule-filter-input');
const descriptionBox = document.getElementById('skill-description');
const statusMsg = document.getElementById('status-msg');
const btnSelectProject = document.getElementById('btn-select-project');
const btnAddDir = document.getElementById('btn-add-dir');
const btnAddRuleFile = document.getElementById('btn-add-rule-file');
const btnRefresh = document.getElementById('btn-refresh');
const btnCancel = document.getElementById('btn-cancel');
const btnApply = document.getElementById('btn-apply');
const platformList = document.getElementById('platform-list');
const platformNote = document.getElementById('platform-note');
const ruleFilesSection = document.getElementById('rule-files-section');
const rulesSection = document.getElementById('rules-section');

btnSelectProject.addEventListener('click', async () => {
  const dir = await api.selectDirectory('Select Project Folder');
  if (dir) {
    config.lastProjectPath = dir;
    await api.saveConfig(config);
    await refresh();
  }
});

btnAddDir.addEventListener('click', async () => {
  const dir = await api.selectDirectory('Select Skill Directory');
  if (dir && !config.skillDirectories.includes(dir)) {
    config.skillDirectories.push(dir);
    await api.saveConfig(config);
    await refresh();
  }
});

btnAddRuleFile.addEventListener('click', async () => {
  const files = await api.selectFiles('Select Rule File(s)');
  if (files && files.length) {
    let added = false;
    for (const f of files) {
      if (!config.ruleFiles.includes(f)) {
        config.ruleFiles.push(f);
        added = true;
      }
    }
    if (added) {
      await api.saveConfig(config);
      await refresh();
    }
  }
});

btnRefresh.addEventListener('click', () => refresh());

btnCancel.addEventListener('click', () => {
  checkedSkillIds = new Set(skills.filter(s => s.isInstalled).map(s => s.id));
  checkedRuleIds = new Set(rules.filter(r => r.isInstalled).map(r => r.id));
  renderSkills();
  renderRules();
  setStatus('');
});

btnApply.addEventListener('click', async () => {
  if (!config.lastProjectPath) {
    setStatus('Please select a project path first.', true);
    return;
  }
  setStatus('Applying...');
  try {
    const result = await api.applyChanges(
      config.skillDirectories,
      config.ruleFiles,
      Array.from(checkedSkillIds),
      Array.from(checkedRuleIds),
      config.lastProjectPath,
      config.platform,
    );
    await refresh();
    if (result.errors.length > 0) {
      setStatus(`Done with ${result.errors.length} error(s) — see details below.`, true);
      descriptionBox.textContent = result.errors.join('\n');
    } else {
      setStatus(
        `Skills: +${result.skillsInstalled}/-${result.skillsRemoved} · Rules: +${result.rulesInstalled}/-${result.rulesRemoved}`,
      );
    }
  } catch (e) {
    setStatus(`Apply failed: ${e && e.message ? e.message : e}`, true);
  }
});

filterInput.addEventListener('input', renderSkills);
ruleFilterInput.addEventListener('input', renderRules);

/**
 * Radios are built from `platforms` (fetched once via a dedicated IPC call,
 * not from the scan result) so the chrome still renders even if a scan
 * fails — adding a target tool is a registry entry in platforms.ts, not an
 * edit here.
 */
function renderPlatforms() {
  platformList.innerHTML = '';
  for (const p of platforms) {
    const label = document.createElement('label');
    label.className = 'radio-label';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'platform';
    radio.value = p.id;
    radio.checked = p.id === config.platform;
    radio.addEventListener('change', async () => {
      config.platform = p.id;
      await api.saveConfig(config);
      renderPlatforms();
      await refresh();
    });

    label.appendChild(radio);
    label.appendChild(document.createTextNode(p.label));
    platformList.appendChild(label);
  }

  const current = platforms.find(p => p.id === config.platform);
  platformNote.textContent = current && current.note ? current.note : '';
  platformNote.hidden = !current || !current.note;

  const supportsRules = !current || current.supportsRuleFiles;
  ruleFilesSection.hidden = !supportsRules;
  rulesSection.hidden = !supportsRules;
}

async function init() {
  config = await api.loadConfig();
  platforms = await api.getPlatforms();
  renderPlatforms();
  api.onSkillsChanged(() => refresh());
  await refresh();
}

async function refresh() {
  if (scanning) {
    rescanQueued = true;
    return;
  }
  scanning = true;
  btnRefresh.disabled = true;

  try {
    projectPathEl.textContent = config.lastProjectPath || 'No project selected';
    renderDirectories();
    renderRuleFiles();
    await api.watchDirs(config.skillDirectories);

    setStatus('Scanning...');
    const result = await api.scanSkills(
      config.skillDirectories,
      config.ruleFiles,
      config.lastProjectPath,
      config.platform,
    );

    skills = result.skills;
    rules = result.rules;
    scanErrors = result.errors || [];
    checkedSkillIds = new Set(skills.filter(s => s.isInstalled).map(s => s.id));
    checkedRuleIds = new Set(rules.filter(r => r.isInstalled).map(r => r.id));
    renderSkills();
    renderRules();
    setStatus(summarizeScan(result), scanErrors.length > 0);
  } catch (e) {
    setStatus(`Scan failed: ${e && e.message ? e.message : e}`, true);
  } finally {
    scanning = false;
    btnRefresh.disabled = false;
    if (rescanQueued) {
      rescanQueued = false;
      refresh();
    }
  }
}

function summarizeScan(result) {
  const dirCount = (result.dirStats || []).length;
  const parts = [
    `${result.skills.length} skill${result.skills.length === 1 ? '' : 's'}` +
      (dirCount ? ` from ${dirCount} director${dirCount === 1 ? 'y' : 'ies'}` : ''),
  ];
  if (result.rules.length) parts.push(`${result.rules.length} rules`);
  if (scanErrors.length) parts.push(`${scanErrors.length} problem(s) — click here`);
  return parts.join(' · ');
}

statusMsg.addEventListener('click', () => {
  if (scanErrors.length) descriptionBox.textContent = scanErrors.join('\n');
});

function renderDirectories() {
  dirList.innerHTML = '';
  if (config.skillDirectories.length === 0) {
    dirList.innerHTML = '<div class="empty-state">No directories configured.</div>';
    return;
  }
  for (const dir of config.skillDirectories) {
    const item = document.createElement('div');
    item.className = 'dir-item';
    const span = document.createElement('span');
    span.className = 'dir-path';
    span.textContent = dir;
    span.title = dir;
    const btn = document.createElement('button');
    btn.className = 'btn-remove';
    btn.textContent = '×';
    btn.addEventListener('click', async () => {
      config.skillDirectories = config.skillDirectories.filter(d => d !== dir);
      await api.saveConfig(config);
      await refresh();
    });
    item.appendChild(span);
    item.appendChild(btn);
    dirList.appendChild(item);
  }
}

function renderRuleFiles() {
  ruleFileList.innerHTML = '';
  if (config.ruleFiles.length === 0) {
    ruleFileList.innerHTML = '<div class="empty-state">No rule files added.</div>';
    return;
  }
  for (const file of config.ruleFiles) {
    const item = document.createElement('div');
    item.className = 'dir-item';
    const span = document.createElement('span');
    span.className = 'dir-path';
    span.textContent = file;
    span.title = file;
    const btn = document.createElement('button');
    btn.className = 'btn-remove';
    btn.textContent = '×';
    btn.addEventListener('click', async () => {
      config.ruleFiles = config.ruleFiles.filter(f => f !== file);
      await api.saveConfig(config);
      await refresh();
    });
    item.appendChild(span);
    item.appendChild(btn);
    ruleFileList.appendChild(item);
  }
}

function renderSkills() {
  renderItemList(skillList, skills, filterInput.value, checkedSkillIds, 'skill', 'Add a skill directory above.');
}

function renderRules() {
  renderItemList(ruleList, rules, ruleFilterInput.value, checkedRuleIds, 'rule', 'Add a rule file above.');
}

function renderItemList(container, items, filterText, checkedSet, kind, emptyHint) {
  const filter = filterText.toLowerCase().trim();
  const filtered = items.filter(
    i => !filter || i.name.toLowerCase().includes(filter) || i.description.toLowerCase().includes(filter),
  );

  container.innerHTML = '';
  if (filtered.length === 0) {
    container.innerHTML = `<div class="empty-state">${
      items.length === 0 ? emptyHint : 'No matches.'
    }</div>`;
    return;
  }

  for (const item of filtered) {
    const row = document.createElement('div');
    row.className = 'skill-item' + (item.id === selectedItemId ? ' selected' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checkedSet.has(item.id);
    checkbox.addEventListener('click', e => e.stopPropagation());
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) checkedSet.add(item.id);
      else checkedSet.delete(item.id);
    });

    const name = document.createElement('span');
    name.className = 'skill-name';
    name.textContent = item.name;

    const desc = document.createElement('span');
    desc.className = 'skill-desc';
    desc.textContent = truncate(item.description, 60);
    desc.title = item.description;

    const source = document.createElement('span');
    source.className = 'skill-source';
    source.textContent = basename(kind === 'rule' ? item.sourcePath : item.sourceDir);

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(desc);
    row.appendChild(source);

    row.addEventListener('click', () => {
      selectedItemId = item.id;
      renderSkills();
      renderRules();
      showDescription(item, kind);
    });

    container.appendChild(row);
  }
}

function describe(item, kind, bodyText) {
  return [
    `Type: ${kind === 'rule' ? 'Rule' : 'Skill'}`,
    `Name: ${item.name}`,
    `Description: ${item.description}`,
    `Source: ${item.sourcePath}`,
    `Status: ${item.isInstalled ? 'Installed' : 'Not installed'}`,
    '',
    '--- Content ---',
    '',
    bodyText,
  ].join('\n');
}

async function showDescription(item, kind) {
  const token = ++bodyRequestToken;
  descriptionBox.textContent = describe(item, kind, 'Loading...');
  try {
    const body = await api.getBody(item.sourcePath);
    if (token !== bodyRequestToken) return;
    descriptionBox.textContent = describe(item, kind, body || '(no content)');
  } catch (e) {
    if (token !== bodyRequestToken) return;
    descriptionBox.textContent = describe(item, kind, `(could not read file: ${e})`);
  }
}

function setStatus(msg, isError) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? 'var(--error)' : 'var(--text-muted)';
  statusMsg.style.cursor = scanErrors.length ? 'pointer' : 'default';
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
function basename(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

init();
