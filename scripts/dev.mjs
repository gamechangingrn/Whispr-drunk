import {spawn} from 'node:child_process';
import {createServer} from 'vite';
import {build} from 'esbuild';
import electron from 'electron';
await build({entryPoints:{main:'src/main/main.ts',preload:'src/preload/preload.ts'},outdir:'dist/main',bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron','sql.js'],outExtension:{'.js':'.cjs'},sourcemap:true});
const server=await createServer(); await server.listen();
const child=spawn(electron,['.'],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:undefined,WILLFULL_DEV_URL:'http://127.0.0.1:5173'}});
child.on('exit',async code=>{await server.close();process.exit(code??0)});
