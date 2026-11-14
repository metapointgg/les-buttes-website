// Bind guest acknowledgement to the exact quoted instalments, not a mutable
// global setting. Older full-payment clients remain compatible only when the
// authoritative policy is still the unpublished 100% default.
export function validatePaymentAcceptance({acceptance,schedule,policyVersion}={}){
 if(!schedule||!Number.isSafeInteger(schedule.totalPence)||
    !Number.isSafeInteger(schedule.dueNowPence)||
    !Number.isSafeInteger(schedule.balancePence)||
    schedule.dueNowPence+schedule.balancePence!==schedule.totalPence)
  throw Error('Authoritative payment schedule unavailable');
 if(acceptance==null&&policyVersion===null&&schedule.balancePence===0)
  return {legacyFullPayment:true};
 if(!acceptance||typeof acceptance!=='object'||Array.isArray(acceptance)||
    !Object.hasOwn(acceptance,'policyVersion')||
    !Object.hasOwn(acceptance,'totalPence')||
    !Object.hasOwn(acceptance,'dueNowPence')||
    !Object.hasOwn(acceptance,'balancePence')||
    !Object.hasOwn(acceptance,'dueDate')||
    acceptance.policyVersion!==policyVersion||
    acceptance.totalPence!==schedule.totalPence||
    acceptance.dueNowPence!==schedule.dueNowPence||
    acceptance.balancePence!==schedule.balancePence||
    acceptance.dueDate!==schedule.dueDate)
  throw Error('Payment terms changed; refresh quotation before booking');
 return {legacyFullPayment:false};
}
