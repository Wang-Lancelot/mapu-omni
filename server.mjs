import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ADAPTER_VERSION, harnessCatalog, inspectConfiguredHarness, migrateHarnessSettings, publicHarness, prepareHarness } from './harness.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4317);
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, '.data'));
mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'workspace.json');
const cli = process.env.CURSOR_CLI || [path.join(os.homedir(), '.local/bin/agent'), path.join(os.homedir(), '.local/bin/cursor-agent')].find(existsSync) || 'agent';
let db = existsSync(dbPath) ? JSON.parse(readFileSync(dbPath, 'utf8')) : {
  projects: [{ id: randomUUID(), name: path.basename(root), path: root }], chats: [],
  settings: { backend: 'cursor', model: 'auto', mode: 'agent', force: false, fontSize: 14 }
};
db.settings.fontSize ??= 14;
db.settings.userName ??= 'Local developer';
const migratedHarnesses = migrateHarnessSettings(db.settings);
for (const chat of db.chats) chat.harnessId ??= 'none';
db.revision ??= 0;
for (const chat of db.chats) if (chat.status === 'running') { chat.status = 'interrupted'; chat.error = '服务器重启，任务已中断。'; }
const jobs = new Map(), clients = new Set();
function save() { writeFileSync(dbPath + '.tmp', JSON.stringify(db, null, 2), { mode: 0o600 }); renameSync(dbPath + '.tmp', dbPath); }
if (migratedHarnesses) save();
function publish() { db.revision++; save(); for (const c of clients) c.write(`data: ${JSON.stringify(db)}\n\n`); }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function capture(args) {
  return new Promise(resolve => {
    const child = spawn(cli, args, { env: process.env, shell: false }); let output = ''; let finished = false;
    const done = code => { if (finished) return; finished = true; clearTimeout(timer); resolve({ code, output: output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim() }); };
    const timer = setTimeout(() => { child.kill('SIGTERM'); done(1); }, 20000);
    child.stdout.on('data', d => output += d); child.stderr.on('data', d => output += d);
    child.on('error', e => { output += e.message; done(1); }); child.on('close', done);
  });
}
function append(chat, kind, text) { chat.logs.push({ kind, text, time: new Date().toISOString() }); if (chat.logs.length > 1500) chat.logs.shift(); }
function stop(chatId) { const child = jobs.get(chatId); if (!child) return; try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); } const timer = setTimeout(() => { if (jobs.get(chatId) === child) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} } }, 3000); timer.unref(); }
function run(chat, prompt) {
  const project = db.projects.find(p => p.id === chat.projectId);
  if (!project || !existsSync(project.path)) fail('项目目录不存在');
  if (jobs.has(chat.id)) fail('此对话仍在执行中', 409);
  const { model, mode, force } = db.settings;
  const args = ['--print', '--trust', '--output-format', 'stream-json', '--model', model];
  let executionPrompt = prompt, harnessRun;
  if (chat.harnessId !== 'none') {
    const info = inspectConfiguredHarness(harnessCatalog(db.settings).find(h => h.id === chat.harnessId), root);
    if (chat.sessionId && chat.harness?.adapterVersion !== ADAPTER_VERSION) fail(`${info.name} 适配器版本已更新，请新建对话`, 409);
    if (chat.harness && (chat.harness.fingerprint !== info.fingerprint || chat.harness.sourceRoot !== info.sourceRoot || (chat.harness.type || 'scale') !== info.type)) fail(`${info.name} 路径或资源版本已变化，请新建对话以加载新配置`, 409);
    harnessRun = prepareHarness({ info, dataDir, project, chat });
    executionPrompt = harnessRun.promptPrefix + prompt; args.push(...harnessRun.args);
  }
  if (mode !== 'agent') args.push('--mode', mode);
  if (force) args.push('--force');
  if (chat.sessionId) args.push('--resume', chat.sessionId);
  args.push('--', executionPrompt);
  const runLogStart = chat.logs.length;
  const reply = { id: randomUUID(), role: 'assistant', text: '', model, actualModel: null, harnessId: chat.harnessId, harnessName: harnessRun?.snapshot.name };
  if (harnessRun) chat.harness = harnessRun.snapshot;
  chat.messages.push({ id: randomUUID(), role: 'user', text: prompt }, reply);
  chat.status = 'running'; chat.error = null; chat.updatedAt = new Date().toISOString(); chat.model = model;
  if (harnessRun) append(chat, 'harness', `${chat.harness.name} ${chat.harness.version} · ${chat.harness.fingerprint.slice(0, 12)}\n资源来源: ${chat.harness.sourceRoot}\n实际工作目录: ${project.path}\n项目记忆: ${chat.harness.memoryProject || '由 Harness 工作流定义'}`);
  append(chat, 'command', `${cli} ${args.map(a => JSON.stringify(a)).join(' ')}\ncwd: ${project.path}`);
  const child = spawn(cli, args, { cwd: project.path, env: process.env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  jobs.set(chat.id, child); publish();
  let buffer = '', resultError = false, spawnError = '';
  function line(text) {
    if (!text.trim()) return;
    try { if (JSON.parse(text).type === 'thinking') return; } catch {}
    append(chat, 'stdout', text);
    try {
      const e = JSON.parse(text);
      if (e.session_id) chat.sessionId = e.session_id;
      if (e.type === 'system' && e.model) reply.actualModel = e.model;
      if (e.type === 'assistant') {
        const content = (e.message?.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
        reply.text += content;
      }
      if (e.type === 'result') { if (typeof e.result === 'string') reply.text = e.result; resultError = !!e.is_error; if (resultError) chat.error = e.result || 'CLI 执行失败'; }
    } catch { /* Preserve non-JSON lines in the terminal. */ }
    publish();
  }
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', data => { buffer += data; let i; while ((i = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, i)); buffer = buffer.slice(i + 1); } });
  child.stderr.on('data', text => { append(chat, 'stderr', text); publish(); });
  child.on('error', e => { spawnError = e.message; });
  child.on('close', (code, signal) => {
    if (buffer) line(buffer);
    jobs.delete(chat.id);
    const cancelled = chat.status === 'stopping';
    chat.status = cancelled ? 'cancelled' : code === 0 && !resultError ? 'complete' : 'error';
    if (chat.status === 'error') chat.error ||= spawnError || chat.logs.slice(Math.min(runLogStart, chat.logs.length - 1)).filter(l => l.kind === 'stderr').slice(-3).map(l => l.text).join('\n') || `CLI 退出码 ${code}`;
    append(chat, 'exit', cancelled ? '任务已停止' : `进程结束 · exit ${code ?? signal}`); publish();
  });
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  try {
    const expectedHost = `127.0.0.1:${port}`, localhost = `localhost:${port}`;
    if (![expectedHost, localhost].includes(req.headers.host)) fail('Invalid host', 403);
    if (req.headers.origin && ![`http://${expectedHost}`, `http://${localhost}`].includes(req.headers.origin)) fail('Invalid origin', 403);
    const url = new URL(req.url, `http://${expectedHost}`); const route = url.pathname;
    const json = data => { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    if (route === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      clients.add(res); res.write(`data: ${JSON.stringify(db)}\n\n`);
      const timer = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      req.on('close', () => { clearInterval(timer); clients.delete(res); }); return;
    }
    if (route === '/api/state' && req.method === 'GET') return json(db);
    if (route === '/api/cli' && req.method === 'GET') {
      const [status, models] = await Promise.all([capture(['status']), capture(['--list-models'])]);
      const list = models.code === 0 ? models.output.split('\n').map(l => l.trim().replace(/^[*•]\s*/, '')).map(l => l.match(/^([a-z0-9][a-z0-9._:[\],=-]*)\s+(?:-\s*|\t)(.+)$/i)).filter(Boolean).map(m => ({ id: m[1], name: m[2] })) : [];
      return json({ executable: cli, authenticated: status.code === 0, status: status.output, models: list, modelsOutput: models.output });
    }
    if (req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) fail('JSON required', 415);
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 128000) fail('请求过大', 413); }
      const body = JSON.parse(raw || '{}');
      if (route === '/api/harness/check') {
        if (body.type && !['scale', 'generic', 'forge', 'cuda'].includes(body.type)) fail('Harness 类型无效');
        return json(publicHarness(inspectConfiguredHarness({ id: 'check', name: 'Harness', type: body.type || 'scale', path: body.path }, root)));
      }
      if (route === '/api/projects') {
        if (typeof body.path !== 'string' || !body.path.trim()) fail('请输入项目绝对路径');
        const input = body.path.replace(/^~(?=\/|$)/, os.homedir()); if (!path.isAbsolute(input)) fail('请使用绝对路径');
        let folder; try { folder = realpathSync(input); if (!statSync(folder).isDirectory()) fail('请选择文件夹'); } catch { fail('目录不存在或无法访问'); }
        if (db.projects.some(p => p.path === folder)) fail('该项目已经添加');
        const project = { id: randomUUID(), name: String(body.name || path.basename(folder)).slice(0, 80), path: folder };
        db.projects.push(project); publish(); return json(project);
      }
      if (route === '/api/settings') {
        if (body.backend !== 'cursor') fail('Codex 后端尚未开放，请选择 Cursor');
        if (typeof body.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:[\],= -]{0,150}$/.test(body.model)) fail('模型标识无效');
        if (!['agent', 'ask', 'plan'].includes(body.mode)) fail('执行模式无效');
        const fontSize = body.fontSize ?? db.settings.fontSize;
        if (!Number.isInteger(fontSize) || fontSize < 12 || fontSize > 20) fail('字体大小应为 12–20 的整数');
        const userName = body.userName ?? db.settings.userName;
        if (typeof userName !== 'string' || !userName.trim() || [...userName.trim()].length > 40) fail('用户名称需为 1–40 个字符');
        const inputHarnesses = body.harnesses ?? db.settings.harnesses;
        if (!Array.isArray(inputHarnesses)) fail('Harness 列表无效');
        const ids = new Set(['none']);
        const harnesses = inputHarnesses.map(h => {
          if (!h || typeof h.id !== 'string' || !/^[a-z][a-z0-9-]{0,79}$/.test(h.id) || ids.has(h.id)) fail('Harness 标识无效或重复');
          ids.add(h.id);
          if (typeof h.name !== 'string' || !h.name.trim() || [...h.name.trim()].length > 80) fail('Harness 名称需为 1–80 个字符');
          if (!['generic', 'scale', 'forge', 'cuda'].includes(h.type)) fail('Harness 类型无效');
          if (typeof h.path !== 'string') fail('Harness 路径必须是字符串');
          const config = { id: h.id, name: h.name.trim(), type: h.type, path: h.path.trim() };
          if (config.path) config.path = inspectConfiguredHarness(config, root).sourceRoot;
          return config;
        });
        db.settings = { backend: 'cursor', model: body.model, mode: body.mode, force: body.force === true, fontSize, harnesses, userName: userName.trim() }; publish(); return json(db.settings);
      }
      if (route === '/api/chats') {
        if (!db.projects.some(p => p.id === body.projectId)) fail('请先选择项目');
        const harnessId = body.harnessId ?? 'none';
        const harness = harnessId !== 'none' ? publicHarness(inspectConfiguredHarness(harnessCatalog(db.settings).find(h => h.id === harnessId), root)) : undefined;
        const chat = { id: randomUUID(), projectId: body.projectId, harnessId, harness, title: '新对话', messages: [], logs: [], status: 'idle', createdAt: new Date().toISOString() };
        db.chats.unshift(chat); publish(); return json(chat);
      }
      const deletion = route.match(/^\/api\/(projects|chats)\/([^/]+)\/delete$/);
      if (deletion) {
        const [, kind, id] = deletion;
        if (!db[kind].some(item => item.id === id)) fail(kind === 'projects' ? '工作空间不存在' : '对话不存在', 404);
        const chats = db.chats.filter(c => kind === 'projects' ? c.projectId === id : c.id === id);
        if (chats.some(c => jobs.has(c.id))) fail('请先停止相关对话中正在运行的任务，再删除', 409);
        const ids = new Set(chats.map(c => c.id));
        db.chats = db.chats.filter(c => !ids.has(c.id));
        if (kind === 'projects') db.projects = db.projects.filter(p => p.id !== id);
        publish(); return json(db);
      }
      const match = route.match(/^\/api\/chats\/([^/]+)\/(send|stop)$/);
      if (match) {
        const chat = db.chats.find(c => c.id === match[1]); if (!chat) fail('对话不存在', 404);
        if (match[2] === 'stop') { if (jobs.has(chat.id)) { chat.status = 'stopping'; stop(chat.id); publish(); } return json({ ok: true }); }
        if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 64000) fail('请输入有效 prompt（最多 64000 字符）');
        if (!chat.messages.length) chat.title = body.prompt.trim().slice(0, 42);
        run(chat, body.prompt.trim()); return json({ ok: true });
      }
      fail('接口不存在', 404);
    }
    if (route.startsWith('/api/')) fail('接口不存在', 404);
    const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
    if (!files[route]) fail('Not found', 404);
    res.writeHead(200, { 'Content-Type': `${mime[path.extname(files[route])]} ; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
    res.end(readFileSync(path.join(root, 'public', files[route])));
  } catch (e) { res.writeHead(e.status || 400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
});
server.listen(port, '127.0.0.1', () => console.log(`MaPU Omni（码炉）is running at http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const id of jobs.keys()) stop(id); for (const c of clients) c.end(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3500).unref(); });
