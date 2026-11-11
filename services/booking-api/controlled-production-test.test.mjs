import test from 'node:test';
import assert from 'node:assert/strict';
import {controlledTestRequest,controlledTestBooking,matchesControlledAccess,controlledTestBookingClaim} from './controlled-production-test.mjs';
const req={unit:'geranium',start:'2027-04-03',end:'2027-04-10',guests:2,
 email:'mike@un1ty.gg',name:'Owner Test',website:''};
const booking={source:'direct',synthetic:false,units:['geranium'],start:'2027-04-03',
 end:'2027-04-10',guestEmail:'mike@un1ty.gg',quote:{currency:'GBP',totalGBP:'735.00'}};
test('request can only target exact owner test identity and published quote dates',()=>{
 assert.equal(controlledTestRequest(req),true);
 for(const changed of [{unit:'honeysuckle'},{start:'2027-04-10'},{end:'2027-04-17'},
   {guests:3},{email:'guest@example.com'},{name:''},{website:'bot'}])
  assert.equal(controlledTestRequest({...req,...changed}),false);
});
test('booking identity cannot be changed for £1 owner acceptance',()=>{
 assert.equal(controlledTestBooking(booking),true);
 for(const changed of [{source:'airbnb'},{synthetic:true},{units:['honeysuckle']},
  {guestEmail:'other@example.com'},{quote:{currency:'GBP',totalGBP:'1.00'}},
  {quote:{currency:'EUR',totalGBP:'735.00'}}])
  assert.equal(controlledTestBooking({...booking,...changed}),false);
});
test('test access is constant-time and a successful request consumes a one-time DynamoDB claim',()=>{
 const code='x'.repeat(48);
 assert.equal(matchesControlledAccess(code,code),true);
 assert.equal(matchesControlledAccess(code,'y'.repeat(48)),false);
 assert.equal(matchesControlledAccess(code,'x'.repeat(47)),false);
 assert.equal(matchesControlledAccess('',code),false);
 const claim=controlledTestBookingClaim('production-table','booking-id');
 assert.equal(claim.Put.Item.PK,'SYSTEM#PRODUCTION_TEST');
 assert.equal(claim.Put.ConditionExpression,'attribute_not_exists(PK)');
});
