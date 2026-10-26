import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const lambda=readFileSync(new URL('../public-read-handler.mjs',import.meta.url),'utf8');
const template=readFileSync(new URL('../../../infra/booking-public-read/template.yaml',import.meta.url),'utf8');
const browser=readFileSync(new URL('../../../src/scripts/booking-discovery.ts',import.meta.url),'utf8');
test('isolated staging read API has no booking writes or private read projections',()=>{
 assert.match(template,/ReservedConcurrentExecutions: 2/);
 assert.match(template,/dynamodb:Query/);
 assert.match(template,/dynamodb:GetItem/);
 assert.doesNotMatch(template,/DynamoDBCrudPolicy|PutItem|UpdateItem|DeleteItem|TransactWriteItems|POST|DELETE/);
 assert.match(template,/BOOKING_ENVIRONMENT: staging/);
 assert.match(lambda,/requestOrigin!==origin/);
 assert.match(lambda,/method!=='GET'/);
 assert.match(lambda,/\['\/availability','\/published-pricing'\]/);
 assert.doesNotMatch(lambda,/SendEmailCommand|PutCommand|UpdateCommand|DeleteCommand|TransactWriteCommand/);
 assert.match(browser,/const readBase=localPreview\?/);
 assert.match(browser,/publishedQuote/);
});
