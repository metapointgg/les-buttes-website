import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from './staging-owner-action-route-handler.mjs';
const original={...process.env};
const route='POST /admin/bookings/{bookingId}/actions/{action}';
const claims={sub:'synthetic-owner',token_use:'access',iss:'https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Wvo0I3cTa',client_id:'2mjmimjh7oc8h00d4nngrc1akj','cognito:groups':'lesbuttes-owner'};
const event={version:'2.0',routeKey:route,rawPath:'/admin/bookings/11111111-1111-4111-8111-111111111111/actions/approve',requestContext:{routeKey:route,http:{method:'POST'},authorizer:{jwt:{claims}}},body:JSON.stringify({approved:true,usePublishedQuote:true})};
test('deployed staging owner route rejects synthetic owner actions when writes are disabled',async()=>{
 const keys=['BOOKING_ENVIRONMENT','BOOKINGS_TABLE','MANAGEMENT_COGNITO_ISSUER','MANAGEMENT_COGNITO_CLIENT_ID','MANAGEMENT_WRITES_ENABLED','MANAGEMENT_APPROVAL_ENABLED'];
 const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{BOOKING_ENVIRONMENT:'staging',BOOKINGS_TABLE:'les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK',MANAGEMENT_COGNITO_ISSUER:claims.iss,MANAGEMENT_COGNITO_CLIENT_ID:claims.client_id,MANAGEMENT_WRITES_ENABLED:'false',MANAGEMENT_APPROVAL_ENABLED:'false'});
 try{
  const noClaims=structuredClone(event);delete noClaims.requestContext.authorizer;
  assert.equal((await handler(noClaims)).statusCode,403);
  const viewer=structuredClone(event);viewer.requestContext.authorizer.jwt.claims['cognito:groups']='lesbuttes-viewer';
  assert.equal((await handler(viewer)).statusCode,403);
  const owner=await handler(event);
  assert.equal(owner.statusCode,503);
  assert.deepEqual(JSON.parse(owner.body),{error:'Management writes disabled'});
 }finally{for(const k of keys){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}}
});
