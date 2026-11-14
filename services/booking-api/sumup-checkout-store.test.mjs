import test from 'node:test';import assert from 'node:assert/strict';
import {registerCheckout,readRegisteredCheckout,reconcileCheckoutRegistration} from './sumup-checkout-store.mjs';
const bookingId='11111111-1111-4111-8111-111111111111';
const checkout={checkoutId:'checkout-12345678',reference:'booking-12345',amountPence:163000,
 currency:'GBP',status:'PENDING',hostedCheckoutUrl:'https://checkout.sumup.com/pay/checkout-12345678'};
test('LB-07 registration is atomic and bound to approved booking state and amount',async()=>{
 let tx;
 const db={send:async command=>{tx=command.input;return {};}};
 const result=await registerCheckout({db,table:'booking-staging',bookingId,checkout,reference:checkout.reference,nowEpoch:100});
 assert.equal(result.checkoutId,checkout.checkoutId);
 assert.equal(tx.TransactItems.length,2);
 assert.equal(tx.TransactItems[0].ConditionCheck.ExpressionAttributeValues[':amount'],1630);
 assert.equal(tx.TransactItems[0].ConditionCheck.ExpressionAttributeValues[':approved'],'APPROVED_AWAITING_PAYMENT');
 assert.equal(tx.TransactItems[1].Put.ConditionExpression,'attribute_not_exists(PK)');
 await assert.rejects(registerCheckout({db,table:'booking-production',bookingId,checkout,reference:checkout.reference}),/unavailable/);
 await assert.rejects(registerCheckout({db,table:'booking-staging',bookingId,checkout:{...checkout,amountPence:0},reference:checkout.reference}),/Invalid/);
});
test('LB-07 duplicate registration compares immutable checkout identity',async()=>{
 const existing={PK:'BOOKING#'+bookingId,SK:'PAYMENT#CHECKOUT',bookingId,
  checkoutId:checkout.checkoutId,reference:checkout.reference,amountPence:checkout.amountPence,currency:'GBP'};
 const db={send:async command=>({Item:existing})};
 assert.deepEqual(await readRegisteredCheckout({db,table:'booking-staging',bookingId}),existing);
 assert.equal((await reconcileCheckoutRegistration({db,table:'booking-staging',bookingId,checkout,reference:checkout.reference})).status,'REGISTERED');
 assert.equal((await reconcileCheckoutRegistration({db,table:'booking-staging',bookingId,checkout:{...checkout,checkoutId:'checkout-99999999'},reference:checkout.reference})).status,'CONFLICT');
 assert.equal((await reconcileCheckoutRegistration({db:{send:async()=>({})},table:'booking-staging',bookingId,checkout,reference:checkout.reference})).status,'UNREGISTERED');
});

test('deposit checkout is conditionally bound to total booking value and exact 50% schedule',async()=>{
 let tx;
 const db={send:async command=>{tx=command.input;return {};}};
 const paymentSchedule={totalPence:80500,dueNowPence:40250,balancePence:40250};
 await registerCheckout({db,table:'booking-staging',bookingId,
  checkout:{...checkout,amountPence:40250},reference:checkout.reference,paymentSchedule});
 assert.equal(tx.TransactItems[0].ConditionCheck.ExpressionAttributeValues[':amount'],805);
 assert.equal(tx.TransactItems[0].ConditionCheck.ExpressionAttributeValues[':schedule'],paymentSchedule);
 assert.match(tx.TransactItems[0].ConditionCheck.ConditionExpression,/paymentSchedule = :schedule/);
 await assert.rejects(registerCheckout({db,table:'booking-staging',bookingId,
  checkout:{...checkout,amountPence:40249},reference:checkout.reference,paymentSchedule}),/schedule/);
});
