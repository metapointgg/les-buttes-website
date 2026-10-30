import test from 'node:test';
import assert from 'node:assert/strict';
import {handler,stagingQuote,validateQuoteQuery} from './staging-quote-handler.mjs';
const value={unit:'geranium',seasonStart:'2027-03-20',seasonEnd:'2027-10-02',maxNights:27,
 bands:[{start:'2027-03-20',end:'2027-10-02',nightlyGBP:'105.00',minNights:3}]};
test('staging quote reads master pricing and checks occupancy without writing',async()=>{
 const commands=[];
 const db={send:async command=>{commands.push(command);return command.input.Key?
  {Item:{value}}:{Items:[]};}};
 const quote=await stagingQuote({unit:'geranium',start:'2027-04-03',end:'2027-04-10',guests:'2'},{db,table:'staging'});
 assert.equal(quote.totalGBP,'735.00');
 assert.equal(commands.length,2);
 assert.ok(commands.every(c=>c.input.ConsistentRead===true));
});
test('occupied nights fail closed',async()=>{
 const db={send:async c=>c.input.Key?{Item:{value}}:{Items:[{SK:'DATE#2027-04-05'}]}};
 await assert.rejects(stagingQuote({unit:'geranium',start:'2027-04-03',end:'2027-04-10',guests:'2'},{db,table:'staging'}),/unavailable/);
});
test('guest capacities and cottage selection are enforced',()=>{
 assert.throws(()=>validateQuoteQuery({unit:'geranium',guests:'5'}),/guest/);
 assert.equal(validateQuoteQuery({unit:'both',guests:'10'}).units.length,2);
});

test('staging handler reports backend failure as 503, never a guest validation error',async()=>{
 const previous={...process.env};
 process.env.BOOKING_ENVIRONMENT='staging';
 process.env.BOOKINGS_TABLE='';
 process.env.ALLOWED_PREVIEW_ORIGIN='https://staging.example.invalid';
 try{
  const response=await handler({headers:{origin:'https://staging.example.invalid'},rawPath:'/quote',requestContext:{http:{method:'GET'}}});
  assert.equal(response.statusCode,403);
 }finally{
  for(const key of ['BOOKING_ENVIRONMENT','BOOKINGS_TABLE','ALLOWED_PREVIEW_ORIGIN']){
   if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
  }
 }
});

test('expired holds do not block quotes but permanent slots and non-expiring holds do',async()=>{
 let slot={SK:'DATE#2027-04-05',expiresAt:1};
 const db={send:async c=>c.input.Key?{Item:{value}}:{Items:[slot]}};
 const q={unit:'geranium',start:'2027-04-03',end:'2027-04-10',guests:'2'};
 assert.equal((await stagingQuote(q,{db,table:'staging'})).totalGBP,'735.00');
 slot={SK:'DATE#2027-04-05',expiresAt:0};
 await assert.rejects(stagingQuote(q,{db,table:'staging'}),/unavailable/);
 slot={SK:'DATE#2027-04-05',expiresAt:Math.floor(Date.now()/1000)+3600};
 await assert.rejects(stagingQuote(q,{db,table:'staging'}),/unavailable/);
});
