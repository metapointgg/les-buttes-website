export const bookingStatus = record=>String(record?.status??'UNKNOWN');
export const allowedAction=(record,action,nowSeconds=Math.floor(Date.now()/1000))=>{
 if(!record||record.source!=='direct')return false;
 if(action==='approve')return record.status==='REQUESTED'&&record.reservationStatus==='PENDING_REVIEW'&&Number(record.holdExpiresAt)>nowSeconds&&Number.isFinite(Number(record.quote?.totalGBP))&&Number(record.quote.totalGBP)>0;
 if(action==='decline')return record.status==='REQUESTED'&&record.reservationStatus==='PENDING_REVIEW'&&Number(record.holdExpiresAt)>nowSeconds;
 if(action==='cancel')return record.status==='CONFIRMED'&&record.reservationStatus==='CONFIRMED';
 return false;
};
export const safeStagingApi=value=>{
 try{
  const url=new URL(value);
  return url.protocol==='https:'&&/^[a-z0-9-]+\.execute-api\.eu-west-2\.amazonaws\.com$/.test(url.hostname)&&url.username===''&&url.password===''&&url.search===''&&url.hash==='' ? url.origin : null;
 }catch{return null;}
};
export const encodeCursor=cursor=>cursor?btoa(JSON.stringify(cursor)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):null;
export const reasonValid=value=>typeof value==='string'&&value.trim().length>=5&&value.length<=1000;
