// Server-side secret reader. Never expose the secret in a Lambda response, exception or log.
import {GetParameterCommand} from '@aws-sdk/client-ssm';
export const TURNSTILE_PARAMETER='/les-buttes/booking/staging/turnstile-siteverify-secret';
export async function readTurnstileSecret({ssm,name=TURNSTILE_PARAMETER}={}){
 if(name!==TURNSTILE_PARAMETER||!ssm||typeof ssm.send!=='function')
  throw Error('Turnstile secret unavailable');
 try{
  const result=await ssm.send(new GetParameterCommand({Name:name,WithDecryption:true}));
  if(result?.Parameter?.Type!=='SecureString'||result.Parameter.Name!==name||
     typeof result.Parameter.Value!=='string'||result.Parameter.Value.length<8||
     result.Parameter.Value.length>2048)
   throw Error('Missing SecureString');
  return result.Parameter.Value;
 }catch{
  throw Error('Turnstile secret unavailable');
 }
}
