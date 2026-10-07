import type {NextRequest} from 'next/server';
import {publicationBridgeAllowed} from '@/app/lib/publication-bridge-policy';
const serviceUrl=(process.env.STHSTART_SERVICE_URL??process.env.NEXT_PUBLIC_STHSTART_SERVICE_URL??'http://127.0.0.1:4100').replace(/\/$/,'');
async function proxy(request:NextRequest,context:{params:Promise<{path:string[]}>}) {
  const {path}=await context.params,headers={'cache-control':'no-store'};
  if(request.headers.has('origin')) return Response.json({error:'publication_bridge_browser_forbidden'},{status:403,headers});
  if(!publicationBridgeAllowed(request.method,path)) return Response.json({error:'publication_bridge_route_not_allowed'},{status:404,headers});
  const authorization=request.headers.get('authorization')??'';
  if(!/^Bearer pub_[a-f0-9]{64}$/.test(authorization)) return Response.json({error:'publication_bridge_unauthorized'},{status:401,headers});
  let body:Uint8Array|undefined;
  if(request.method==='POST'){
    if(!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({error:'publication_bridge_json_required'},{status:415,headers});
    const reader=request.body?.getReader(),chunks:Uint8Array[]= [];let total=0;
    if(reader) for(;;){const result=await reader.read();if(result.done) break;total+=result.value.length;if(total>512000){await reader.cancel();return Response.json({error:'publication_bridge_body_too_large'},{status:413,headers});}chunks.push(result.value);}
    body=new Uint8Array(total);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  }
  try{
    const response=await fetch(`${serviceUrl}/api/v1/publication-bridge/${path.map(encodeURIComponent).join('/')}${request.nextUrl.search}`,{
      method:request.method,headers:{authorization,accept:'application/json',...(body?{'content-type':'application/json'}:{})},
      body:body as BodyInit|undefined,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(120000)});
    return new Response(response.body,{status:response.status,headers:{...headers,'content-type':'application/json'}});
  }catch{return Response.json({error:'publication_bridge_unavailable',message:'制作服务暂时不可达。'},{status:503,headers});}
}
export const GET=proxy;
export const POST=proxy;
