import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApprovedTermsRelease,readApprovedTermsFromMaster} from '../booking-terms-store.mjs';
import {derivePublishedBookingTerms} from '../cms-published-terms.mjs';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
const source={status:'PUBLISHED',version:2,
 termsText:'Synthetic complete approved English booking terms text for the unit test fixture.',
 cancellationText:'Synthetic complete approved English cancellation policy for the unit test fixture.'};
const digest=derivePublishedBookingTerms(source).digest;
const options={source,table,approvedDigest:digest,previousVersion:1,
 now:new Date('2026-10-27T12:00:00Z')};
test('approved terms release is immutable version plus atomic compare-and-swap pointer',()=>{
 const plan=buildApprovedTermsRelease(options);
 assert.equal(plan.status,'RELEASE_PLAN_ONLY');
 assert.equal(plan.transactWrite.TransactItems.length,2);
 const [version,current]=plan.transactWrite.TransactItems.map(x=>x.Put);
 assert.equal(version.Item.SK,'VERSION#0000000002');
 assert.equal(version.ConditionExpression,'attribute_not_exists(PK)');
 assert.equal(current.Item.versionKey,version.Item.SK);
 assert.equal(current.ExpressionAttributeValues[':previous'],1);
 assert.equal(current.ConditionExpression,'attribute_exists(PK) AND #version = :previous');
});
test('drafts, digest mismatches, downgrades and non-staging targets cannot publish',()=>{
 for(const patch of [{approvedDigest:'0'.repeat(64)},
  {source:{...source,status:'DRAFT'}},{previousVersion:2},
  {previousVersion:3},{table:'production'}]){
  assert.throws(()=>buildApprovedTermsRelease({...options,...patch}));
 }
 const initial=buildApprovedTermsRelease({...options,previousVersion:0});
 assert.equal(initial.transactWrite.TransactItems[1].Put.ConditionExpression,'attribute_not_exists(PK)');
});
test('read requires matching immutable contents and published pointer',async()=>{
 const plan=buildApprovedTermsRelease(options);
 const [version,current]=plan.transactWrite.TransactItems.map(x=>x.Put.Item);
 const rows={[current.SK]:current,[version.SK]:version};
 const db={send:async command=>({Item:rows[command.input.Key.SK]})};
 assert.deepEqual(await readApprovedTermsFromMaster({db,table}),derivePublishedBookingTerms(source));
 await assert.rejects(readApprovedTermsFromMaster({db:{send:async()=>({Item:undefined})},table}));
 await assert.rejects(readApprovedTermsFromMaster({db:{send:async c=>({Item:c.input.Key.SK==='CURRENT'?current:{...version,termsText:'changed'}})},table}));
 await assert.rejects(readApprovedTermsFromMaster({db:{send:async c=>({Item:c.input.Key.SK==='CURRENT'?{...current,digest:'0'.repeat(64)}:version})},table}));
});
