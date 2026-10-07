import {Composition,Folder,staticFile} from 'remotion';
import {loadFont} from '@remotion/fonts';
import {SnowEcho} from './Composition';
import {Camp,Observation,Notebook,Crystal,Understanding,Unfinished} from './Scenes';
import {Opening,Closing} from './Bookends';
await loadFont({family:'NotoComic',url:staticFile('media/NotoSansSC-VF.ttf'),weight:'100 900'});

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="SnowEcho" component={SnowEcho} durationInFrames={2038} fps={30} width={1080} height={1920}/>
      <Folder name="Scenes">
       <Composition id="Opening" component={Opening} durationInFrames={72} fps={30} width={1080} height={1920}/>
       <Composition id="Camp" component={Camp} durationInFrames={286} fps={30} width={1080} height={1920}/>
       <Composition id="Observation" component={Observation} durationInFrames={378} fps={30} width={1080} height={1920}/>
       <Composition id="Notebook" component={Notebook} durationInFrames={291} fps={30} width={1080} height={1920}/>
       <Composition id="Crystal" component={Crystal} durationInFrames={286} fps={30} width={1080} height={1920}/>
       <Composition id="Understanding" component={Understanding} durationInFrames={318} fps={30} width={1080} height={1920}/>
       <Composition id="Unfinished" component={Unfinished} durationInFrames={340} fps={30} width={1080} height={1920}/>
       <Composition id="Closing" component={Closing} durationInFrames={67} fps={30} width={1080} height={1920}/>
      </Folder>
    </>
  );
};
