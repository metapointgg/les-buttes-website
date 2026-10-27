// Intentionally non-operational staging foundation. Do not accept or log guest data.
export async function handler(){
 return {statusCode:403,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
  body:JSON.stringify({error:'Real guest submissions are not enabled'})};
}
