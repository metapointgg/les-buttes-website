import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/deploy-booking-preview-staging.yml',import.meta.url),'utf8');
test('LB-05 staging website deployment preserves separate management folder',()=>{
 const lines=workflow.split('\n').filter(line=>line.includes('aws s3 sync dist/'));
 assert.equal(lines.length,1,'Exactly one staging website sync command expected');
 const line=lines[0];
 assert.match(line,/s3:\/\/les-buttes-booking-preview-staging-145608514666\//);
 assert.match(line,/--delete/);
 assert.match(line,/--exclude ['"]management\/\*['"]/);
 assert.ok(line.indexOf('--exclude')>line.indexOf('--delete'));
});
