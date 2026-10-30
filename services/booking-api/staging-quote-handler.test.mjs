import test from 'node:test';
import assert from 'node:assert/strict';
import {stagingQuote,validateQuoteQuery} from './staging-quote-handler.mjs';
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
