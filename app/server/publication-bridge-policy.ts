const segment=/^[A-Za-z0-9_-]{1,160}$/;
export function publicationBridgeAllowed(method:string,path:string[]) {
  if(path[0]!=='projects'||!segment.test(path[1]??'')) return false;
  const tail=path.slice(2);
  if(method==='GET'&&tail.length===1&&tail[0]==='sources') return true;
  if(method==='POST'&&tail.length===1&&tail[0]==='plans') return true;
  if(method==='GET'&&tail.length===1&&tail[0]==='publications') return true;
  if(tail[0]!=='publications'||!segment.test(tail[1]??'')) return false;
  if(method==='GET'&&tail.length===2) return true;
  if(method==='POST'&&tail.length===3&&tail[2]==='runs') return true;
  if(method==='GET'&&tail.length===3&&['runs','media','options'].includes(tail[2])) return true;
  if(method==='POST'&&tail.length===3&&['validate','preview','patch','exports'].includes(tail[2])) return true;
  if(method==='GET'&&tail.length===4&&['artifacts','tasks'].includes(tail[2])&&segment.test(tail[3])) return true;
  if(method==='GET'&&tail.length===5&&['shots','utterances'].includes(tail[2])&&segment.test(tail[3])&&tail[4]==='history') return true;
  if(method==='POST'&&tail.length===5&&tail[2]==='utterances'&&segment.test(tail[3])&&['select-audio','retries'].includes(tail[4])) return true;
  if(method==='GET'&&tail.length===4&&tail[2]==='runs'&&segment.test(tail[3])) return true;
  if(method==='POST'&&tail.length===5&&tail[2]==='runs'&&segment.test(tail[3])&&tail[4]==='stop') return true;
  return method==='POST'&&tail.length===5&&tail[2]==='shots'&&segment.test(tail[3])&&['retries','select-image'].includes(tail[4]);
}
