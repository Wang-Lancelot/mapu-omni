const $ = s => document.querySelector(s);
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, selectedProject = localStorage.getItem('project'), selectedChat = localStorage.getItem('chat'), cliInfo, signature = '', toastTimer, sending = false;
const draftHarnesses = JSON.parse(localStorage.getItem('draftHarnesses') || '{}');
let harnessDrafts = [], checkingHarnesses = new Set();
function catalog() { return state.settings.harnesses || []; }
function harnessName(id, chat) { return chat?.harness?.name || catalog().find(h => h.id === id)?.name || '已删除的 Harness'; }
const expandedProjects = new Set(JSON.parse(localStorage.getItem('expandedProjects') || '[]'));
function applyState(next) {
  if (state && (next.revision ?? 0) < (state.revision ?? 0)) return;
  state = next; render();
}
async function api(route, body) {
  const response = await fetch(`/api/${route}`, body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result;
}
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 6000); }
function currentChat() { return state?.chats.find(c => c.id === selectedChat); }
function currentProject() { return state?.projects.find(p => p.id === selectedProject); }
function remember() { localStorage.setItem('project', selectedProject || ''); localStorage.setItem('chat', selectedChat || ''); }
function selectProject(id) { selectedProject = id; selectedChat = null; signature = ''; remember(); render(); $('.sidebar').classList.remove('open'); }
function selectChat(id) { selectedChat = id; selectedProject = currentChat().projectId; signature = ''; remember(); render(); $('.sidebar').classList.remove('open'); }
function formatText(text) {
  return text.split(/(```[\s\S]*?```)/g).map(part => part.startsWith('```') ? `<pre><code>${escape(part.replace(/^```[^\n]*\n?/, '').replace(/```$/, ''))}</code></pre>` : `<span class="message-text">${escape(part)}</span>`).join('');
}
function render() {
  if (!state) return;
  if (!currentProject()) selectedProject = state.projects[0]?.id;
  if (selectedChat && !currentChat()) selectedChat = null;
  const project = currentProject(), chat = currentChat();
  const userName = state.settings.userName || 'Local developer';
  $('#profile-name').textContent = userName;
  $('#profile-name').title = userName;
  $('#profile-avatar').textContent = [...userName][0].toLocaleUpperCase();
  const busy = chat && ['running','stopping'].includes(chat.status);
  document.documentElement.style.fontSize = `${state.settings.fontSize || 14}px`;
  const recent = [...state.chats].sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  const chatRow = c => `<div class="sidebar-item"><button class="chat-row ${c.id === selectedChat ? 'active' : ''}" data-chat="${c.id}" title="${escape(c.title)}"><span class="dot ${['running', 'stopping'].includes(c.status) ? 'running' : ''}"></span><span>${escape(c.title)}</span></button><button class="delete-item" data-delete-chat="${c.id}" title="删除对话" aria-label="删除对话：${escape(c.title)}">×</button></div>`;
  $('#projects').innerHTML = state.projects.map(p => {
    const chats = recent.filter(c => c.projectId === p.id), expanded = expandedProjects.has(p.id);
    return `<div class="project-group"><div class="sidebar-item"><button class="project-expand" data-expand="${p.id}" aria-expanded="${expanded}" aria-controls="project-chats-${p.id}" aria-label="${expanded ? '收起' : '展开'}${escape(p.name)}的对话">${expanded ? '⌄' : '›'}</button><button class="project-row ${p.id === selectedProject ? 'active' : ''}" data-project="${p.id}" aria-current="${p.id === selectedProject ? 'true' : 'false'}" title="${escape(p.path)}"><span class="project-symbol"><svg class="workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-${p.id === selectedProject ? 'folder-open' : 'layers'}"></use></svg></span><span class="project-text">${escape(p.name)}</span><span class="count">${chats.length}</span></button><button class="delete-item" data-delete-project="${p.id}" title="删除工作空间" aria-label="删除工作空间：${escape(p.name)}">×</button></div><div class="project-chats" id="project-chats-${p.id}" ${expanded ? '' : 'hidden'}>${chats.length ? chats.map(chatRow).join('') : '<div class="empty-chats">暂无对话</div>'}</div></div>`;
  }).join('') || '<div class="empty-chats">点击 ＋ 添加工作空间</div>';
  $('#chat-count').textContent = recent.length;
  $('#chats').innerHTML = recent.length ? recent.map(chatRow).join('') : '<div class="empty-chats">想法从这里开始。<br>新建对话，开始你的第一个任务。</div>';
  $('#project-name').textContent = project?.name || '工作空间';
  $('#chat-title').textContent = chat?.title || '新对话';
  $('#composer-project').textContent = project?.name || '选择项目';
  $('#model-label').textContent = state.settings.model === 'auto' ? 'Auto' : state.settings.model;
  $('#mode').value = state.settings.mode;
  const availableHarnesses = catalog();
  let harnessId = chat ? (chat.harnessId || 'none') : (draftHarnesses[selectedProject] || 'none');
  if (!chat && !availableHarnesses.some(h => h.id === harnessId && h.path)) harnessId = 'none';
  $('#harness').innerHTML = '<option value="none">无</option>' + availableHarnesses.map(h => `<option value="${escape(h.id)}" ${h.path ? '' : 'disabled'}>${escape(h.name)}${h.path ? '' : ' · 先设置路径'}</option>`).join('') + (harnessId !== 'none' && !availableHarnesses.some(h => h.id === harnessId) ? `<option value="${escape(harnessId)}" disabled>${escape(harnessName(harnessId, chat))} · 已删除</option>` : '');
  $('#harness').value = harnessId; $('#harness').disabled = !!busy;
  $('#harness-note').hidden = harnessId === 'none';
  $('#harness-note').textContent = `${harnessName(harnessId, chat)}${chat?.harness ? ` · ${chat.harness.version}` : ''} · 使用当前项目目录，切换 Harness 将开启新对话`;
  $('#send').classList.toggle('running', !!busy); $('#send').textContent = busy ? '■' : '↑';
  $('#send').setAttribute('aria-label', busy ? '停止任务' : '发送 prompt');
  $('#send').disabled = !project || chat?.status === 'stopping';
  $('#prompt').disabled = !!busy; $('#mode').disabled = !!busy;
  const nextSignature = JSON.stringify([selectedProject, selectedChat, chat?.messages, chat?.status, chat?.error]);
  if (signature !== nextSignature) {
    const panel = $('#messages'); const nearBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 120;
    if (!chat?.messages.length) {
      panel.innerHTML = `<div class="welcome"><div class="welcome-eyebrow">MaPU Omni · 码炉</div><h1>在码炉，让代码各展所能。</h1><p class="subtitle">连接你的项目，与 MaPU Omni 一起完成 MaPU Scale 编程。</p><div class="suggestions"><button class="suggestion" data-prompt="请先阅读项目文件，介绍这个项目的结构和技术栈，暂时不要修改文件。"><span class="suggestion-icon">⌘</span><b>了解这个项目</b><small>梳理代码结构与技术栈</small></button><button class="suggestion" data-prompt="请分析当前项目中值得改进的地方，给出具体建议，暂时不要修改文件。"><span class="suggestion-icon">↗</span><b>发现改进空间</b><small>一起找到下一个优化点</small></button><button class="suggestion" data-prompt="我想在这个项目中实现一个新功能，请先了解项目并与我讨论需求。"><span class="suggestion-icon">✳</span><b>构建新功能</b><small>把一个想法变成可用的代码</small></button></div><div class="workspace-path"><svg class="workspace-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-folder-open"></use></svg> ${escape(project?.path || '添加项目以开始')}</div></div>`;
    } else {
      panel.innerHTML = chat.messages.map(m => `<article class="message ${m.role}">${m.role === 'assistant' ? `<div class="message-label"><strong>✳ MaPU Omni</strong><span>${escape(m.actualModel || m.model || '')}</span>${m.harnessId && m.harnessId !== 'none' ? `<span class="message-harness">${escape(m.harnessName || harnessName(m.harnessId, chat))}</span>` : ''}</div>` : ''}<div>${formatText(m.text)}</div></article>`).join('') + (busy ? `<div class="run-indicator">◌ ${chat.status === 'stopping' ? '正在停止进程…' : '码炉正在执行任务…'}</div>` : '') + (chat.error ? `<div class="error-message">${escape(chat.error)}</div>` : chat.status === 'cancelled' ? '<div class="run-indicator">任务已停止，可继续发送消息。</div>' : '');
    }
    if (chat?.messages.length && (nearBottom || !signature)) panel.scrollTop = panel.scrollHeight;
    else if (!chat?.messages.length) panel.scrollTop = 0;
    signature = nextSignature;
  }
  const terminal = $('#terminal-output'), atBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 80;
  const output = chat?.logs?.map(l => `${l.kind === 'command' ? '$ ' : l.kind === 'stderr' ? '[stderr] ' : l.kind === 'exit' ? '\n' : ''}${l.text}`).join('\n') || '发送一条消息后，真实的 CLI 命令、输出和退出状态将在这里显示。';
  if (terminal.textContent !== output) { terminal.textContent = output; if (atBottom) terminal.scrollTop = terminal.scrollHeight; }
  $('#terminal-meta').textContent = `${project?.path || ''}${chat ? ` · ${chat.status}` : ''}`;
  remember();
}
async function refreshCli() {
  $('#cli-status').textContent = '正在检测 CLI 和可用模型…';
  try {
    cliInfo = await api('cli');
    $('#cli-status').textContent = cliInfo.authenticated ? (cliInfo.models.length ? '● Cursor CLI 已登录 · 模型列表已加载' : '● Cursor CLI 已登录\n模型列表暂不可用，可刷新或填写自定义模型 ID。') : '○ Cursor CLI 未登录或状态检测失败 · 请展开详情查看';
    $('#cli-details').textContent = `${cliInfo.executable}\n\n${cliInfo.status}\n\n${cliInfo.modelsOutput}`;
    populateModels();
    $('#connection-notice').hidden = cliInfo.authenticated;
    if (!cliInfo.authenticated) $('#connection-notice').innerHTML = '<span>Cursor 尚未登录。在本机终端运行 <code>agent login</code> 后即可开始。</span><button id="notice-settings">查看设置 ↗</button>';
  } catch (e) { $('#cli-status').textContent = `检测失败：${e.message}`; toast(e.message); }
}
function populateModels() {
  const model = state.settings.model;
  const list = [{id:'auto',name:'Auto · Cursor 自动选择'}, ...(cliInfo?.models || []).filter(m => m.id !== 'auto')];
  if (!list.some(m => m.id === model)) list.push({id:model,name:`${model} · 当前模型`});
  $('#models').innerHTML = list.map(m => `<option value="${escape(m.id)}">${escape(m.name)} (${escape(m.id)})</option>`).join('');
  $('#models').value = model;
}
function selectSettingsTab(key) {
  for (const tab of document.querySelectorAll('[data-settings-tab]')) {
    const active = tab.dataset.settingsTab === key;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    $(`#settings-panel-${tab.dataset.settingsTab}`).hidden = !active;
  }
}
for (const tab of document.querySelectorAll('[data-settings-tab]')) {
  tab.onclick = () => selectSettingsTab(tab.dataset.settingsTab);
  tab.onkeydown = e => {
    const tabs = [...document.querySelectorAll('[data-settings-tab]')], index = tabs.indexOf(tab);
    let next;
    if (['ArrowDown', 'ArrowRight'].includes(e.key)) next = (index + 1) % tabs.length;
    else if (['ArrowUp', 'ArrowLeft'].includes(e.key)) next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault(); selectSettingsTab(tabs[next].dataset.settingsTab); tabs[next].focus();
  };
}
$('#harness-search').oninput = e => {
  const query = e.target.value.trim().toLocaleLowerCase(); let matches = 0;
  for (const card of document.querySelectorAll('[data-harness-name]')) {
    card.hidden = !card.dataset.harnessName.toLocaleLowerCase().includes(query);
    if (!card.hidden) matches++;
  }
  $('#harness-search-empty').hidden = matches > 0;
};
function renderHarnessCards() {
  $('#harness-catalog').innerHTML = harnessDrafts.map(h => `<article class="harness-settings" data-harness-id="${escape(h.id)}" data-harness-name="${escape(h.name)}">
    <div class="harness-card-heading"><h3 data-card-title>${escape(h.name)}</h3><button type="button" class="text-button remove-harness" data-remove-harness="${escape(h.id)}" aria-label="删除 ${escape(h.name)}">删除</button></div>
    <label>名称<input data-harness-field="name" value="${escape(h.name)}" maxlength="80" placeholder="例如：并行代码改写"></label><label>类型<select data-harness-field="type"><option value="generic" ${h.type === 'generic' ? 'selected' : ''}>通用 · AGENTS.md</option><option value="scale" ${h.type === 'scale' ? 'selected' : ''}>Scale · Multi-Lang</option><option value="forge" ${h.type === 'forge' ? 'selected' : ''}>Scale · Forge</option></select></label>
    <label>本地目录<input data-harness-field="path" value="${escape(h.path)}" placeholder="/绝对路径/my-harness 或 ../my-harness" autocomplete="off"></label>
    <p data-harness-help>${h.type === 'forge' ? '选择 SCALE_Forge 根目录；仅加载规则、Skills、知识、工具与工作流，不打包原工程状态及运行产物。' : h.type === 'scale' ? '请选择包含 AGENTS.md 与 scale-agent 文件夹的根目录。' : '根目录需包含 AGENTS.md。可附带 skills/、agents/ 及其他资源文件；请使用专用 Harness 目录。'}</p>
    <button type="button" class="text-button" data-check-harness="${escape(h.id)}">检测 Harness</button><div class="harness-status" role="status">尚未检测</div>
  </article>`).join('');
  $('#harness-search').oninput({target:$('#harness-search')});
}
function openSettings(section = 'general') {
  selectSettingsTab(section); $('#harness-search').value = '';
  harnessDrafts = catalog().map(h => ({...h})); renderHarnessCards();
  const f = $('#settings-form'); f.elements.userName.value = state.settings.userName || 'Local developer'; f.elements.backend.value = 'cursor'; f.elements.mode.value = state.settings.mode; f.elements.force.checked = state.settings.force; f.elements.customModel.value = ''; f.elements.fontSize.value = state.settings.fontSize || 14;
  populateModels(); $('#settings-dialog').showModal();
}
$('#add-harness').onclick = () => {
  const h = {id:`h-${crypto.randomUUID()}`, name:'新 Harness', type:'generic', path:''};
  harnessDrafts.push(h); $('#harness-search').value = ''; renderHarnessCards();
  const card = document.querySelector(`[data-harness-id="${h.id}"]`);
  card.scrollIntoView({block:'nearest'}); const name = card.querySelector('[data-harness-field="name"]'); name.focus(); name.select();
};
$('#harness-catalog').addEventListener('input', e => {
  const field = e.target.dataset.harnessField, card = e.target.closest('[data-harness-id]');
  if (!field || !card) return;
  const h = harnessDrafts.find(h => h.id === card.dataset.harnessId); h[field] = e.target.value;
  if (field === 'name') { card.dataset.harnessName = h.name; card.querySelector('[data-card-title]').textContent = h.name || '新 Harness'; card.querySelector('[data-remove-harness]')?.setAttribute('aria-label', `删除 ${h.name || '新 Harness'}`); }
  card.querySelector('.harness-status').textContent = '配置已修改，请重新检测或保存';
  if (field === 'type') card.querySelector('[data-harness-help]').textContent = h.type === 'forge' ? '选择 SCALE_Forge 根目录；仅加载规则、Skills、知识、工具与工作流，不打包原工程状态及运行产物。' : h.type === 'scale' ? '请选择包含 AGENTS.md 与 scale-agent 文件夹的根目录。' : '根目录需包含 AGENTS.md。可附带 skills/、agents/ 及其他资源文件；请使用专用 Harness 目录。';
});
$('#harness-catalog').addEventListener('click', async e => {
  const remove = e.target.closest('[data-remove-harness]');
  if (remove) {
    harnessDrafts = harnessDrafts.filter(h => h.id !== remove.dataset.removeHarness); renderHarnessCards(); return;
  }
  const button = e.target.closest('[data-check-harness]'); if (!button) return;
  const h = {...harnessDrafts.find(h => h.id === button.dataset.checkHarness)}, card = button.closest('[data-harness-id]'), status = card.querySelector('.harness-status');
  if (checkingHarnesses.has(h.id)) return;
  checkingHarnesses.add(h.id); button.disabled = true; status.textContent = '正在检查路径与资源…';
  try {
    const info = await api('harness/check', {path:h.path, type:h.type});
    const current = harnessDrafts.find(item => item.id === h.id);
    if (current?.path === h.path && current?.type === h.type) status.textContent = `✓ 检测通过 · ${info.skills.length} 个 Skills · ${info.agents.length} 个角色\n${info.sourceRoot}`;
  } catch(error) { status.textContent = error.message; }
  finally { checkingHarnesses.delete(h.id); button.disabled = false; }
});
$('#harness').onchange = e => {
  const value = e.target.value; draftHarnesses[selectedProject] = value; localStorage.setItem('draftHarnesses', JSON.stringify(draftHarnesses));
  if (currentChat() && (currentChat().harnessId || 'none') !== value) { selectedChat = null; signature = ''; remember(); toast('已切换 Harness，下一条消息将开启新对话'); }
  render();
};
async function updateSettings(changes) { await api('settings', {...state.settings,...changes}); }
async function sidebarClick(e) {
  const removeProject = e.target.closest('[data-delete-project]'), removeChat = e.target.closest('[data-delete-chat]');
  if (removeProject || removeChat) {
    const id = removeProject ? removeProject.dataset.deleteProject : removeChat.dataset.deleteChat;
    const item = (removeProject ? state.projects : state.chats).find(item => item.id === id);
    if (!item) return;
    const message = removeProject ? `删除工作空间「${item.name}」及其所有对话记录？磁盘上的文件不会删除。` : `删除对话「${item.title}」？聊天记录将无法恢复。`;
    if (!window.confirm(message)) return;
    try {
      const updated = await api(`${removeProject ? 'projects' : 'chats'}/${id}/delete`, {});
      if (removeProject) { expandedProjects.delete(id); localStorage.setItem('expandedProjects', JSON.stringify([...expandedProjects])); }
      applyState(updated); toast(removeProject ? '工作空间及所属对话已删除' : '对话已删除');
    } catch (error) { toast(error.message); }
    return;
  }
  const expand = e.target.closest('[data-expand]');
  if (expand) {
    const id = expand.dataset.expand;
    if (expandedProjects.has(id)) expandedProjects.delete(id); else expandedProjects.add(id);
    localStorage.setItem('expandedProjects', JSON.stringify([...expandedProjects])); render(); return;
  }
  const chat = e.target.closest('[data-chat]'), project = e.target.closest('[data-project]');
  if (chat) selectChat(chat.dataset.chat); else if (project) selectProject(project.dataset.project);
}
$('#projects').addEventListener('click', sidebarClick);
$('#chats').addEventListener('click', sidebarClick);
// Resize independently of server events so streaming replies cannot reset the width.
const sidebar = $('.sidebar'), sidebarResizer = $('#sidebar-resizer');
let sidebarWidth = Number(localStorage.getItem('sidebarWidth')) || 258, sidebarDrag;
function resizeSidebar(width, persist = false) {
  const max = Math.min(520, window.innerWidth <= 760 ? window.innerWidth - 32 : window.innerWidth - 360);
  const min = Math.min(220, max);
  const applied = Math.round(Math.max(min, Math.min(max, width)));
  sidebar.style.setProperty('--sidebar-width', `${applied}px`);
  sidebarResizer.setAttribute('aria-valuemin', min);
  sidebarResizer.setAttribute('aria-valuemax', max);
  sidebarResizer.setAttribute('aria-valuenow', applied);
  if (persist) { sidebarWidth = applied; localStorage.setItem('sidebarWidth', String(applied)); }
  return applied;
}
resizeSidebar(sidebarWidth);
window.addEventListener('resize', () => resizeSidebar(sidebarWidth));
sidebarResizer.addEventListener('pointerdown', e => {
  if (e.button !== 0 || sidebarDrag) return;
  e.preventDefault();
  sidebarDrag = { id: e.pointerId, x: e.clientX, width: sidebar.getBoundingClientRect().width };
  sidebarResizer.setPointerCapture(e.pointerId);
  document.body.classList.add('resizing-sidebar');
});
sidebarResizer.addEventListener('pointermove', e => {
  if (sidebarDrag?.id === e.pointerId) resizeSidebar(sidebarDrag.width + e.clientX - sidebarDrag.x);
});
function finishSidebarResize(e) {
  if (sidebarDrag?.id !== e.pointerId) return;
  resizeSidebar(sidebar.getBoundingClientRect().width, true);
  sidebarDrag = null;
  document.body.classList.remove('resizing-sidebar');
}
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) sidebarResizer.addEventListener(event, finishSidebarResize);
sidebarResizer.addEventListener('dblclick', () => resizeSidebar(258, true));
sidebarResizer.addEventListener('keydown', e => {
  const width = sidebar.getBoundingClientRect().width;
  if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(e.key)) return;
  e.preventDefault();
  resizeSidebar(e.key === 'Home' ? 258 : width + (e.key === 'ArrowRight' ? 10 : -10), true);
});
$('#messages').addEventListener('click', e => { const button = e.target.closest('[data-prompt]'); if (button) { $('#prompt').value = button.dataset.prompt; $('#prompt').focus(); } });
$('#new-chat').onclick = () => { selectedChat = null; signature = ''; remember(); render(); $('.sidebar').classList.remove('open'); $('#prompt').focus(); };
$('#mobile-menu').onclick = () => $('.sidebar').classList.toggle('open');
$('#add-project').onclick = () => $('#project-dialog').showModal();
for (const button of document.querySelectorAll('[data-close]')) button.onclick = () => button.closest('dialog').close();
$('#project-form').onsubmit = async e => { e.preventDefault(); try { const form = new FormData(e.target); const project = await api('projects', Object.fromEntries(form)); applyState(await api('state')); selectProject(project.id); $('#project-dialog').close(); e.target.reset(); toast('项目已添加'); } catch (error) { toast(error.message); } };
$('#settings-button').onclick = () => openSettings(); $('#model-button').onclick = () => openSettings('models');
$('#connection-notice').onclick = e => { if (e.target.closest('button')) openSettings(); };
$('#refresh-cli').onclick = refreshCli;
$('#settings-form').onsubmit = async e => {
  e.preventDefault(); const form = e.target;
  try { await updateSettings({ backend:form.elements.backend.value, model:form.elements.customModel.value.trim() || form.elements.model.value, mode:form.elements.mode.value, force:form.elements.force.checked, fontSize:Number(form.elements.fontSize.value), userName:form.elements.userName.value.trim(), harnesses:harnessDrafts }); applyState(await api('state')); $('#settings-dialog').close(); toast('设置已保存'); } catch(error) { toast(error.message); }
};
$('#mode').onchange = async e => { try { await updateSettings({mode:e.target.value}); applyState(await api('state')); } catch(error) { toast(error.message); render(); } };
$('#terminal-toggle').onclick = () => { $('#terminal').hidden = !$('#terminal').hidden; localStorage.setItem('terminal', String(!$('#terminal').hidden)); };
$('#terminal-close').onclick = () => { $('#terminal').hidden = true; localStorage.setItem('terminal','false'); };
$('#terminal').hidden = localStorage.getItem('terminal') !== 'true';
$('#composer').onsubmit = async e => {
  e.preventDefault(); if (sending) return; const chat = currentChat();
  if (chat && ['running','stopping'].includes(chat.status)) { try { await api(`chats/${chat.id}/stop`,{}); } catch(error) { toast(error.message); } return; }
  const prompt = $('#prompt').value.trim(); if (!prompt) return;
  sending = true; $('#send').disabled = true;
  try {
    if (!selectedChat) { const newChat = await api('chats', {projectId:selectedProject, harnessId:$('#harness').value}); selectedChat = newChat.id; remember(); }
    await api(`chats/${selectedChat}/send`, {prompt}); $('#prompt').value = ''; applyState(await api('state'));
  } catch(error) { toast(error.message); $('#send').disabled = false; } finally { sending = false; }
};
$('#prompt').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } };
document.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#new-chat').click(); } if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); if (!$('#settings-dialog').open) openSettings(); } });
try {
  applyState(await api('state'));
  const events = new EventSource('/api/events');
  events.onmessage = e => { applyState(JSON.parse(e.data)); };
  events.onerror = () => { $('#connection-notice').hidden = false; $('#connection-notice').textContent = '与本地服务的连接中断，正在自动重连…'; };
  events.onopen = () => { if (cliInfo?.authenticated) $('#connection-notice').hidden = true; else if (cliInfo) $('#connection-notice').innerHTML = '<span>Cursor 尚未登录。在本机终端运行 <code>agent login</code> 后即可开始。</span><button>查看设置 ↗</button>'; };
  refreshCli();
} catch(error) { toast(`无法连接本地服务：${error.message}`); }
