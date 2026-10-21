import {describe,expect,it} from 'vitest';
import {literalFormat,prepareText,validateCleanup} from '../src/main/format';
import type {DictionaryItem,Snippet} from '../src/shared/types';

const dictionary:DictionaryItem[]=[
 {id:'person',heard:'louis',written:'Loius Bachour'},
 {id:'company',heard:'acme',written:'Acme Capital'},
];
const snippets:Snippet[]=[
 {id:'short',trigger:'my signature',text:'Regards,\nSam'},
 {id:'long',trigger:'my signature for clients',text:'Regards,\nSam | +91 555 0100\nAcme Capital'},
];

describe('literal formatting and exact personalization',()=>{
 it('applies spoken layout commands without manufacturing sentence content',()=>{
  expect(literalFormat('First point new line Second point new paragraph Final point')).toBe('First point\nSecond point\n\nFinal point');
 });
 it('matches whole phrases and protects preferred names exactly',()=>{
  const prepared=prepareText('Ask Louis about acme. The word acmeology stays.',dictionary,[]);
  expect(prepared.literal).toBe('Ask Loius Bachour about Acme Capital. The word acmeology stays.');
  expect(prepared.values).toEqual(['Loius Bachour','Acme Capital']);
  expect(prepared.restore(prepared.text)).toBe(prepared.literal);
 });
 it('selects the longest overlapping snippet and preserves its exact multiline body',()=>{
  const prepared=prepareText('Please use my signature for clients, not my signature.',dictionary,snippets);
  expect(prepared.literal).toBe('Please use Regards,\nSam | +91 555 0100\nAcme Capital, not Regards,\nSam.');
  expect(prepared.values).toHaveLength(2);
 });
 it('does not expand trigger substrings inside another word',()=>{
  const prepared=prepareText('email mail mailbox mailroom',[],[{id:'mail',trigger:'mail',text:'MESSAGE'}]);
  expect(prepared.literal).toBe('email MESSAGE mailbox mailroom');
 });
 it('escapes regular-expression characters in user rules',()=>{
  const prepared=prepareText('send project (alpha) now',[],[{id:'alpha',trigger:'project (alpha)',text:'Project A+ [approved]'}]);
  expect(prepared.literal).toBe('send Project A+ [approved] now');
 });
 it('keeps repeated expansions individually protected',()=>{
  const prepared=prepareText('my signature then my signature',[],snippets);
  expect(prepared.values).toHaveLength(2);
  expect(prepared.literal).toBe('Regards,\nSam then Regards,\nSam');
 });
 it('does not delete user-supplied strings that resemble internal placeholders',()=>{
  const source='The template contains [[WF_SLOT_99]] literally.';
  expect(prepareText(source,[],[]).literal).toBe(source);
 });
 it('keeps a literal placeholder separate from a newly protected dictionary value',()=>{
  const prepared=prepareText('Print [[WF_SLOT_0]] for Louis.',dictionary,[]);
  expect(prepared.literal).toBe('Print [[WF_SLOT_0]] for Loius Bachour.');
 });
});

describe('cleanup integrity checks',()=>{
 it('allows conservative punctuation changes and comma-normalized amounts',()=>{
  expect(validateCleanup('send $1,500 to acme on 2026-10-21','Send $1500 to Acme on 2026-10-21.',0)).toBeUndefined();
 });
 it.each([
  ['Do not sell 25 shares.','Sell 25 shares.'],
  ['Never transfer without approval.','Transfer without approval.'],
  ["I don't authorize the transfer.",'I authorize the transfer.'],
  ['Transfer $1500, not $150.','Transfer $150, not $1500.'],
  ['Transfer $100 from account 1 to account 2.','Transfer $1 from account 100 to account 2.'],
  ['Revenue was 5 million dollars.','Revenue was 5 billion dollars.'],
 ])('rejects changed numbers, numeric roles, units or deleted negation: %s',(source,generated)=>{
  expect(validateCleanup(source,generated,0)).toBeTypeOf('string');
 });
 it('allows a negated contraction to expand without losing negation',()=>{
  expect(validateCleanup("I don't approve.",'I do not approve.',0)).toBeUndefined();
 });
 it('rejects omission or duplication of a protected name or snippet',()=>{
  const prepared=prepareText('Send this to Louis and use my signature.',dictionary,snippets);
  expect(validateCleanup(prepared.text,prepared.text.replace('[[WF_SLOT_0]]',''),prepared.values.length)).toBeTypeOf('string');
  expect(validateCleanup(prepared.text,prepared.text+' [[WF_SLOT_0]]',prepared.values.length)).toBeTypeOf('string');
 });
 it('rejects reordering protected recipients even when token counts match',()=>{
  const source='Send to [[WF_SLOT_0]], not [[WF_SLOT_1]].';
  const generated='Send to [[WF_SLOT_1]], not [[WF_SLOT_0]].';
  expect(validateCleanup(source,generated,2)).toBeTypeOf('string');
 });
 it('rejects invented placeholder references instead of silently deleting generated material',()=>{
  expect(validateCleanup('Hello [[WF_SLOT_0]].','Hello [[WF_SLOT_0]] and [[WF_SLOT_99]].',1)).toBeTypeOf('string');
 });
 it.each(['','   ','<think>private reasoning</think> text','<script>alert(1)</script>','```text\nHello\n```'])(
  'rejects empty or malformed generation: %s',generated=>expect(validateCleanup('Hello.',generated,0)).toBeTypeOf('string'),
 );
 it('rejects excessive invented expansion',()=>{
  expect(validateCleanup('Hello.','New facts. '.repeat(40),0)).toBeTypeOf('string');
 });
});
