import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseDate,guernseyToday,DAY} from './rules.mjs';

function isoDate(value){
  if(!/^\d{8}$/.test(value))throw new Error('Only all-day YYYYMMDD Airbnb events are supported; timed events must be reviewed manually');
  const d=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
  if(!Number.isFinite(parseDate(d)))throw new Error('Invalid iCalendar event date');
  return d;
}
export function parseAirbnbCalendar(source){
  if(typeof source!=='string'||source.length>5_000_000)throw new Error('Missing or oversized calendar');
  // Unfold RFC 5545 content lines before parsing.
  const lines=source.replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'').split('\n');
  if(!lines.some(l=>l.trim()==='BEGIN:VCALENDAR'))throw new Error('Not an iCalendar file');
  let inEvent=false,fields=[],count=0;
  const ranges=[];
  for(const raw of lines){
    const line=raw.trimEnd();
    if(line==='BEGIN:VEVENT'){
      if(inEvent)throw new Error('Nested calendar event');
      inEvent=true;fields=[];continue;
    }
    if(line==='END:VEVENT'){
      if(!inEvent)throw new Error('Unexpected event end');
      count++;
      const dateValues=(key)=>fields.filter(l=>l.startsWith(key+':')||l.startsWith(key+';')).map(l=>l.slice(l.indexOf(':')+1));
      if(fields.some(l=>/^RRULE[;:]/.test(l)))throw new Error('Recurring events need manual review');
      if(!fields.some(l=>l==='STATUS:CANCELLED')){
        const starts=dateValues('DTSTART'),ends=dateValues('DTEND');
        if(starts.length!==1||ends.length!==1)throw new Error('Each event must have one start and one checkout date');
        const start=isoDate(starts[0]),end=isoDate(ends[0]);
        if(parseDate(end)<=parseDate(start))throw new Error('Checkout must be after check-in');
        if((parseDate(end)-parseDate(start))/DAY>366)throw new Error('Long calendar block needs manual review');
        ranges.push({start,end});
      }
      inEvent=false;fields=[];continue;
    }
    if(inEvent)fields.push(line);
  }
  if(inEvent)throw new Error('Unclosed calendar event');
  const blocked=new Set();
  for(const r of ranges){
    for(let day=parseDate(r.start);day<parseDate(r.end);day+=DAY){
      blocked.add(new Date(day).toISOString().slice(0,10));
    }
  }
  return {eventCount:count,blockedNights:[...blocked].sort()};
}
export function consolidateBlockedNights(days,{fromDate=guernseyToday(),maxBlock=99}={}){
  if(!Number.isFinite(parseDate(fromDate))||!Number.isInteger(maxBlock)||maxBlock<1||maxBlock>99)
    throw new Error('Invalid preview parameters');
  const dates=[...new Set(days)].filter(date=>date>=fromDate).sort();
  const result=[];
  let a=null,last=null,len=0;
  const add=()=>{
    if(a!==null&&last!==null)result.push({
      start:a,end:new Date(parseDate(last)+DAY).toISOString().slice(0,10),nights:len
    });
  };
  for(const date of dates){
    if(!Number.isFinite(parseDate(date)))throw new Error('Invalid blocked date');
    const continuous=last!==null&&parseDate(date)===parseDate(last)+DAY;
    if(!continuous||len>=maxBlock){add();a=date;len=1;}
    else len++;
    last=date;
  }
  add();return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [unit,filepath]=process.argv.slice(2);
  if(!['geranium','honeysuckle'].includes(unit)||!filepath){
    console.error('Usage: node preview-airbnb.mjs geranium|honeysuckle local-export.ics');
    process.exitCode=2;
  }else{
    try{
      const parsed=parseAirbnbCalendar(readFileSync(filepath,'utf8'));
      const groups=consolidateBlockedNights(parsed.blockedNights);
      console.log('Airbnb calendar preview (read-only): '+unit);
      console.log(parsed.eventCount+' events; '+parsed.blockedNights.length+' blocked nights in file; '+groups.length+' suggested block periods from today.');
      console.log('WARNING: Airbnb exports can include pending requests, preparation/availability restrictions and imported blocks, NOT just confirmed bookings.');
      console.log('VERIFY EACH PERIOD with the Airbnb host calendar and existing master bookings. No dates were changed or imported.');
      for(const g of groups)console.log([
        'node admin.mjs block',unit,g.start,g.end,'"Verified Airbnb calendar block"'
      ].join(' ')+'  # '+g.nights+' night(s)');
    }catch(e){console.error(e.message);process.exitCode=1;}
  }
}
