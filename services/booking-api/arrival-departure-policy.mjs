const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;

export function validateArrivalDeparturePolicy(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
   value.timezone!=='Europe/Guernsey'||!TIME.test(value.checkInLocalTime??'')||
   !TIME.test(value.checkOutLocalTime??'')||
   (value.testOnly!==undefined&&value.testOnly!==true))
  throw Error('Invalid arrival and departure policy');
 return true;
}

const parts=(instant)=>Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
 timeZone:'Europe/Guernsey',year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
}).formatToParts(instant).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));

export function guernseyLocalInstant(date,time){
 if(!DATE.test(date??'')||!TIME.test(time??''))throw Error('Invalid local arrival time');
 const [year,month,day]=date.split('-').map(Number),[hour,minute]=time.split(':').map(Number);
 const wanted=Date.UTC(year,month-1,day,hour,minute,0),probe=new Date(wanted);
 const first=parts(probe);
 const represented=Date.UTC(Number(first.year),Number(first.month)-1,Number(first.day),
  Number(first.hour),Number(first.minute),Number(first.second));
 let instant=wanted-(represented-wanted);
 const observed=parts(new Date(instant));
 if(observed.year!==String(year).padStart(4,'0')||observed.month!==String(month).padStart(2,'0')||
   observed.day!==String(day).padStart(2,'0')||observed.hour!==String(hour).padStart(2,'0')||
   observed.minute!==String(minute).padStart(2,'0'))throw Error('Invalid Guernsey local arrival time');
 const offsetMinutes=Math.round((wanted-instant)/60000),sign=offsetMinutes<0?'-':'+';
 const absolute=Math.abs(offsetMinutes),offset=sign+String(Math.floor(absolute/60)).padStart(2,'0')+':'+String(absolute%60).padStart(2,'0');
 return date+'T'+time+':00'+offset;
}
