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

// UI role is advisory; API Gateway must independently validate the signed JWT.
// Never show owner controls for a token issued to the isolated viewer-only client.
export function managementRoleFromAccessToken(token,{now=Date.now()}={}){
 try{
  if(typeof token!=='string'||token.length>12000||token.split('.').length!==3)return 'viewer';
  const claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
  if(claims?.token_use!=='access'||
     claims.iss!=='https://cognito-idp.eu-west-2.amazonaws.com/eu-west-2_Wvo0I3cTa'||
     claims.client_id!=='2mjmimjh7oc8h00d4nngrc1akj'||
     !Number.isFinite(claims.exp)||claims.exp<=Math.floor(now/1000)+15)return 'viewer';
  const groups=claims['cognito:groups'];
  return Array.isArray(groups)&&groups.includes('lesbuttes-owner')?'owner':'viewer';
 }catch{return 'viewer';}
}
