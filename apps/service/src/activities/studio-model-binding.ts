import type {ServiceDatabase} from '../database.js';
import type {SecretStore} from '../security.js';
import {resolveProfile,type ResolvedProfile} from '../providers.js';
import {studioError,studioHash} from './studio-store.js';

/** Private configuration snapshot. Only a digest and public labels leave here;
 * headers, options and credential references must never enter a task or preview. */
export function studioTextProfileBinding(database:ServiceDatabase,profileId:string){
  const managed=database.connection.prepare(`SELECT mp.*,sc.base_url,sc.kind connection_kind,sc.enabled connection_enabled,
    sc.credential_account,sc.headers_json,sc.options_json,sc.timeout_ms FROM model_profiles mp
    LEFT JOIN service_connections sc ON sc.id=mp.connection_id WHERE mp.id=?`).get(profileId);
  const legacy=managed?null:database.connection.prepare(`SELECT p.*,o.thinking_mode,o.headers_json,o.extra_body_json
    FROM provider_profiles p LEFT JOIN provider_profile_options o ON o.profile_id=p.id WHERE p.id=?`).get(profileId);
  const row=managed??legacy;
  let textCapable=false;try{const capabilities=JSON.parse(String(managed?.capabilities_json??'[]'));textCapable=Array.isArray(capabilities)&&capabilities.includes('text');}catch{/* Invalid capability data is not permission to dispatch. */}
  const enabled=Boolean(row&&row.enabled===1&&(managed?row.connection_enabled===1&&row.connection_kind==='openai-compatible-text'&&textCapable:row.kind==='llm'));
  return {hash:studioHash(row??null),enabled,credentialRequired:Boolean(row?.credential_account),
    name:row?String(row.name):'',model:row?(row.model_id??row.model)==null?'':String(row.model_id??row.model):''};
}

export async function resolveStudioTextProfile(database:ServiceDatabase,secrets:SecretStore,profileId:string,expectedHash?:string):Promise<ResolvedProfile>{
  const binding=studioTextProfileBinding(database,profileId);
  if(expectedHash&&binding.hash!==expectedHash)throw studioError('studio_fallback_config_changed','备用文本模型配置已变化，请重新审阅；未发送模型请求。',409);
  if(!binding.enabled||!binding.model.trim())throw studioError('studio_fallback_profile_unavailable','备用文本模型不存在、未启用或缺少模型 ID。',409);
  let profile:ResolvedProfile|null;
  try{profile=await resolveProfile(database,secrets,'llm',profileId);}catch{throw studioError('studio_fallback_profile_unavailable','备用文本模型凭据不可读取。',409);}
  if(!profile||binding.credentialRequired&&!profile.secret)throw studioError('studio_fallback_profile_unavailable','备用文本模型已配置的凭据不可用。',409);
  if(studioTextProfileBinding(database,profileId).hash!==binding.hash)throw studioError('studio_fallback_config_changed','读取凭据期间配置已变化，未发送请求。',409);
  return profile;
}

/** 应用级活动文本档案（预览与派发共用的同一处来源）。 */
export function activityTextProfileId(database:ServiceDatabase):string{
  const assigned=database.connection.prepare("SELECT profile_id FROM app_llm_assignments WHERE app_id='activities' AND role='text'").get() as {profile_id?:string}|undefined;
  return String(assigned?.profile_id??'');
}

/**
 * 预览用的只读凭据探针：**不抛错**，把原因返回给调用方。
 *
 * 背景：`studioTextProfileBinding` 是同步的、不读密钥库，所以它判断不了凭据；
 * 而真正会因凭据缺失失败的是 `resolveStudioTextProfile`（异步，只在派发路径上调用）。
 * 结果是预览报 `canSubmit: true`、派发才失败——用户在界面上看到一个点下去就错的按钮。
 * 预览路径用本函数把这个缺口补上。
 */
export async function inspectStudioTextProfile(database:ServiceDatabase,secrets:SecretStore,profileId:string):Promise<{ready:boolean;reason:string|null}>{
  if(!profileId)return {ready:false,reason:'活动文本模型未配置。'};
  try{await resolveStudioTextProfile(database,secrets,profileId);return {ready:true,reason:null};}
  catch(error){return {ready:false,reason:error instanceof Error?error.message:String(error)};}
}
