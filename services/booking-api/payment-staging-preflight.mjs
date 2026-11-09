// LB-08: local, read-only payment staging configuration preflight.
// This deliberately does not contact AWS or SumUp or print secret values.
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const MERCHANT=/^[A-Z0-9]{6,20}$/;
export function validatePaymentStagingConfiguration(env={}){
 const failures=[];
 if(env.BOOKING_ENVIRONMENT!=='staging')failures.push('BOOKING_ENVIRONMENT must be staging');
 if(!TABLE.test(env.BOOKINGS_TABLE??''))failures.push('BOOKINGS_TABLE must name isolated booking staging table');
 if(env.PAYMENT_RECONCILIATION_ENABLED!=='false')failures.push('PAYMENT_RECONCILIATION_ENABLED must be false during preflight');
 if(env.PAYMENT_NOTIFICATIONS_ENABLED!=='false')failures.push('PAYMENT_NOTIFICATIONS_ENABLED must be false during preflight');
 if(!MERCHANT.test(env.SUMUP_MERCHANT_CODE??''))failures.push('SUMUP_MERCHANT_CODE invalid or absent');
 if(typeof env.SUMUP_API_KEY!=='string'||!env.SUMUP_API_KEY.startsWith('sup_sk_test_'))
  failures.push('A sandbox-only SumUp API key is required');
 if(typeof env.PAYMENT_TRIGGER_HMAC_SECRET!=='string'||env.PAYMENT_TRIGGER_HMAC_SECRET.length<32)
  failures.push('Private internal HMAC secret must be at least 32 characters');
 return {ready:failures.length===0,failures,
  note:'Configuration-only assessment; IAM, API connectivity, merchant eligibility and real DynamoDB semantics are not verified'};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 const result=validatePaymentStagingConfiguration(process.env);
 console.log(JSON.stringify(result,null,2));
 if(!result.ready)process.exitCode=1;
}
