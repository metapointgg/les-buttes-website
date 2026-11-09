// Inspect projected CloudFormation metadata from stdin; never accept parameter values.
// A successful exit indicates eligibility for MANUAL review, never deployment approval.
import {inspectIsolatedManagementChangeSet} from './lb08-isolated-management-changeset-review.mjs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
export async function reviewIsolatedFromStdin(input=process.stdin){
 let raw='';
 for await(const chunk of input){
  raw+=chunk.toString('utf8');
  if(raw.length>1024*1024)throw Error('Change-set response exceeds review limit');
 }
 const data=JSON.parse(raw);
 if(!data||typeof data!=='object'||Array.isArray(data)||
    Object.keys(data).some(key=>!['Status','ExecutionStatus','Changes'].includes(key)))
  throw Error('Unprojected or invalid change-set metadata');
 return inspectIsolatedManagementChangeSet({
  status:data.Status,executionStatus:data.ExecutionStatus,changes:data.Changes
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  const result=await reviewIsolatedFromStdin();
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.clearedForManualReview)process.exitCode=1;
 }catch{
  process.stderr.write('Isolated management change-set review failed; DO NOT EXECUTE.\n');
  process.exitCode=1;
 }
}
