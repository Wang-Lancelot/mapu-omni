import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Run the real UI handlers with a minimal DOM and controlled network ordering.
test('deleting from either sidebar list updates both and ignores older snapshots', async () => {
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', value: '', dataset: {}, style: {setProperty() {}},
      scrollHeight: 0, scrollTop: 0, clientHeight: 0,
      classList: { toggle() {}, remove() {} },
      addEventListener(type, handler) { this[type] = handler; },
      setAttribute() {},
      querySelector(selector) { return node(selector); },
      close() {},
    });
    return nodes.get(selector);
  }
  const document = { querySelector: node, querySelectorAll: () => [], documentElement: {style:{}}, addEventListener() {} };
  const storage = new Map([['project', 'p'], ['chat', 'a'], ['expandedProjects', '["p"]']]);
  const localStorage = {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v)};
  let snapshot = {
    revision: 1, projects: [{id:'p', name:'Project', path:'/tmp'}],
    chats: ['a','b'].map((id,i) => ({id,projectId:'p',title:`Conversation ${id}`,status:'idle',messages:[],logs:[],createdAt:`2026-10-2${i}`})),
    settings: {model:'auto',mode:'agent',fontSize:14,harnesses:[{id:'mpucporter',name:'MPUCPorter',type:'scale',path:'/test/harness'}]},
  };
  const original = structuredClone(snapshot);
  const requests = [];
  const fetch = async (route, options) => {
    if (route === '/api/settings') { const {harnessesBase,...changes}=JSON.parse(options.body);snapshot={...snapshot,revision:snapshot.revision+1,settings:{...snapshot.settings,...changes}}; }
    requests.push(route);
    if (route.endsWith('/delete')) {
      const id = route.split('/')[3];
      snapshot = {...snapshot, revision:snapshot.revision + 1, chats:snapshot.chats.filter(c => c.id !== id)};
    }
    const body = route === '/api/cli' ? {authenticated:true,models:[],executable:'test',status:'ok',modelsOutput:''} : structuredClone(snapshot);
    return {ok:true,json:async () => body};
  };
  let stream;
  class EventSource { constructor() { stream = this; } }
  const run = new (Object.getPrototypeOf(async function(){}).constructor)(
    'document','localStorage','fetch','EventSource','window','setTimeout','clearTimeout',
    readFileSync(new URL('../public/app.js', import.meta.url), 'utf8') + '\nreturn {selectChat, showHarnesses: (items=catalog()) => {harnessDraftBase=catalog().map(h=>({...h}));harnessDrafts=items.map(h=>({...h}));renderHarnessCards();}};'
  );
  const ui = await run(document,localStorage,fetch,EventSource,{confirm:()=>true,innerWidth:1280,addEventListener(){}},()=>0,()=>{});
  assert.match(node('#projects').innerHTML,/Conversation a/);
  assert.match(node('#chats').innerHTML,/Conversation a/);
  node('#prompt').value = 'keep draft';
  node('#harness').onchange({target:{value:'mpucporter'}});
  assert.equal(node('#chat-title').textContent,'新对话');
  assert.equal(node('#harness').value,'mpucporter');
  assert.equal(node('#prompt').value,'keep draft');
  assert.equal(JSON.parse(storage.get('draftHarnesses')).p,'mpucporter');
  ui.selectChat('a');
  assert.equal(node('#harness').value,'none','existing chats retain their original Harness');
  const clickDelete = id => ({target:{closest: selector => selector === '[data-delete-chat]' ? {dataset:{deleteChat:id}} : null}});
  await node('#chats').click(clickDelete('a'));
  for (const selector of ['#projects','#chats']) {
    assert.doesNotMatch(node(selector).innerHTML,/Conversation a/);
    assert.match(node(selector).innerHTML,/Conversation b/);
  }
  assert.equal(node('#chat-title').textContent,'新对话');
  assert.equal(node('#chat-count').textContent,1);
  // A queued pre-deletion SSE event must not restore the deleted chat.
  stream.onmessage({data:JSON.stringify(original)});
  assert.doesNotMatch(node('#projects').innerHTML,/Conversation a/);
  assert.doesNotMatch(node('#chats').innerHTML,/Conversation a/);
  ui.selectChat('b');
  await node('#projects').click(clickDelete('b'));
  for (const selector of ['#projects','#chats']) assert.doesNotMatch(node(selector).innerHTML,/Conversation [ab]/);
  assert.equal(node('#chat-count').textContent,0);
  assert.equal(requests.filter(r => r === '/api/state').length,1,'deletion does not depend on a follow-up fetch');
  ui.showHarnesses([{id:'microcode',name:'MicroCode',type:'microcode',path:'/microcode'}]);
  assert.match(node('#harness-catalog').innerHTML,/<option value="microcode" selected>MaPU · MicroCode<\/option>/);
  assert.match(node('#harness-catalog').innerHTML,/<option value="cuda" >Scale · CUDA<\/option>/);
  ui.showHarnesses([{id:'mpucagent',name:'MPUCAgent',type:'cuda',path:'/knowledge'}]);
  assert.match(node('#harness-catalog').innerHTML,/<option value="cuda" selected>Scale · CUDA<\/option>/);
  assert.match(node('#harness-catalog').innerHTML,/<option value="forge" >Scale · Forge<\/option>/);
  ui.showHarnesses();
  assert.match(node('#harness-catalog').innerHTML,/data-harness-field="name"/);
  assert.match(node('#harness-catalog').innerHTML,/data-remove-harness="mpucporter"/);
  assert.doesNotMatch(node('#harness-catalog').innerHTML,/内置 Harness/);
  await node('#harness-catalog').click({target:{closest:s=>s==='[data-remove-harness]'?{dataset:{removeHarness:'mpucporter'}}:null}});
  assert.equal(node('#harness-catalog').innerHTML,'');
  const values={backend:'cursor',customModel:'',model:'auto',mode:'agent',fontSize:'14',userName:'User'};
  const elements=Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value}]));elements.force={checked:false};
  await node('#settings-form').onsubmit({preventDefault(){},target:{elements}});
  assert.deepEqual(snapshot.settings.harnesses,[]);
  assert.equal(Object.hasOwn(snapshot.settings,'scaleAgentPath'),false);
  assert.equal(node('#harness').innerHTML,'<option value="none">无</option>');
  // An open settings draft predates another client adding MicroCode.
  ui.showHarnesses();
  const microcode={id:'microcode',name:'MicroCode',type:'microcode',path:'/microcode'};
  snapshot={...snapshot,revision:snapshot.revision+1,settings:{...snapshot.settings,harnesses:[microcode]}};
  stream.onmessage({data:JSON.stringify(snapshot)});
  assert.match(node('#harness').innerHTML,/MicroCode/);
  elements.fontSize.value='18';
  await node('#settings-form').onsubmit({preventDefault(){},target:{elements}});
  assert.equal(snapshot.settings.fontSize,18);
  assert.deepEqual(snapshot.settings.harnesses,[microcode],'saving unrelated settings keeps a newly added Harness');
  assert.match(node('#harness').innerHTML,/MicroCode/);

});
