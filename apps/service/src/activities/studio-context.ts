import type {StudioVersionContext} from '@sthstart/contracts';
import type {ServiceDatabase} from '../database.js';
import {ActivityStore} from './store.js';
import {ComicStore} from './comic-store.js';
import {assertStudioVersions} from './studio-storyboard.js';
import {getImageConfigDraft,getImageConfigRevision,commitImageConfigRevision} from './image-configs.js';
import {studioHash} from './studio-store.js';

export function readStudioContext(database:ServiceDatabase,activityId:string):StudioVersionContext{
  const activities=new ActivityStore(database),activity=activities.getActivity(activityId)!,draft=activities.getDraft(activityId)!,image=getImageConfigDraft(database,activityId),comic=new ComicStore(database).getComicDraft(activityId);
  return {headVersion:activity.headVersion,contentDraftVersion:draft.draftVersion,contentRevisionId:activity.currentContentRevisionId,
    imageConfigDraftVersion:image.draftVersion,imageConfigRevisionId:image.baseRevisionId,...(comic?{comicDraftVersion:comic.draftVersion}:{})};
}
/** Called only on the user's explicit create/preview action, after all editor queues flush.
 * Hash comparisons, CAS and both commits share one transaction. No model/network requests here. */
export function prepareStudioContext(database:ServiceDatabase,activityId:string,expected:StudioVersionContext):StudioVersionContext{
  return database.transaction(()=>{
    const {activity,draft,config}=assertStudioVersions(database,activityId,expected),activities=new ActivityStore(database);
    const current=activity.currentContentRevisionId?activities.getContentRevision(activityId,activity.currentContentRevisionId):null;
    if(!current||studioHash(current.document)!==studioHash(draft.document))activities.commitDraft(activityId,activity.headVersion,draft.draftVersion,{skipTransaction:true});
    const latest=activities.getActivity(activityId)!,base=config.baseRevisionId?getImageConfigRevision(database,activityId,config.baseRevisionId):null;
    const media=latest.currentMediaRevisionId?activities.getMediaRevision(activityId,latest.currentMediaRevisionId):null;
    if(!base||studioHash(base.document)!==studioHash(config.document)||media?.imageConfigRevisionId!==base.id)
      commitImageConfigRevision(database,activities,activityId,config.draftVersion,latest.headVersion,{skipTransaction:true});
    // Comics retain their explicit content binding; never rebind a previous comic to this new revision.
    return readStudioContext(database,activityId);
  });
}
