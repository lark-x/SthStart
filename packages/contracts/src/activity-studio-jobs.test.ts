import assert from 'node:assert/strict';
import test from 'node:test';
import { Value } from '@sinclair/typebox/value';
import { StudioStoryboardRequestSchema, StudioStoryboardApplySchema, StudioStoryboardOutputSchema, StudioTargetSchema,StudioHealthRequestSchema } from './index.js';
import { StudioStoryboardRequestSchema as DirectSchema } from './activity-studio-jobs.js';
import { StudioRefineRequestSchema,StudioVisualPatchSchema,StudioRefineApplySchema,StudioBatchRequestSchema,StudioBatchRetrySchema,StudioPrepareContextSchema,StudioJobResumeSchema } from './activity-studio-jobs.js';
import {StudioTextFallbackSelectionSchema,StudioTextFallbackRequestSchema} from './activity-studio-jobs.js';

test('text fallback only accepts an existing profile and an explicit frozen confirmation, not source/configuration overrides',()=>{
  assert.ok(Value.Check(StudioTextFallbackSelectionSchema,{profileId:'existing'}));
  const request={profileId:'existing',expectedJobRevision:2,planHash:'reviewed',idempotencyKey:'once'};
  assert.ok(Value.Check(StudioTextFallbackRequestSchema,request));
  for(const extra of [{token:'secret'},{baseUrl:'http://untrusted'},{model:'arbitrary'},{prompt:'replace'},{workflow:{}},{force:true}]){
    assert.equal(Value.Check(StudioTextFallbackSelectionSchema,{profileId:'existing',...extra}),false);
    assert.equal(Value.Check(StudioTextFallbackRequestSchema,{...request,...extra}),false);
  }
  assert.equal(Value.Check(StudioTextFallbackRequestSchema,{...request,expectedJobRevision:0}),false);
});

test('health only accepts a target descriptor, never workflow, credentials or upstream URL',()=>{
  const request={target:{kind:'beat',stageId:'s',sceneId:'c',beatId:'b'}};
  assert.ok(Value.Check(StudioHealthRequestSchema,request));
  for(const extra of [{workflow:{}},{token:'secret'},{baseUrl:'http://private'},{seed:1}])assert.equal(Value.Check(StudioHealthRequestSchema,{...request,...extra}),false);
});

test('batch/prepare/retry contracts bound targets and expose no arbitrary workflow or server paths',()=>{
  const versions={headVersion:1,contentDraftVersion:1,contentRevisionId:null,imageConfigDraftVersion:1,imageConfigRevisionId:null};
  const input={targets:[{kind:'beat',stageId:'s',sceneId:'c',beatId:'b'}],candidateCount:3,placement:'history_only'};
  assert.ok(Value.Check(StudioBatchRequestSchema,{kind:'render_batch',versions,input,idempotencyKey:'stable'}));
  for(const extra of [{workflow:{}},{path:'C:/private'},{prompt:'direct'}])assert.equal(Value.Check(StudioBatchRequestSchema,{kind:'render_batch',versions,input:{...input,...extra},idempotencyKey:'stable'}),false);
  assert.equal(Value.Check(StudioBatchRequestSchema,{kind:'render_batch',versions,input:{...input,candidateCount:4},idempotencyKey:'stable'}),false);
  assert.ok(Value.Check(StudioPrepareContextSchema,{expected:versions}));
  const retry={expectedJobRevision:1,itemIds:['failed'],idempotencyKey:'retry-once'};
  assert.ok(Value.Check(StudioBatchRetrySchema,retry));
  assert.equal(Value.Check(StudioBatchRetrySchema,{...retry,itemIds:['failed','failed']}),false);
  assert.equal(Value.Check(StudioBatchRetrySchema,{...retry,itemIds:[]}),false);
  assert.equal(Value.Check(StudioBatchRetrySchema,{...retry,force:true}),false);
  assert.ok(Value.Check(StudioJobResumeSchema,{expectedJobRevision:2,planHash:'frozen'}));
  assert.ok(Value.Check(StudioJobResumeSchema,{expectedJobRevision:2,planHash:'frozen',itemIds:['waiting']}));
  assert.equal(Value.Check(StudioJobResumeSchema,{expectedJobRevision:2,itemIds:[]}),false);
  assert.equal(Value.Check(StudioJobResumeSchema,{expectedJobRevision:2,itemIds:['same','same']}),false);
  assert.equal(Value.Check(StudioJobResumeSchema,{expectedJobRevision:2,itemIds:Array.from({length:25},(_,i)=>`item-${i}`)}),false);
  for(const extra of [{force:true},{artifactPath:'C:/private'},{resetSucceeded:true},{allowUnknown:true}])
    assert.equal(Value.Check(StudioJobResumeSchema,{expectedJobRevision:2,...extra}),false);
});

