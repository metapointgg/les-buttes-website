// Metadata for owner-negotiated direct reservation price (not a payment confirmation).
export function agreedDirectQuote(record,pairs,{capturedAt=new Date().toISOString()}={}){
  if(!record||record.status!=='BLOCKED'||record.source!=='direct'||record.reservationStatus!=='RESERVED'){
    throw Error('Only an existing direct / RESERVED manual block may receive an agreed price');
  }
  const units=record.units;
  if(!Array.isArray(units)||!units.length||units.some(u=>!['geranium','honeysuckle'].includes(u))||
     new Set(units).size!==units.length)throw Error('Reservation has invalid cottage metadata');
  if(!Array.isArray(pairs)||pairs.length!==units.length)throw Error('Supply one UNIT=AMOUNT_GBP value per cottage');
  const amounts=new Map();
  for(const pair of pairs){
    if(typeof pair!=='string')throw Error('Use UNIT=AMOUNT_GBP format');
    const match=/^(geranium|honeysuckle)=(\d+(?:\.\d{1,2})?)$/.exec(pair);
    if(!match||amounts.has(match[1])||!units.includes(match[1]))throw Error('Invalid, duplicate, or unexpected cottage amount');
    const pence=Math.round(Number(match[2])*100);
    if(pence<=0||!Number.isSafeInteger(pence)||pence>99_999_900)throw Error('Cottage amount must be positive and within supported GBP range');
    amounts.set(match[1],pence);
  }
  const perCottage=units.map(unit=>{
    if(!amounts.has(unit))throw Error('Missing amount for '+unit);
    return {unit,amountGBP:(amounts.get(unit)/100).toFixed(2)};
  });
  const total=[...amounts.values()].reduce((a,b)=>a+b,0);
  if(!Number.isSafeInteger(total))throw Error('Total amount out of range');
  return {
    currency:'GBP',perCottage,totalGBP:(total/100).toFixed(2),
    capturedAt,priceSource:'Owner-negotiated direct guest offer',
    paymentVerified:false,bookingConfirmed:false
  };
}
