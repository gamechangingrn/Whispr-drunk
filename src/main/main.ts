import {app,BrowserWindow,ipcMain,Tray,Menu,nativeImage,clipboard,dialog,shell,session,screen} from 'electron';
import {join,dirname,resolve} from 'node:path';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Store} from './store';
import {JsonProcess} from './process';
import {Editor} from './editor';
import {prepareText,validateCleanup} from './format';
import type {AppState,Target,Settings} from '../shared/types';
import editorManifest from '../../resources/editor-manifest.json';
import editorCpuManifest from '../../resources/editor-cpu-manifest.json';
// @ts-ignore - plain Node module is shared with the setup CLI.
import {download} from '../../scripts/download.mjs';

app.setName('Willfull');
if(process.env.WILLFULL_USER_DATA)app.setPath('userData',resolve(process.env.WILLFULL_USER_DATA));
if(!app.requestSingleInstanceLock())app.quit();
const base=app.isPackaged?process.resourcesPath:app.getAppPath();
const data=()=>app.getPath('userData');
const speechModel=()=>app.isPackaged?join(base,'models','phonon-2'):join(base,'resources','models','phonon-2');
const runtime=()=>app.isPackaged?join(base,'runtime','python','python.exe'):join(base,'resources','runtime','python','python.exe');
const workerPath=()=>app.isPackaged?join(base,'speech','worker.py'):join(base,'workers','speech','worker.py');
const nativePath=()=>app.isPackaged?join(base,'native','Willfull.Native.exe'):join(base,'native','windows','bin','Willfull.Native.exe');
let store:Store,mainWindow:BrowserWindow|undefined,overlay:BrowserWindow|undefined,tray:Tray|undefined,native:JsonProcess|undefined,speech:JsonProcess|undefined,editor:Editor;
let closing=false,speechLoading:Promise<void>|undefined,currentTarget:Target|undefined,heldStop=false,currentAbort:AbortController|undefined,installAbort:AbortController|undefined,setupProcess:ChildProcess|undefined;
let previewTarget:Target|undefined,previewTimeout:NodeJS.Timeout|undefined,lastActivity=Date.now();
let audioReadyId:string|undefined,sessionSpeechReady:Promise<void>|undefined,pendingAudio:string[]=[],pendingAudioBytes=0;
const state:AppState={session:{phase:'idle',mode:'dictation',partial:'',result:'',level:0},settings:{mode:'clean',historyEnabled:false,launchAtLogin:false,deviceId:'-1',hotkey:'Ctrl+Alt+Space',commandHotkey:'Ctrl+Alt+Shift+Space',toggleHotkey:'Ctrl+Alt+Enter',appStyles:false,style:'neutral',editorDevice:'auto',onboardingComplete:false,idleUnloadMinutes:10},models:{speech:{name:'Phonon-2',status:'missing'},editor:{name:'Qwen3.5 4B',status:'missing'}},history:[],dictionary:[],snippets:[],devices:[],metrics:{}};
const busy=()=>['starting','recording','finalizing','formatting','inserting'].includes(state.session.phase);
function publish(){for(const window of [mainWindow,overlay])if(window&&!window.isDestroyed())window.webContents.send('willfull:state',state);}
function setSession(value:Partial<AppState['session']>){state.session={...state.session,...value};if(value.phase)native?.notify('busy',{active:busy()||Boolean(state.commandPreview)});publish();}
function errorText(error:unknown){return error instanceof Error?error.message:String(error);}
function fail(error:unknown){setSession({phase:'error',error:errorText(error),level:0});showOverlay();}
function createWindow(){
 if(mainWindow&&!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();return;}
 mainWindow=new BrowserWindow({width:1160,height:810,minWidth:900,minHeight:620,backgroundColor:'#f8f9f5',title:'Willfull',frame:false,autoHideMenuBar:true,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
 mainWindow.on('closed',()=>{mainWindow=undefined;});lockWindow(mainWindow);
 loadWindow(mainWindow);
}
function loadWindow(window:BrowserWindow,extra=''){if(process.env.WILLFULL_DEV_URL)void window.loadURL(process.env.WILLFULL_DEV_URL+extra);else void window.loadFile(join(__dirname,'../renderer/index.html'),extra?{query:{overlay:'1'}}:{});}
function lockWindow(window:BrowserWindow){window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',(event,url)=>{const current=window.webContents.getURL();if(url!==current)event.preventDefault();});}
function showOverlay(){
 if(!overlay||overlay.isDestroyed()){const display=screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;overlay=new BrowserWindow({width:440,height:128,x:Math.round(display.x+(display.width-440)/2),y:display.y+display.height-165,frame:false,transparent:true,backgroundColor:'#00000000',alwaysOnTop:true,focusable:false,skipTaskbar:true,resizable:false,hasShadow:false,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});lockWindow(overlay);loadWindow(overlay,'?overlay=1');overlay.webContents.once('did-finish-load',publish);overlay.on('closed',()=>{overlay=undefined;});}
 overlay.showInactive();
}
function hideLater(){setTimeout(()=>{if(!busy()&&!state.commandPreview)overlay?.hide();},4500).unref();}
async function startNative(){
 if(!existsSync(nativePath())){state.metrics.nativeReady=false;state.session.notice='Windows helper is missing. Run pnpm native, then restart.';publish();return;}
 native=new JsonProcess(nativePath(),[],dirname(nativePath()));
 native.on('message',(message:any)=>{
  if(message.event==='ready'){state.metrics.nativeReady=true;void refreshDevices().catch(()=>{state.devices=[];publish();});void native?.request('configure',{...state.settings}).catch(()=>{});publish();}
  if(message.event==='audio'&&message.sessionId===state.session.id&&['recording','starting','finalizing'].includes(state.session.phase)){if(audioReadyId===message.sessionId)speech?.notify('audio',{sessionId:message.sessionId,pcm:message.pcm});else{pendingAudio.push(message.pcm);pendingAudioBytes+=Math.ceil(String(message.pcm).length*0.75);if(pendingAudioBytes>32000*35){void cancel();fail('Speech warm-up took too long. Recording cancelled; please retry.');return;}}state.session.level=message.level??0;publish();}
  if(message.event==='capture-error'){void cancel();fail(message.error);}
  if(message.event==='devices-changed')void refreshDevices().catch(()=>{});
  if(message.event==='hotkey'){
   if(message.action==='down')void start(message.mode==='command'?'command':'dictation',message.target).catch(fail);
   else if(message.action==='up')void stop().catch(fail);
   else if(message.action==='toggle')void (busy()?stop():start('dictation',message.target)).catch(fail);
   else if(message.action==='cancel')void cancel();
   else if(message.action==='apply')void applyCommand().catch(fail);
   else if(message.action==='paste-last')void pasteLast(message.target).catch(fail);
  }
 });
 native.on('gone',()=>{state.metrics.nativeReady=false;if(!closing){void cancel();state.session.notice='Windows helper disconnected. Restart Willfull to reconnect.';publish();}});native.start();
}
async function refreshDevices(){if(!native)return;const result=await native.request('devices');state.devices=(Array.isArray(result)?result:result.devices??[]).map((item:any)=>({id:String(item.id),name:String(item.name)}));publish();}
function speechAvailable(){return existsSync(runtime())&&existsSync(join(speechModel(),'model.fermion'));}
async function ensureSpeech(){
 lastActivity=Date.now();if(state.models.speech.status==='ready'&&speech?.child)return;
 if(speechLoading)return speechLoading;
 speechLoading=(async()=>{
  if(!speechAvailable())throw new Error('The local speech model is not installed. Open Models to set it up.');
  state.models.speech={name:'Phonon-2',status:'loading',message:'Warming the local speech engine…'};publish();
  if(!speech){const instance=new JsonProcess(runtime(),['-u',workerPath(),'--model-dir',speechModel(),'--threads','6'],dirname(workerPath()),{PYTHONUTF8:'1',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'});speech=instance;instance.on('message',(message:any)=>{if(speech===instance&&message.event==='partial'&&message.sessionId===state.session.id)setSession({partial:message.text??''});});instance.on('gone',()=>{if(speech!==instance)return;speech=undefined;state.models.speech={name:'Phonon-2',status:'unloaded',message:'Speech worker stopped. Start again to reload.'};if(busy()&&!closing){void cancel();fail('Speech worker stopped. Your recording was cancelled.');}publish();});}
  const loaded=await speech.request('load',{},180000);state.models.speech={name:'Phonon-2',status:'ready',message:'Packed CPU engine · English · offline'};const memory=loaded.memory??{};state.metrics.speechRamMb=memory.workingSetBytes?Math.round(memory.workingSetBytes/1048576):undefined;publish();
 })().catch(error=>{state.models.speech={name:'Phonon-2',status:'error',message:errorText(error)};publish();throw error;}).finally(()=>{speechLoading=undefined;});return speechLoading;
}
async function start(mode:'dictation'|'command'='dictation',target?:Target){
 if(busy())return;if(!native||!state.metrics.nativeReady)throw new Error('The Windows helper is not ready. Restart Willfull.');
 const id=randomUUID();heldStop=false;currentAbort=new AbortController();audioReadyId=undefined;pendingAudio=[];pendingAudioBytes=0;
 currentTarget=target??await native.request('focus');
 if(currentTarget?.isPassword)throw new Error('Dictation is disabled in password fields.');
 if(mode==='command'&&(!currentTarget?.selectionAvailable||!String(currentTarget.selectionText??'').trim()))throw new Error('Select text in the destination app, then hold the command shortcut.');
 if(previewTimeout)clearTimeout(previewTimeout);state.commandPreview=undefined;previewTarget=undefined;
 setSession({id,phase:'starting',mode,partial:'',result:'',error:undefined,notice:undefined,level:0,startedAt:Date.now(),targetName:String(currentTarget?.processName??currentTarget?.name??'Active application')});showOverlay();
 try{await native.request('start',{sessionId:id,deviceId:Number(state.settings.deviceId)});if(state.session.id!==id){await native.request('cancel',{sessionId:id}).catch(()=>{});return;}setSession({phase:'recording'});if(state.settings.editorDevice==='cpu')editor.stop();sessionSpeechReady=(async()=>{await ensureSpeech();if(state.session.id!==id)return;await speech!.request('begin',{sessionId:id});if(state.session.id!==id)return;for(const pcm of pendingAudio)speech!.notify('audio',{sessionId:id,pcm});pendingAudio=[];pendingAudioBytes=0;audioReadyId=id;})();void sessionSpeechReady.catch(error=>{if(state.session.id===id){void cancel();fail(error);}});if(heldStop)await stop();}catch(error){if(state.session.id===id){await native.request('cancel',{sessionId:id}).catch(()=>{});fail(error);}}
}
async function stop(){
 if(state.session.phase==='starting'){heldStop=true;return;}
 if(state.session.phase!=='recording')return;
 const id=state.session.id!,target=currentTarget,mode=state.session.mode,started=state.session.startedAt??Date.now(),released=performance.now();
 setSession({phase:'finalizing',level:0});
 try{await native!.request('stop',{sessionId:id});await sessionSpeechReady;if(state.session.id!==id)return;const result=await speech!.request('end',{sessionId:id},120000);audioReadyId=undefined;if(state.session.id!==id)return;const raw=String(result.text??'').trim();if(!raw){setSession({phase:'complete',result:'',notice:'No speech detected. Hold the shortcut and try again.'});hideLater();return;}
  if(mode==='command'){
   if(!editor.available(state.settings))throw new Error('Install the selected local editor profile in Models to use voice commands.');setSession({phase:'formatting'});
   unloadSpeechForCpuEditor();const original=String(target?.selectionText??'');const edited=await editor.generate(original,state.settings,raw,currentAbort?.signal);if(state.session.id!==id)return;
   state.commandPreview={original,edited,instruction:raw,target};previewTarget=target;setSession({phase:'complete',result:edited,notice:'Review the edit. Keep the original selection focused and press Ctrl+Alt+A to apply.'});showOverlay();
   previewTimeout=setTimeout(()=>{state.commandPreview=undefined;previewTarget=undefined;publish();overlay?.hide();},300000);return;
  }
  const prepared=prepareText(raw,state.dictionary,state.snippets);let text=prepared.literal;let notice:string|undefined;
  if(state.settings.mode==='clean'){
   if(editor.available(state.settings)){setSession({phase:'formatting'});try{unloadSpeechForCpuEditor();const cleaned=await editor.generate(prepared.text,state.settings,undefined,currentAbort?.signal);if(state.session.id!==id)return;const refused=validateCleanup(prepared.text,cleaned,prepared.values.length);if(refused)notice=refused;else text=prepared.restore(cleaned);}catch(error){if(state.session.id!==id)return;notice=`Original kept: ${errorText(error)}`;}}
   else notice='Local editor is not installed; your recognized words were kept.';
  }
  if(state.session.id!==id)return;setSession({phase:'inserting',result:text,partial:raw});
  try{if(!target||/willfull/i.test(String(target.processName)))throw new Error('Result ready to copy. Use the global shortcut from another app to insert there.');await native!.request('paste',{text,target},10000);}catch(error){notice=errorText(error);}
  if(state.session.id!==id)return;state.metrics.lastLatencyMs=Math.round(performance.now()-released);
  if(state.settings.historyEnabled){store.addHistory({id,raw,text,createdAt:Date.now(),app:String(target?.processName??'Unknown'),mode:state.settings.mode,durationMs:Date.now()-started});state.history=store.history();}
  setSession({phase:'complete',result:text,notice,level:0});lastActivity=Date.now();hideLater();
 }catch(error){if(state.session.id===id)fail(error);}
}
function unloadSpeechForCpuEditor(){if(state.settings.editorDevice!=='cpu')return;const previous=speech;speech=undefined;audioReadyId=undefined;previous?.stop();state.models.speech={name:'Phonon-2',status:'unloaded',message:'Installed · reloads while your next recording is buffered.'};publish();}
async function cancel(){const id=state.session.id;state.session.id=undefined;audioReadyId=undefined;pendingAudio=[];pendingAudioBytes=0;if(previewTimeout)clearTimeout(previewTimeout);state.commandPreview=undefined;previewTarget=undefined;currentAbort?.abort();speech?.notify('cancel',{sessionId:id});setSession({phase:'idle',partial:'',level:0,error:undefined,notice:'Cancelled.'});overlay?.hide();if(native)await native.request('cancel',{sessionId:id}).catch(()=>{});}
async function applyCommand(){const preview=state.commandPreview;if(!preview||!previewTarget)throw new Error('There is no pending command edit.');await native!.request('paste',{text:preview.edited,target:previewTarget},10000);if(previewTimeout)clearTimeout(previewTimeout);state.commandPreview=undefined;previewTarget=undefined;setSession({phase:'complete',notice:'Edit applied.',result:preview.edited});hideLater();}
async function pasteLast(target?:Target){if(!state.session.result)throw new Error('There is no result to paste yet.');await native!.request('paste',{text:state.session.result,target:target??await native!.request('focus')},10000);setSession({notice:'Last result pasted.'});}
const settingsSchema=z.object({mode:z.enum(['literal','clean']),historyEnabled:z.boolean(),launchAtLogin:z.boolean(),deviceId:z.string().max(30),hotkey:z.string().min(3).max(80),commandHotkey:z.string().min(3).max(80),toggleHotkey:z.string().min(3).max(80),appStyles:z.boolean(),style:z.enum(['neutral','email','casual','code']),editorDevice:z.enum(['auto','cpu','gpu']),onboardingComplete:z.boolean(),idleUnloadMinutes:z.number().int().min(0).max(60)}).partial().strict();
const itemId=z.object({id:z.string().min(1).max(80)});
async function action(name:string,input:any={}){
 switch(name){
  case 'start':await start(input?.mode==='command'?'command':'dictation');break;
  case 'stop':await stop();break;
  case 'cancel':await cancel();break;
  case 'settings:update':{const changed=settingsSchema.parse(input);if(busy())throw new Error('Finish recording before changing settings.');const next={...state.settings,...changed};if(new Set([next.hotkey,next.commandHotkey,next.toggleHotkey].map(x=>x.toLowerCase())).size!==3)throw new Error('Each action needs a different shortcut.');if(changed.hotkey||changed.commandHotkey||changed.toggleHotkey)await native?.request('configure',next);if(changed.editorDevice)editor.stop();state.settings=next;if(changed.editorDevice)state.models.editor={name:editor.paths(next)?.name??(next.editorDevice==='cpu'?'Qwen3.5 2B':'Qwen3.5 4B'),status:editor.available(next)?'unloaded':'missing',message:editor.available(next)?'Installed locally. Loads when needed.':'Set up the selected editor profile in Models.'};store.set('settings',next);app.setLoginItemSettings({openAtLogin:next.launchAtLogin});break;}
  case 'dictionary:save':{const item=z.object({id:z.string().optional(),heard:z.string().trim().min(1).max(120),written:z.string().trim().min(1).max(500)}).parse(input);const id=item.id??randomUUID();state.dictionary=[...state.dictionary.filter(x=>x.id!==id),{...item,id}];store.set('dictionary',state.dictionary);break;}
  case 'dictionary:delete':state.dictionary=state.dictionary.filter(x=>x.id!==itemId.parse(input).id);store.set('dictionary',state.dictionary);break;
  case 'snippets:save':{const item=z.object({id:z.string().optional(),trigger:z.string().trim().min(1).max(120),text:z.string().min(1).max(10000)}).parse(input);const id=item.id??randomUUID();state.snippets=[...state.snippets.filter(x=>x.id!==id),{...item,id}];store.set('snippets',state.snippets);break;}
  case 'snippets:delete':state.snippets=state.snippets.filter(x=>x.id!==itemId.parse(input).id);store.set('snippets',state.snippets);break;
  case 'dictionary:import':case 'snippets:import':await importItems(name.split(':')[0] as 'dictionary'|'snippets');break;
  case 'dictionary:export':case 'snippets:export':{const key=name.split(':')[0] as 'dictionary'|'snippets';const result=await dialog.showSaveDialog({defaultPath:`willfull-${key}.json`,filters:[{name:'JSON',extensions:['json']}]});if(result.filePath)writeFileSync(result.filePath,JSON.stringify(state[key],null,2));break;}
  case 'history:delete':store.deleteHistory(itemId.parse(input).id);state.history=store.history();break;
  case 'history:clear':store.clearHistory();state.history=[];break;
  case 'history:copy':{const item=state.history.find(x=>x.id===itemId.parse(input).id);if(item)clipboard.writeText(item.text);break;}
  case 'result:copy':clipboard.writeText(state.session.result);break;
  case 'devices:refresh':await refreshDevices();break;
  case 'models:setupSpeech':try{if(speechAvailable())await ensureSpeech();else await setupSpeech();}catch(error){state.models.speech={name:'Phonon-2',status:'error',message:errorText(error)};publish();throw error;}break;
  case 'models:setupEditor':void setupEditor().catch(error=>{state.models.editor={name:state.settings.editorDevice==='cpu'?'Qwen3.5 2B':'Qwen3.5 4B',status:'error',message:errorText(error)};publish();});break;
  case 'models:cancel':if(input?.model==='speech')setupProcess?.kill();else installAbort?.abort();break;
  case 'models:unload':if(input?.model==='speech'){speech?.stop();speech=undefined;state.models.speech.status='unloaded';}else editor.stop();break;
  case 'command:apply':await applyCommand();break;
  case 'command:dismiss':if(previewTimeout)clearTimeout(previewTimeout);state.commandPreview=undefined;previewTarget=undefined;overlay?.hide();break;
  case 'playground:transcribe':{if(busy())throw new Error('Finish dictation before using the formatting playground.');const {text}=z.object({text:z.string().max(10000)}).parse(input);const prepared=prepareText(text,state.dictionary,state.snippets);let output=prepared.literal;if(state.settings.mode==='clean'&&editor.available(state.settings)){unloadSpeechForCpuEditor();const cleaned=await editor.generate(prepared.text,state.settings);if(!validateCleanup(prepared.text,cleaned,prepared.values.length))output=prepared.restore(cleaned);}return {text:output};}
  case 'window:open':createWindow();break;
  case 'window:hide':mainWindow?.close();break;
  case 'window:minimize':mainWindow?.minimize();break;
  case 'window:maximize':if(mainWindow?.isMaximized())mainWindow.unmaximize();else mainWindow?.maximize();break;
  case 'window:close':mainWindow?.close();break;
  case 'data:open':await shell.openPath(data());break;
  default:throw new Error('Unknown action.');
 }publish();return {ok:true};
}
async function importItems(key:'dictionary'|'snippets'){
 const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]});if(result.canceled)return;
 const raw=readFileSync(result.filePaths[0],'utf8');if(raw.length>3*1024*1024)throw new Error('Import is limited to 3 MB.');const input=JSON.parse(raw);const rows=z.array(key==='dictionary'?z.object({heard:z.string().trim().min(1).max(120),written:z.string().trim().min(1).max(500)}):z.object({trigger:z.string().trim().min(1).max(120),text:z.string().min(1).max(10000)})).max(1000).parse(input);(state as any)[key]=[...state[key],...rows.map(row=>({...row,id:randomUUID()}))];store.set(key,state[key]);
}
async function setupSpeech(){
 if(app.isPackaged)throw new Error('This offline package is missing its speech runtime. Reinstall the full Windows package.');
 if(setupProcess)throw new Error('Speech setup is already running.');state.models.speech={name:'Phonon-2',status:'installing',message:'Setting up the embedded speech runtime…'};publish();
 await new Promise<void>((resolve,reject)=>{setupProcess=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',join(base,'scripts','setup-speech.ps1')],{windowsHide:true,stdio:'ignore'});setupProcess.on('error',reject);setupProcess.on('exit',code=>{setupProcess=undefined;code===0?resolve():reject(new Error('Speech setup failed. Retry setup or use the full offline installer.'));});});await ensureSpeech();
}
async function setupEditor(){
 if(installAbort)throw new Error('A model download is already running.');installAbort=new AbortController();const signal=installAbort.signal;const cpu=state.settings.editorDevice==='cpu';const manifest=cpu?editorCpuManifest:editorManifest;const name=cpu?'Qwen3.5 2B':'Qwen3.5 4B';const folder=app.isPackaged?join(data(),'models',cpu?'editor-cpu':'editor'):join(base,'resources',cpu?'llama-cpu':'llama');mkdirSync(folder,{recursive:true});
 try{for(const [kind,asset] of Object.entries(manifest)){state.models.editor={name,status:'installing',progress:0,message:kind==='model'?`Downloading the ${cpu?'1.28':'2.74'} GB local editor…`:'Downloading the verified Windows runtime…'};publish();await download(asset,join(folder,asset.file),{signal,onProgress:(value:number)=>{state.models.editor.progress=value;publish();}});if(kind==='runtime')await extractZip(join(folder,asset.file),join(folder,'bin'));}state.models.editor={name,status:'unloaded',message:'Installed locally. Loads when needed.'};}finally{installAbort=undefined;publish();}
}
function extractZip(file:string,destination:string){mkdirSync(destination,{recursive:true});return new Promise<void>((resolve,reject)=>{const child=spawn('tar.exe',['-xf',file,'-C',destination],{windowsHide:true,stdio:'ignore'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Could not extract editor runtime.')));});}
app.on('second-instance',createWindow);
app.on('window-all-closed',()=>{});
app.on('before-quit',()=>{closing=true;currentAbort?.abort();installAbort?.abort();setupProcess?.kill();speech?.stop();native?.stop();editor?.stop();});
app.whenReady().then(async()=>{
 store=new Store(join(data(),'willfull.sqlite'));await store.init();state.settings=store.settings();state.dictionary=store.dictionary();state.snippets=store.snippets();state.history=store.history();
 editor=new Editor([join(data(),'models','editor'),join(data(),'models','editor-cpu'),app.isPackaged?join(base,'llama'):join(base,'resources','llama'),app.isPackaged?join(base,'llama-cpu'):join(base,'resources','llama-cpu')],value=>{state.models.editor=value;publish();});state.models.editor={name:editor.paths(state.settings)?.name??'Qwen3.5 4B',status:editor.available(state.settings)?'unloaded':'missing',message:editor.available(state.settings)?'Installed locally. Loads when needed.':'Optional · install for cleanup and voice commands'};
 state.models.speech={name:'Phonon-2',status:speechAvailable()?'unloaded':'missing',message:speechAvailable()?'Installed locally. Warming up…':'Install to start dictating'};
 session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 ipcMain.handle('willfull:getState',event=>{if(![mainWindow?.webContents,overlay?.webContents].includes(event.sender))throw new Error('Unknown window.');return state;});
 ipcMain.handle('willfull:action',async(event,name,input)=>{if(![mainWindow?.webContents,overlay?.webContents].includes(event.sender))throw new Error('Unknown window.');if(typeof name!=='string')throw new Error('Invalid action.');return action(name,input);});
 const pixels=Buffer.alloc(32*32*4);for(let y=0;y<32;y++)for(let x=0;x<32;x++){const offset=(y*32+x)*4;const bar=[8,13,18,23].some((center,index)=>Math.abs(x-center)<=1&&Math.abs(y-16)<[5,10,8,6][index]);pixels[offset]=bar?217:59;pixels[offset+1]=bar?245:77;pixels[offset+2]=bar?239:35;pixels[offset+3]=255;}const icon=nativeImage.createFromBitmap(pixels,{width:32,height:32});tray=new Tray(icon);tray.setToolTip('Willfull · local dictation');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open Willfull',click:createWindow},{label:'Copy last result',click:()=>clipboard.writeText(state.session.result)},{type:'separator'},{label:'Quit Willfull',click:()=>app.quit()}]));tray.on('double-click',createWindow);
 createWindow();await startNative();if(speechAvailable())void ensureSpeech().catch(()=>{});
 const gpu=await app.getGPUInfo('basic') as any;state.metrics.gpuName=gpu.gpuDevice?.map((device:any)=>device.deviceString).filter(Boolean).join(' / ')||undefined;
 setInterval(()=>{const metrics=app.getAppMetrics();const pids=[...metrics.map(item=>item.pid),native?.child?.pid,speech?.child?.pid,editor.pid].filter((pid):pid is number=>typeof pid==='number');if(native)void native.request('metrics',{pids},2500).then(result=>{state.metrics.appRamMb=Math.round(result.workingSetBytes/1048576);publish();}).catch(()=>{});if(speech?.child)void speech.request('status',{},2000).then(result=>{if(result.memory?.workingSetBytes)state.metrics.speechRamMb=Math.round(result.memory.workingSetBytes/1048576);}).catch(()=>{});if(!busy()&&state.settings.idleUnloadMinutes>0&&Date.now()-lastActivity>state.settings.idleUnloadMinutes*60000){speech?.stop();speech=undefined;state.models.speech.status='unloaded';}publish();},5000).unref();
}).catch(error=>{dialog.showErrorBox('Willfull could not start',errorText(error));app.quit();});
