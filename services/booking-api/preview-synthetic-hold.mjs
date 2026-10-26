// CLI only. Always dry-run by default; never exposed to website visitors.
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,GetCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {masterOccupied} from './master-occupied.mjs';
import {publishedPricingSnapshots} from './published-pricing-reader.mjs';
import {buildSyntheticHold,submitSyntheticHold} from './synthetic-hold.mjs';
const table=process.env.BOOKINGS_TABLE;
const args=process.argv.slice(2);
if(process.env.BOOKING_ENVIRONMENT!=='staging'||!/^les-buttes-booking-staging-BookingTable-[A-Za-z0-9]+$/.test(table??''))
 throw Error('Refusing anything other than the existing staging table');
if(args.length!==5&&args.length!==6)throw Error('Usage: node preview-synthetic-hold.mjs geranium|honeysuckle|both YYYY-MM-DD YYYY-MM-DD adults children [--execute]');
const [unit,start,end,adultString,childString,flag]=args;
if(flag&&flag!=='--execute')throw Error('Unrecognised option');
if(!/^(0|[1-9][0-9]*)$/.test(adultString)||!/^(0|[1-9][0-9]*)$/.test(childString))throw Error('Guests must be integers');
const client=DynamoDBDocumentClient.from(new DynamoDBClient({region:'eu-west-2'}));
const availability=await masterOccupied({db:{send:x=>client.send(new QueryCommand(x.input))},table});
const pricing=await publishedPricingSnapshots({db:{send:x=>client.send(new GetCommand(x))},table});
const input={availability,pricing,unit,start,end,adults:Number(adultString),children:Number(childString)};
const dry=buildSyntheticHold(input);
console.log(JSON.stringify({mode:flag==='--execute'?'STAGING_WRITE_REQUESTED':'DRY_RUN_ONLY',
 synthetic:true,guestEmail:'test@example.invalid',units:dry.meta.units,dates:{start,end},
 totalGBP:dry.quote.totalGBP,slotCount:dry.items.length-1,holdHours:24},null,2));
if(flag==='--execute'){
 if(process.env.CONFIRM_SYNTHETIC_HOLD!=='I_ACCEPT_STAGING_TABLE_WRITES')throw Error('Explicit CONFIRM_SYNTHETIC_HOLD required for staging write');
 const result=await submitSyntheticHold({db:{send:x=>client.send(new TransactWriteCommand(x))},table,...input});
 console.log(JSON.stringify({submitted:true,...result},null,2));
}
