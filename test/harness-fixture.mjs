import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export function createHarnessFixture(root) {
 const files={
  'AGENTS.md':'# Harness rules\n本文件所在目录为工作区根目录，下文路径均相对此目录。\nRead [index](scale-agent/knowledge/INDEX.md). Use collaboration.spawn_agent for independent review.\n',
  'scale-agent/knowledge/INDEX.md':'# Index\nTest knowledge',
  'scale-agent/knowledge/SOURCES.md':'# Sources',
  'scale-agent/scripts/knowledge.py':'print("metadata")',
  'scale-agent/scripts/project_memory.py':'print("memory")',
  'scale-agent/.claude-plugin/plugin.json':JSON.stringify({name:'scale-code-agent',version:'1.7.0'})
 };
 for(const name of ['workflow/scale-write','workflow/scale-port','workflow/scale-comm','knowledge/scale-lookup','review/scale-review','optimization/scale-opt']) files[`scale-agent/skills/${name}/SKILL.md`]=`---\nname: ${name.split('/').at(-1)}\ndescription: Test skill\n---\nRead [knowledge](../../../knowledge/INDEX.md).`;
 for(const name of ['scale-mpu-review','scale-comm-review']) files[`scale-agent/agents/${name}.md`]=`---\nname: ${name}\ndescription: Independent reviewer\ntools: Read, Grep, Glob, Bash\n---\nRead [skill](../skills/review/scale-review/SKILL.md). Never write files.`;
 for(const [relative,content] of Object.entries(files)){const file=path.join(root,relative);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,content);}
 return root;
}
