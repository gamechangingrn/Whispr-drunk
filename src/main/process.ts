import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createInterface} from 'node:readline';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';

export class JsonProcess extends EventEmitter {
 child?:ChildProcessWithoutNullStreams;
 private pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
 constructor(public executable:string,public args:string[],public cwd:string,public env:NodeJS.ProcessEnv={}){super();}
 start(){
  if(this.child) return;
  const child=spawn(this.executable,this.args,{cwd:this.cwd,env:{...process.env,...this.env},windowsHide:true,stdio:['pipe','pipe','pipe']}); this.child=child;
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{try{const message=JSON.parse(line);if(message.id&&this.pending.has(String(message.id))){const item=this.pending.get(String(message.id))!;clearTimeout(item.timer);this.pending.delete(String(message.id));message.ok===false?item.reject(new Error(typeof message.error==='string'?message.error:message.error?.message??'Worker request failed')):item.resolve(message.result??message);}if(message.event)this.emit('message',message);}catch{ /* Vendor diagnostics may be non-JSON; never forward transcript content to logs. */ }});
  child.stderr.on('data',()=>{});
  const ended=(error:Error)=>{if(this.child!==child)return;this.child=undefined;for(const item of this.pending.values()){clearTimeout(item.timer);item.reject(error);}this.pending.clear();this.emit('gone',error);};
  child.on('error',ended);child.on('exit',(code)=>ended(new Error(`Worker stopped (${code??'signal'}).`)));
 }
 request(op:string,payload:Record<string,unknown>={},timeout=30000):Promise<any>{
  this.start(); const id=randomUUID();
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`${op} timed out. Try again.`));},timeout);this.pending.set(id,{resolve,reject,timer});this.child!.stdin.write(JSON.stringify({id,op,...payload})+'\n',error=>{if(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});});
 }
 notify(op:string,payload:Record<string,unknown>={}){if(this.child?.stdin.writable)this.child.stdin.write(JSON.stringify({op,...payload})+'\n');}
 stop(){const child=this.child;if(child){this.notify('shutdown');setTimeout(()=>{if(this.child===child)child.kill();},1000).unref();}}
}
