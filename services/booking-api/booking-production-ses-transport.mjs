import {SESClient,SendEmailCommand} from '@aws-sdk/client-ses';
import {validateProductionSesMessage} from './booking-production-ses-policy.mjs';

export function createProductionSesTransport({env=process.env,
 clientFactory=region=>new SESClient({region}),commandFactory=input=>new SendEmailCommand(input)}={}){
 return {async send({to,type,subject,body,html,templateId,bookingId}={}){
  const decision=validateProductionSesMessage({env,to,type,subject,body,templateId,bookingId});
  if(html!==undefined&&(typeof html!=='string'||html.length>50000||!html.startsWith('<!doctype html>')))
   throw Error('Invalid HTML email content');
  if(!decision.allowed)throw Error('Production SES delivery not authorised: '+decision.failures.join('; '));
  const client=clientFactory(decision.region);
  if(!client||typeof client.send!=='function')throw Error('Invalid SES client');
  try{
   const result=await client.send(commandFactory({Source:decision.sender,
    Tags:[{Name:'bookingId',Value:decision.bookingId},{Name:'emailType',Value:decision.type},{Name:'templateId',Value:decision.templateId}],
    Destination:{ToAddresses:[decision.recipient]},Message:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:body,Charset:'UTF-8'},...(html?{Html:{Data:html,Charset:'UTF-8'}}:{})}}}));
   if(typeof result?.MessageId!=='string'||!result.MessageId.trim())throw Error('SES acknowledgement unavailable');
   return {messageId:result.MessageId,region:decision.region,bookingId:decision.bookingId,
    templateId:decision.templateId,type:decision.type,status:'ACCEPTED_BY_SES_NOT_DELIVERED'};
  }catch(error){
   console.error('PRODUCTION_SES_SEND_FAILED',String(error?.name??'UnknownError').replace(/[^A-Za-z0-9_]/g,'').slice(0,80));
   throw error;
  }finally{client.destroy?.();}
 }};
}
