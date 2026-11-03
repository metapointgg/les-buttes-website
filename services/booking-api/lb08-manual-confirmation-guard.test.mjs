import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('LB-08 host-only CLI cannot confirm a booking using a caller-supplied payment reference',()=>{
 const source=readFileSync(new URL('./admin.mjs',import.meta.url),'utf8');
 const match=source.match(/\}else if\(command==='confirm'\)\{([\s\S]*?)\}else if\(command==='decline'\)/);
 assert.ok(match,'Explicit manual confirmation branch must remain fail-closed');
 assert.match(match[1],/fail\('Manual payment confirmation disabled:/);
 assert.doesNotMatch(match[1],/await\s+change\(/);
 assert.doesNotMatch(match[1],/TransactWriteCommand/);
});
