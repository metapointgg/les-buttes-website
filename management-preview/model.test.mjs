import test from 'node:test';import assert from 'node:assert/strict';
import {allowedAction,safeStagingApi,reasonValid,bookingStatus} from './model.mjs';
const requested={source:'direct',status:'REQUESTED',reservationStatus:'PENDING_REVIEW',holdExpiresAt:200};
test('safe action states and expired holds',()=>{
 assert.equal(allowedAction(requested,'decline',100),true);
 assert.equal(allowedAction(requested,'decline',200),false);
 assert.equal(allowedAction({...requested,source:'airbnb'},'decline',100),false);
 assert.equal(allowedAction({...requested,status:'CONFIRMED',reservationStatus:'CONFIRMED'},'cancel'),true);
 assert.equal(allowedAction(requested,'approve',100),false);
 assert.equal(bookingStatus({status:'DECLINED'}),'DECLINED');
});
test('staging API URL rejects other hosts and unsafe schemes',()=>{
 assert.equal(safeStagingApi('https://abc.execute-api.eu-west-2.amazonaws.com'),'https://abc.execute-api.eu-west-2.amazonaws.com');
 for(const url of ['http://abc.execute-api.eu-west-2.amazonaws.com','https://example.com','https://abc.execute-api.us-east-1.amazonaws.com','https://user:pass@abc.execute-api.eu-west-2.amazonaws.com'])
  assert.equal(safeStagingApi(url),null);
});
test('reasons must be substantial and bounded',()=>{
 assert.equal(reasonValid('short'),true);assert.equal(reasonValid('bad'),false);assert.equal(reasonValid('x'.repeat(1001)),false);
});
