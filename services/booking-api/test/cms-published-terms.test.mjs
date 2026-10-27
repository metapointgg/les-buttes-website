import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePublishedBookingTerms} from '../cms-published-terms.mjs';
const legal={status:'PUBLISHED',version:2,termsText:'Complete sample booking terms for an intentionally synthetic test fixture.',cancellationText:'Complete sample cancellation wording for this synthetic unit test only.'};
test('draft and incomplete legal content cannot be accepted',()=>{
 for(const source of [{...legal,status:'DRAFT'}, {...legal,termsText:''},
  {...legal,cancellationText:''}, {...legal,version:0},null])
  assert.throws(()=>derivePublishedBookingTerms(source));
});
test('published digest binds version and both legal documents',()=>{
 const x=derivePublishedBookingTerms(legal);
 assert.equal(x.status,'PUBLISHED');
 assert.match(x.digest,/^[a-f0-9]{64}$/);
 assert.notEqual(x.digest,derivePublishedBookingTerms({...legal,version:3}).digest);
 assert.notEqual(x.digest,derivePublishedBookingTerms({...legal,cancellationText:legal.cancellationText+' Revised.'}).digest);
});
