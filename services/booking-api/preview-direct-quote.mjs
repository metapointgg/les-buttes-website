// Host-only, read-only, local preview. Does not access AWS or email anybody.
// Usage: node preview-direct-quote.mjs both 2027-08-28 2027-09-04
// Usage: node preview-direct-quote.mjs both 2027-08-28 2027-09-04 --geranium 1450 --honeysuckle 1650
import {previewOwnerQuote} from './owner-quote.mjs';

const [unit,start,end,...extra]=process.argv.slice(2);
const help='Usage: node services/booking-api/preview-direct-quote.mjs geranium|honeysuckle|both YYYY-MM-DD CHECKOUT_YYYY-MM-DD [--geranium AMOUNT_GBP] [--honeysuckle AMOUNT_GBP]';
try{
  if(!unit||!start||!end||extra.length%2!==0)throw Error(help);
  const offers={};
  for(let i=0;i<extra.length;i+=2){
    const flag=extra[i],value=extra[i+1];
    if(!['--geranium','--honeysuckle'].includes(flag)||!/^\d+(?:\.\d{1,2})?$/.test(value))
      throw Error(help);
    const selected=flag.slice(2);
    if(Object.hasOwn(offers,selected))throw Error('Duplicate manual amount override for '+selected);
    offers[selected]=Number(value);
  }
  const q=previewOwnerQuote({unit,start,end,offers});
  console.log('\nLES BUTTES OWNER-ONLY DIRECT QUOTE PREVIEW (not guest quote, not booking availability)');
  console.log('Cottage(s): '+unit+'; '+start+' to '+end+' (checkout excluded); '+q.nights+' nights');
  for(const item of q.items){
    console.log('  '+item.unit+': Airbnb £'+item.airbnbComparableGBP+
      '; suggested rounded direct £'+item.indicativeRoundedOfferGBP+
      '; '+(item.selectedOfferIsManualOverride?'MANUALLY CHOSEN':'indicative')+
      ' £'+item.selectedOfferGBP+
      '; guest saving £'+item.guestSavingsGBP+' ('+item.guestSavingPercent+'%)');
  }
  console.log('Combined: Airbnb £'+q.total.airbnbComparableGBP+
    ' -> indicative/selected direct £'+q.total.indicativeSelectedDirectGBP+
    ', guest saving £'+q.total.guestSavingsGBP+
    ' ('+q.total.guestSavingPercent+'%)');
  console.log('Illustrative host net: Airbnb £'+q.total.assumedAirbnbHostNetGBP+
    ' vs direct £'+q.total.assumedDirectHostNetGBP+
    ', difference £'+q.total.assumedHostNetDifferenceGBP);
  console.log('Proposed (NOT approved) seasonal minimum: '+q.provisionalMinimumStayNights+
    ' nights; meets draft minimum: '+q.provisionalMinimumStayMet);
  for(const note of q.notes)console.log('NOTICE: '+note);
  console.log('No AWS calls, availability checks, booking writes, payment requests or guest communications performed.');
}catch(err){console.error(err.message);process.exitCode=1;}
