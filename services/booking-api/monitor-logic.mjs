import {createHash} from 'node:crypto';
import {consolidateBlockedNights} from './preview-airbnb.mjs';
import {parseDate} from './rules.mjs';

const MAX_ISSUES_IN_EMAIL=50;
const categories=['missingInMaster','missingFromAirbnb','unclassified','otherOnlyMaster'];

export function validateAirbnbUrl(value,unit){
  const expected={geranium:'17564897',honeysuckle:'15695088'}[unit];
  if(!expected||typeof value!=='string')throw Error('Invalid Airbnb calendar configuration');
  let u;
  try{u=new URL(value);}catch{throw Error('Invalid Airbnb calendar configuration');}
  if(u.protocol!=='https:'||u.hostname!=='www.airbnb.com'||u.port||u.username||u.password||u.hash||
     u.pathname!=='/calendar/ical/'+expected+'.ics'||
     [...u.searchParams.keys()].some(key=>key!=='t')||
     u.searchParams.getAll('t').length!==1||!/^[a-zA-Z0-9]{20,128}$/.test(u.searchParams.get('t')||'')){
    throw Error('Airbnb calendar URL must be a private HTTPS export for the correct cottage');
  }
  return u.href;
}
export function monitoredFeedNights(nights,from,to){
  if(!Number.isFinite(parseDate(from))||!Number.isFinite(parseDate(to))||to<=from)throw Error('Invalid monitoring window');
  if(!Array.isArray(nights))throw Error('Invalid parsed Airbnb calendar');
  return [...new Set(nights.filter(day=>day>=from&&day<to))].sort();
}
export function fingerprint(value){
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function assessMonitorRun(currentNights,previousState,comparison,{from,to}){
  const current=monitoredFeedNights(currentNights,from,to);
  const previous=previousState?.blockedNights;
  if(previous!==undefined&&(!Array.isArray(previous)||previous.some(x=>typeof x!=='string')))
    throw Error('Monitoring checkpoint invalid; manual review required');
  const prev=new Set(previous??[]);
  const curr=new Set(current);
  const added=previous===undefined?[]:current.filter(d=>!prev.has(d));
  const removed=previous===undefined?[]:previous.filter(d=>d>=from&&d<to&&!curr.has(d)).sort();
  // All date comparisons exclude direct reservations blocked within Airbnb: these are expected.
  const exceptions=Object.fromEntries(categories.map(k=>[k,comparison[k]??[]]));
  const issues=categories.some(k=>exceptions[k].length>0);
  const issueFingerprint=fingerprint(exceptions);
  const changedIssues=issues&&issueFingerprint!==previousState?.issueFingerprint;
  const shouldAlert=added.length>0||removed.length>0||changedIssues;
  return {
    current,
    added:consolidateBlockedNights(added,{fromDate:from}),
    removed:consolidateBlockedNights(removed,{fromDate:from}),
    exceptions,
    issueFingerprint,
    issues,
    shouldAlert,
    isBaseline:previous===undefined
  };
}
export function monitorMessage(unit,report,from,to){
  const lines=[
    'Les Buttes Airbnb calendar review — '+unit,
    'Window: '+from+' to '+to+' (checkout exclusive)',
    'Read-only alert: NO reservations have been created, cancelled or amended.',
    'Airbnb calendar exports include manual blocks and restrictions, not only confirmed bookings.',
    '',
  ];
  const add=(title,spans)=>{
    lines.push(title+':');
    if(!spans.length){lines.push('  None');return;}
    for(const s of spans.slice(0,MAX_ISSUES_IN_EMAIL))lines.push('  '+s.start+' -> '+s.end+' ('+s.nights+' nights)');
    if(spans.length>MAX_ISSUES_IN_EMAIL)lines.push('  More periods omitted; run manual reconciliation');
  };
  add('NEW dates blocked in the Airbnb export since previous check',report.added);
  add('DATES REMOVED from the Airbnb export since previous check',report.removed);
  add('Airbnb export blocks MISSING in staging master — verify before adding',report.exceptions.missingInMaster);
  add('Airbnb-confirmed master blocks MISSING from Airbnb export — never auto-cancel',report.exceptions.missingFromAirbnb);
  add('UNCLASSIFIED staging master blocks',report.exceptions.unclassified);
  add('Other-source (direct/owner) master dates missing from Airbnb export — check manual Airbnb block or outbound calendar sync',report.exceptions.otherOnlyMaster);
  lines.push('','Check the Airbnb host calendar and the staging master manually. Export sync can lag hours.');
  return lines.join('\n');
}
