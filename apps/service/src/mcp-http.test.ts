import test from 'node:test';
import assert from 'node:assert/strict';
import {mcpJson,mcpError} from './mcp-http.js';
test('MCP transport bounds responses and preserves safe conflict errors without leaking request secrets',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async()=>Response.json({error:'publication_draft_conflict',message:'冲突',currentVersion:4},{status:409});
    await assert.rejects(()=>mcpJson('http://localhost/secret-token'),e=>{
      const r=mcpError(e);assert.equal(r.structuredContent.currentVersion,4);assert.equal(r.structuredContent.retryable,false);assert.ok(!JSON.stringify(r).includes('secret-token'));return true;
    });
    globalThis.fetch=async()=>new Response('not json');await assert.rejects(()=>mcpJson('http://localhost'),/JSON/);
    globalThis.fetch=async()=>new Response('x'.repeat(5*1024*1024+1));await assert.rejects(()=>mcpJson('http://localhost'),/5MiB/);
    globalThis.fetch=async()=>{throw new Error('URL containing secret-token');};
    await assert.rejects(()=>mcpJson('http://localhost'),e=>{assert.equal(mcpError(e).structuredContent.retryable,true);assert.ok(!JSON.stringify(mcpError(e)).includes('secret-token'));return true;});
  }finally{globalThis.fetch=original;}
});
