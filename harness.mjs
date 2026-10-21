import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, lstatSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const ADAPTER_VERSION = 3;
export function harnessCatalog(settings) {
  return settings.harnesses || [];
}
// Consume the legacy field once so deleted entries cannot return on restart.
export function migrateHarnessSettings(settings) {
  settings.harnesses ??= [];
  if (!Object.hasOwn(settings, 'scaleAgentPath')) return false;
  if (settings.scaleAgentPath && !settings.harnesses.some(h => h.id === 'mpucporter')) {
    settings.harnesses.unshift({ id: 'mpucporter', name: 'MPUCPorter', type: 'scale', path: settings.scaleAgentPath });
  }
  delete settings.scaleAgentPath;
  return true;
}
export function inspectConfiguredHarness(config, appRoot) {
  if (!config) problem('Harness 已删除，请选择其他 Harness 或新建对话');
  const info = config.type === 'scale' ? inspectHarness(config.path, appRoot) : inspectGenericHarness(config.path, appRoot, config.type);
  return { ...info, id: config.id, name: config.name, type: config.type };
}
function inspectGenericHarness(input, appRoot, type = 'generic') {
  if (typeof input !== 'string' || !input.trim()) problem('请先填写 Harness 路径');
  let sourceRoot;
  try {
    sourceRoot = realpathSync(path.resolve(appRoot, input.trim().replace(/^~(?=\/|$)/, os.homedir())));
    if (!statSync(sourceRoot).isDirectory()) throw new Error();
  } catch { problem('Harness 路径不存在或无法访问'); }
  const entry = path.join(sourceRoot, 'AGENTS.md');
  if (!existsSync(entry) || !statSync(entry).isFile()) problem('Harness 根目录需包含 AGENTS.md');
  if (statSync(entry).size === 0) problem('AGENTS.md 不能为空');
  // Forge is an engineering workspace: snapshot reusable resources, not its projects.
  const forgeEntries = ['AGENTS.md', 'README.md', 'skills', 'agents', 'knowledge', 'tools', 'workflows', 'docs'];
  if (type === 'forge') {
    for (const entry of ['skills/catalog.json', 'knowledge/README.md', 'tools/common.py', 'workflows/README.md']) {
      if (!existsSync(path.join(sourceRoot, entry))) problem(`不是完整的 Forge Harness，缺少 ${entry}`);
    }
  }
  const files = type === 'forge' ? forgeEntries.flatMap(entry => {
    const location = path.join(sourceRoot, entry);
    if (!existsSync(location)) return [];
    if (lstatSync(location).isSymbolicLink()) problem(`Harness 资源包含符号链接：${location}`);
    return statSync(location).isDirectory() ? filesIn(location, sourceRoot) : [{ relative: entry, bytes: readFileSync(location) }];
  }) : filesIn(sourceRoot);
  const digest = createHash('sha256');
  for (const file of files) { digest.update(file.relative); digest.update('\0'); digest.update(String(file.bytes.length)); digest.update('\0'); digest.update(file.bytes); }
  const skills = files.filter(f => /^skills\/(?:[^/]+\/)*SKILL\.md$/.test(f.relative)).map(f => path.posix.dirname(f.relative));
  const agents = files.filter(f => /^agents\/[^/]+\.md$/.test(f.relative)).map(f => f.relative);
  for (const file of files.filter(f => skills.includes(path.posix.dirname(f.relative)) && path.posix.basename(f.relative) === 'SKILL.md' || agents.includes(f.relative))) {
    if (!/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(file.bytes.toString('utf8'))) problem(`${file.relative} 缺少 frontmatter`);
  }
  return { sourceRoot, version: 'unversioned', fingerprint: digest.digest('hex'), skills, agents, files };
}
const skillPaths = [
  'workflow/scale-write', 'workflow/scale-port', 'workflow/scale-comm',
  'knowledge/scale-lookup', 'review/scale-review', 'optimization/scale-opt'
];
const agentNames = ['scale-mpu-review', 'scale-comm-review'];
const excluded = new Set(['__pycache__', '.DS_Store', '.pytest_cache', 'node_modules', '.git', '.data', '.venv', 'venv', 'dist', 'build']);
function problem(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function filesIn(dir, base = dir) {
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (excluded.has(item.name)) continue;
    const file = path.join(dir, item.name);
    if (item.isSymbolicLink()) problem(`Harness 资源包含符号链接，请使用普通文件：${file}`);
    if (item.isDirectory()) out.push(...filesIn(file, base));
    else if (item.isFile() && !item.name.endsWith('.pyc')) out.push({ relative: path.relative(base, file), bytes: readFileSync(file) });
  }
  return out;
}
export function inspectHarness(input, appRoot) {
  if (typeof input !== 'string' || !input.trim()) problem('请先在设置中填写 scale-agent 路径');
  let sourceRoot;
  try {
    sourceRoot = realpathSync(path.resolve(appRoot, input.trim().replace(/^~(?=\/|$)/, os.homedir())));
    if (path.basename(sourceRoot) === 'scale-agent' && !existsSync(path.join(sourceRoot, 'AGENTS.md'))) sourceRoot = path.dirname(sourceRoot);
    if (!statSync(sourceRoot).isDirectory()) throw new Error();
  } catch { problem('scale-agent 路径不存在或无法访问'); }
  const required = ['AGENTS.md', 'scale-agent/knowledge/INDEX.md', 'scale-agent/knowledge/SOURCES.md',
    'scale-agent/scripts/knowledge.py', 'scale-agent/scripts/project_memory.py',
    ...skillPaths.map(p => `scale-agent/skills/${p}/SKILL.md`), ...agentNames.map(n => `scale-agent/agents/${n}.md`)];
  for (const file of required) if (!existsSync(path.join(sourceRoot, file)) || !statSync(path.join(sourceRoot, file)).isFile()) problem(`不是完整的 Scale Harness，缺少 ${file}`);
  const files = [{ relative: 'AGENTS.md', bytes: readFileSync(path.join(sourceRoot, 'AGENTS.md')) }];
  for (const dir of ['skills', 'knowledge', 'scripts', 'agents']) {
    files.push(...filesIn(path.join(sourceRoot, 'scale-agent', dir)).map(f => ({ ...f, relative: `scale-agent/${dir}/${f.relative.split(path.sep).join('/')}` })));
  }
  const manifest = path.join(sourceRoot, 'scale-agent/.claude-plugin/plugin.json');
  let version = 'unversioned';
  if (existsSync(manifest)) { const bytes = readFileSync(manifest); try { version = JSON.parse(bytes).version || version; } catch { problem('Harness 版本清单不是有效 JSON'); } files.push({ relative: 'scale-agent/.claude-plugin/plugin.json', bytes }); }
  const digest = createHash('sha256');
  for (const file of files) { digest.update(file.relative); digest.update('\0'); digest.update(String(file.bytes.length)); digest.update('\0'); digest.update(file.bytes); }
  return { id: 'mpucporter', name: 'MPUCPorter', sourceRoot, version, fingerprint: digest.digest('hex'), skills: skillPaths.map(p => p.split('/').at(-1)), agents: agentNames, files };
}
export function publicHarness(info) { const { files, ...visible } = info; return visible; }
function absoluteLinks(text, originalDir) {
  return text.replace(/\]\(([^)\n]+)\)/g, (match, link) => {
    if (/^(?:[a-z]+:|\/|#)/i.test(link) || /\s/.test(link)) return match;
    const hash = link.indexOf('#'), target = hash < 0 ? link : link.slice(0, hash), anchor = hash < 0 ? '' : link.slice(hash);
    return `](<${path.resolve(originalDir, target)}${anchor}>)`;
  });
}
export function prepareHarness({ info, dataDir, project, chat }) {
  if (['generic', 'forge'].includes(info.type)) return prepareGenericHarness({ info, dataDir, project, chat });
  const memoryRoot = path.join(dataDir, 'harness-memory', project.id);
  const memoryProject = path.join(memoryRoot, 'projects', project.id);
  const binding = createHash('sha256').update(JSON.stringify([info.sourceRoot, project.path, project.id, info.id, info.name])).digest('hex').slice(0, 16);
  const pluginDir = path.join(dataDir, 'harness-adapters', `${info.fingerprint.slice(0, 24)}-${binding}-v${ADAPTER_VERSION}`);
  const sourceCopy = path.join(pluginDir, 'source');
  const bridge = `# ${info.name} / Cursor 运行适配\n\n` +
    `当前实际工程目录（所有源码、测试及构建的 code-root）：${project.path}\n` +
    `原 Harness 根目录：${info.sourceRoot}\n` +
    `本次版本资源快照根目录：${sourceCopy}\n` +
    `知识与工具包根目录：${path.join(sourceCopy, 'scale-agent')}\n` +
    `本工程记忆位置：${memoryProject}\n\n` +
    `你正在真实工程目录执行，不能因为 Harness 改变 cwd。开始每轮用户任务前，从磁盘重读原 Harness 的 ${path.join(info.sourceRoot, 'AGENTS.md')}，并核对实际工程适用的 AGENTS.md；随后使用本次快照中的相关 Skills 和知识。若原 Harness 版本变化，由 MaPU Omni 阻止续接，须新建对话。\n` +
    `路径适配：原规则所谓“本文件所在目录/工作区根目录”涉及 Harness 资源时指快照根目录 ${sourceCopy}；scale-agent/... 按此根目录定位，不能按当前工程 cwd 解释。Markdown 相对链接按所在文件解析。projects/<工程>/ 一律映射为 ${memoryProject}，init 的 --code-root 必须为 ${project.path}；纯查询不初始化或写记忆。不要把日志或源码写入 Harness 源仓库，也不要修改快照。若确需回灌 Harness，先明确取得该范围授权。\n` +
    `宿主工具适配：源规则中的 collaboration.spawn_agent 是 Codex 工具名，在这里使用 Cursor 当前实际提供的原生子代理委派工具，调用本插件的 scale-mpu-review / scale-comm-review；不要尝试调用不存在的 collaboration API。仅阅读角色文件或主代理自检不等于独立审核，工具不可用时明确报告未执行。保留角色的只读要求、禁止递归派遣要求和真实证据记录。\n` +
    `适用性：保留原 Harness 的澄清、规划确认、知识证据、记忆与审核要求；用户指令与更高优先级约束优先，实际工程规则仍适用，实质冲突先说明。Ask / Plan 只读模式及工具权限继续受 CLI 设置控制，不能因 Harness 自动批准命令。回复需用户确认时明确写“等待用户确认”，并可由用户下一条消息继续。\n`;
  if (!existsSync(path.join(pluginDir, '.cursor-plugin/plugin.json'))) {
    const staging = `${pluginDir}.tmp-${chat.id}`;
    rmSync(staging, { recursive: true, force: true });
    for (const file of info.files) { const output = path.join(staging, 'source', file.relative); mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, file.bytes); }
    mkdirSync(path.join(staging, '.cursor-plugin'), { recursive: true });
    mkdirSync(path.join(staging, 'rules'), { recursive: true });
    mkdirSync(path.join(staging, 'agents'), { recursive: true });
    const rule = absoluteLinks(info.files.find(f => f.relative === 'AGENTS.md').bytes.toString('utf8'), sourceCopy)
      .replaceAll('collaboration.spawn_agent', 'Cursor 原生子代理委派工具');
    writeFileSync(path.join(staging, 'rules/mpucporter.mdc'), `---\ndescription: MPUCPorter 工作流与工作目录适配\nalwaysApply: true\n---\n${bridge}\n# 原 Harness 规则（路径基准依上文适配）\n${rule}`);
    for (const name of agentNames) {
      const original = info.files.find(f => f.relative === `scale-agent/agents/${name}.md`).bytes.toString('utf8');
      const header = original.match(/^---\n([\s\S]*?)\n---\n/);
      if (!header) problem(`审核角色 ${name} 缺少 frontmatter`);
      const description = header[1].match(/^description:\s*(.+)$/m)?.[1] || `${name} 独立只读审核`;
      const body = absoluteLinks(original.slice(header[0].length), path.join(sourceCopy, 'scale-agent/agents')).replaceAll('collaboration.spawn_agent', 'Cursor 原生子代理委派工具');
      writeFileSync(path.join(staging, `agents/${name}.md`), `---\nname: ${name}\ndescription: ${description}\nreadonly: true\npermissionMode: readonly\n---\n${bridge}\n你是未参与待审代码编写的独立只读审核员，禁止修改文件或递归派遣。\n${body}`);
    }
    // Use Cursor's conventional skill layout as well as plugin metadata. Both
    // discovery paths resolve to the same files, avoiding duplicate definitions.
    for (const relative of skillPaths) {
      const name = relative.split('/').at(-1);
      const original = info.files.find(f => f.relative === `scale-agent/skills/${relative}/SKILL.md`).bytes.toString('utf8');
      const header = original.match(/^---\n[\s\S]*?\n---\n/);
      if (!header) problem(`Skill ${name} 缺少 frontmatter`);
      const body = absoluteLinks(original.slice(header[0].length), path.join(sourceCopy, 'scale-agent/skills', relative));
      const output = path.join(staging, '.cursor/skills', name, 'SKILL.md');
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, header[0] + bridge + '\n' + body);
    }
    writeFileSync(path.join(staging, '.cursor-plugin/plugin.json'), JSON.stringify({ name: 'mpucporter', version: /^\d+\.\d+\.\d+/.test(info.version) ? info.version : '1.0.0', description: 'Scale Harness 的 MaPU Omni / Cursor 适配',
      rules: ['./rules/mpucporter.mdc'], agents: agentNames.map(n => `./agents/${n}.md`), skills: skillPaths.map(p => `./.cursor/skills/${p.split('/').at(-1)}`) }, null, 2));
    mkdirSync(path.dirname(pluginDir), { recursive: true }); renameSync(staging, pluginDir);
  }
  mkdirSync(memoryRoot, { recursive: true });
  const snapshot = { ...publicHarness(info), adapterVersion: ADAPTER_VERSION, pluginDir, memoryRoot, memoryProject, projectPath: project.path };
  const promptPrefix = `[MaPU Omni 运行配置：${info.name}]\n${bridge}\n已通过 --plugin-dir 加载插件；Skills 名称：${info.skills.join(', ')}。保留原任务含义，按需读取资源，不要一次加载整库。\n\n[用户本轮请求]\n`;
  return { snapshot, promptPrefix, args: ['--plugin-dir', pluginDir, '--add-dir', info.sourceRoot, '--add-dir', pluginDir, '--add-dir', memoryRoot] };
}