test('refine contracts only expose visual whitelist and permit explicit reviewed single drawing',()=>{
  const versions={headVersion:1,contentDraftVersion:1,contentRevisionId:null,imageConfigDraftVersion:1,imageConfigRevisionId:null};
  const request={kind:'refine',versions,input:{target:{kind:'beat',stageId:'s',sceneId:'c',beatId:'b'},instructions:'暖光'},idempotencyKey:'once'};
  assert.ok(Value.Check(StudioRefineRequestSchema,request));
  assert.equal(Value.Check(StudioRefineRequestSchema,{...request,input:{...request.input,target:{kind:'media_slot',slotId:'m'}}}),false);
  for(const patch of [{dialogue:'new'},{actorIds:['other']},{parameters:{seed:4}},{director:{lighting:'unknown'}},{}])assert.equal(Value.Check(StudioVisualPatchSchema,patch),false);
  assert.ok(Value.Check(StudioRefineApplySchema,{expectedJobRevision:1,versions,resultHash:'hash',renderAfterApply:true}));
});
test('studio contracts whitelist model semantics and enforce source and request limits from public and direct exports',() => {
  const request = { kind: 'storyboard',versions: { headVersion: 1,contentDraftVersion: 1,contentRevisionId: null,imageConfigDraftVersion: 1,imageConfigRevisionId: null },
    input: { source: { kind: 'text',text: '正文' },actorIds: [],output: 'beats',count: 6,stageId: 's',sceneId: null,instructions: '' },idempotencyKey: 'one' };
  for (const schema of [StudioStoryboardRequestSchema,DirectSchema]) {
    assert.ok(Value.Check(schema,request));
    assert.equal(Value.Check(schema,{ ...request,input: { ...request.input,source: { kind: 'text',text: '字'.repeat(12001) } } }),false);
    assert.equal(Value.Check(schema,{ ...request,input: { ...request.input,actorIds: ['same','same'] } }),false);
    assert.equal(Value.Check(schema,{ ...request,input: { ...request.input,workflow: {} } }),false);
    assert.equal(Value.Check(schema,{ ...request,input: { ...request.input,source: { kind: 'dsh_chat',sessionId: 'private' } } }),false);
  }
  const output = { scene: { title: '场次',timeText: '',locationText: '',environment: '' },beats: [1,2].map(() => ({ actorIds: [],primaryActorId: null,action: '动作',dialogue: '',outcome: '',director: {},composition: '' })) };
  assert.ok(Value.Check(StudioStoryboardOutputSchema,output));
  assert.equal(Value.Check(StudioStoryboardOutputSchema,{ ...output,html: '<script/>' }),false);
  assert.equal(Value.Check(StudioStoryboardOutputSchema,{ ...output,beats: output.beats.map(beat => ({ ...beat,id: 'model-owned-id' })) }),false);
  assert.ok(Value.Check(StudioStoryboardApplySchema,{ expectedJobRevision: 1,versions: request.versions,resultHash: 'hash',mode: 'append',sceneId: null,renderAfterApply: true,placement:'fill_empty' }));
  assert.equal(Value.Check(StudioTargetSchema,{ kind: 'beat',stageId: 's',sceneId: 'c',beatId: 'b',url: 'http://untrusted' }),false);
});
