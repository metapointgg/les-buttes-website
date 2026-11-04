import {parseDate,guernseyToday} from './rules.mjs';
import {slotBlocksAvailability} from './occupancy.mjs';
import {consolidateBlockedNights} from './preview-airbnb.mjs';

// A *read-only* report. Airbnb feeds represent blocked days, not necessarily
// confirmed reservations; a disappeared block is never grounds for cancellation.
export function compareAirbnbBlocks(feedNights,slotRows,metadataById,{from=guernseyToday(),to,now=Math.floor(Date.now()/1000)}={}){
  if(!Number.isFinite(parseDate(from))||!Number.isFinite(parseDate(to))||to<=from)
    throw Error('Specify valid comparison dates: YYYY-MM-DD FROM TO_EXCLUSIVE');
  if(!(metadataById instanceof Map))throw Error('Expected a Map of master booking metadata');
  const inWindow=(d)=>d>=from&&d<to;
  const feed=new Set(feedNights.filter(inWindow));
  const master=new Map();
  for(const row of slotRows){
    const night=typeof row.SK==='string'&&row.SK.startsWith('DATE#')?row.SK.slice(5):null;
    if(!night||!inWindow(night)||!slotBlocksAvailability(row,now))continue;
    const meta=metadataById.get(row.id);
    const source=meta?.source??'unclassified';
    master.set(night,{source,status:meta?.reservationStatus??'UNVERIFIED',id:row.id});
  }
  const missingInMaster=[...feed].filter(day=>!master.has(day)).sort();
  const missingFromAirbnb=[...master].filter(([day,item])=>item.source==='airbnb'&&!feed.has(day)).map(([day])=>day).sort();
  const unclassified=[...master].filter(([,item])=>item.source==='unclassified').map(([day])=>day).sort();
  const otherOnAirbnb=[...master].filter(([day,item])=>item.source!=='airbnb'&&item.source!=='unclassified'&&feed.has(day)).map(([day])=>day).sort();
  const otherOnlyMaster=[...master].filter(([day,item])=>item.source!=='airbnb'&&item.source!=='unclassified'&&!feed.has(day)).map(([day])=>day).sort();
  const alignedAirbnb=[...master].filter(([day,item])=>item.source==='airbnb'&&feed.has(day)).map(([day])=>day).sort();
  const spans=days=>consolidateBlockedNights(days,{fromDate:from});
  return {
    feedNightCount:feed.size,masterNightCount:master.size,
    alignedAirbnb:spans(alignedAirbnb),
    missingInMaster:spans(missingInMaster),
    missingFromAirbnb:spans(missingFromAirbnb),
    unclassified:spans(unclassified),
    otherOnAirbnb:spans(otherOnAirbnb),
    otherOnlyMaster:spans(otherOnlyMaster)
  };
}
