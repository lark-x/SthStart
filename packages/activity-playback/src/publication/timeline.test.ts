import test from 'node:test';
import assert from 'node:assert/strict';
import type {PublicationDocument} from '@sthstart/contracts';
import {compilePublicationTimeline,getPublicationFrameState,publicationSrt,splitPublicationSubtitle} from './timeline.js';
import {compilePublicationCards} from './renderer.js';
const doc:PublicationDocument={schemaVersion:1,source:{storyProjectId:'p',entryRevisionIds:['r'],sourceHash:'h'},title:'测试',synopsis:'',orientation:'portrait',actors:[],publishingCopy:{title:'',description:'',tags:[]},shots:[{
  id:'s',sourceRefs:['r'],actorIds:[],visualDescription:'',structuredPrompt:{actors:[],camera:[],scene:[],details:[],naturalLanguage:''},renderSettings:{},selectedImage:null,presentation:'still',
  utterances:[{id:'u',speakerActorId:null,text:'这是有😀的对白。第二句不能截断。',voiceBindingId:null,selectedAudioArtifactId:'a'}],
},{id:'quiet',sourceRefs:['r'],actorIds:[],visualDescription:'',structuredPrompt:{actors:[],camera:[],scene:[],details:[],naturalLanguage:''},renderSettings:{},selectedImage:null,presentation:'still',utterances:[]}]};
test('timeline uses actual durations and gaps, keeps graphemes and produces deterministic frame states',()=>{
  const t=compilePublicationTimeline(doc,{u:{artifactId:'a',durationMs:6000}});
  assert.equal(t.durationMs,10050);assert.equal(t.shots[0].endMs,6650);
  assert.equal(t.subtitles.at(-1)?.endMs,6000);
  assert.equal(getPublicationFrameState(t,6800).shotId,'quiet');
  assert.equal(getPublicationFrameState(t,6300).subtitle,null);
  assert.ok(publicationSrt(t).includes('旁白：'));
  assert.deepEqual(splitPublicationSubtitle('😀😀😀',1),['😀','😀','😀']);
  assert.throws(()=>compilePublicationTimeline(doc,{}),/缺少/);
  assert.throws(()=>compilePublicationTimeline(doc,{u:{artifactId:'a',durationMs:301000}}),/5 分钟/);
});
test('comic cards reuse the shot image when more than three utterances require extra cards',()=>{
  const copy=structuredClone(doc);copy.shots[0].utterances=Array.from({length:7},(_,i)=>({...copy.shots[0].utterances[0],id:`u${i}`}));
  const cards=compilePublicationCards(copy);
  assert.equal(cards.length,4);assert.deepEqual(cards.slice(0,3).map(c=>c.utteranceIds.length),[3,3,1]);
});
