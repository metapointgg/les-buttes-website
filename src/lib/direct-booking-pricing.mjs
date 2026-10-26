// Pure pricing calculation over an already-published booking-master snapshot.
// Caller must separately establish the source, version, occupancy and live availability.
const iso=/^\d{4}-\d{2}-\d{2}$/;
function asDate(value){
 if(typeof value!=="string"||!iso.test(value))throw new Error("Date must use YYYY-MM-DD");
 const d=new Date(value+"T00:00:00Z");
 if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==value)throw new Error("Invalid date");
 return d;
}
function pennies(rate){
 if(typeof rate!=="string"||!/^\d{1,5}(?:\.\d{1,2})?$/.test(rate))throw new Error("Invalid published nightly rate");
 const [whole,fraction=""]=rate.split(".");
 const amount=Number(whole)*100+Number(fraction.padEnd(2,"0"));
 if(!Number.isSafeInteger(amount)||amount<=0)return (()=>{throw new Error("Invalid published nightly rate")})();
 return amount;
}
export function quotePublishedPricing({published,checkIn,checkOut,reservedNights}){
 if(!published||!Number.isSafeInteger(Number(published.version))||Number(published.version)<1||!published.value?.bands?.length)
  throw new Error("Published configuration required");
 if(!Array.isArray(reservedNights))throw new Error("Authoritative reserved-night results required");
 const start=asDate(checkIn),end=asDate(checkOut);
 const nights=(end-start)/86400000;
 if(!Number.isInteger(nights)||nights<1||nights>27)throw new Error("Stay must be 1–27 nights");
 const config=published.value;
 if(checkIn<config.seasonStart||checkOut>config.seasonEnd||Number(config.maxNights)<nights)
  throw new Error("Stay outside the published operating season");
 const blocked=new Set(reservedNights);
 const breakdown=[];
 let minStay=0,totalPence=0;
 for(let i=0;i<nights;i++){
  const day=new Date(start.getTime()+i*86400000).toISOString().slice(0,10);
  if(blocked.has(day))throw new Error("Selected stay includes unavailable nights");
  const band=config.bands.find(b=>day>=b.start&&day<b.end);
  if(!band)throw new Error("No published rate for "+day);
  const ratePence=pennies(band.nightlyGBP);
  const requirement=Number(band.minNights);
  if(!Number.isSafeInteger(requirement)||requirement<1)throw new Error("Invalid published minimum stay");
  minStay=Math.max(minStay,requirement);
  totalPence+=ratePence;
  breakdown.push({date:day,season:band.season,nightlyGBP:(ratePence/100).toFixed(2)});
 }
 if(nights<minStay)throw new Error("Minimum stay for these dates is "+minStay+" nights");
 return {unit:published.unit||config.unit,version:Number(published.version),checkIn,checkOut,nights,minStay,
  totalGBP:(totalPence/100).toFixed(2),currency:"GBP",breakdown,
  availabilitySource:"supplied-authoritative-reserved-nights",
  disclaimer:"Quote only; not a reservation or availability hold."};
}
