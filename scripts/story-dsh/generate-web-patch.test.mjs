import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {parseDocument} from 'yaml';
const exec=promisify(execFile);

const storyToken='test-story-credential-not-a-real-grant';
const publicationToken=`pub_${'a'.repeat(64)}`;

// Placeholder-only environment: never reads or prints a real bridge token.
function baseEnv(dir){
  const env={...process.env,DSH_HOME:dir,STHSTART_STORY_WORKSPACE:dir,STHSTART_STORY_PROJECT_ID:'isolated-project',
    STHSTART_STORY_PORTAL_URL:'http://127.0.0.1:4197',STHSTART_STORY_BRIDGE_TOKEN:storyToken,
    STHSTART_STORY_TSX_IMPORT_PATH:import.meta.resolve('tsx/esm'),
    STHSTART_STORY_MCP_SOURCE_PATH:resolve('apps/service/src/story/native-mcp-server.ts')};
  delete env.STHSTART_PUBLICATION_BRIDGE_TOKEN;
  return env;
}

async function generatePatch(extraEnv){
  const dir=await mkdtemp(join(tmpdir(),'sthstart-story-dsh-patch-'));
  const patch=join(dir,'web.patch.yml');
  const env={...baseEnv(dir),...extraEnv};
  await exec(process.execPath,[resolve('scripts/story-dsh/generate-web-patch.mjs'),patch],{env,windowsHide:true,timeout:15000});
  return {dir,patch,source:await readFile(patch,'utf8')};
}

function standardPlugins(source){
  const customTags=[{tag:'tag:yaml.org,2002:js',resolve:(value)=>value}];
  const document=parseDocument(source,{customTags});
  assert.deepEqual(document.errors,[],'generated patch must stay valid YAML');
  const entries=document.toJS();
  const preset=entries.find((entry)=>entry?.insert?.some((row)=>row?.id==='preset-standard'))
    ?.insert?.find((row)=>row?.id==='preset-standard');
  assert.ok(Array.isArray(preset?.config?.plugins),'preset-standard must expose its plugin list');
  return preset.config.plugins;
}

const personaOf=(plugins)=>plugins.filter((entry)=>entry?.name==='@deepseek-ai/dsh-persona');
const mcpServersOf=(plugins)=>plugins.filter((entry)=>entry?.name==='@deepseek-ai/dsh-mcp-client')
  .map((entry)=>entry.config.serverName);
test('installed native Web profile merges a separate production MCP without persisting tokens',{timeout:30000},async()=>{
  const {dir,patch,source}=await generatePatch({STHSTART_PUBLICATION_BRIDGE_TOKEN:publicationToken});
  try{
    assert.ok(source.includes('publication-mcp'));assert.ok(source.includes('story-mcp'));
    assert.ok(!source.includes(publicationToken));assert.ok(!source.includes(storyToken));
    assert.ok(source.includes('process.env.STHSTART_PUBLICATION_BRIDGE_TOKEN'));
    const env={...process.env,DSH_HOME:dir,STHSTART_STORY_WORKSPACE:dir,STHSTART_STORY_PROJECT_ID:'isolated-project',STHSTART_STORY_PORTAL_URL:'http://127.0.0.1:4197',
      STHSTART_STORY_BRIDGE_TOKEN:storyToken,STHSTART_PUBLICATION_BRIDGE_TOKEN:publicationToken,STHSTART_STORY_TSX_IMPORT_PATH:import.meta.resolve('tsx/esm'),
      STHSTART_STORY_MCP_SOURCE_PATH:resolve('apps/service/src/story/native-mcp-server.ts')};
    const {stdout}=await exec(process.execPath,[resolve('node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','web','--patch',patch,'--dump-config'],{cwd:dir,env,windowsHide:true,timeout:15000,maxBuffer:2*1024*1024});
    assert.ok(stdout.includes('publication-mcp'), 'Native Web merged config must actually retain the MCP plugin');
    assert.ok(stdout.includes('story-mcp'));assert.ok(stdout.includes('@deepseek-ai/dsh-web-app'));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('publication environment keeps a single Story persona whose prefix carries the production instructions',async()=>{
  const {dir,source}=await generatePatch({STHSTART_PUBLICATION_BRIDGE_TOKEN:publicationToken});
  try{
    const plugins=standardPlugins(source);
    assert.deepEqual(mcpServersOf(plugins).sort(),['publication','story'],'both Story and publication MCPs stay enabled');
    const personas=personaOf(plugins);
    assert.equal(personas.length,1,'publication mode must not register a second @deepseek-ai/dsh-persona');
    const {prefix}=personas[0].config;
    assert.ok(prefix.includes('制作作品请使用独立 publication MCP'),'publication instruction must live on the Story persona prefix');
    assert.ok(prefix.includes('等待人类确认预算'),'budget confirmation requirement must survive the merge');
    assert.ok(prefix.includes('submit_proposal'),'the original Story proposal principle must remain');
    assert.ok(prefix.includes('{{model}}'),'the original story-writing role must remain');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('without a publication token only the Story MCP and one persona are installed, with no production instructions',async()=>{
  const {dir,source}=await generatePatch({});
  try{
    const plugins=standardPlugins(source);
    assert.deepEqual(mcpServersOf(plugins),['story'],'only the Story MCP is installed without a publication token');
    const personas=personaOf(plugins);
    assert.equal(personas.length,1,'a single persona is installed');
    assert.ok(!personas[0].config.prefix.includes('publication'),'the prefix must stay free of publication instructions');
    assert.ok(!source.includes('publication-mcp'),'no publication MCP entry may be emitted');
    assert.ok(personas[0].config.prefix.includes('submit_proposal'),'the original Story principle still holds');
  } finally {await rm(dir,{recursive:true,force:true});}
});
