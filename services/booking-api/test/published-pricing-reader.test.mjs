import test from 'node:test';
import assert from 'node:assert/strict';
import {publishedPricingSnapshots} from '../published-pricing-reader.mjs';
const table='les-buttes-booking-staging-BookingTable-RXRKLOG7NOXK';
function item(unit){return {unit,version:unit==='geranium'?3:1,publishedAt:'2026-10-26T08:32:50Z',value:{unit,year:2027,seasonStart:'2027-03-20',seasonEnd:'2027-10-02',maxNights:27,bands:[
{season:'low',start:'2027-03-20',end:'2027-04-24',nightlyGBP:'105.00',minNights:3},
{season:'shoulder',start:'2027-04-24',end:'2027-06-26',nightlyGBP:'115.00',minNights:5},
{season:'peak',start:'2027-06-26',end:'2027-08-28',nightlyGBP:'155.00',minNights:7},
{season:'shoulder',start:'2027-08-28',end:'2027-09-25',nightlyGBP:'115.00',minNights:5},
{season:'low',start:'2027-09-25',end:'2027-10-02',nightlyGBP:'105.00',minNights:3}
]}};}
test('published versioned prices exposed without drafts or staff fields',async()=>{
 const db={send:async input=>({Item:{...item(input.Key.PK.split('#').at(-1)),updatedBy:'private-manager',secret:'private'}})};
 const result=await publishedPricingSnapshots({db,table});
 assert.equal(result.cottages.geranium.version,3);
 assert.equal(result.cottages.honeysuckle.version,1);
 assert.equal(result.cottages.geranium.value.bands[0].nightlyGBP,'105.00');
 assert.equal(JSON.stringify(result).includes('private-manager'),false);
});
test('missing or malformed published prices fail closed',async()=>{
 await assert.rejects(publishedPricingSnapshots({db:{send:async()=>({})},table}),/Missing published/);
 await assert.rejects(publishedPricingSnapshots({db:{send:async()=>({Item:item('geranium')})},table:'other-table'}),/staging table/);
 const bad=item('geranium');bad.value.bands[0].end='2027-04-25';
 await assert.rejects(publishedPricingSnapshots({db:{send:async()=>({Item:bad})},table}),/Invalid published band/);
});
