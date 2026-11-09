// Owner-approved staging configuration publication. Never exposed on production.
import {randomBytes} from 'node:crypto';
import {GetCommand} from '@aws-sdk/lib-dynamodb';
import {configKey,publishSetting,validateConfig} from './booking-settings.mjs';

export async function publishOwnerConfiguration({db,table,identity,kind,unit='all',value,expectedVersion,approved}={}){
 if(identity?.role!=='owner'||typeof identity.subject!=='string'||!identity.subject.trim())
   throw Error('Forbidden');
 if(!db?.send||!table||!table.toLowerCase().includes('staging'))
   throw Error('Staging configuration writer unavailable');
 if(approved!==true)throw Error('Explicit owner approval required');
 if(expectedVersion!==null&&(typeof expectedVersion!=='string'||!expectedVersion.length))
   throw Error('Invalid expected version');
 validateConfig({kind,unit,value});
 const version=new Date().toISOString()+'#'+randomBytes(8).toString('hex');
 return publishSetting(db,table,{kind,unit,value,version,expectedVersion,actor:identity.subject,approved:true});
}
export async function rollbackOwnerConfiguration({db,table,identity,kind,unit='all',historicalVersion,expectedVersion,approved}={}){
 if(identity?.role!=='owner'||!identity.subject)throw Error('Forbidden');
 if(typeof historicalVersion!=='string'||!historicalVersion.length)throw Error('Invalid historical version');
 if(!db?.send||!table||!table.toLowerCase().includes('staging'))throw Error('Staging configuration writer unavailable');
 const {PK}=configKey(kind,unit);
 const item=(await db.send(new GetCommand({TableName:table,Key:{PK,SK:'VERSION#'+historicalVersion},ConsistentRead:true}))).Item;
 if(!item||item.version!==historicalVersion||item.kind!==kind||item.unit!==unit)
   throw Error('Historical configuration not found');
 return publishOwnerConfiguration({db,table,identity,kind,unit,value:item.value,expectedVersion,approved});
}
