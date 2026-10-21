import {readFileSync,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {download,sha256} from './download.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const manifest=JSON.parse(readFileSync(join(root,'resources/editor-cpu-manifest.json'),'utf8'));
const folder=join(root,'resources/llama-cpu');mkdirSync(folder,{recursive:true});
for(const kind of ['runtime','model']){
 const asset=manifest[kind],path=join(folder,asset.file);let last=-1;
 const existing=join(root,'resources/llama',asset.file);
 if(kind==='runtime'&&existsSync(existing)&&await sha256(existing)===asset.sha256)copyFileSync(existing,path);
 await download(asset,path,{onProgress:value=>{const percent=Math.floor(value*100);if(percent!==last&&percent%5===0){console.log(`CPU ${kind}: ${percent}%`);last=percent;}}});
 if(kind==='runtime'){
  mkdirSync(join(folder,'bin'),{recursive:true});
  const result=spawnSync('tar.exe',['-xf',path,'-C',join(folder,'bin')],{windowsHide:true,encoding:'utf8'});
  if(result.status!==0)throw new Error(result.stderr||'CPU runtime extraction failed');
 }
}
console.log('CPU editor model and runtime verified.');
