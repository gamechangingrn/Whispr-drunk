import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {transform} from 'esbuild';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const args=process.argv.slice(2),cpu=args.includes('--cpu'),smoke=args.includes('--smoke');
const runtimeOverrides={noHost:args.includes('--no-host'),loadMode:args.find(a=>a.startsWith('--load-mode='))?.split('=')[1]??'auto'};
if(runtimeOverrides.noHost)process.env.LLAMA_ARG_NO_HOST='1';
if(runtimeOverrides.loadMode!=='auto')process.env.LLAMA_ARG_LOAD_MODE=runtimeOverrides.loadMode;
process.env.LLAMA_ARG_LOG_VERBOSITY='4';
const limitArg=args.find(a=>a.startsWith('--limit=')),limit=limitArg?Number(limitArg.split('=')[1]):Infinity;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const loadedSources=new Map();
const loadModule=async path=>{const source=readFileSync(path,'utf8');loadedSources.set(path,source);const code=await transform(source,{loader:'ts',format:'esm',target:'es2022'});return import('data:text/javascript;base64,'+Buffer.from(code.code).toString('base64'));};
const {Editor,findFile}=await loadModule(join(root,'src/main/editor.ts'));
const {prepareText,validateCleanup}=await loadModule(join(root,'src/main/format.ts'));
const folder=join(root,'resources',cpu?'llama-cpu':'llama');
const server=findFile(join(folder,'bin'),'llama-server.exe');
const expectedModel=cpu?'Qwen3.5-2B-Q4_K_M.gguf':'Qwen3.5-4B-Q4_K_M.gguf';
if(!server||!existsSync(join(folder,expectedModel)))throw new Error(`Run scripts/setup-editor${cpu?'-cpu':''}.mjs before this real integration test.`);
const help=spawnSync(server,['--help'],{windowsHide:true,encoding:'utf8',timeout:15000});
const helpText=(help.stdout??'')+(help.stderr??'');
for(const flag of ['--ctx-checkpoints','--cache-ram','--no-webui','--chat-template-kwargs','--jinja'])if(!helpText.includes(flag))throw new Error(`Pinned llama runtime does not support ${flag}.`);
const all=JSON.parse(readFileSync(join(root,'tests/editor-fixtures.json'),'utf8')).fixtures;
if(all.length!==100)throw new Error(`Expected 100 authored fixtures, found ${all.length}.`);
let fixtures=all;
if(smoke){const seen=new Set();fixtures=all.filter(f=>{const key=f.category;if(seen.has(key))return false;seen.add(key);return true;});}
fixtures=fixtures.slice(0,limit);
const settings={mode:'clean',historyEnabled:false,launchAtLogin:false,deviceId:'',hotkey:'',commandHotkey:'',toggleHotkey:'',appStyles:false,style:'neutral',editorDevice:cpu?'cpu':'gpu',onboardingComplete:true,idleUnloadMinutes:0};
const updates=[],editor=new Editor([folder],s=>updates.push(s));
const reportDir=join(root,'test-results');mkdirSync(reportDir,{recursive:true});
const logChunks=[],memory=[],gpuBefore=gpuMemory();let sampler,effectiveRuntime;
const python=join(root,'resources/runtime/python/python.exe');
const hostBefore=existsSync(python)?spawnSync(python,['-c','import psutil;print(psutil.virtual_memory().available)'],{windowsHide:true,encoding:'utf8',timeout:10000}):null;
const hostAvailableBefore=hostBefore?.status===0?Number(hostBefore.stdout.trim()):null;

