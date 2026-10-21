import {spawn} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,linkSync,copyFileSync,unlinkSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
const root=resolve('.'),pkg=JSON.parse(readFileSync('package.json','utf8'));
if(!existsSync('node_modules/electron/dist/electron.exe'))throw new Error('Install the verified Electron runtime before packaging.');
const version=readFileSync('node_modules/electron/dist/version','utf8').trim().replace(/^v/,'');
if(version!==pkg.devDependencies.electron)throw new Error(`Packaging requires Electron ${pkg.devDependencies.electron}, found ${version}.`);
const builder=resolve('node_modules/electron-builder/cli.js');
const run=(executable,args,cwd=root)=>new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd,stdio:'inherit',windowsHide:true,env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Packaging failed (${code}).`)));});
const base=structuredClone(pkg.build);base.electronDist='node_modules/electron/dist';
for(const file of ['README.md','LICENSE','BUILD_REPORT.md'])base.extraResources.push({from:file,to:file});
const full=structuredClone(base);full.compression='store';full.win.target=[{target:'dir',arch:['x64']}];
full.extraResources=full.extraResources.map(item=>item.to==='models'?{...item,filter:['**/*','!**/*.fermion']}:['llama','llama-cpu'].includes(item.to)?{...item,filter:['bin/**/*']}:item);
mkdirSync('.test-data',{recursive:true});writeFileSync('.test-data/full-builder.json',JSON.stringify(full,null,2));
await run(process.execPath,[builder,'--win','dir','--config','.test-data/full-builder.json']);
const appFolder=resolve('release/win-unpacked');
// Immutable model hardlinks avoid duplicate payloads on the build volume.
// ZIP extraction produces ordinary, independent model files for distribution.
for(const [source,target] of [
 ['resources/models/phonon-2/model.fermion','resources/models/phonon-2/model.fermion'],
 ['resources/llama/Qwen3.5-4B-Q4_K_M.gguf','resources/llama/Qwen3.5-4B-Q4_K_M.gguf'],
 ['resources/llama-cpu/Qwen3.5-2B-Q4_K_M.gguf','resources/llama-cpu/Qwen3.5-2B-Q4_K_M.gguf']
]){const destination=join(appFolder,target);mkdirSync(dirname(destination),{recursive:true});if(existsSync(destination))unlinkSync(destination);try{linkSync(resolve(source),destination);}catch{copyFileSync(resolve(source),destination);}}
for(const file of ['README.md','LICENSE','BUILD_REPORT.md'])copyFileSync(file,join(appFolder,file));
const core=structuredClone(base);core.extraResources=core.extraResources.filter(item=>!['llama','llama-cpu'].includes(item.to));core.directories={output:'release/installer'};core.compression='normal';core.win.target=[{target:'nsis',arch:['x64']}];core.artifactName='Willfull-Setup-${version}.${ext}';writeFileSync('.test-data/core-builder.json',JSON.stringify(core,null,2));
await run(process.execPath,[builder,'--win','nsis','--config','.test-data/core-builder.json']);
function findFile(folder,name){if(!existsSync(folder))return;for(const item of readdirSync(folder,{withFileTypes:true})){const path=join(folder,item.name);if(item.isFile()&&item.name===name)return path;if(item.isDirectory()){const found=findFile(path,name);if(found)return found;}}}
const seven=findFile(join(process.env.LOCALAPPDATA,'electron-builder','Cache'),'7za.exe');if(!seven)throw new Error('The packaging 7-Zip tool is unavailable.');
const archive=resolve(`release/Willfull-${pkg.version}-win.zip`);if(existsSync(archive))unlinkSync(archive);
await run(seven,['a','-tzip','-mx=0','-bd',archive,'.'],appFolder);
console.log('Built offline ZIP with both editor profiles and a smaller speech-ready Windows installer.');
