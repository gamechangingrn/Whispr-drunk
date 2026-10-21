export type Phase='idle'|'starting'|'recording'|'finalizing'|'formatting'|'inserting'|'complete'|'error';
export type Mode='literal'|'clean';
export interface Settings {mode:Mode;historyEnabled:boolean;launchAtLogin:boolean;deviceId:string;hotkey:string;commandHotkey:string;toggleHotkey:string;appStyles:boolean;style:'neutral'|'email'|'casual'|'code';editorDevice:'auto'|'cpu'|'gpu';onboardingComplete:boolean;idleUnloadMinutes:number;}
export interface Entry {id:string;raw:string;text:string;createdAt:number;app:string;mode:string;durationMs:number;}
export interface DictionaryItem {id:string;heard:string;written:string;}
export interface Snippet {id:string;trigger:string;text:string;}
export interface ModelState {name:string;status:'missing'|'installing'|'loading'|'ready'|'error'|'unloaded';progress?:number;message?:string;size?:string;}
export interface Target {hwnd?:string;pid?:number;name?:string;processName?:string;[key:string]:unknown;}
export interface AppState {
 session:{phase:Phase;id?:string;mode:'dictation'|'command';partial:string;result:string;error?:string;level:number;startedAt?:number;targetName?:string;notice?:string;};
 settings:Settings;models:{speech:ModelState;editor:ModelState};history:Entry[];dictionary:DictionaryItem[];snippets:Snippet[];devices:{id:string;name:string}[];
 metrics:{appRamMb?:number;speechRamMb?:number;gpuName?:string;nativeReady?:boolean;lastLatencyMs?:number;};
 commandPreview?:{original:string;edited:string;instruction:string;target?:Target};
}
export interface Bridge {getState():Promise<AppState>;invoke(action:string,payload?:unknown):Promise<any>;onState(callback:(state:AppState)=>void):()=>void;}
declare global {interface Window {willfull:Bridge;}}
