import {QueryCommand} from '@aws-sdk/lib-dynamodb';
// Read-only owner report from authoritative booking records. No scans, no
// invented payment amounts, and no provider assertions from the browser.
export async function loadProductionBalanceReport({db,table,now=new Date().toISOString().slice(0,10)}={}){
 if(!db?.send||typeof table!=='string'||!table.startsWith('les-buttes-booking-production-data-BookingTable-'))
  throw Error('Production balance report unavailable');
 const rows=[];let cursor,pages=0;
 do{
  const response=await db.send(new QueryCommand({TableName:table,
   IndexName:'BookingRequestsIndex',KeyConditionExpression:'GSI1PK = :pk',
   ExpressionAttributeValues:{':pk':'BOOKING_REQUESTS'},Limit:100,ExclusiveStartKey:cursor}));
  for(const item of response.Items??[]){
   if(item.source!=='direct'||item.synthetic===true||item.archivedForProductionLaunch===true||
      !['CONFIRMED','APPROVED_AWAITING_PAYMENT'].includes(item.status))continue;
   const totalPence=Math.round(Number(item.approvedAmountGBP??item.quote?.totalGBP)*100);
   if(!Number.isSafeInteger(totalPence)||totalPence<1)continue;
   const receivedPence=Number.isSafeInteger(item.paidAmountPence)?item.paidAmountPence:0;
   const outstandingPence=totalPence-receivedPence;
   if(outstandingPence<0)throw Error('Booking payment ledger exceeds booking total');
   if(outstandingPence===0&&item.status==='CONFIRMED')continue;
   const dueDate=item.status==='APPROVED_AWAITING_PAYMENT'?null:item.paymentSchedule?.dueDate??null;
   rows.push({bookingId:item.id,guestName:item.guestName??'',guestEmail:item.guestEmail??'',
    cottages:item.units??[],arrival:item.start,departure:item.end,status:item.status,
    paymentStatus:item.paymentStatus??'AWAITING_INITIAL_PAYMENT',
    totalPence,receivedPence,outstandingPence,dueDate,
    overdue:!!dueDate&&dueDate<now});
  }
  cursor=response.LastEvaluatedKey;
  if(++pages>20)throw Error('Balance report exceeds page safety limit');
 }while(cursor);
 rows.sort((a,b)=>(a.dueDate??a.arrival??'9999').localeCompare(b.dueDate??b.arrival??'9999'));
 return {generatedAt:new Date().toISOString(),
  totalOwedPence:rows.reduce((v,row)=>v+row.outstandingPence,0),
  overduePence:rows.filter(row=>row.overdue).reduce((v,row)=>v+row.outstandingPence,0),
  items:rows};
}
