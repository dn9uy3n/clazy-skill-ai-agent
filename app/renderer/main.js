// @ts-check
const api = window.lazyApi;

/** @typedef {{id:string,name:string,description:string,sourcePath:string,sourceDir:string,format:string,isInstalled:boolean,body:string}} SkillInfo */

/** @type {{skillDirectories:string[], lastProjectPath?:string, platform:string}} */
let config = { skillDirectories: [], platform: 'claude-code' };
/** @type {SkillInfo[]} */
let skills = [];
/** @type {string|null} */
let selectedSkillId = null;
/** @type {Set<string>} */
let checkedIds = new Set();

// DOM
const projectPathEl = document.getElementById('project-path');
const dirList = document.getElementById('dir-list');
const skillList = document.getElementById('skill-list');
const filterInput = document.getElementById('filter-input');
const descriptionBox = document.getElementById('skill-description');
const statusMsg = document.getElementById('status-msg');
const btnSelectProject = document.getElementById('btn-select-project');
const btnAddDir = document.getElementById('btn-add-dir');
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

btnCancel.addEventListener('click', () => {
  checkedIds = new Set(skills.filter(s => s.isInstalled).map(s => s.id));
  renderSkills();
  setStatus('');
});

btnApply.addEventListener('click', async () => {
  if (!config.lastProjectPath) {
    setStatus('Please select a project path first.', true);
    return;
  }
  setStatus('Applying...');
  const result = await api.applyChanges(skills, Array.from(checkedIds), config.lastProjectPath, config.platform);
  if (result.errors.length > 0) {
    setStatus(`Done with errors: ${result.errors.join('; ')}`, true);
  } else {
    setStatus(`Installed: ${result.installed}, Removed: ${result.removed}`);
  }
  await refresh();
});

filterInput.addEventListener('input', renderSkills);

document.querySelectorAll('input[name="platform"]').forEach(r => {
  r.addEventListener('change', async (e) => {
    config.platform = /** @type {HTMLInputElement} */ (e.target).value;
    await api.saveConfig(config);
    await refresh();
  });
});

async function init() {
  config = await api.loadConfig();
  document.querySelectorAll('input[name="platform"]').forEach(r => {
    /** @type {HTMLInputElement} */ (r).checked =
      /** @type {HTMLInputElement} */ (r).value === config.platform;
  });
  await refresh();
}

async function refresh() {
  projectPathEl.textContent = config.lastProjectPath || 'No project selected';
  renderDirectories();

  skills = await api.scanSkills(config.skillDirectories, config.lastProjectPath, config.platform);
  checkedIds = new Set(skills.filter(s => s.isInstalled).map(s => s.id));
  renderSkills();
}

function renderDirectories() {
  if (config.skillDirectories.length === 0) {
    dirList.innerHTML = '<div class="empty-state">No directories configured.</div>';
    return;
  }
  dirList.innerHTML = '';
  for (const dir of config.skillDirectories) {
    const item = document.createElement('div');
    item.className = 'dir-item';
    const pathSpan = document.createElement('span');
    pathSpan.className = 'dir-path';
    pathSpan.textContent = dir;
    pathSpan.title = dir;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', async () => {
      config.skillDirectories = config.skillDirectories.filter(d => d !== dir);
      await api.saveConfig(config);
      await refresh();
    });
    item.appendChild(pathSpan);
    item.appendChild(removeBtn);
    dirList.appendChild(item);
  }
}

function renderSkills() {
  const filter = filterInput.value.toLowerCase().trim();
  const filtered = skills.filter(s =>
    !filter || s.name.toLowerCase().includes(filter) || s.description.toLowerCase().includes(filter),
  );

  if (filtered.length === 0) {
    skillList.innerHTML = skills.length === 0
      ? '<div class="empty-state">No skills found. Add a directory with skill subfolders.</div>'
      : '<div class="empty-state">No skills match the filter.</div>';
    return;
  }

  skillList.innerHTML = '';
  for (const skill of filtered) {
    const row = document.createElement('div');
    row.className = 'skill-item' + (skill.id === selectedSkillId ? ' selected' : '');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checkedIds.has(skill.id);
    checkbox.addEventListener('click', e => e.stopPropagation());
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) checkedIds.add(skill.id);
      else checkedIds.delete(skill.id);
    });

    const name = document.createElement('span');
    name.className = 'skill-name';
    name.textContent = skill.name;

    const desc = document.createElement('span');
    desc.className = 'skill-desc';
    desc.textContent = truncate(skill.description, 60);

    const source = document.createElement('span');
    source.className = 'skill-source';
    source.textContent = basename(skill.sourceDir);

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(desc);
    row.appendChild(source);

    row.addEventListener('click', () => {
      selectedSkillId = skill.id;
      renderSkills();
      showDescription(skill);
    });

    skillList.appendChild(row);
  }
}

/** @param {SkillInfo} skill */
function showDescription(skill) {
  descriptionBox.textContent = [
    `Name: ${skill.name}`,
    `Description: ${skill.description}`,
    `Source: ${skill.sourceDir}`,
    `Format: ${skill.format}`,
    `Status: ${skill.isInstalled ? 'Installed' : 'Not installed'}`,
    '',
    '--- Content ---',
    '',
    skill.body || '(no content)',
  ].join('\n');
}

/** @param {string} msg @param {boolean} [isError] */
function setStatus(msg, isError) {
  statusMsg.textContent = msg;
  statusMsg.style.color = isError ? 'var(--error)' : 'var(--text-muted)';
}

function truncate(s, max) { return s.length > max ? s.slice(0, max) + '...' : s; }
function basename(p) {
  const parts = p.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || p;
}

init();
