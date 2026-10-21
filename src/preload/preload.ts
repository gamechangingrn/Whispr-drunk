import {contextBridge,ipcRenderer} from 'electron';
contextBridge.exposeInMainWorld('willfull',{
 getState:()=>ipcRenderer.invoke('willfull:getState'),
 invoke:(action:string,payload?:unknown)=>ipcRenderer.invoke('willfull:action',action,payload),
 onState:(callback:(state:unknown)=>void)=>{const listener=(_event:unknown,state:unknown)=>callback(state);ipcRenderer.on('willfull:state',listener);return()=>ipcRenderer.removeListener('willfull:state',listener);}
});
