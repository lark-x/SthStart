import test from 'node:test';
import assert from 'node:assert/strict';
import {Value} from '@sinclair/typebox/value';
import {PublicationDocumentSchema,PublicationApprovalRequestSchema,PublicationPlanRequestSchema,PublicationRunRequestSchema,SpeechProfileSchema} from './activity-publication.js';
test('production contracts keep sources strict and do not expose arbitrary graphs, keys or approval to MCP',()=>{
  const doc={schemaVersion:1,source:{storyProjectId:'project',entryRevisionIds:['revision'],sourceHash:'hash'},title:'作品',synopsis:'',orientation:'portrait',actors:[],shots:[],publishingCopy:{title:'',description:'',tags:[]}};
  assert.equal(Value.Check(PublicationDocumentSchema,doc),true);
  assert.equal(Value.Check(PublicationDocumentSchema,{...doc,adminToken:'no'}),false);
  assert.equal(Value.Check(PublicationPlanRequestSchema,{activityId:'a',expectedDraftVersion:1,document:doc,approved:true}),false);
  assert.equal(Value.Check(PublicationRunRequestSchema,{approvalId:'approval',idempotencyKey:'same-key',workflow:{}}),false);
  assert.equal(Value.Check(PublicationApprovalRequestSchema,{expectedDraftVersion:1,speechProfileId:null,makeVideo:false,imageBudget:16,speechCharacterBudget:0}),false);
  const speech={id:'tts',revision:1,name:'TTS',baseUrl:'https://example.invalid/v1',model:'speech',voices:['a'],defaultVoice:'a',speed:1,secretEnvironment:'SPEECH_TEST_KEY'};
  assert.equal(Value.Check(SpeechProfileSchema,speech),true);
  assert.equal(Value.Check(SpeechProfileSchema,{...speech,connectionId:'configured-speech'}),true);
  assert.equal(Value.Check(SpeechProfileSchema,{...speech,connectionId:''}),false);
  assert.equal(Value.Check(SpeechProfileSchema,{...speech,apiKey:'not allowed'}),false);
});
