import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
const root = path.resolve(import.meta.dirname, '..');
const dataDir = mkdtempSync(path.join(os.tmpdir(),'mapu-test-'));
const port = 14317;
let server;
async function start() {
 server = spawn(process.execPath, ['server.mjs'], {cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dataDir,CURSOR_CLI:path.join(root,'test/fake-cursor.mjs')},stdio:['ignore','pipe','pipe']});
 await Promise.race([once(server.stdout,'data'),once(server,'exit').then(([code])=>{throw new Error(`Server failed ${code}`);})]);
}
async function request(route, body, extra={}) {
 const response=await fetch(`http://127.0.0.1:${port}/api/${route}`,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),...extra});
 return {status:response.status,body:await response.json()};
}
async function complete(id) {
 for (let i=0;i<80;i++) { const {body}=await request('state'); const chat=body.chats.find(c=>c.id===id); if(!['running','stopping'].includes(chat.status)) return chat; await new Promise(r=>setTimeout(r,30)); }
 throw new Error('Timed out');
}
test('project, CLI execution, model, resume, cancellation, persistence and origin protection',async t=>{
 await start();
 t.after(async()=>{server.kill('SIGTERM');await once(server,'exit');rmSync(dataDir,{recursive:true,force:true});});
 const initial=(await request('state')).body;
 assert.deepEqual(initial.settings.harnesses,[]);
 assert.equal(Object.hasOwn(initial.settings,'scaleAgentPath'),false);
 assert.equal((await request('cli')).body.models[1].id,'test-model');
 assert.equal((await request('projects',{path:'/nonexistent-maputest'})).status,400);
 const project=(await request('projects',{path:os.tmpdir(),name:'Integration'})).body;
 assert.equal((await request('projects',{path:os.tmpdir()})).status,400);
 assert.equal((await request('settings',{backend:'codex',model:'auto',mode:'agent'})).status,400);
 assert.equal((await request('settings',{backend:'cursor',model:'test-model',mode:'ask',force:false})).status,200);
 const chat=(await request('chats',{projectId:project.id})).body;
 const prompt='hello; $(touch /tmp/mapu-should-never-run)';
 assert.equal((await request(`chats/${chat.id}/send`,{prompt})).status,200);
 const done=await complete(chat.id);
 assert.equal(done.status,'complete'); assert.equal(done.sessionId,'test-session');
 const payload=JSON.parse(done.messages[1].text);
 assert.equal(payload.cwd,project.path); assert.equal(payload.args.at(-1),prompt);
 assert.equal(payload.args[payload.args.indexOf('--model')+1],'test-model');
 assert.ok(payload.args.includes('--trust'));assert.ok(payload.args.includes('--mode'));assert.ok(!payload.args.includes('--force'));
 await request(`chats/${chat.id}/send`,{prompt:'follow up'});
 const resumed=await complete(chat.id);assert.ok(JSON.parse(resumed.messages[3].text).args.includes('--resume'));
 await request(`chats/${chat.id}/send`,{prompt:'wait'});
 assert.equal((await request(`chats/${chat.id}/send`,{prompt:'concurrent'})).status,409);
 assert.equal((await request(`chats/${chat.id}/delete`,{})).status,409);
 assert.equal((await request(`projects/${project.id}/delete`,{})).status,409);
 await request(`chats/${chat.id}/stop`,{});assert.equal((await complete(chat.id)).status,'cancelled');
 assert.equal((await request('settings',{backend:'cursor',model:'auto',mode:'agent'},{headers:{'Content-Type':'application/json',Origin:'https://evil.example'}})).status,403);
 server.kill('SIGTERM');await once(server,'exit');await start();
 const restored=(await request('state')).body;
 assert.equal(restored.settings.fontSize,14);
 assert.equal(restored.settings.contentWidth,960);
 assert.equal(restored.chats[0].messages.length,6);assert.equal(restored.settings.model,'test-model');assert.equal(restored.projects.length,initial.projects.length+1);
 const settings = {...restored.settings,fontSize:18,contentWidth:1200,userName:'  测试用户  '};
 assert.equal((await request('settings',settings)).status,200);
 assert.equal((await request('state')).body.settings.userName,'测试用户');
 for (const userName of ['', '  ', 42, '名'.repeat(41)]) assert.equal((await request('settings',{...settings,userName})).status,400);
 assert.equal((await request('settings',{...settings,fontSize:99})).status,400);
 assert.equal((await request('settings',{...settings,fontSize:'16'})).status,400);
 for (const contentWidth of [-1, 800, '960']) assert.equal((await request('settings',{...settings,contentWidth})).status,400);
 assert.equal((await request('settings',{...settings,contentWidth:0})).status,200);
 assert.equal((await request('state')).body.settings.contentWidth,0);
 assert.equal((await request('settings',settings)).status,200);
 const spare=(await request('chats',{projectId:initial.projects[0].id})).body;
 const beforeDelete=(await request('state')).body;
 const deletion=await request(`chats/${spare.id}/delete`,{});
 assert.equal(deletion.status,200);
 assert.ok(deletion.body.revision > beforeDelete.revision);
 assert.ok(!deletion.body.chats.some(c=>c.id===spare.id));
 assert.ok(deletion.body.chats.some(c=>c.id===chat.id));
 assert.deepEqual((await request('state')).body,deletion.body);
 assert.equal((await request(`chats/${spare.id}/delete`,{})).status,404);
 assert.equal((await request(`projects/${project.id}/delete`,{},{headers:{'Content-Type':'application/json',Origin:'https://evil.example'}})).status,403);
 assert.equal((await request(`projects/${project.id}/delete`,{})).status,200);
 let cleaned=(await request('state')).body;
 assert.equal(cleaned.chats.length,0); assert.equal(cleaned.projects.length,initial.projects.length);
 assert.equal((await request(`chats/${chat.id}/send`,{prompt:'removed'})).status,404);
 server.kill('SIGTERM');await once(server,'exit');await start();
 cleaned=(await request('state')).body;
 assert.equal(cleaned.settings.contentWidth,1200); assert.equal(cleaned.settings.fontSize,18); assert.equal(cleaned.settings.userName,'测试用户'); assert.equal(cleaned.chats.length,0);
 assert.equal((await request(`projects/${initial.projects[0].id}/delete`,{})).status,200);
 assert.equal((await request('state')).body.projects.length,0);
 assert.equal((await request('projects',{path:os.tmpdir(),name:'Re-add'})).status,200);
});
