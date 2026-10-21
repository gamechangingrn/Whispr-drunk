import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {download} from './download.mjs';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const manifest=JSON.parse(readFileSync(join(root,'resources/editor-manifest.json'),'utf8'));
const folder=join(root,'resources/llama');mkdirSync(folder,{recursive:true});
for(const [kind,asset] of Object.entries(manifest)){
 const path=join(folder,asset.file);let last=-1;
 await download(asset,path,{onProgress:value=>{const percent=Math.floor(value*100);if(percent!==last&&percent%5===0){console.log(`${kind}: ${percent}%`);last=percent;}}});
 if(kind==='runtime'){mkdirSync(join(folder,'bin'),{recursive:true});const result=spawnSync('tar.exe',['-xf',path,'-C',join(folder,'bin')],{windowsHide:true,encoding:'utf8'});if(result.status!==0)throw new Error(result.stderr||'Runtime extraction failed');}
}
console.log('Local editor model and runtime verified.');
