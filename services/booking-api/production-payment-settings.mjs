// Owner-controlled global payment policy. An absent record means the existing
// 100% upfront behaviour. No production configuration is silently defaulted to 50%.
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {randomBytes} from 'node:crypto';
import {DEFAULT_PAYMENT_POLICY,validatePaymentPolicy} from './booking-payment-policy.mjs';
import {publishSetting} from './booking-settings.mjs';

export const PAYMENT_CONFIG_KEY={PK:'CONFIG#payments#all',SK:'CURRENT'};
export async function readProductionPaymentSettings({db,table}={}){
 if(!db?.send||!table)throw Error('Payment settings unavailable');
 const {Item:record}=await db.send(new GetCommand({TableName:table,
  Key:PAYMENT_CONFIG_KEY,ConsistentRead:true}));
 if(!record)return {version:null,value:{...DEFAULT_PAYMENT_POLICY},isDefault:true};
 validatePaymentPolicy(record.value);
 return {version:record.version,value:record.value,isDefault:false};
}
export async function publishProductionPaymentSettings({db,table,identity,value,expectedVersion,
 approved}={}){
 if(identity?.role!=='owner'||!identity.subject?.trim()||approved!==true)
  throw Error('Explicit owner approval required');
 if(typeof table!=='string'||!/^les-buttes-booking-production-data-BookingTable-[A-Za-z0-9]+$/.test(table))
  throw Error('Production payment settings unavailable');
 validatePaymentPolicy(value);
 if(expectedVersion!==null&&typeof expectedVersion!=='string')
  throw Error('Expected version required for an existing policy');
 const current=await readProductionPaymentSettings({db,table});
 if(current.version!==expectedVersion)throw Error('Payment policy changed; refresh before saving');
 const version=new Date().toISOString()+'#'+randomBytes(8).toString('hex');
 return publishSetting(db,table,{kind:'payments',unit:'all',value,version,expectedVersion,
  actor:identity.subject,approved:true});
}
