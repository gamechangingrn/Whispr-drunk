import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

// Exercises only helper protocol, device capture and refusal guards. Never steals
// foreground focus or sends input to an existing application.
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const executable=join(root,'native','windows','bin','Willfull.Native.exe');
const helper=spawn(executable,[],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const pending=new Map();let sequence=0,frames=0,pcmBytes=0,captureSession='';
let readyResolve,readyReject;
const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
let stderr='';helper.stderr.on('data',data=>{stderr=(stderr+String(data)).slice(-1000);});
helper.on('error',error=>{readyReject(error);for(const task of pending.values())task.reject(error);});
helper.on('exit',()=>{for(const task of pending.values())task.reject(new Error('Native helper exited before response.'));});
const reader=createInterface({input:helper.stdout});
reader.on('line',line=>{
 let item;try{item=JSON.parse(line);}catch{return;}
 if(item.event==='ready')readyResolve(item);
 if(item.event==='audio'&&item.sessionId===captureSession){frames++;pcmBytes+=Buffer.byteLength(item.pcm,'base64');}
 if(item.id!==undefined&&pending.has(item.id)){const task=pending.get(item.id);pending.delete(item.id);clearTimeout(task.timer);task.resolve(item);}
});
function request(op,payload={}){
 const id=++sequence;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${op} timed out`));},5000);
  pending.set(id,{resolve,reject,timer});helper.stdin.write(JSON.stringify({id,op,...payload})+'\n');
 });
}
const timeout=setTimeout(()=>{helper.kill();throw new Error('Native integration exceeded 20 seconds.');},20000);
const checks=[];
try{
 const welcome=await ready;assert.equal(welcome.protocol,1);checks.push('protocol-ready');
 assert.equal((await request('busy',{active:true})).result.active,true);
 assert.equal((await request('busy',{active:false})).result.active,false);checks.push('interaction-cancel-state');
 const devices=await request('devices');assert.equal(devices.ok,true);assert.ok(Array.isArray(devices.result));checks.push('device-enumeration');
 const metrics=await request('metrics',{pids:[process.pid,helper.pid,helper.pid,999999]});assert.equal(metrics.ok,true);
 assert.equal(metrics.result.byPid.filter(item=>item.pid===helper.pid).length,1);
 assert.ok(metrics.result.workingSetBytes>0&&metrics.result.privateBytes>0);checks.push('aggregate-process-memory');
 const configured=await request('configure',{hotkey:'Alt+Ctrl+F9',commandHotkey:'Ctrl+Shift+F10',toggleHotkey:'Ctrl+Alt+F11'});
 assert.equal(configured.ok,true);assert.equal(configured.result.hotkeys.dictate,'Ctrl+Alt+F9');checks.push('shortcut-configuration');
 assert.equal((await request('configure',{hotkey:'Ctrl+Alt+A'})).ok,false);checks.push('shortcut-conflict-rejection');
 assert.equal((await request('configure',{hotkey:'Space'})).ok,false);checks.push('unsafe-shortcut-rejection');
 assert.equal((await request('configure',{hotkey:'Ctrl+Alt+Space',commandHotkey:'Ctrl+Alt+Shift+Space',toggleHotkey:'Ctrl+Alt+Enter'})).ok,true);
 const paste=await request('paste',{text:'THIS MUST NEVER BE INSERTED',target:{hwnd:'0',pid:0}});assert.equal(paste.ok,false);checks.push('unidentified-target-refusal');
 let microphone='not-requested';
 if(process.argv.includes('--microphone')){
  if(devices.result.length){
   captureSession=`native-test-${Date.now()}`;
   const started=await request('start',{sessionId:captureSession,deviceId:-1});assert.equal(started.ok,true);assert.equal(started.result.captureReady,true);
   assert.equal((await request('start',{sessionId:'second-session'})).ok,false);checks.push('concurrent-recording-rejection');
   assert.equal((await request('stop',{sessionId:'wrong-session'})).ok,false);checks.push('wrong-session-stop-rejection');
   await new Promise(resolve=>setTimeout(resolve,850));
   const stopped=await request('cancel',{sessionId:captureSession});assert.equal(stopped.ok,true);assert.equal(stopped.result.cancelled,true);
   assert.ok(frames>0&&pcmBytes>0);const count=frames;await new Promise(resolve=>setTimeout(resolve,150));assert.equal(frames,count);
   checks.push('real-microphone-capture-and-cancel');microphone='captured-PCM-without-content-review';
  }else microphone='no-input-device';
 }
 assert.equal((await request('shutdown')).ok,true);checks.push('clean-shutdown');
 console.log(JSON.stringify({passed:true,checks,deviceCount:devices.result.filter(item=>item.id!==-1).length,microphone,frames,pcmBytes,memory:{workingSetBytes:metrics.result.workingSetBytes,privateBytes:metrics.result.privateBytes},insertion:'refusal-guard-only; no live paste or foreground changes'},null,2));
}catch(error){console.error(JSON.stringify({passed:false,error:error.message,checks,stderr},null,2));process.exitCode=1;}
finally{clearTimeout(timeout);reader.close();helper.stdin.end();setTimeout(()=>helper.kill(),500).unref();}
