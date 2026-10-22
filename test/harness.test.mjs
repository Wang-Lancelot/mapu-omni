import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, realpathSync, mkdirSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { inspectHarness, inspectConfiguredHarness, prepareHarness, harnessCatalog, migrateHarnessSettings } from '../harness.mjs';
import { codexArgs } from '../codex.mjs';
import { createHarnessFixture } from './harness-fixture.mjs';

function createCudaFixture(source) {
 const files={
  'AGENTS.md':'# CUDA rules\nRead [start](START_HERE.md).',
  'START_HERE.md':'# Start\nRead projects/<id>/project.yaml.',
  'common/cuda2scale/commands/INDEX.md':'# Commands\nRead autoTrans.md as a playbook.',
  'common/cuda2scale/commands/autoTrans.md':'# Translate\nS2 must pass before S3.',
  'common/cuda2scale/skills/SKILL_INDEX.md':'# Knowledge index',
  'common/cuda2scale/SCALE_checklist.md':'# Checklist',
  'projects/_template/project.yaml':'id: REPLACE_ME\ncode_root: ""\n',
  'projects/other/project.yaml':'id: other\ncode_root: /unrelated\n'
 };
 for (const [name,content] of Object.entries(files)) {const dest=path.join(source,name);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,content);}
 return source;
}

function createMicrocodeFixture(source) {
 const files={
  'AGENTS.md':'# Microcode\nRead [routing](skills/hpp-routing/SKILL.md).',
  'version.json':JSON.stringify({product:'1.1.3'}),
  'plugin.json':JSON.stringify({name:'hpp-microcode-plugin',version:'1.1.3'}),
  'capabilities.json':'{}',
  'skills/hpp-routing/SKILL.md':'---\nname: hpp-routing\ndescription: Route tasks\n---\nRead ../../references/README.md.',
  'skills/math/nested/SKILL.md':'---\nname: math-nested\ndescription: Math task\n---\nUse evidence.',
  'lib/hpp_harness/__init__.py':'# HPP library',
  'scripts/_bootstrap.py':'# Snapshot root',
  'references/README.md':'# ISA references',
  'compiler-environment/environment.json':'{"toolchain":"REPLACE_ME"}',
  'compiler-environment/environment.local.json':'{"toolchain":"private-local-machine"}',
  'compiler-environment/runs/output.log':'old result'
 };
 for (const [name,content] of Object.entries(files)) { const file=path.join(source,name);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,content); }
 return source;
}

test('adapter snapshots preserve relative resources, native skills, readonly agents and project isolation',t=>{
 const folder=realpathSync(mkdtempSync(path.join(os.tmpdir(),'mapu-harness-')));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const source=createHarnessFixture(path.join(folder,'source'));
 const info=inspectHarness(source,folder);
 assert.equal(inspectHarness(path.join(source,'scale-agent'),folder).sourceRoot,source);
 assert.equal(info.skills.length,6);assert.equal(info.agents.length,2);
 const make=id=>prepareHarness({info,dataDir:path.join(folder,'data'),project:{id,path:path.join(folder,id)},chat:{id:`chat-${id}`}});
 const a=make('alpha'),b=make('beta');
 assert.notEqual(a.snapshot.memoryRoot,b.snapshot.memoryRoot);assert.notEqual(a.snapshot.pluginDir,b.snapshot.pluginDir);
 const manifest=JSON.parse(readFileSync(path.join(a.snapshot.pluginDir,'.cursor-plugin/plugin.json')));
 assert.equal(manifest.skills.length,6);
 for(const file of [...manifest.rules,...manifest.agents])assert.ok(existsSync(path.join(a.snapshot.pluginDir,file)) && file.endsWith(file.includes('/rules/')?'.mdc':'.md'));
 for(const skill of manifest.skills)assert.ok(existsSync(path.join(a.snapshot.pluginDir,skill,'SKILL.md')));
 assert.ok(existsSync(path.join(a.snapshot.pluginDir,'source/scale-agent/knowledge/INDEX.md')));
 const role=readFileSync(path.join(a.snapshot.pluginDir,'agents/scale-mpu-review.md'),'utf8');
 assert.match(role,/readonly: true/);assert.match(role,/permissionMode: readonly/);assert.ok(!role.includes('tools: Read, Grep'));
 const rule=readFileSync(path.join(a.snapshot.pluginDir,'rules/mpucporter.mdc'),'utf8');
 assert.match(rule,/alwaysApply: true/);assert.ok(rule.includes(path.join(folder,'alpha')));
 assert.ok(rule.includes(`${a.snapshot.pluginDir}/source/scale-agent/knowledge/INDEX.md`));
 writeFileSync(path.join(source,'scale-agent/knowledge/INDEX.md'),'new knowledge');
 assert.notEqual(inspectHarness(source,folder).fingerprint,info.fingerprint);
 assert.equal(readFileSync(path.join(a.snapshot.pluginDir,'source/scale-agent/knowledge/INDEX.md'),'utf8'),'# Index\nTest knowledge');
 assert.throws(()=>inspectHarness(folder,folder),/缺少/);
});

