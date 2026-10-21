import {build} from 'esbuild';
await build({entryPoints:{main:'src/main/main.ts',preload:'src/preload/preload.ts'},outdir:'dist/main',bundle:true,platform:'node',format:'cjs',target:'node24',external:['electron','sql.js'],outExtension:{'.js':'.cjs'},sourcemap:true});
