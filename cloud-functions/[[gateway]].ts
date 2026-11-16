import { getStore } from '@edgeone/pages-blob';
import { handleEdgeOneGateway } from '../edgeone/city-gateway/handler';
export async function onRequest(context: {request:Request;env:Record<string,string>;clientIp?:string}) {
  return handleEdgeOneGateway(context.request,context.env,getStore('busline-city-uploads'),fetch,context.clientIp||'');
}
