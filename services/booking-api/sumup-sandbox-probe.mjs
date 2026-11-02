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
