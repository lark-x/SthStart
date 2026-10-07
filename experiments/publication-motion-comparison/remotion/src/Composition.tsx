import {AbsoluteFill,Sequence,staticFile} from 'remotion';
import {Audio} from '@remotion/media';
import {Opening,Closing} from './Bookends';
import {Camp,Observation,Notebook,Crystal,Understanding,Unfinished} from './Scenes';
export const SnowEcho=()=> <AbsoluteFill>
 <Audio src={staticFile('media/soundtrack.wav')}/>
 <Sequence name="开篇" from={0} durationInFrames={72}><Opening/></Sequence>
 <Sequence name="01 风雪营地" from={72} durationInFrames={286}><Camp/></Sequence>
 <Sequence name="02 观察" from={358} durationInFrames={378}><Observation/></Sequence>
 <Sequence name="03 记录" from={736} durationInFrames={291}><Notebook/></Sequence>
 <Sequence name="04 蓝光" from={1027} durationInFrames={286}><Crystal/></Sequence>
 <Sequence name="05 理解" from={1313} durationInFrames={318}><Understanding/></Sequence>
 <Sequence name="06 未完" from={1631} durationInFrames={340}><Unfinished/></Sequence>
 <Sequence name="结尾" from={1971} durationInFrames={67}><Closing/></Sequence>
</AbsoluteFill>;
