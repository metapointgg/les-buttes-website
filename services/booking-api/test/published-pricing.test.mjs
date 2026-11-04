import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteFromPublishedMaster} from '../published-pricing.mjs';

const table='les-buttes-booking-staging-BookingTable-TEST';
const nights=Array.from({length:7},(_,i)=>new Date(Date.UTC(2027,5,26+i)).toISOString().slice(0,10));
const baseRecords={
 geranium:{version:3,value:{maxNights:27,bands:[
  {start:'2027-03-20',end:'2027-06-26',nightlyGBP:'105.00',minNights:3},
  {start:'2027-06-26',end:'2027-08-28',nightlyGBP:'155.00',minNights:7}
 ]}},
 honeysuckle:{version:1,value:{maxNights:27,bands:[
  {start:'2027-03-20',end:'2027-06-26',nightlyGBP:'120.00',minNights:3},
  {start:'2027-06-26',end:'2027-08-28',nightlyGBP:'140.00',minNights:7}
 ]}}
};
function fakeDb(records=baseRecords){
 const calls=[];
 return {calls,send:async command=>{
  const input=command.input;
  calls.push(input);
  assert.equal(input.TableName,table);
  assert.equal(input.ConsistentRead,true);
  assert.equal(input.Key.SK,'CURRENT');
  const unit=input.Key.PK.replace('CONFIG#pricing#','');
  return {Item:records[unit]??null};
 }};
}
test('direct quote matches management-published 2027 rates and stores versions',async()=>{
 const db=fakeDb();
 const quote=await quoteFromPublishedMaster({db,table,units:['geranium','honeysuckle'],nights});
 assert.equal(quote.totalGBP,'2065.00');
 assert.deepEqual(quote.breakdown,[{unit:'geranium',amountGBP:'1085.00'},{unit:'honeysuckle',amountGBP:'980.00'}]);
 assert.deepEqual(quote.units,[{unit:'geranium',priceGBP:'1085.00',version:3},{unit:'honeysuckle',priceGBP:'980.00',version:1}]);
 assert.equal(quote.minimumNights,7);
 assert.equal(db.calls.length,2);
});
test('missing, duplicate and invalid published bands fail closed',async()=>{
 const withoutHoney={geranium:baseRecords.geranium};
 assert.equal((await quoteFromPublishedMaster({db:fakeDb(withoutHoney),table,units:['geranium','honeysuckle'],nights})).serverError,true);
 const g=baseRecords.geranium;
 const duplicate={...g,value:{...g.value,bands:[...g.value.bands,g.value.bands[1]]}};
 assert.equal((await quoteFromPublishedMaster({db:fakeDb({geranium:duplicate}),table,units:['geranium'],nights})).serverError,true);
 const invalid={...g,value:{...g.value,bands:[...g.value.bands.slice(0,1),{...g.value.bands[1],nightlyGBP:'not-a-price'}]}};
 assert.equal((await quoteFromPublishedMaster({db:fakeDb({geranium:invalid}),table,units:['geranium'],nights})).serverError,true);
});
test('only published bands can price nights and end date is excluded',async()=>{
 const db=fakeDb();
 const outside=['2027-08-28'];
 assert.equal((await quoteFromPublishedMaster({db,table,units:['geranium'],nights:outside})).serverError,true);
 const shorter=nights.slice(0,3);
 assert.equal((await quoteFromPublishedMaster({db,table,units:['geranium'],nights:shorter})).serverError,true);
});
test('environment rate JSON is never read or used as a fallback',async()=>{
 const before=process.env.BOOKING_RATES_JSON;
 try{
  process.env.BOOKING_RATES_JSON=JSON.stringify({periods:[{start:'2027-01-01',end:'2027-12-31',geranium:1}]});
  const quote=await quoteFromPublishedMaster({db:fakeDb(),table,units:['geranium'],nights});
  assert.equal(quote.totalGBP,'1085.00');
 }finally{
  if(before===undefined)delete process.env.BOOKING_RATES_JSON;
  else process.env.BOOKING_RATES_JSON=before;
 }
});