test('arbitrary workspaces run selected Harness with actual cwd; configuration changes cannot reuse old sessions',async t=>{
 const folder=realpathSync(mkdtempSync(path.join(os.tmpdir(),'mapu-harness-api-')));
 const source=createHarnessFixture(path.join(folder,'source'));
 const dataDir=path.join(folder,'data'),port=14319;
 mkdirSync(dataDir);
 writeFileSync(path.join(dataDir,'workspace.json'),JSON.stringify({projects:[],chats:[],settings:{backend:'cursor',model:'auto',mode:'agent',force:false,fontSize:14,scaleAgentPath:source}}));
 const launch=()=>spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,CURSOR_CLI:path.join(import.meta.dirname,'fake-cursor.mjs')},stdio:['ignore','pipe','pipe']});
 let server=launch();
 t.after(async()=>{server.kill('SIGTERM');await once(server,'exit');rmSync(folder,{recursive:true,force:true});});
 await Promise.race([once(server.stdout,'data'),once(server,'exit').then(([c])=>{throw new Error(`server exit ${c}`)})]);
 async function req(route,body){const r=await fetch(`http://127.0.0.1:${port}/api/${route}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
 async function done(id){for(let i=0;i<80;i++){const c=(await req('state')).body.chats.find(c=>c.id===id);if(c.status!=='running')return c;await new Promise(r=>setTimeout(r,25));}throw new Error('timeout');}
 const initial=(await req('state')).body;
 assert.equal(Object.hasOwn(initial.settings,'scaleAgentPath'),false);
 assert.equal(initial.settings.harnesses[0].id,'mpucporter');
 assert.equal(Object.hasOwn(JSON.parse(readFileSync(path.join(dataDir,'workspace.json'))).settings,'scaleAgentPath'),false);
 const settings={...initial.settings};
 assert.equal((await req('harness/check',{path:source})).body.skills.length,6);
 assert.equal((await req('settings',{...settings,harnesses:[{...settings.harnesses[0],path:folder}]})).status,400);
 assert.equal((await req('settings',settings)).status,200);
 const project=(await req('projects',{path:folder,name:'Unrelated project'})).body;
 assert.equal((await req('chats',{projectId:project.id,harnessId:'bad'})).status,400);
 const chat=(await req('chats',{projectId:project.id,harnessId:'mpucporter'})).body;
 assert.equal(chat.harness.name,'MPUCPorter');
 await req(`chats/${chat.id}/send`,{prompt:'plain query'});
 const first=await done(chat.id),payload=JSON.parse(first.messages[1].text);
 assert.equal(first.status,'complete');assert.equal(payload.cwd,project.path);
 assert.ok(payload.args.includes('--plugin-dir'));assert.ok(payload.args.includes('--add-dir'));
 assert.ok(payload.args.at(-1).endsWith('[用户本轮请求]\nplain query'));
 assert.equal(first.messages[0].text,'plain query');assert.equal(first.messages[1].harnessId,'mpucporter');
 assert.ok(first.harness.memoryProject.startsWith(dataDir));
 await req(`chats/${chat.id}/send`,{prompt:'continue'});
 assert.ok(JSON.parse((await done(chat.id)).messages[3].text).args.includes('--resume'));
 const raw=(await req('chats',{projectId:project.id,harnessId:'none'})).body;
 await req(`chats/${raw.id}/send`,{prompt:'unchanged'});
 const rawPayload=JSON.parse((await done(raw.id)).messages[1].text);
 assert.equal(rawPayload.args.at(-1),'unchanged');assert.ok(!rawPayload.args.includes('--plugin-dir'));
 writeFileSync(path.join(source,'AGENTS.md'),'updated rules');
 assert.equal((await req(`chats/${chat.id}/send`,{prompt:'stale'})).status,409);
 assert.equal((await req('state')).body.chats.find(c=>c.id===chat.id).messages.length,4);
 const renamed={...settings,harnesses:[{...settings.harnesses[0],name:'Porter renamed'}]};
 assert.equal((await req('settings',renamed)).status,200);
 assert.equal((await req('chats',{projectId:project.id,harnessId:'mpucporter'})).body.harness.name,'Porter renamed');
 assert.equal((await req('settings',{...settings,harnesses:[]})).status,200);
 assert.deepEqual((await req('state')).body.settings.harnesses,[]);
 server.kill('SIGTERM');await once(server,'exit');server=launch();
 await Promise.race([once(server.stdout,'data'),once(server,'exit').then(([c])=>{throw new Error(`server restart exit ${c}`)})]);
 assert.deepEqual((await req('state')).body.settings.harnesses,[],'deleted MPUCPorter stays deleted after restart');
 assert.ok((await req('state')).body.chats.some(c=>c.id===chat.id),'removing MPUCPorter preserves existing chats');
 assert.equal((await req(`chats/${chat.id}/send`,{prompt:'deleted porter'})).status,400);
 assert.equal((await req('chats',{projectId:project.id,harnessId:'mpucporter'})).status,400);
 assert.equal((await req('chats',{projectId:project.id,harnessId:'none'})).status,200);
 const customSource=path.join(folder,'custom');mkdirSync(customSource);writeFileSync(path.join(customSource,'AGENTS.md'),'# Custom Harness\nUse project code.');
 const custom=Array.from({length:8},(_,i)=>({id:`h-custom-${i}`,name:`自定义 ${i}`,type:'generic',path:customSource}));
 const customSettings={...settings,harnesses:custom};
 assert.equal((await req('harness/check',{path:customSource,type:'generic'})).status,200);
 assert.equal((await req('harness/check',{path:folder,type:'generic'})).status,400);
 assert.equal((await req('settings',{...customSettings,harnesses:[custom[0],custom[0]]})).status,400);
 assert.equal((await req('settings',{...customSettings,harnesses:[{...custom[0],id:'../bad'}]})).status,400);
 assert.equal((await req('settings',customSettings)).status,200);
 assert.equal((await req('state')).body.settings.harnesses.length,8);
 assert.equal(JSON.parse(readFileSync(path.join(dataDir,'workspace.json'))).settings.harnesses[0].name,'自定义 0');
 const customChat=(await req('chats',{projectId:project.id,harnessId:custom[0].id})).body;
 assert.equal(customChat.harness.name,'自定义 0');
 await req(`chats/${customChat.id}/send`,{prompt:'custom task'});
 const customRun=await done(customChat.id),customPayload=JSON.parse(customRun.messages[1].text);
 assert.equal(customRun.status,'complete');assert.equal(customPayload.cwd,project.path);
 assert.ok(customPayload.args.includes('--plugin-dir'));assert.ok(customPayload.args.at(-1).includes('自定义 0'));
 assert.equal(customRun.messages[1].harnessName,'自定义 0');
 await req(`chats/${customChat.id}/send`,{prompt:'continue custom'});
 assert.ok(JSON.parse((await done(customChat.id)).messages[3].text).args.includes('--resume'));
 writeFileSync(path.join(customSource,'AGENTS.md'),'Changed rules');
 assert.equal((await req(`chats/${customChat.id}/send`,{prompt:'stale'})).status,409);
 assert.equal((await req('settings',{...customSettings,harnesses:custom.slice(1)})).status,200);
 assert.equal((await req(`chats/${customChat.id}/send`,{prompt:'deleted'})).status,400);
 assert.ok((await req('state')).body.chats.some(c=>c.id===customChat.id),'deleting a Harness preserves history');
 assert.equal((await req('chats',{projectId:project.id,harnessId:custom[0].id})).status,400);
 const cudaSource=createCudaFixture(path.join(folder,'cuda'));
 const cuda={id:'mpucagent',name:'MPUCAgent',type:'cuda',path:cudaSource};
 assert.equal((await req('harness/check',cuda)).status,200);
 assert.equal((await req('harness/check',{...cuda,path:folder})).status,400);
 const cudaSettings={...customSettings,harnesses:[...custom.slice(1),cuda]};
 assert.equal((await req('settings',cudaSettings)).status,200);
 const cudaChat=(await req('chats',{projectId:project.id,harnessId:cuda.id})).body;
 assert.equal(cudaChat.harness.type,'cuda');assert.equal(cudaChat.harness.name,'MPUCAgent');
 await req(`chats/${cudaChat.id}/send`,{prompt:'analyze CUDA module'});
 const cudaRun=await done(cudaChat.id),cudaPayload=JSON.parse(cudaRun.messages[1].text);
 assert.equal(cudaRun.status,'complete');assert.equal(cudaPayload.cwd,project.path);
 assert.ok(cudaPayload.args.at(-1).includes('playbook'));
 assert.ok(cudaPayload.args.includes(cudaRun.harness.memoryRoot));
 assert.equal(JSON.parse(readFileSync(path.join(dataDir,'workspace.json'))).settings.harnesses.at(-1).type,'cuda');
 const microcodeSource=createMicrocodeFixture(path.join(folder,'microcode'));
 const microcode={id:'microcode',name:'MicroCode',type:'microcode',path:microcodeSource};
 assert.equal((await req('harness/check',microcode)).body.version,'1.1.3');
 assert.equal((await req('harness/check',{...microcode,path:cudaSource})).status,400);
 assert.equal((await req('settings',{...cudaSettings,harnesses:[...cudaSettings.harnesses,microcode]})).status,200);
 const staleSave=await req('settings',{...cudaSettings,fontSize:18,harnessesBase:cudaSettings.harnesses,harnesses:[]});
 assert.equal(staleSave.status,409);
 assert.match(staleSave.body.error,/重新打开设置/);
 assert.ok((await req('state')).body.settings.harnesses.some(h=>h.id===microcode.id));
 const {harnesses:unusedHarnesses,...onlyPreferences}=cudaSettings;
 assert.equal((await req('settings',{...onlyPreferences,fontSize:18})).status,200);
 assert.ok((await req('state')).body.settings.harnesses.some(h=>h.id===microcode.id),'preference-only saves keep MicroCode');
 const microChat=(await req('chats',{projectId:project.id,harnessId:microcode.id})).body;
 assert.equal(microChat.harness.type,'microcode');
 await req(`chats/${microChat.id}/send`,{prompt:'inspect microcode task'});
 const microRun=await done(microChat.id),microPayload=JSON.parse(microRun.messages[1].text);
 assert.equal(microRun.status,'complete');assert.equal(microPayload.cwd,project.path);
 assert.equal(microPayload.env.HPP_RESULTS_ROOT,microRun.harness.resultsRoot);
 assert.equal(microPayload.env.PYTHONPATH,path.join(microRun.harness.pluginDir,'source/lib'));
 assert.equal(microPayload.env.PYTHONDONTWRITEBYTECODE,'1');
 await req(`chats/${raw.id}/send`,{prompt:'no env leak'});
 const rawAgain=JSON.parse((await done(raw.id)).messages.at(-1).text);
 assert.notEqual(rawAgain.env.HPP_RESULTS_ROOT,microRun.harness.resultsRoot);



});


test('generic Harness snapshots include resources and register skills and roles', t => {
 const folder=realpathSync(mkdtempSync(path.join(os.tmpdir(),'forge-generic-')));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const source=path.join(folder,'harness');mkdirSync(path.join(source,'skills','opt','references'),{recursive:true});mkdirSync(path.join(source,'agents'));
 writeFileSync(path.join(source,'AGENTS.md'),'# Optimize\nRead [guide](guide.md).');writeFileSync(path.join(source,'guide.md'),'Keep output correct.');
 writeFileSync(path.join(source,'skills/opt/SKILL.md'),'---\nname: opt\ndescription: Optimize code\n---\nRead references/check.md');
 writeFileSync(path.join(source,'skills/opt/references/check.md'),'Check output');
 writeFileSync(path.join(source,'agents/review.md'),'---\nname: review\ndescription: Review code\nreadonly: true\n---\nReview changes.');
 const config={id:'h-opt',name:'代码优化',type:'generic',path:source};
 const info=inspectConfiguredHarness(config,folder);
 assert.deepEqual(info.skills,['skills/opt']);assert.deepEqual(info.agents,['agents/review.md']);
 const result=prepareHarness({info,dataDir:path.join(folder,'data'),project:{id:'project',path:folder},chat:{id:'chat'}});
 const manifest=JSON.parse(readFileSync(path.join(result.snapshot.pluginDir,'.cursor-plugin/plugin.json')));
 assert.equal(manifest.name,'h-opt');assert.equal(manifest.skills[0],'./source/skills/opt');
 assert.ok(readFileSync(path.join(result.snapshot.pluginDir,'rules/harness.mdc'),'utf8').includes(path.join(result.snapshot.pluginDir,'source/guide.md')));
 assert.equal(readFileSync(path.join(result.snapshot.pluginDir,'source/guide.md'),'utf8'),'Keep output correct.');
 writeFileSync(path.join(source,'guide.md'),'Changed');assert.notEqual(inspectConfiguredHarness(config,folder).fingerprint,info.fingerprint);
 writeFileSync(path.join(source,'skills/opt/SKILL.md'),'Invalid skill');assert.throws(()=>inspectConfiguredHarness(config,folder),/frontmatter/);
});


test('Forge snapshots reusable resources without importing project state or build symlinks', t => {
 const folder=realpathSync(mkdtempSync(path.join(os.tmpdir(),'mapu-forge-')));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const source=path.join(folder,'forge');
 const files={
  'AGENTS.md':'# Forge\nRead state/project_manifest.json and skills/catalog.json.',
  'skills/catalog.json':'{}', 'skills/opt/SKILL.md':'---\nname: opt\ndescription: Optimize\n---\nCheck evidence.',
  'knowledge/README.md':'# Shared knowledge', 'tools/common.py':'# Tools root', 'workflows/README.md':'# Workflows',
  'state/project_manifest.json':'{"project":"unrelated"}', 'target/output.sc':'old implementation'
 };
 for (const [name,content] of Object.entries(files)) { const dest=path.join(source,name);mkdirSync(path.dirname(dest),{recursive:true});writeFileSync(dest,content); }
 symlinkSync('/does-not-exist',path.join(source,'target/build-link'));
 const config={id:'mpucopt',name:'MPUCOpt',type:'forge',path:source};
 const info=inspectConfiguredHarness(config,folder);
 assert.deepEqual(info.skills,['skills/opt']);
 assert.ok(!info.files.some(f=>/^(state|target)\//.test(f.relative)));
 const result=prepareHarness({info,dataDir:path.join(folder,'data'),project:{id:'p',path:folder},chat:{id:'c'}});
 assert.match(result.promptPrefix,/state\/project_manifest.json/);
 assert.match(result.promptPrefix,/缺失时说明工程尚未初始化/);
 assert.match(result.promptPrefix,/只能执行只读知识检索/);
 const fingerprint=info.fingerprint;
 writeFileSync(path.join(source,'state/project_manifest.json'),'changed project');
 assert.equal(inspectConfiguredHarness(config,folder).fingerprint,fingerprint);
 writeFileSync(path.join(source,'knowledge/README.md'),'changed shared knowledge');
 assert.notEqual(inspectConfiguredHarness(config,folder).fingerprint,fingerprint);
 symlinkSync('/does-not-exist',path.join(source,'tools/bad-link'));
 assert.throws(()=>inspectConfiguredHarness(config,folder),/符号链接/);
});


test('legacy MPUCPorter migrates once and all Harnesses can remain deleted', () => {
 const settings={scaleAgentPath:'/legacy/scale',harnesses:[{id:'mpucopt',name:'MPUCOpt',type:'forge',path:'/forge'}]};
 assert.equal(migrateHarnessSettings(settings),true);
 assert.deepEqual(harnessCatalog(settings).map(h=>h.id),['mpucporter','mpucopt']);
 assert.equal(Object.hasOwn(settings,'scaleAgentPath'),false);
 settings.harnesses[0].name='Renamed';
 assert.equal(migrateHarnessSettings(settings),false);
 assert.equal(settings.harnesses[0].name,'Renamed');
 settings.harnesses=[];
 assert.equal(migrateHarnessSettings(settings),false);
 assert.deepEqual(harnessCatalog(settings),[]);
 const fresh={};migrateHarnessSettings(fresh);assert.deepEqual(harnessCatalog(fresh),[]);
 const duplicate={scaleAgentPath:'/old',harnesses:[{id:'mpucporter',name:'Edited',type:'generic',path:'/new'}]};
 migrateHarnessSettings(duplicate);assert.equal(duplicate.harnesses.length,1);assert.equal(duplicate.harnesses[0].name,'Edited');
});


test('CUDA knowledge snapshots isolate project configuration and route playbooks', t => {
 const folder=realpathSync(mkdtempSync(path.join(os.tmpdir(),'mapu-cuda-')));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const source=createCudaFixture(path.join(folder,'source'));
 symlinkSync('/missing',path.join(source,'projects/other/build-link'));
 const config={id:'mpucagent',name:'MPUCAgent',type:'cuda',path:source};
 const info=inspectConfiguredHarness(config,folder);
 assert.ok(info.files.some(f=>f.relative==='projects/_template/project.yaml'));
 assert.ok(!info.files.some(f=>f.relative.startsWith('projects/other/')));
 const make=id=>prepareHarness({info,dataDir:path.join(folder,'data'),project:{id,path:path.join(folder,id)},chat:{id:'c'}});
 const a=make('a'),b=make('b');
 assert.notEqual(a.snapshot.memoryProject,b.snapshot.memoryProject);
 assert.ok(a.args.includes(a.snapshot.memoryRoot));
 assert.match(a.promptPrefix,/并非 shell 命令/);assert.match(a.promptPrefix,/NOT_RUN/);
 assert.ok(a.promptPrefix.includes(path.join(a.snapshot.memoryProject,'project.yaml')));
 const manifest=JSON.parse(readFileSync(path.join(a.snapshot.pluginDir,'.cursor-plugin/plugin.json')));
 assert.equal(manifest.name,'mpucagent');
 const rules=readFileSync(path.join(a.snapshot.pluginDir,manifest.rules[0]),'utf8');
 assert.ok(rules.includes(path.join(a.snapshot.pluginDir,'source/START_HERE.md')));
 writeFileSync(path.join(source,'projects/other/project.yaml'),'changed');
 assert.equal(inspectConfiguredHarness(config,folder).fingerprint,info.fingerprint);
 writeFileSync(path.join(source,'common/cuda2scale/commands/autoTrans.md'),'changed');
 assert.notEqual(inspectConfiguredHarness(config,folder).fingerprint,info.fingerprint);
 assert.match(readFileSync(path.join(a.snapshot.pluginDir,'source/common/cuda2scale/commands/autoTrans.md'),'utf8'),/S2 must pass/);
 rmSync(path.join(source,'START_HERE.md'));
 assert.throws(()=>inspectConfiguredHarness(config,folder),/不是完整的 CUDA Harness/);
});


test('MicroCode snapshots native skills and version while isolating results and local environment', t => {
 const folder=realpathSync(mkdtempSync(path.join(os.tmpdir(),'mapu-microcode-')));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const source=createMicrocodeFixture(path.join(folder,'source'));
 const config={id:'microcode',name:'MicroCode',type:'microcode',path:source};
 const info=inspectConfiguredHarness(config,folder);
 assert.equal(info.version,'1.1.3');assert.equal(info.skills.length,2);
 assert.ok(info.skills.includes('skills/math/nested'));
 assert.ok(!info.files.some(f=>f.relative.includes('environment.local.json') || f.relative.startsWith('compiler-environment/runs/')));
 const make=id=>prepareHarness({info,dataDir:path.join(folder,'data'),project:{id,path:path.join(folder,id)},chat:{id:'c'}});
 const a=make('a'),b=make('b');
 assert.notEqual(a.snapshot.resultsRoot,b.snapshot.resultsRoot);
 assert.equal(a.env.HPP_RESULTS_ROOT,a.snapshot.resultsRoot);
 assert.ok(a.args.includes(a.snapshot.memoryRoot));assert.ok(existsSync(a.snapshot.resultsRoot));
 assert.ok(!a.snapshot.resultsRoot.startsWith(a.snapshot.pluginDir));
 assert.match(a.promptPrefix,/HG-001/);assert.match(a.promptPrefix,/--environment/);
 const manifest=JSON.parse(readFileSync(path.join(a.snapshot.pluginDir,'.cursor-plugin/plugin.json')));
 assert.equal(manifest.version,'1.1.3');assert.equal(manifest.skills.length,2);
 for (const skill of manifest.skills) assert.ok(existsSync(path.join(a.snapshot.pluginDir,skill,'SKILL.md')));
 assert.equal(readFileSync(path.join(a.snapshot.pluginDir,'source/lib/hpp_harness/__init__.py'),'utf8'),'# HPP library');
 writeFileSync(path.join(source,'compiler-environment/environment.local.json'),'changed local config');
 assert.equal(inspectConfiguredHarness(config,folder).fingerprint,info.fingerprint);
 writeFileSync(path.join(source,'references/README.md'),'new knowledge');
 assert.notEqual(inspectConfiguredHarness(config,folder).fingerprint,info.fingerprint);
 writeFileSync(path.join(source,'plugin.json'),'{}');
 assert.throws(()=>inspectConfiguredHarness(config,folder),/版本不一致/);
 writeFileSync(path.join(source,'version.json'),'invalid');
 assert.throws(()=>inspectConfiguredHarness(config,folder),/版本清单无效/);
});

test('Codex Harness uses original resources and keeps snapshots outside writable roots',t=>{
 const folder=realpathSync(mkdtempSync(path.join(os.tmpdir(),'mapu-codex-harness-')));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const dataDir=path.join(folder,'data'), project={id:'p',path:folder},chat={id:'c'};
 const scale=inspectHarness(createHarnessFixture(path.join(folder,'scale')),folder);
 const info={...scale,type:'scale'};
 const run=prepareHarness({info,dataDir,project,chat,backend:'codex'});
 assert.equal(run.snapshot.backend,'codex');assert.deepEqual(run.args,[]);
 assert.match(run.instructions,/scale-agent\/skills\/workflow\/scale-write/);
 assert.match(run.instructions,/scale-agent\/agents\/scale-mpu-review.md/);
 assert.doesNotMatch(run.instructions,/Cursor 原生子代理|已通过 --plugin-dir/);
 assert.deepEqual(run.writableRoots,[run.snapshot.memoryRoot]);
 assert.ok(!run.writableRoots.includes(run.snapshot.pluginDir));
 const entry=readFileSync(path.join(run.snapshot.pluginDir,'source/AGENTS.md'),'utf8');
 assert.match(entry,/collaboration.spawn_agent/);
 const args=codexArgs({model:'auto',mode:'agent',force:true,prompt:'test',harnessRun:run});
 assert.ok(!args.includes('--plugin-dir'));assert.ok(args.includes(`developer_instructions=${JSON.stringify(run.instructions)}`));
 const micro=inspectConfiguredHarness({id:'mc',name:'MicroCode',type:'microcode',path:createMicrocodeFixture(path.join(folder,'micro'))},folder);
 const mc=prepareHarness({info:micro,dataDir,project,chat,backend:'codex'});
 assert.equal(mc.env.HPP_RESULTS_ROOT,mc.snapshot.resultsRoot);
 assert.match(mc.instructions,/HPP_RESULTS_ROOT/);assert.match(mc.instructions,/skills\/hpp-routing/);
 assert.deepEqual(mc.writableRoots,[mc.snapshot.memoryRoot]);
});
