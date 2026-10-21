import {_electron as electron} from 'playwright';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('.'),packaged=process.argv.includes('--packaged');const executable=process.env.WILLFULL_ELECTRON??(packaged?resolve('release/win-unpacked/Willfull.exe'):resolve('node_modules/electron/dist/electron.exe'));
const report={checks:[],errors:[],runtime:'',packaged,scope:'Electron bridge, real native helper, persistence, local speech model, local editor when installed, and rendered desktop UI. No audible speech review or live external-app insertion.'};
const app=await electron.launch({executablePath:executable,args:packaged?[]:['.'],cwd:root,env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,WILLFULL_USER_DATA:resolve(packaged?'.test-data/package-profile':'.test-data/smoke-profile')},timeout:45000});
try{
 report.runtime=await app.evaluate(({app})=>JSON.stringify(process.versions));
 const page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
 await page.waitForFunction(()=>!!window.willfull);await page.waitForFunction(async()=>{const s=await window.willfull.getState();return s.metrics.nativeReady&&s.models.speech.status==='ready';},{timeout:180000});
 await page.evaluate(()=>window.willfull.invoke('devices:refresh'));
 const initial=await page.evaluate(()=>window.willfull.getState());assert(Array.isArray(initial.devices));report.deviceCount=initial.devices.length;report.checks.push('Real Windows helper connected; input device enumeration completed; packed Phonon-2 loaded');
 const invoke=(action,payload)=>page.evaluate(([name,data])=>window.willfull.invoke(name,data),[action,payload]);
 if(initial.models.editor.status!=='missing')await invoke('settings:update',{mode:'clean',editorDevice:'gpu'});
 await invoke('dictionary:save',{id:'smoke-term',heard:'will full',written:'Willfull'});await invoke('snippets:save',{id:'smoke-snippet',trigger:'my sign off',text:'Best,\nWillfull'});
 const formatted=await invoke('playground:transcribe',{text:'Open will full. my sign off'});assert.match(formatted.text,/Willfull/);assert.match(formatted.text,/Best,/);report.checks.push('Dictionary and exact multiline snippet expansion through live IPC');
 await invoke('settings:update',{historyEnabled:false,mode:'literal',onboardingComplete:true});await invoke('dictionary:delete',{id:'smoke-term'});await invoke('snippets:delete',{id:'smoke-snippet'});
 await assert.rejects(()=>invoke('settings:update',{mode:'bad-mode'}));await assert.rejects(()=>invoke('does-not-exist',{}));report.checks.push('Invalid settings and unknown privileged actions rejected');
 if(process.argv.includes('--record')){
  if(!initial.devices.length)throw new Error('No microphone is available for the requested real-capture check.');
  await invoke('models:unload',{model:'speech'});await invoke('start',{mode:'dictation'});await page.waitForFunction(async()=>(await window.willfull.getState()).session.phase==='recording');await page.waitForTimeout(150);await invoke('stop');const stopped=await page.evaluate(()=>window.willfull.getState());assert.equal(stopped.session.phase,'complete',stopped.session.error);report.checks.push('Real microphone start/stop while the cold speech worker loads; buffer drains and completes');
  await invoke('start',{mode:'dictation'});await invoke('cancel');const cancelled=await page.evaluate(()=>window.willfull.getState());assert.equal(cancelled.session.phase,'idle');report.checks.push('Real microphone cancellation returns idle');
 }
 await new Promise(r=>setTimeout(r,5500));const current=await page.evaluate(()=>window.willfull.getState());assert(current.metrics.appRamMb>0);report.memory=current.metrics;report.checks.push('Aggregate process-tree memory reported');
 mkdirSync('.artifacts/app-review',{recursive:true});for(const [width,height] of [[1160,810],[900,620]]){await page.setViewportSize({width,height});await page.screenshot({path:join('.artifacts/app-review',`electron-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:1160,height:810});await page.getByRole('button',{name:/Local models/}).click();await page.screenshot({path:'.artifacts/app-review/models-current.png',fullPage:true});
 await page.getByRole('button',{name:'Home',exact:true}).click();
 const live=await page.evaluate(()=>window.willfull.getState());const fixture={...live,session:{...live.session,id:'ui-command-fixture',phase:'recording',mode:'command',level:0.4,partial:'Make this shorter'}};
 await app.evaluate(({BrowserWindow},sample)=>{const target=BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('overlay=1'));globalThis.__willfullUiFixture=setInterval(()=>target.webContents.send('willfull:state',sample),25);},fixture);
 await page.getByRole('button',{name:'Finish instruction'}).waitFor();await page.waitForTimeout(200);await page.screenshot({path:'.artifacts/app-review/command-state-fixture.png',fullPage:true});
 await app.evaluate(({BrowserWindow},sample)=>{clearInterval(globalThis.__willfullUiFixture);BrowserWindow.getAllWindows().find(window=>!window.webContents.getURL().includes('overlay=1')).webContents.send('willfull:state',sample);},live);report.checks.push('Command UI mode follows a supplied session-state fixture (UI-only test, not a live command)');
 assert.equal(report.errors.length,0,report.errors.join('\n'));report.checks.push('Rendered Electron UI without renderer errors at both desktop sizes');
}finally{await app.close();mkdirSync('.artifacts',{recursive:true});writeFileSync(`.artifacts/${packaged?'packaged':'electron'}-smoke.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
