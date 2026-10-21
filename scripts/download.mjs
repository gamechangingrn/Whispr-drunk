import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,mkdirSync,statSync,renameSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {once} from 'node:events';
export async function sha256(path){const hash=createHash('sha256');for await(const data of createReadStream(path))hash.update(data);return hash.digest('hex');}
export async function download(asset,destination,{signal,onProgress=()=>{}}={}){
 mkdirSync(dirname(destination),{recursive:true});
 if(existsSync(destination)&&statSync(destination).size===asset.bytes&&await sha256(destination)===asset.sha256){onProgress(1);return destination;}
 const partial=destination+'.partial';let offset=existsSync(partial)?statSync(partial).size:0;
 const response=await fetch(asset.url,{headers:offset?{Range:`bytes=${offset}-`}:{},signal});
 if(!response.ok||!response.body)throw new Error(`Download failed (${response.status}). Try again; partial downloads are retained.`);
 if(offset&&response.status!==206)offset=0;
 const stream=createWriteStream(partial,{flags:offset?'a':'w'});let received=offset;let last=0;
 try{for await(const chunk of response.body){if(signal?.aborted)throw new Error('Download cancelled.');received+=chunk.length;if(!stream.write(chunk))await once(stream,'drain');if(Date.now()-last>250){onProgress(received/asset.bytes);last=Date.now();}}stream.end();await once(stream,'finish');}catch(error){stream.destroy();throw error;}
 if(received!==asset.bytes||await sha256(partial)!==asset.sha256){unlinkSync(partial);throw new Error('The download did not pass its integrity check. Please retry.');}
 if(existsSync(destination))unlinkSync(destination);renameSync(partial,destination);onProgress(1);return destination;
}
