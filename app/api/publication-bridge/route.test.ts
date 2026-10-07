import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {NextRequest} from 'next/server';
test('Publication Portal forwards scoped new routes without admin headers and rejects forbidden writes/oversized requests',async()=>{
  const received:Array<{url:string;headers:Record<string,unknown>}> = [];
  const http=createServer(async(req,res)=>{for await(const _ of req){}received.push({url:req.url??'',headers:req.headers});res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({ok:true}));});
  http.listen(0,'127.0.0.1');await once(http,'listening');const address=http.address();assert.ok(address&&typeof address!=='string');
  const previous=process.env.STHSTART_SERVICE_URL;process.env.STHSTART_SERVICE_URL=`http://127.0.0.1:${address.port}`;
  try{
    const routes=await import('./[...path]/route.js'),headers={authorization:`Bearer pub_${'a'.repeat(64)}`,cookie:'admin_session=not-forwarded','x-sthstart-admin-token':'not-forwarded'};
    for(const path of [['projects','project-a','publications'],['projects','project-a','publications','work','artifacts','img'],['projects','project-a','publications','work','utterances','line','history']]){
      const result=await routes.GET(new NextRequest(`http://localhost/api/publication-bridge/${path.join('/')}?limit=2`,{headers}),{params:Promise.resolve({path})});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
      assert.equal(received.at(-1)?.url,`/api/v1/publication-bridge/${path.join('/')}?limit=2`);assert.equal(received.at(-1)?.headers.cookie,undefined);assert.equal(received.at(-1)?.headers['x-sthstart-admin-token'],undefined);
    }
    const base=['projects','project-a','publications','work'];
    for(const tail of ['approvals','../admin'])assert.equal((await routes.POST(new NextRequest('http://localhost/api',{method:'POST',headers:{...headers,'content-type':'application/json'},body:'{}'}),{params:Promise.resolve({path:[...base,tail]})})).status,404);
    assert.equal((await routes.POST(new NextRequest('http://localhost/api',{method:'POST',headers:{...headers,'content-type':'application/json'},body:'x'.repeat(512001)}),{params:Promise.resolve({path:[...base,'patch']})})).status,413);
    assert.equal((await routes.GET(new NextRequest('http://localhost/api',{headers:{...headers,origin:'http://localhost'}}),{params:Promise.resolve({path:base})})).status,403);
    assert.equal((await routes.GET(new NextRequest('http://localhost/api',{headers:{authorization:'Bearer admin-token'}}),{params:Promise.resolve({path:base})})).status,401);
  }finally{if(previous===undefined)delete process.env.STHSTART_SERVICE_URL;else process.env.STHSTART_SERVICE_URL=previous;http.close();await once(http,'close');}
});
