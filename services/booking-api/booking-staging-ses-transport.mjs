// LB-09: explicitly regional, staging-only SES transport.
// No automatic event wiring, no side effects on import, and no guest-recipient fallback.
import {SESClient,SendEmailCommand} from '@aws-sdk/client-ses';
import {validateStagingSesMessage} from './booking-staging-ses-policy.mjs';

export function createStagingSesTransport({
 env=process.env,
 clientFactory=region=>new SESClient({region}),
 commandFactory=input=>new SendEmailCommand(input)
}={}){
 if(typeof clientFactory!=='function'||typeof commandFactory!=='function')
  throw Error('SES transport factories required');
 return {
  async send({to,type,subject,body,templateId,bookingId}={}){
   const decision=validateStagingSesMessage({env,to,type,subject,body,templateId,bookingId});
   if(!decision.allowed)throw Error('Staging SES delivery not authorised: '+decision.failures.join('; '));
   // SES region deliberately differs from AWS_REGION of our eu-west-2 booking Lambda.
   const command=commandFactory({
    Source:decision.sender,
    ...(env.BOOKING_SES_CONFIGURATION_SET?{ConfigurationSetName:env.BOOKING_SES_CONFIGURATION_SET}:{}),
    Tags:[
     {Name:'bookingId',Value:decision.bookingId},
     {Name:'emailType',Value:decision.type},
     {Name:'templateId',Value:decision.templateId}
    ],
    Destination:{ToAddresses:[decision.recipient]},
    Message:{
     Subject:{Data:subject,Charset:'UTF-8'},
     Body:{Text:{Data:body,Charset:'UTF-8'}}
    }
   });
   const client=clientFactory(decision.region);
   if(!client||typeof client.send!=='function')
    throw Error('Invalid SES client');
   try{
    const result=await client.send(command);
    if(typeof result?.MessageId!=='string'||!result.MessageId.trim())
     throw Error('SES did not return a message identifier; manual reconciliation required');
    // Only return the opaque provider receipt, never guest email bodies or raw SDK output.
    return {messageId:result.MessageId,region:decision.region,
     bookingId:decision.bookingId,templateId:decision.templateId,type:decision.type,
     status:'ACCEPTED_BY_SES_NOT_DELIVERED'};
   }catch(error){
    console.error('STAGING_SES_SEND_FAILED',String(error?.name??'UnknownError').replace(/[^A-Za-z0-9_]/g,'').slice(0,80));
    throw error;
   }finally{
    client.destroy?.();
   }
  }
 };
}
