import {describe,it,expect} from 'vitest';
import {validateCleanup} from '../src/main/format';

describe('numeric correction preservation',()=>{
 it('accepts an explicit date correction and preserves the other number',()=>{
  expect(validateCleanup('The deadline is 24 October correction 25 October and the budget is $500.','The deadline is 25 October and the budget is $500.',0)).toBeUndefined();
 });
 it('accepts an explicit amount correction without losing a separate invoice total',()=>{
  expect(validateCleanup('The deposit is $300 sorry $350 and the total remains $900.','The deposit is $350 and the total remains $900.',0)).toBeUndefined();
 });
 it('rejects dropping an unrelated amount even when a valid correction is present',()=>{
  expect(validateCleanup('The deposit is $300 sorry $350 and the total remains $900.','The deposit is $350.',0)).toBeDefined();
 });
 it('rejects choosing a number other than the explicitly corrected value',()=>{
  expect(validateCleanup('The deadline is 24 October correction 25 October.','The deadline is 26 October.',0)).toBeDefined();
 });
 it('rejects silently dropping a number in an utterance without a correction',()=>{
  expect(validateCleanup('Send 3 drafts to the 2 reviewers.','Send drafts to the 2 reviewers.',0)).toBeDefined();
 });
});
