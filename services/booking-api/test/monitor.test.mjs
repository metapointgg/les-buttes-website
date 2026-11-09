import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAirbnbUrl,monitoredFeedNights,assessMonitorRun,monitorMessage} from '../monitor-logic.mjs';

const t='a'.repeat(32);
const period={from:'2027-03-20',to:'2027-10-02'};
const normalAudit={
  missingInMaster:[],missingFromAirbnb:[],unclassified:[],otherOnlyMaster:[],
  otherOnAirbnb:[{start:'2027-08-28',end:'2027-09-04',nights:7}]
};

test('accept only correct private Airbnb iCal URL for each cottage, never redirects or extra query parameters',()=>{
  assert.equal(validateAirbnbUrl('https://www.airbnb.com/calendar/ical/17564897.ics?t='+t,'geranium').includes('17564897.ics'),true);
  assert.equal(validateAirbnbUrl('https://www.airbnb.com/calendar/ical/15695088.ics?t='+t,'honeysuckle').includes('15695088.ics'),true);
  for(const url of [
    'http://www.airbnb.com/calendar/ical/17564897.ics?t='+t,
    'https://evil.example/calendar/ical/17564897.ics?t='+t,
    'https://www.airbnb.com/calendar/ical/15695088.ics?t='+t,
    'https://www.airbnb.com/calendar/ical/17564897.ics?t='+t+'&redirect=https://evil.example',
    'https://www.airbnb.com/calendar/ical/17564897.ics',
    'https://www.airbnb.com/calendar/ical/17564897.ics?t=short',
    'https://www.airbnb.com:8443/calendar/ical/17564897.ics?t='+t,
    'https://www.airbnb.com/calendar/ical/17564897.ics?t='+t+'#fragment'
  ])assert.throws(()=>validateAirbnbUrl(url,'geranium'),/Airbnb calendar/);
});
test('normal monitoring baseline does not send email, and ignores expected direct-only reservations',()=>{
  const baseline=assessMonitorRun(['2027-08-28','2027-08-29'],undefined,normalAudit,period);
  assert.equal(baseline.isBaseline,true);
  assert.equal(baseline.shouldAlert,false);
  assert.equal(baseline.current.length,2);
});
test('new Airbnb blocks and removed blocks generate distinct date-only alerts',()=>{
  const previous={blockedNights:['2027-05-22','2027-05-23'],issueFingerprint:'none'};
  const run=assessMonitorRun(['2027-05-23','2027-05-24'],previous,normalAudit,period);
  assert.equal(run.shouldAlert,true);
  assert.deepEqual(run.added,[{start:'2027-05-24',end:'2027-05-25',nights:1}]);
  assert.deepEqual(run.removed,[{start:'2027-05-22',end:'2027-05-23',nights:1}]);
  const message=monitorMessage('geranium',run,period.from,period.to);
  assert.match(message,/NEW dates blocked/);
  assert.match(message,/2027-05-24/);
  assert.doesNotMatch(message,/test@example|airbnb.com|t=/);
});
test('missing-in-master issues alert on initial scan but not on unchanged repeat scans',()=>{
  const issue={...normalAudit,missingInMaster:[{start:'2027-07-01',end:'2027-07-02',nights:1}]};
  const baseline=assessMonitorRun(['2027-07-01'],undefined,issue,period);
  assert.equal(baseline.shouldAlert,true);
  const next=assessMonitorRun(['2027-07-01'],
    {blockedNights:baseline.current,issueFingerprint:baseline.issueFingerprint},issue,period);
  assert.equal(next.shouldAlert,false);
  const cleared=assessMonitorRun(['2027-07-01'],
    {blockedNights:baseline.current,issueFingerprint:baseline.issueFingerprint},normalAudit,period);
  assert.equal(cleared.shouldAlert,false);
});
test('out-of-season Airbnb blocks are ignored and invalid checkpoints fail safely',()=>{
  assert.deepEqual(monitoredFeedNights(['2027-03-19','2027-03-20','2027-10-01','2027-10-02'],period.from,period.to),
    ['2027-03-20','2027-10-01']);
  assert.throws(()=>assessMonitorRun([],{blockedNights:'bad'},normalAudit,period),/checkpoint invalid/);
});
