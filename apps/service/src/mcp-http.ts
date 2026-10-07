import { Kind,Type,type TSchema } from '@sinclair/typebox';
/** Hydrate legacy plain JSON schemas before TypeBox runtime validation. */
export function toolSchema(schema:Record<string,any>):TSchema {
  if((schema as unknown as TSchema)[Kind])return schema as TSchema;
  if(Array.isArray(schema.type))return Type.Union(schema.type.map((type:string)=>toolSchema({...schema,type})));
  if(schema.enum)return Type.Union(schema.enum.map((v:string|number|boolean)=>Type.Literal(v)));
  if(schema.type==='object')return Type.Object(Object.fromEntries(Object.entries(schema.properties??{}).map(([k,v])=>[k,(schema.required??[]).includes(k)?toolSchema(v as any):Type.Optional(toolSchema(v as any))])),{additionalProperties:schema.additionalProperties??true});
  if(schema.type==='string')return Type.String(schema);
  if(schema.type==='integer')return Type.Integer(schema);
  if(schema.type==='number')return Type.Number(schema);
  if(schema.type==='boolean')return Type.Boolean(schema);
  if(schema.type==='null')return Type.Null();
  throw new Error('不支持的工具Schema。');
}
/** Bounded JSON transport shared by stdio adapters. Never include URLs/tokens in errors. */
export async function mcpJson(url:string,init:RequestInit={}) {
  let response:Response;
  try{response=await fetch(url,{...init,redirect:'error',signal:init.signal??AbortSignal.timeout(20_000)});}
  catch{throw Object.assign(new Error('桥接连接失败或超时，请检查服务。'),{code:'bridge_unavailable',retryable:true});}
  const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>5*1024*1024){await reader.cancel();throw Object.assign(new Error('桥接响应超过5MiB上限。'),{code:'bridge_response_too_large'});}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  let payload:any;try{payload=JSON.parse(new TextDecoder().decode(bytes));}catch{throw Object.assign(new Error('桥接没有返回有效JSON。'),{code:'bridge_invalid_response'});}
  if(!response.ok)throw Object.assign(new Error(typeof payload?.message==='string'?payload.message:`桥接请求失败（${response.status}）。`),{
    code:typeof payload?.error==='string'?payload.error:'bridge_http_error',retryable:response.status===503,...(Number.isSafeInteger(payload?.currentVersion)?{currentVersion:payload.currentVersion}:{})});
  return payload;
}
export function mcpError(error:unknown) {
  const e=error as Error&{code?:string;retryable?:boolean;currentVersion?:number};
  const result={error:e.code??'mcp_invalid_request',message:e.message||'工具调用失败。',retryable:e.retryable??false,...(e.currentVersion?{currentVersion:e.currentVersion}:{})};
  return {isError:true,content:[{type:'text' as const,text:JSON.stringify(result)}],structuredContent:result};
}
