#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === 'login' && args[1] === 'status') { console.log('Logged in using ChatGPT'); process.exit(0); }
console.log(JSON.stringify({type:'thread.started',thread_id:'codex-test-session'}));
const prompt = args.at(-1);
if (prompt === 'wait') setInterval(() => {}, 1000);
else if (prompt === 'fail') console.log(JSON.stringify({type:'turn.failed',error:{message:'Test failure'}}));
else {
 console.log(JSON.stringify({type:'item.completed',item:{id:'reasoning',type:'reasoning',text:'Hidden reasoning'}}));
 console.log(JSON.stringify({type:'item.completed',item:{id:'answer',type:'agent_message',text:JSON.stringify({args,cwd:process.cwd(),env:{HPP_RESULTS_ROOT:process.env.HPP_RESULTS_ROOT}})}}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:10,output_tokens:5}}));
}
