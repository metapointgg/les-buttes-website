// Read-only, allowlisted published-price snapshots from the staging booking master.
// No drafts, guest details, historical records or management credentials are exposed.
export async function publishedPricingSnapshots({db,table}){
 if(!/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(table||''))throw Error('staging table required');
 const result={mode:'STAGING_PUBLISHED_PRICING_READ_ONLY',capturedAt:new Date().toISOString(),cottages:{}};
 for(const unit of ['geranium','honeysuckle']){
  const response=await db.send({TableName:table,Key:{PK:'CONFIG#pricing#'+unit,SK:'CURRENT'},ConsistentRead:true});
  const item=response?.Item;
  if(!item||!Number.isInteger(Number(item.version))||Number(item.version)<1||item.unit!==unit)throw Error('Missing published configuration for '+unit);
  const v=item.value;
  if(v?.unit!==unit||Number(v?.year)!==2027||v.seasonStart!=='2027-03-20'||v.seasonEnd!=='2027-10-02'||Number(v.maxNights)!==27||!Array.isArray(v.bands)||v.bands.length!==5)throw Error('Invalid published configuration');
  const expected=['low','shoulder','peak','shoulder','low'];let boundary=v.seasonStart;
  const bands=v.bands.map((x,i)=>{
   if(x.season!==expected[i]||x.start!==boundary||typeof x.end!=='string'||x.end<=x.start||x.end>v.seasonEnd||Number(x.minNights)!==({low:3,shoulder:5,peak:7})[x.season]||!/^\d+(?:\.\d{1,2})?$/.test(String(x.nightlyGBP))||Number(x.nightlyGBP)<=0)throw Error('Invalid published band');
   boundary=x.end;
   return {season:x.season,start:x.start,end:x.end,nightlyGBP:Number(x.nightlyGBP).toFixed(2),minNights:Number(x.minNights)};
  });
  if(boundary!==v.seasonEnd)throw Error('Published pricing does not cover season');
  result.cottages[unit]={unit,version:Number(item.version),publishedAt:item.publishedAt||null,value:{unit,year:2027,seasonStart:v.seasonStart,seasonEnd:v.seasonEnd,maxNights:27,bands}};
 }
 return result;
}
