// LB-08 safe CLI: receives ONLY Status/ExecutionStatus/Changes fields
// from a projected CloudFormation describe-change-set response (no parameters).
import {inspectManagementPreviewChangeSet} from './lb08-management-changeset-review.mjs';
export async function reviewFromStdin(input=process.stdin){
 let source='';
 for await(const chunk of input){
  source+=chunk.toString('utf8');
  if(source.length>1024*1024)throw Error('Change-set preview unexpectedly large');
 }
 const data=JSON.parse(source);
 if(Object.keys(data).some(key=>!['Status','ExecutionStatus','Changes'].includes(key)))
  throw Error('Unprojected response includes sensitive change-set metadata');
 return inspectManagementPreviewChangeSet({status:data.Status,executionStatus:data.ExecutionStatus,
  changes:data.Changes});
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try{
  const result=await reviewFromStdin();
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  if(!result.clearedForManualReview)process.exitCode=1;
 }catch{
  process.stderr.write('LB-08 change-set review failed; no changes may be executed.\n');
  process.exitCode=1;
 }
}
