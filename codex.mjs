import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const codexExecutable = process.env.CODEX_CLI || [
  ...((process.env.PATH || '').split(path.delimiter).map(dir => path.join(dir, 'codex'))),
  path.join(os.homedir(), '.local/bin/codex'),
  '/opt/homebrew/bin/codex', '/usr/local/bin/codex',
  '/Applications/Codex.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'
].find(existsSync) || 'codex';

export function codexModels() {
  const cache = path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json');
  try {
    const data = JSON.parse(readFileSync(cache, 'utf8'));
    const models = (data.models || []).filter(m => m.visibility === 'list' && typeof m.slug === 'string')
      .map(m => ({ id: m.slug, name: m.display_name || m.slug }));
    return { models, source: `模型来自本机 Codex 缓存：${cache}（可能滞后，可填写自定义模型 ID）` };
  } catch {
    return { models: [], source: '本机尚无可读取的 Codex 模型缓存。Auto 使用 CLI 默认模型，也可填写自定义模型 ID。' };
  }
}

export function codexArgs({ model, mode, force, sessionId, prompt, harnessRun }) {
  // Apply policy before the subcommand so new and resumed sessions share it.
  const args = ['-a', 'never', '-s', mode === 'agent' && force ? 'workspace-write' : 'read-only'];
  if (harnessRun) {
    args.push('-c', `developer_instructions=${JSON.stringify(harnessRun.instructions)}`);
    if (harnessRun.writableRoots.length) args.push('-c', `sandbox_workspace_write.writable_roots=${JSON.stringify(harnessRun.writableRoots)}`);
  }
  args.push('exec');
  if (sessionId) args.push('resume');
  args.push('--json', '--skip-git-repo-check');
  if (model !== 'auto') args.push('--model', model);
  if (sessionId) args.push('--', sessionId); else args.push('--');
  const constraint = mode === 'plan' ? '请只分析并提出计划，不修改文件或执行有副作用的操作。\n' : mode === 'ask' ? '请只读分析并回答，不修改文件。\n' : '';
  args.push(constraint + prompt);
  return args;
}

export function applyCodexEvent(event, chat, reply) {
  if (event.type === 'thread.started' && event.thread_id) chat.sessionId = event.thread_id;
  if (event.type === 'turn.started' && event.model) reply.actualModel = event.model;
  if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
    reply.text += (reply.text ? '\n\n' : '') + (event.item.text || '');
  }
  if (event.type === 'turn.completed' && event.usage) reply.usage = event.usage;
  if (event.type === 'turn.failed' || event.type === 'error') {
    chat.error = event.error?.message || event.message || 'Codex 执行失败';
    return true;
  }
  return false;
}
