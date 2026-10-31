// Structured metadata is independent of the occupancy state ('BLOCKED') in DynamoDB.
// Classification updates never create, delete, or change any nightly slot.
const statuses={
  airbnb:new Set(['CONFIRMED']),
  direct:new Set(['RESERVED','CONFIRMED']),
  owner:new Set(['BLOCKED']),
  'winter-let':new Set(['CONFIRMED']),
  maintenance:new Set(['BLOCKED'])
};
export function validClassification(source,reservationStatus){
  return Object.hasOwn(statuses,source)&&statuses[source].has(reservationStatus);
}
export function normalizeExternalReference(value){
  if(value===undefined||value===null||value==='-')return undefined;
  if(typeof value!=='string'||value.trim().length<3||value.trim().length>120||/[\r\n\t]/.test(value))
    throw Error('External reference must be 3-120 characters without control characters (or use - if not known)');
  return value.trim();
}
export function classificationForRecord(record){
  if(!record||record.status!=='BLOCKED')throw Error('Only existing manual reservation blocks can be classified');
  return {
    source:record.source||'unclassified',
    reservationStatus:record.reservationStatus||'UNVERIFIED'
  };
}
