// Two atomic hourly quotas stored alongside synthetic holds in the staging booking table.
// Never expose or store a raw source address, name, email, or token.
import {createHmac} from 'node:crypto';
export function syntheticQuotaItems({table,ip,secret,nowEpoch=Math.floor(Date.now()/1000)}){
 if(!/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(table??''))throw Error('Staging table required');
 if(typeof ip!=='string'||ip.length<3||ip.length>128||!(/^[0-9a-fA-F:.]+$/.test(ip)))throw Error('Source address unavailable');
 if(typeof secret!=='string'||secret.length<10)throw Error('Quota secret missing');
 if(!Number.isSafeInteger(nowEpoch)||nowEpoch<=0)throw Error('Invalid clock');
 const hour=Math.floor(nowEpoch/3600);
 const source=createHmac('sha256',secret).update(ip).digest('hex');
 const expiresAt=(hour+2)*3600;
 return [['GLOBAL',20],['SOURCE#'+source,3]].map(([scope,limit])=>({
  Update:{
   TableName:table,
   Key:{PK:'STAGING_QUOTA#'+hour,SK:scope},
   UpdateExpression:'SET expiresAt = :expiry ADD #count :one',
   ConditionExpression:'attribute_not_exists(#count) OR #count < :limit',
   ExpressionAttributeNames:{'#count':'requestCount'},
   ExpressionAttributeValues:{':expiry':expiresAt,':one':1,':limit':limit}
  }
 }));
}
