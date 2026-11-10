import test from 'node:test';
import assert from 'node:assert/strict';
import {guernseyLocalInstant,validateArrivalDeparturePolicy} from './arrival-departure-policy.mjs';

test('Guernsey arrival time retains the correct seasonal UTC offset',()=>{
 assert.equal(guernseyLocalInstant('2027-08-28','12:00'),'2027-08-28T12:00:00+01:00');
 assert.equal(guernseyLocalInstant('2027-03-20','12:00'),'2027-03-20T12:00:00+00:00');
});

test('arrival policy is explicit, bounded and permits a clearly marked staging fixture',()=>{
 assert.equal(validateArrivalDeparturePolicy({timezone:'Europe/Guernsey',checkInLocalTime:'12:00',checkOutLocalTime:'10:00'}),true);
 assert.equal(validateArrivalDeparturePolicy({timezone:'Europe/Guernsey',checkInLocalTime:'12:00',checkOutLocalTime:'10:00',testOnly:true}),true);
 for(const value of [
  {timezone:'UTC',checkInLocalTime:'12:00',checkOutLocalTime:'10:00'},
  {timezone:'Europe/Guernsey',checkInLocalTime:'24:00',checkOutLocalTime:'10:00'},
  {timezone:'Europe/Guernsey',checkInLocalTime:'12:00',checkOutLocalTime:'10:00',testOnly:false}
 ])assert.throws(()=>validateArrivalDeparturePolicy(value));
});
