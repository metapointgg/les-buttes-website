// Read-only management query service for the ONE authoritative BOOKINGS_TABLE.
// No browser credentials or publicly accessible admin routes are defined here.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {readSetting,listSettingVersions,configKey} from './booking-settings.mjs';

export function bookingAdminReader({db,table,authorise,bookingIndex=null}){
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
      // Never scan the master: booking list requires a dedicated GSI on the SAME table.
      if(!bookingIndex)throw Error('Booking list index not configured');
      if(cursor!==null&&(!cursor||typeof cursor!=='object'||typeof cursor.PK!=='string'||typeof cursor.SK!=='string'))throw Error('Invalid cursor');
      const result=await db.send(new QueryCommand({
        TableName:table,IndexName:bookingIndex,
        KeyConditionExpression:'GSI1PK = :requests',
        ExpressionAttributeValues:{':requests':'BOOKING_REQUESTS'},
        ScanIndexForward:false,Limit:limit,
        ...(cursor?{ExclusiveStartKey:cursor}:{})
      }));
      return {items:result.Items??[],nextCursor:result.LastEvaluatedKey??null};
    }
  };
}
export function createReadOnlyAdminReader({table=process.env.BOOKINGS_TABLE,bookingIndex=process.env.BOOKING_REQUESTS_INDEX,authorise}={}){
  if(!table)throw Error('BOOKINGS_TABLE missing');
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({}),{marshallOptions:{removeUndefinedValues:true}});
  return bookingAdminReader({db,table,authorise,bookingIndex});
}
