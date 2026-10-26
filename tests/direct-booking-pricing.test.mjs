import assert from "node:assert/strict";
import {quotePublishedPricing} from "../src/lib/direct-booking-pricing.mjs";
const value={unit:"geranium",year:2027,seasonStart:"2027-03-20",seasonEnd:"2027-10-02",maxNights:27,
 bands:[{season:"low",start:"2027-03-20",end:"2027-04-24",nightlyGBP:"105.00",minNights:3},
 {season:"shoulder",start:"2027-04-24",end:"2027-06-26",nightlyGBP:"115.00",minNights:5},
 {season:"peak",start:"2027-06-26",end:"2027-08-28",nightlyGBP:"155.00",minNights:7},
 {season:"shoulder",start:"2027-08-28",end:"2027-09-25",nightlyGBP:"115.00",minNights:5},
 {season:"low",start:"2027-09-25",end:"2027-10-02",nightlyGBP:"105.00",minNights:3}]};
const published={unit:"geranium",version:"3",value};
const quote=quotePublishedPricing({published,checkIn:"2027-03-20",checkOut:"2027-03-23",reservedNights:[]});
assert.equal(quote.totalGBP,"315.00");
assert.equal(quote.version,3);
assert.equal(quote.nights,3);
assert.throws(()=>quotePublishedPricing({published,checkIn:"2027-03-20",checkOut:"2027-03-23"}),/reserved-night/);
assert.throws(()=>quotePublishedPricing({published,checkIn:"2027-03-20",checkOut:"2027-03-23",reservedNights:["2027-03-21"]}),/unavailable/);
assert.throws(()=>quotePublishedPricing({published,checkIn:"2027-06-26",checkOut:"2027-06-29",reservedNights:[]}),/Minimum stay/);
assert.throws(()=>quotePublishedPricing({published,checkIn:"2027-10-01",checkOut:"2027-10-04",reservedNights:[]}),/operating season/);
const crossing=quotePublishedPricing({published,checkIn:"2027-04-22",checkOut:"2027-04-27",reservedNights:[]});
assert.equal(crossing.totalGBP,"565.00");
assert.equal(crossing.minStay,5);
console.log("Published pricing quotation guards passed");
