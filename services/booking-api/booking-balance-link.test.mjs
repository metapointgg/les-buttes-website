import test from 'node:test';
import assert from 'node:assert/strict';
import {balancePaymentPageUrl,verifyBalancePaymentAccess} from './booking-balance-link.mjs';
const id='11111111-1111-4111-8111-111111111111',token='A'.repeat(43);
const booking={id,source:'direct',status:'CONFIRMED',reservationStatus:'CONFIRMED',
 paymentStatus:'PARTIALLY_PAID',balanceDuePence:40250,balanceAccessToken:token};
test('balance reminder uses high-entropy fragment URL not HTTP query strings',()=>{
 const url=new URL(balancePaymentPageUrl({bookingId:id,token}));
 assert.equal(url.hostname,'lesbuttes.com');
 assert.equal(url.pathname,'/pay/');
 assert.equal(url.search,'');
 assert.equal(new URLSearchParams(url.hash.slice(1)).get('access'),token);
});
test('guest balance capability is bound to an outstanding confirmed booking',()=>{
 assert.equal(verifyBalancePaymentAccess({booking,bookingId:id,token}),true);
 for(const change of [{balanceDuePence:0},{status:'CANCELLED'},{paymentStatus:'PAID_IN_FULL'},
   {balanceAccessToken:'B'.repeat(43)},{synthetic:true},{reservationStatus:'CANCELLED'}])
  assert.equal(verifyBalancePaymentAccess({booking:{...booking,...change},bookingId:id,token}),false);
 assert.equal(verifyBalancePaymentAccess({booking,bookingId:id,token:'B'.repeat(43)}),false);
 assert.throws(()=>balancePaymentPageUrl({bookingId:id,token:'invalid'}));
});
