// @ts-check
const api = window.lazyApi;

let config = { skillDirectories: [], ruleFiles: [], platform: 'claude-code' };
let skills = [];
let rules = [];
let selectedItemId = null;
let checkedSkillIds = new Set();
let checkedRuleIds = new Set();

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
const btnCancel = document.getElementById('btn-cancel');
const btnApply = document.getElementById('btn-apply');

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
  const result = await api.applyChanges(
    skills,
    Array.from(checkedSkillIds),
    rules,
    Array.from(checkedRuleIds),
    config.lastProjectPath,
    config.platform,
  );
  if (result.errors.length > 0) {
    setStatus(`Done with errors: ${result.errors.join('; ')}`, true);
  } else {
    setStatus(
      `Skills: +${result.skillsInstalled}/-${result.skillsRemoved} · Rules: +${result.rulesInstalled}/-${result.rulesRemoved}`,
    );
  }
  await refresh();
});

filterInput.addEventListener('input', renderSkills);
ruleFilterInput.addEventListener('input', renderRules);

document.querySelectorAll('input[name="platform"]').forEach(r => {
  r.addEventListener('change', async e => {
    config.platform = e.target.value;
    await api.saveConfig(config);
    await refresh();
  });
});

async function init() {
  config = await api.loadConfig();
  document
    .querySelectorAll('input[name="platform"]')
    .forEach(r => (r.checked = r.value === config.platform));
  await refresh();
}

async function refresh() {
  projectPathEl.textContent = config.lastProjectPath || 'No project selected';
  renderDirectories();
  renderRuleFiles();

  const result = await api.scanSkills(
    config.skillDirectories,
    config.ruleFiles,
    config.lastProjectPath,
    config.platform,
  );
  skills = result.skills;
  rules = result.rules;
  checkedSkillIds = new Set(skills.filter(s => s.isInstalled).map(s => s.id));
  checkedRuleIds = new Set(rules.filter(r => r.isInstalled).map(r => r.id));
  renderSkills();
  renderRules();
}

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

function showDescription(item, kind) {
  descriptionBox.textContent = [
    `Type: ${kind === 'rule' ? 'Rule' : 'Skill'}`,
    `Name: ${item.name}`,
    `Description: ${item.description}`,
    `Source: ${item.sourcePath}`,
    `Status: ${item.isInstalled ? 'Installed' : 'Not installed'}`,
    '',
    '--- Content ---',
    '',
    item.body || '(no content)',
  ].join('\n');
}

function setStatus(msg, isError) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? 'var(--error)' : 'var(--text-muted)';
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + '...' : s;
}
function basename(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

init();
