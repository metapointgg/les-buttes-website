// Read-only management query service for the ONE authoritative BOOKINGS_TABLE.
// No browser credentials or publicly accessible admin routes are defined here.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {readSetting,listSettingVersions,configKey} from './booking-settings.mjs';

export function bookingAdminReader({db,table,authorise}){
  if(!db||!table||typeof authorise!=='function')throw Error('Admin reader requires DB, table and authentication');
  const requireAdmin=async(context)=>{
    const identity=await authorise(context);
    if(!identity||!['owner','admin','viewer'].includes(identity.role))throw Error('Unauthorised');
    return identity;
  };
  return {
    async getConfig(context,kind,unit='all'){
      await requireAdmin(context);
      configKey(kind,unit);
      return readSetting(db,table,kind,unit);
    },
    async getConfigHistory(context,kind,unit='all'){
      await requireAdmin(context);
      return listSettingVersions(db,table,kind,unit);
    },
    async getBooking(context,id){
      await requireAdmin(context);
      if(!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(id))throw Error('Invalid reference');
      const result=await db.send(new GetCommand({TableName:table,Key:{PK:'BOOKING#'+id,SK:'META'},ConsistentRead:true}));
      return result.Item??null;
    },
    async listBookings(context,{limit=30,cursor=null}={}){
      await requireAdmin(context);
      if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid page size');
      // A production list view should have a dedicated sparse GSI for request timestamp.
      // This bounded query is for a single partition only; never scan the whole master.
      if(cursor)throw Error('Pagination cursor not supported without booking request index');
      return {items:[],nextCursor:null,indexRequired:true};
    }
  };
}
export function createReadOnlyAdminReader({table=process.env.BOOKINGS_TABLE,authorise}={}){
  if(!table)throw Error('BOOKINGS_TABLE missing');
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
  return bookingAdminReader({db,table,authorise});
}
