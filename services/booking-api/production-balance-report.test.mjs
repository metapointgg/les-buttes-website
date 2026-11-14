import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProductionBalanceReport} from './production-balance-report.mjs';
const table='les-buttes-booking-production-data-BookingTable-1FSJ2IAR789E2';
const ids=['11111111-1111-4111-8111-111111111111',
 '22222222-2222-4222-8222-222222222222',
 '33333333-3333-4333-8333-333333333333'];
const booked=[
 {id:ids[0],source:'direct',status:'CONFIRMED',reservationStatus:'CONFIRMED',
  start:'2027-05-08',units:['geranium'],guestName:'Dave Guest',guestEmail:'guest@example.com',
  approvedAmountGBP:805,paidAmountPence:40250, balanceDuePence:40250,
  paymentStatus:'PARTIALLY_PAID',paymentSchedule:{dueDate:'2027-04-24'}},
 {id:ids[1],source:'direct',status:'APPROVED_AWAITING_PAYMENT',
  start:'2027-04-10',units:['honeysuckle'],guestName:'Jo Guest',
  approvedAmountGBP:840},
 {id:ids[2],source:'direct',status:'CONFIRMED',
  start:'2027-06-05',units:['geranium'],approvedAmountGBP:735,paidAmountPence:73500}
];
test('owner financial report strongly reads booking META because existing GSI excludes money fields',async()=>{
 const calls=[];const db={send:async cmd=>{
  calls.push(cmd.input);
  if(cmd.input.IndexName)return {Items:ids.map(id=>({id,status:'CONFIRMED'}))};
  return {Item:booked.find(item=>item.id===cmd.input.Key.PK.slice(8))};
 }};
 const report=await loadProductionBalanceReport({db,table,now:'2027-04-25'});
 assert.equal(calls.filter(c=>c.ConsistentRead===true).length,3);
 assert.equal(report.items.length,2);
 assert.equal(report.totalOwedPence,124250);
 assert.equal(report.overduePence,40250);
 assert.equal(report.items[0].guestName,'Dave Guest');
 assert.equal(report.items[0].receivedPence,40250);
});
test('archived test booking never appears in financial obligations',async()=>{
 const db={send:async cmd=>cmd.input.IndexName?
  {Items:[{id:ids[0]}]}:{Item:{...booked[0],archivedForProductionLaunch:true}}};
 const report=await loadProductionBalanceReport({db,table});
 assert.equal(report.totalOwedPence,0);
 assert.deepEqual(report.items,[]);
});
