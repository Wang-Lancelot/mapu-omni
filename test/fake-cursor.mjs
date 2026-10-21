#!/usr/bin/env node
// Isolated test double. Never used by the production server unless explicitly configured.
const args = process.argv.slice(2);
if (args[0] === 'status') { console.log('Logged in as integration-test'); process.exit(0); }
if (args[0] === '--list-models') { console.log('Available models\nauto - Auto\ntest-model - Test Model'); process.exit(0); }
const prompt = args.at(-1);
console.log(JSON.stringify({ type:'system', session_id:'test-session', model:args[args.indexOf('--model')+1] }));
if (prompt === 'wait') { setInterval(() => {}, 1000); }
else {
 console.log(JSON.stringify({ type:'assistant', message:{ content:[{type:'text',text:'Test response'}] } }));
 console.log(JSON.stringify({ type:'result', result:JSON.stringify({args,cwd:process.cwd(),env:{HPP_RESULTS_ROOT:process.env.HPP_RESULTS_ROOT,PYTHONPATH:process.env.PYTHONPATH,PYTHONDONTWRITEBYTECODE:process.env.PYTHONDONTWRITEBYTECODE}}), is_error:false }));
}
