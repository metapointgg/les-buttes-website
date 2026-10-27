// Safety checks for the future private executor; never performs a DynamoDB write.
// The dry-run planner is deliberately not an executable booking API.
const TABLE=/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/;
const TEST_TABLE=/^les-buttes-booking-transaction-test-SyntheticTransactionTable-[A-Za-z0-9]+$/;
const allowed=table=>TABLE.test(table??'') ||
 (process.env.BOOKING_TRANSACTION_ISOLATED_TEST==='true' && TEST_TABLE.test(table??'') &&
  process.env.SYNTHETIC_TRANSACTION_TABLE===table);
export function validatePrivateTransactionPlan(plan,table){
 if(!allowed(table)||plan?.mode!=='DRY_RUN_ONLY')throw Error('Staging-only dry run required');
 const items=plan.transactWrite?.TransactItems;
 if(!Array.isArray(items)||items.length<4||items.length>100)throw Error('Unexpected transaction size');
 const puts=items.map(x=>x?.Put);
 if(puts.some(x=>!x||x.TableName!==table||x.ConditionExpression===undefined))
  throw Error('All records must be conditional staging writes');
 const pk=puts.map(x=>x.Item?.PK);
 if(!pk[0]?.startsWith('BOOKING#')||!pk[1]?.startsWith('GUEST#')||
    !pk[2]?.startsWith('IDEMPOTENCY#')||pk.slice(3).some(x=>!/^UNIT#(geranium|honeysuckle)$/.test(x??'')))
  throw Error('Unexpected transaction record types');
 if(puts[0].Item.synthetic!==false||puts[0].Item.status!=='REQUESTED'||
    puts[0].Item.id!==plan.reference||plan.transactWrite.ClientRequestToken!==plan.reference)
  throw Error('Booking identity mismatch');
 if(puts[0].Item.guestEmail||puts[0].Item.guestName||puts[0].Item.notes||
    !puts[1].Item.ciphertext||puts[1].Item.keyType!=='AWS_KMS')
  throw Error('Guest contact must be encrypted separately');
 if(puts.length-3!==plan.slotCount||puts.slice(3).some(p=>p.Item?.id!==plan.reference ||
   !p.Item.SK?.startsWith('DATE#')||!p.ConditionExpression.includes('attribute_not_exists(PK)')))
  throw Error('Date holds must use conditional booking-owned keys');
 if(puts[2].ConditionExpression!=='attribute_not_exists(PK)')
  throw Error('Idempotency record must be unique');
 // Do not infer transaction success from a snapshot; only a real DynamoDB commit can prove it.
 return {mode:'DRY_RUN_ONLY',reference:plan.reference,slotCount:plan.slotCount,
  recordCount:items.length,quotedGBP:plan.totalGBP};
}
export function classifyPrivateWriteFailure(error){
 // Never echo errors, transaction data, keys, guest fields or AWS diagnostic payloads.
 const code=error?.name??error?.Code??'';
 if(code==='TransactionCanceledException'||code==='ConditionalCheckFailedException')
  return {status:409,error:'Request conflicts with an existing reservation or duplicate submission'};
 return {status:503,error:'Booking request could not be processed'};
}
