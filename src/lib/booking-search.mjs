// Search/selection model. Quotes are accepted only with explicit published snapshot
// and authoritative availability input. No fallback to invented available dates.
import {quotePublishedPricing} from "./direct-booking-pricing.mjs";
export const COTTAGES=Object.freeze({
 geranium:{name:"Geranium",bedrooms:2,capacity:4},
 honeysuckle:{name:"Honeysuckle",bedrooms:3,capacity:6}
});
export function findBookingOptions({checkIn,checkOut,adults,children,rooms=0,snapshots}){
 const guests=Number(adults)+Number(children),beds=Number(rooms);
 if(!Number.isInteger(guests)||guests<1||!Number.isInteger(Number(adults))||Number(adults)<1||
 !Number.isInteger(Number(children))||Number(children)<0||!Number.isInteger(beds)||beds<0||beds>5)
  throw new Error("Enter valid guests and bedrooms");
 if(!snapshots||typeof snapshots!=="object")throw new Error("Published prices and availability have not been loaded");
 const options=[];
 for(const units of [["geranium"],["honeysuckle"],["geranium","honeysuckle"]]){
  const capacity=units.reduce((n,u)=>n+COTTAGES[u].capacity,0);
  const bedrooms=units.reduce((n,u)=>n+COTTAGES[u].bedrooms,0);
  if(guests>capacity||beds>bedrooms)continue;
  let totalPence=0;const breakdown=[];let unavailable=false;
  for(const unit of units){
   const snapshot=snapshots[unit];
   if(!snapshot?.published||!Array.isArray(snapshot?.reservedNights)){unavailable=true;break;}
   try{
    const quote=quotePublishedPricing({published:snapshot.published,checkIn,checkOut,reservedNights:snapshot.reservedNights});
    breakdown.push(quote);totalPence+=Math.round(Number(quote.totalGBP)*100);
   }catch{unavailable=true;break;}
  }
  if(!unavailable)options.push({units,capacity,bedrooms,totalGBP:(totalPence/100).toFixed(2),breakdown});
 }
 return options;
}
