import test from 'node:test';
import assert from 'node:assert/strict';
import {slotBlocksAvailability} from '../occupancy.mjs';

const now=1792839600;

test('confirmed reservations with no TTL are always blocked (critical regression)',()=>{
  assert.equal(slotBlocksAvailability({PK:'UNIT#geranium',SK:'DATE#2027-06-11',id:'confirmed-booking'},now),true);
  assert.equal(slotBlocksAvailability({PK:'UNIT#honeysuckle',SK:'DATE#2027-06-11',id:'manual-airbnb-block'},now),true);
});
test('temporary requests and approved payment holds are blocked before expiry',()=>{
  assert.equal(slotBlocksAvailability({expiresAt:now+3600},now),true);
  assert.equal(slotBlocksAvailability({expiresAt:now},now),true);
});
test('expired holds cease blocking after expiry and can be safely reused',()=>{
  assert.equal(slotBlocksAvailability({expiresAt:now-1},now),false);
  assert.equal(slotBlocksAvailability({expiresAt:now-3600},now),false);
});
test('malformed TTLs do not accidentally open an occupied date',()=>{
  assert.equal(slotBlocksAvailability({expiresAt:null},now),true);
  assert.equal(slotBlocksAvailability({expiresAt:'1792839600'},now),true);
  assert.equal(slotBlocksAvailability({expiresAt:0},now),true);
  assert.equal(slotBlocksAvailability({expiresAt:-1},now),true);
  assert.equal(slotBlocksAvailability({expiresAt:NaN},now),true);
});
test('a missing date-slot item is available',()=>{
  assert.equal(slotBlocksAvailability(undefined,now),false);
});
