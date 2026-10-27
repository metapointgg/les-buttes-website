import test from 'node:test';
import assert from 'node:assert/strict';
import {handler} from '../disabled-real-guest-handler.mjs';
test('real guest worker refuses every invocation without logging or persisting data', async()=>{
 for(const input of [{},{body:JSON.stringify({email:'private@example.org'})},null]){
  const result=await handler(input);
  assert.equal(result.statusCode,403);
  assert.equal(result.headers['Cache-Control'],'no-store');
  assert.ok(!JSON.stringify(result).includes('private@example.org'));
 }
});
