import type {DictionaryItem,Snippet} from '../shared/types';
const escape=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function literalFormat(text:string){return text.replace(/\bnew paragraph\b/gi,'\n\n').replace(/\bnew line\b/gi,'\n').replace(/\b(?:open parenthesis)\b/gi,'(').replace(/\b(?:close parenthesis)\b/gi,')').replace(/ +\n/g,'\n').replace(/\n +/g,'\n').trim();}
export function prepareText(raw:string,dictionary:DictionaryItem[],snippets:Snippet[]){
 let text=literalFormat(raw);const values:string[]=[];
 const protect=(value:string)=>{const slot=`[[WF_SLOT_${values.length}]]`;values.push(value);return slot;};
 text=text.replace(/\[\[WF_SLOT_\d+\]\]/g,match=>protect(match));
 const replaceOutsideSlots=(input:string,expression:RegExp,replacer:(match:string)=>string)=>input.split(/(\[\[WF_SLOT_\d+\]\])/g).map(part=>/^\[\[WF_SLOT_\d+\]\]$/.test(part)?part:part.replace(expression,replacer)).join('');
 const rules=[...snippets].filter(x=>x.trigger.trim()).sort((a,b)=>b.trigger.length-a.trigger.length);
 if(rules.length){const byKey=new Map(rules.map(x=>[x.trigger.toLocaleLowerCase(),x.text]));const expression=new RegExp(`(?<![\\p{L}\\p{N}_])(?:${rules.map(x=>escape(x.trigger)).join('|')})(?![\\p{L}\\p{N}_])`,'giu');text=replaceOutsideSlots(text,expression,match=>protect(byKey.get(match.toLocaleLowerCase())!));}
 for(const rule of [...dictionary].sort((a,b)=>b.heard.length-a.heard.length)){if(!rule.heard.trim())continue;const expression=new RegExp(`(?<![\\p{L}\\p{N}_])${escape(rule.heard)}(?![\\p{L}\\p{N}_])`,'giu');text=replaceOutsideSlots(text,expression,()=>protect(rule.written));}
 const restore=(result:string)=>result.replace(/\[\[WF_SLOT_(\d+)\]\]/g,(match,index)=>values[Number(index)]??match);
 return {text,values,restore,literal:restore(text)};
}
export function validateCleanup(original:string,result:string,slotCount:number):string|undefined{
 if(!result.trim())return 'The cleanup model returned empty text.';
 if(result.length>original.length*3+120)return 'Cleanup expanded the dictation too much.';
 for(let index=0;index<slotCount;index++){const slot=`[[WF_SLOT_${index}]]`;const count=(s:string)=>s.split(slot).length-1;if(count(original)!==count(result))return 'Cleanup changed a protected word or snippet.';}
 const slots=(s:string)=>(s.match(/\[\[WF_SLOT_\d+\]\]/g)??[]).join('|');
 if(slots(original)!==slots(result))return 'Cleanup moved or invented protected text.';
 const digits=(s:string)=>(s.replace(/\[\[WF_SLOT_\d+\]\]/g,'').match(/[$£€₹]?\s*[-+]?\d[\d,.]*(?:%|\b)(?:\s*(?:trillion|billion|million|thousand|hundred|percent|dollars?|pounds?|euros?|rupees?|kg|kilograms?|grams?|miles?|km|meters?|liters?|hours?|minutes?|seconds?))?/gi)??[]).map(x=>x.replace(/,/g,'').replace(/\s+/g,' ').trim().toLowerCase()).join('|');
 const correctionSource=original.replace(/(?:[$£€₹]\s*)?[-+]?\d[\d,.]*(?:\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|trillion|billion|million|thousand|hundred|percent|dollars?|pounds?|euros?|rupees?))?\s*,?\s*(?:sorry|correction|corrected to|i mean|no i mean)\s*,?\s*(?=(?:[$£€₹]\s*)?[-+]?\d)/gi,'');
 if(digits(correctionSource)!==digits(result))return 'Cleanup changed a number or its unit; the original was kept.';
 const magnitudes=(s:string)=>(s.match(/\b(?:trillion|billion|million|thousand|hundred)\b/gi)??[]).map(x=>x.toLowerCase()).join('|');
 if(magnitudes(correctionSource)!==magnitudes(result))return 'Cleanup changed a quantity; the original was kept.';
 const negations=(s:string)=>(s.match(/\b(?:not|never|without|no)\b|n['’]t\b/gi)??[]).length;
 if(negations(correctionSource)!==negations(result))return 'Cleanup changed a negation; the original was kept.';
 if(/<think>|<script|^```/i.test(result))return 'Cleanup returned unsupported markup.';
 return undefined;
}
