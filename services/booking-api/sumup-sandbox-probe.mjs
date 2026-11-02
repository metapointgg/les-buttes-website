// LB-08 explicitly invoked read-only staging diagnostic. Never run in CI automatically.
import {SSMClient} from '@aws-sdk/client-ssm';
import {checkSandboxSumUpConnectivity} from './sumup-sandbox-runtime.mjs';

export async function runSandboxProbe({env=process.env,ssmFactory,probe=checkSandboxSumUpConnectivity}={}){
 if(env.BOOKING_ENVIRONMENT!=='staging'||env.AWS_REGION!=='eu-west-2'||
    env.LB08_READONLY_SANDBOX_PROBE!=='yes')
  throw Error('Explicit staging-only read-only probe authorisation required');
 const ssm=ssmFactory?ssmFactory():new SSMClient({region:'eu-west-2'});
 try {
  const result=await probe({ssm,region:'eu-west-2'});
  if(result?.connected!==true||result.merchantMatched!==true)
   throw Error('Sandbox connectivity verification failed');
  return {connected:true,region:'eu-west-2',environment:'staging',merchantMatched:true};
 } finally {
  ssm.destroy?.();
 }
}

// Classify failures without printing SDK messages or parameter contents.
export function classifySandboxProbeError(error){
 const name=String(error?.name??'');
 const message=String(error?.message??'');
 if(name==='AccessDeniedException'||name==='AccessDenied'||name==='UnrecognizedClientException'||name==='CredentialsProviderError')
  return 'AWS_CREDENTIALS_OR_PERMISSIONS';
 if(name==='ParameterNotFound'||name==='ParameterVersionNotFound')return 'SSM_PARAMETER_MISSING';
 if(message.includes('Sandbox credentials missing or invalid'))return 'SSM_PARAMETER_VALUE_INVALID';
 if(message.includes('SumUp API request failed: 401'))return 'SUMUP_UNAUTHORISED';
 if(message.includes('SumUp API request failed: 403'))return 'SUMUP_FORBIDDEN';
 if(message.includes('SumUp API request failed: 404'))return 'SUMUP_ENDPOINT_NOT_FOUND';
 if(message.includes('Sandbox merchant identity mismatch'))return 'SUMUP_MERCHANT_MISMATCH';
 if(message.includes('SumUp API request failed:'))return 'SUMUP_HTTP_FAILURE';
 if(message.includes('Explicit staging-only'))return 'STAGING_GUARD';
 return 'UNCLASSIFIED_CONNECTIVITY_FAILURE';
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 try {
  const result=await runSandboxProbe();
  process.stdout.write(JSON.stringify(result)+'\n');
 } catch {
  // AWS SDK and HTTP exception messages can contain sensitive context; never print them.
  process.stderr.write('LB-08 sandbox probe failed. Check staging AWS identity, SSM permissions, parameter values and SumUp account access.\n');
  process.exitCode=1;
 }
}