function gpuMemory(){const p=spawnSync('nvidia-smi',['--query-gpu=name,memory.used,memory.total','--format=csv,noheader,nounits'],{windowsHide:true,encoding:'utf8',timeout:10000});return p.status===0?p.stdout.trim():null;}
function constraints(f,text){const errors=[],lower=text.toLocaleLowerCase();for(const value of f.mustContain??[])if(!lower.includes(value.toLocaleLowerCase()))errors.push(`missing:${value}`);for(const value of f.mustNotContain??[])if(lower.includes(value.toLocaleLowerCase()))errors.push(`forbidden:${value}`);if(f.exact&&text.trim()!==f.exact)errors.push('exact-output-mismatch');if(f.mustMatch&&!new RegExp(f.mustMatch,'im').test(text))errors.push('pattern-mismatch');if(f.maxWords&&text.trim().split(/\s+/).length>f.maxWords)errors.push('too-many-words');if(/<think>|<\/think>|^```|^Here (?:is|are)\b/i.test(text))errors.push('reasoning-or-wrapper');return errors;}
function percentile(values,q){if(!values.length)return null;const a=[...values].sort((a,b)=>a-b);return a[Math.max(0,Math.ceil(a.length*q)-1)];}

try{
 const cold=performance.now(),loading=editor.ensure(settings);
 for(let n=0;n<100&&!editor.pid;n++)await delay(10);
 const launched=editor.child?.spawnargs??[];
 const option=name=>{const index=launched.indexOf(name);return index>=0?launched[index+1]:undefined;};
 effectiveRuntime={context:option('-c'),gpuLayers:option('-ngl'),noHost:launched.includes('--no-host'),loadMode:option('--load-mode')??runtimeOverrides.loadMode,device:option('--device')??'auto',opOffload:!launched.includes('--no-op-offload'),kvOffload:!launched.includes('--no-kv-offload'),threads:option('--threads')};
 if(editor.child?.stderr)editor.child.stderr.on('data',d=>logChunks.push(String(d)));
 if(editor.child?.stdout)editor.child.stdout.on('data',d=>logChunks.push(String(d)));
 if(editor.pid&&existsSync(python)){
  const code="import sys,time,json,psutil\np=psutil.Process(int(sys.argv[1]))\nwhile p.is_running():\n try:\n  m=p.memory_info();print(json.dumps({'workingSetBytes':m.rss,'privateBytes':getattr(m,'private',m.vms),'peakWorkingSetBytes':getattr(m,'peak_wset',m.rss),'peakPrivateBytes':getattr(m,'peak_pagefile',getattr(m,'private',m.vms)),'systemAvailableBytes':psutil.virtual_memory().available}),flush=True);time.sleep(.25)\n except psutil.Error:break";
  sampler=spawn(python,['-u','-c',code,String(editor.pid)],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  let buffer='';sampler.stdout.on('data',data=>{buffer+=String(data);let end;while((end=buffer.indexOf('\n'))>=0){try{memory.push(JSON.parse(buffer.slice(0,end)));}catch{}buffer=buffer.slice(end+1);}});
 }
 await loading;
 const loadMs=performance.now()-cold;
 const readyMemoryIndex=memory.length;
 console.log(`${cpu?'CPU 2B':'GPU 4B'} editor ready in ${(loadMs/1000).toFixed(2)}s. Running ${fixtures.length} real fixtures.`);
 const unauthorized=await fetch(editor.base+'/v1/models',{signal:AbortSignal.timeout(5000)});
 if(unauthorized.status!==401)throw new Error(`Expected API authentication, got ${unauthorized.status}.`);
 const results=[];
 for(const f of fixtures){
  const began=performance.now();
  try{
   const prepared=prepareText(f.text,(f.dictionary??[]).map((d,i)=>({id:String(i),...d})),(f.snippets??[]).map((s,i)=>({id:String(i),...s})));
   const output=await editor.generate(f.mode==='command'?f.text:prepared.text,settings,f.instruction);
   const guard=f.mode==='cleanup'?validateCleanup(prepared.text,output,prepared.values.length):undefined;
   const restored=f.mode==='cleanup'?prepared.restore(output):output;
   const effective=guard?prepared.literal:restored;
   const errors=constraints(f,restored),effectiveErrors=constraints(f,effective);
   results.push({id:f.id,mode:f.mode,category:f.category,latencyMs:performance.now()-began,output:restored,modelConstraintErrors:errors,guardAccepted:!guard,guardError:guard??null,effectiveOutput:effective,effectiveConstraintErrors:effectiveErrors,semanticReviewRequired:true});
  }catch(error){results.push({id:f.id,mode:f.mode,category:f.category,latencyMs:performance.now()-began,error:String(error.message??error)});}
  if(results.length%10===0||results.length===fixtures.length)console.log(`${results.length}/${fixtures.length} · model constraints ${results.filter(r=>!r.error&&!r.modelConstraintErrors.length).length} · guarded result constraints ${results.filter(r=>!r.error&&!r.effectiveConstraintErrors.length).length}`);
 }
 const logs=logChunks.join(''),latencies=results.filter(r=>!r.error).map(r=>r.latencyMs);
 const warmLatencies=latencies.slice(1),warmMemory=memory.slice(readyMemoryIndex);
 const report={profile:cpu?'cpu-2b':'gpu-4b',model:expectedModel,runtime:'llama.cpp b11756 Windows x64 Vulkan/CPU',runtimeOverrides,passed:results.every(r=>!r.error&&!r.effectiveConstraintErrors.length),scope:'Real local editor generation using the app Editor class and guards. Constraint checks are not full semantic equivalence or an end-to-end dictation timing benchmark.',fixtures:results.length,modelConstraintPasses:results.filter(r=>!r.error&&!r.modelConstraintErrors.length).length,guardedConstraintPasses:results.filter(r=>!r.error&&!r.effectiveConstraintErrors.length).length,guardRejections:results.filter(r=>r.guardError).length,errors:results.filter(r=>r.error).length,loadMs,firstRequestMs:latencies[0],latencyMs:{p50:percentile(latencies,.5),p95:percentile(latencies,.95),max:Math.max(...latencies)},subsequentRequestLatencyMs:{samples:warmLatencies.length,p50:percentile(warmLatencies,.5),p95:percentile(warmLatencies,.95),max:Math.max(...warmLatencies)},serverMemory:{scope:'llama-server process only; excludes Electron and speech worker.',samples:memory.length,peakWorkingSetBytes:Math.max(0,...memory.map(m=>m.peakWorkingSetBytes)),peakPrivateBytes:Math.max(0,...memory.map(m=>m.peakPrivateBytes)),afterReadyPeakWorkingSetBytes:Math.max(0,...warmMemory.map(m=>m.workingSetBytes)),afterReadyPeakPrivateBytes:Math.max(0,...warmMemory.map(m=>m.privateBytes)),lastSample:memory.at(-1)},gpuBefore,gpuAfter:gpuMemory(),gpuOffloadEvidence:logs.split(/\r?\n/).filter(line=>/Vulkan|offload|model buffer|KV buffer|compute buffer/i.test(line)),apiUnauthorizedStatus:unauthorized.status,settings,results};
 const suffix=smoke?'smoke':fixtures.length===100?'100':String(fixtures.length);
 report.hostAvailableMemory={beforeBytes:hostAvailableBefore,minimumDuringBytes:Math.min(...memory.map(m=>m.systemAvailableBytes)),lastBytes:memory.at(-1)?.systemAvailableBytes,scope:'Whole-system available physical memory; other activity can affect this delta.'};
 report.effectiveRuntime=effectiveRuntime;
 report.sourceSha256=createHash('sha256').update(loadedSources.get(join(root,'src/main/editor.ts'))).digest('hex');
 report.fixturesSha256=createHash('sha256').update(readFileSync(join(root,'tests/editor-fixtures.json'))).digest('hex');
 const tuning=runtimeOverrides.noHost||runtimeOverrides.loadMode!=='auto'?`-${runtimeOverrides.noHost?'no-host':'host'}-${runtimeOverrides.loadMode}`:'';
 const path=join(reportDir,`editor-${cpu?'cpu':'gpu'}${tuning}-${suffix}.json`);writeFileSync(path,JSON.stringify(report,null,2)+'\n');
 writeFileSync(join(reportDir,`editor-${cpu?'cpu':'gpu'}${tuning}-${suffix}.log`),logs);
 console.log(JSON.stringify({...report,results:undefined,settings:undefined,gpuOffloadEvidence:report.gpuOffloadEvidence.slice(-12),report:path},null,2));
 if(report.errors)process.exitCode=1;
}catch(error){
 console.error(`Editor integration failed: ${error.message??String(error)}`);
 if(logChunks.length)console.error(logChunks.join('').slice(-2000));
 process.exitCode=1;
}finally{
 editor.stop();sampler?.kill();
}
