// All amounts in integer pence; prices are not available until a complete rate table is configured.
// No fallback prices, taxes, discounts or extra charges are inferred.
const COTTAGES=['geranium','honeysuckle'];
function asPence(value){
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>10000)return null;
  const pence=Math.round(value*100);
  return Math.abs(pence/100-value)<0.0000001?pence:null;
}
export function quoteFor(units,nights,rates){
  if(!Array.isArray(units)||!units.length||units.some(unit=>!COTTAGES.includes(unit))
    ||!Array.isArray(nights)||!nights.length||!Array.isArray(rates?.periods)||!rates.periods.length)
    return {error:'Pricing is not configured',serverError:true};
  const breakdown=[];
  let totalPence=0;
  for(const unit of units){
    let unitTotalPence=0;
    for(const night of nights){
      // Multiple matching periods are ambiguous and must not silently override one another.
      const periods=rates.periods.filter(period=>period&&night>=period.start&&night<=period.end);
      if(periods.length!==1)return {error:'Pricing is incomplete or ambiguous',serverError:true};
      const price=asPence(periods[0][unit]);
      if(price===null)return {error:'Pricing is incomplete or invalid',serverError:true};
      totalPence+=price;unitTotalPence+=price;
    }
    breakdown.push({unit,amountGBP:(unitTotalPence/100).toFixed(2)});
  }
  return {currency:'GBP',totalGBP:(totalPence/100).toFixed(2),breakdown,nights:nights.length};
}
export function configuredQuote(units,nights){
  let rates;
  try{rates=JSON.parse(process.env.BOOKING_RATES_JSON||'{}');}
  catch{return {error:'Pricing is not configured',serverError:true};}
  if(rates.status!=='APPROVED_FOR_LIVE_BOOKINGS')return {error:'Nightly rates have not been approved',serverError:true};
  return quoteFor(units,nights,rates);
}
