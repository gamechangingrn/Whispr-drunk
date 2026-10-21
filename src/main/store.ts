import initSqlJs,{type Database} from 'sql.js';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import type {Settings,DictionaryItem,Snippet,Entry} from '../shared/types';

export const defaults:Settings={mode:'clean',historyEnabled:false,launchAtLogin:false,deviceId:'-1',hotkey:'Ctrl+Alt+Space',commandHotkey:'Ctrl+Alt+Shift+Space',toggleHotkey:'Ctrl+Alt+Enter',appStyles:false,style:'neutral',editorDevice:'auto',onboardingComplete:false,idleUnloadMinutes:10};
export class Store {
 private db!:Database;
 constructor(private file:string){}
 async init(){const require=createRequire(__filename);const SQL=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});this.db=existsSync(this.file)?new SQL.Database(readFileSync(this.file)):new SQL.Database();this.db.run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history (id TEXT PRIMARY KEY,created INTEGER NOT NULL,value TEXT NOT NULL)');this.flush();}
 get<T>(key:string,fallback:T):T{const statement=this.db.prepare('SELECT value FROM kv WHERE key=?');try{statement.bind([key]);if(statement.step())return JSON.parse(String(statement.get()[0]));return fallback;}finally{statement.free();}}
 set(key:string,value:unknown){this.db.run('INSERT OR REPLACE INTO kv VALUES (?,?)',[key,JSON.stringify(value)]);this.flush();}
 settings():Settings{return {...defaults,...this.get<Partial<Settings>>('settings',{})};}
 dictionary():DictionaryItem[]{return this.get('dictionary',[]);}
 snippets():Snippet[]{return this.get('snippets',[]);}
 history():Entry[]{const rows=this.db.exec('SELECT value FROM history ORDER BY created DESC LIMIT 500');return rows.length?rows[0].values.map(row=>JSON.parse(String(row[0]))):[];}
 addHistory(entry:Entry){this.db.run('INSERT INTO history VALUES (?,?,?)',[entry.id,entry.createdAt,JSON.stringify(entry)]);this.db.run('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY created DESC LIMIT 500)');this.flush();}
 deleteHistory(id:string){this.db.run('DELETE FROM history WHERE id=?',[id]);this.flush();}
 clearHistory(){this.db.run('DELETE FROM history');this.flush();}
 private flush(){mkdirSync(dirname(this.file),{recursive:true});const next=this.file+'.tmp';writeFileSync(next,this.db.export());renameSync(next,this.file);}
 close(){this.db.close();}
}
