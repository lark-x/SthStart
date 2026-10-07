import test from 'node:test';
import assert from 'node:assert/strict';
import {checkVideoDependencies,missingVideoDependency,probeBinary,ffprobeAvailable,type VideoBinary,type VideoBinaryProbe} from './runtime-preflight.js';

// An injected probe keeps these cases hermetic: no host tools are uninstalled and no test
// competes over process.env or a shared child-process.
function probeWith(available:VideoBinary[]):VideoBinaryProbe {
  return async binary=>available.includes(binary);
}

test('video dependencies are reported per binary so ffmpeg and ffprobe stay distinguishable',async()=>{
  assert.deepEqual(await checkVideoDependencies(probeWith(['ffmpeg','ffprobe'])),{ok:true,missing:[]});
  assert.deepEqual(await checkVideoDependencies(probeWith(['ffprobe'])),{ok:false,missing:['ffmpeg']});
  assert.deepEqual(await checkVideoDependencies(probeWith(['ffmpeg'])),{ok:false,missing:['ffprobe']});
  assert.deepEqual(await checkVideoDependencies(probeWith([])),{ok:false,missing:['ffmpeg','ffprobe']});
});

test('missing binaries map to stable publication error codes and clear Chinese messages',()=>{
  const ffmpeg=missingVideoDependency(['ffmpeg']);assert.equal(ffmpeg.code,'publication_ffmpeg_missing');assert.match(ffmpeg.message,/FFmpeg/);
  const ffprobe=missingVideoDependency(['ffprobe']);assert.equal(ffprobe.code,'publication_ffprobe_missing');assert.match(ffprobe.message,/FFprobe/);
  // FFmpeg is the primary failure when both are gone; fixing it also surfaces FFprobe next.
  const both=missingVideoDependency(['ffmpeg','ffprobe']);assert.equal(both.code,'publication_ffmpeg_missing');
});

test('the real probe answers with a boolean instead of throwing when a binary is absent',async()=>{
  assert.equal(typeof await probeBinary('ffmpeg'),'boolean');
  assert.equal(typeof await ffprobeAvailable(),'boolean');
});
