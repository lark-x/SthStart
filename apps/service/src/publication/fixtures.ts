import {ServiceDatabase} from '../database.js';
import {StoryStore} from '../story/store.js';
import {PublicationStore} from './store.js';
import type {PublicationDocument} from '@sthstart/contracts';
export function publicationFixture(artifactDirectory:string) {
  const db=new ServiceDatabase(':memory:'),story=new StoryStore(db),store=new PublicationStore(db,artifactDirectory);
  db.connection.prepare(`INSERT INTO managed_apps(id,name,token_hash,capabilities_json,enabled,created_at,updated_at) VALUES ('activities','制作测试','test-only','[]',1,?,?)`).run(new Date().toISOString(),new Date().toISOString());
  const project=story.createProject({title:'隔离制作验收'}),chapter=story.createDocument(project.id,{kind:'chapter',title:'雪山小样',body:'两位炼金术士在雪山营地交流新结晶的发现。'});
  const revision=story.listEntryRevisions(project.id,'chapter',chapter.id)[0],created=store.create(project.id,[revision.id]);
  const document:PublicationDocument={...created.document,shots:Array.from({length:6},(_,i)=>({id:`shot-${i}`,sourceRefs:[revision.id],actorIds:[],visualDescription:`雪山实验关键画面 ${i+1}`,
    structuredPrompt:{actors:[],camera:['medium shot'],scene:['snowy mountain laboratory'],details:['glowing crystal'],naturalLanguage:'An illustrated snowy camp with a crystal on a wooden laboratory desk.'},renderSettings:{},selectedImage:null,presentation:'still',
    utterances:[{id:`utterance-${i}`,speakerActorId:null,text:`这是第${i+1}个关键发现。`,voiceBindingId:null,selectedAudioArtifactId:null}]}))};
  const draft=store.save(created.activityId,1,document);
  return {db,story,store,project,chapter,revision,draft,document};
}
export function addPublicationTestWorkflow(db:ServiceDatabase) {
  const time=new Date().toISOString();
  db.connection.prepare(`INSERT INTO generation_engines(id,name,kind,base_url,enabled,concurrency_limit,created_at,updated_at) VALUES ('publication-engine','模拟 ComfyUI','comfyui','http://publication.mock',1,2,?,?)`).run(time,time);
  db.connection.prepare(`INSERT INTO generation_workflows(id,name,description,engine_kind,latest_version,created_at,updated_at,category) VALUES ('publication-workflow','模拟 Anima','','comfyui',1,?,?,'image')`).run(time,time);
  const schema={prompt:{semantic:'prompt',type:'long-text',required:true},negative:{semantic:'negative_prompt',type:'long-text'},seed:{semantic:'seed',type:'seed',minimum:0,maximum:2147483647},
    checkpoint:{semantic:'checkpoint',type:'model',default:'anima-test.safetensors'},width:{semantic:'width',type:'integer',default:768,minimum:256,maximum:2048},height:{semantic:'height',type:'integer',default:1024,minimum:256,maximum:2048}};
  const graph={'1':{class_type:'CLIPTextEncode',inputs:{text:''}},'2':{class_type:'CLIPTextEncode',inputs:{text:''}},'3':{class_type:'KSampler',inputs:{seed:0,model:['4',0]}},'4':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'anima-test.safetensors'}},'5':{class_type:'SaveImage',inputs:{images:['3',0]}},'6':{class_type:'EmptyLatentImage',inputs:{width:768,height:1024,batch_size:1}}};
  const bindings={prompt:['1','inputs','text'],negative:['2','inputs','text'],seed:['3','inputs','seed'],checkpoint:['4','inputs','ckpt_name'],width:['6','inputs','width'],height:['6','inputs','height']};
  const editor={version:2,modelSelection:'individual',fields:{},loraSlots:[],sizePresets:[],constraints:{},activityLoraInjection:{targetNodeId:'3',targetInput:'model'}};
  db.connection.prepare(`INSERT INTO generation_workflow_versions(workflow_id,version,engine_id,input_schema_json,node_bindings_json,output_declarations_json,definition_json,is_published,created_at,input_capabilities_json,output_media_types_json,output_schema_json,config_format_version,editor_config_json)
    VALUES ('publication-workflow',1,'publication-engine',?,?,?,?,1,?,'{}','["image/png"]','{}',2,?)`).run(JSON.stringify(schema),JSON.stringify(bindings),'["5"]',JSON.stringify(graph),time,JSON.stringify(editor));
  db.connection.prepare(`INSERT INTO app_generation_assignments(app_id,purpose,workflow_id,workflow_version,engine_id,updated_at) VALUES ('activities','activity_image_text','publication-workflow',1,'publication-engine',?)`).run(time);
}
export function publicationObjectInfo(missing=false) {
  return {CLIPTextEncode:{input:{required:{text:['STRING',{}]}}},KSampler:{input:{required:{seed:['INT',{}]}}},
    CheckpointLoaderSimple:{input:{required:{ckpt_name:[[...(missing?[]:['anima-test.safetensors'])],{}]}}},
    EmptyLatentImage:{input:{required:{width:['INT',{}],height:['INT',{}],batch_size:['INT',{}]}}},
    SaveImage:{input:{required:{images:['IMAGE',{}]}}},LoraLoaderModelOnly:{input:{required:{model:['MODEL',{}],lora_name:[[],{}],strength_model:['FLOAT',{}]}}}};
}