function prepareGenericHarness({ info, dataDir, project, chat }) {
  const binding = createHash('sha256').update(JSON.stringify([info.id, info.name, info.sourceRoot, project.id, project.path])).digest('hex').slice(0, 16);
  const pluginDir = path.join(dataDir, 'harness-adapters', `generic-${info.fingerprint.slice(0, 24)}-${binding}-v${ADAPTER_VERSION}`);
  const sourceCopy = path.join(pluginDir, 'source');
  let bridge = `# ${info.name} / MaPU Omni 运行适配\n实际工程目录：${project.path}\nHarness 原目录：${info.sourceRoot}\n只读资源快照：${sourceCopy}\n每轮任务开始先读取快照中的 AGENTS.md，并按需读取相关资源。执行任务的 cwd 始终为实际工程目录；Harness 中的相对资源路径以快照根目录为准。不得改写 Harness 源目录或快照。用户指令、更高优先级约束及实际工程规则仍适用。工具权限及 Ask / Plan 只读模式继续受 CLI 设置控制。\n`;
  if (info.type === 'forge') bridge += `\nForge 路径与状态适配（优先于下方原始规则）：skills/、knowledge/、workflows/、docs/ 和只读检索工具位于资源快照。state/、source/、target/、intermediate/、evals/、logs/、memory/、tmp/ 属于实际工程 ${project.path}，不得读取 Harness 原仓库的项目状态作为本工程事实。先检查实际工程 state/project_manifest.json；缺失时说明工程尚未初始化，先与用户确定 migration/native 工作流，不得借用原仓库的 manifest 或计划。tools/common.py 等工具以脚本位置推导工程根目录，快照中的工具只能执行只读知识检索；更新状态、初始化、验收和写证据必须使用实际工程中已部署且根目录正确的 Forge 工具，缺失时明确说明，不能向快照写入或假称完成。knowledge/project/ 仅作为原仓库参考，不代表当前工程证据。\n`;
  if (!existsSync(path.join(pluginDir, '.cursor-plugin/plugin.json'))) {
    const staging = `${pluginDir}.tmp-${chat.id}`;
    rmSync(staging, { recursive: true, force: true });
    try {
      for (const file of info.files) {
        const output = path.join(staging, 'source', file.relative);
        mkdirSync(path.dirname(output), { recursive: true }); writeFileSync(output, file.bytes);
      }
      mkdirSync(path.join(staging, 'rules'), { recursive: true });
      const entry = info.files.find(f => f.relative === 'AGENTS.md').bytes.toString('utf8');
      writeFileSync(path.join(staging, 'rules/harness.mdc'), `---\ndescription: Harness 工作流\nalwaysApply: true\n---\n${bridge}\n${absoluteLinks(entry, sourceCopy)}`);
      mkdirSync(path.join(staging, '.cursor-plugin'), { recursive: true });
      writeFileSync(path.join(staging, '.cursor-plugin/plugin.json'), JSON.stringify({
        name: info.id, version: '1.0.0', description: info.name,
        rules: ['./rules/harness.mdc'], skills: info.skills.map(s => `./source/${s}`), agents: info.agents.map(s => `./source/${s}`)
      }, null, 2));
      mkdirSync(path.dirname(pluginDir), { recursive: true }); renameSync(staging, pluginDir);
    } catch (error) { rmSync(staging, { recursive: true, force: true }); throw error; }
  }
  return {
    snapshot: { ...publicHarness(info), adapterVersion: ADAPTER_VERSION, pluginDir, projectPath: project.path },
    promptPrefix: `[MaPU Omni 运行配置：${info.name}]\n${bridge}\n[用户本轮请求]\n`,
    args: ['--plugin-dir', pluginDir, '--add-dir', pluginDir]
  };
}
