import test from 'node:test';
import assert from 'node:assert/strict';
import { Value } from '@sinclair/typebox/value';
import { PublicationPatchRequestSchema,PublicationHarnessTools,PublicationDiscoveryQuerySchema } from './harness-mcp.js';
test('patch contracts forbid source/media edits, bound batches and distinguish null from omission',()=>{
  const valid={expectedDraftVersion:2,operations:[{kind:'utterance',id:'line-1',changes:{voiceBindingId:null}}]};
  assert.equal(Value.Check(PublicationPatchRequestSchema,valid),true);
  for(const operations of [[],Array(41).fill(valid.operations[0]),[{kind:'publication',changes:{source:{}}}],[{kind:'utterance',id:'line-1',changes:{selectedAudioArtifactId:'fake'}}],[{kind:'shot',id:'shot-1',changes:{selectedImage:null}}]])assert.equal(Value.Check(PublicationPatchRequestSchema,{expectedDraftVersion:2,operations}),false);
  assert.equal(Value.Check(PublicationDiscoveryQuerySchema,{cursor:-1}),false);
  assert.equal(Value.Check(PublicationDiscoveryQuerySchema,{limit:51}),false);
  assert.equal(Value.Check(PublicationDiscoveryQuerySchema,{projectId:'foreign'}),false);
  const read=PublicationHarnessTools.find(t=>t.name==='read_publication_artifact')!;
  assert.equal(Value.Check(read.inputSchema,{activityId:'work',artifactId:'asset',mode:'preview'}),true);
  assert.equal(Value.Check(read.inputSchema,{activityId:'work',artifactId:'asset',url:'https://arbitrary.invalid'}),false);
});
