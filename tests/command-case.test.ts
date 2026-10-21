import {describe,it,expect} from 'vitest';
import {directCaseEdit} from '../src/main/editor';
describe('explicit case commands',()=>{
 it('executes an uppercase instruction without a model changing wording',()=>expect(directCaseEdit('Invoice A-19: due today.','Make this uppercase.')).toBe('INVOICE A-19: DUE TODAY.'));
 it('keeps nonletters and line breaks for lowercase',()=>expect(directCaseEdit('READY 12.50%\nAPI','convert this to lowercase')).toBe('ready 12.50%\napi'));
 it('does not misinterpret a negated instruction',()=>expect(directCaseEdit('Original','Do not make this uppercase')).toBeUndefined());
});
