import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {AppCatalog,validateApp,readPage} from '../catalog.mjs';

test('apps persist across instances and concurrent additions are not lost',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-catalog-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const catalog=new AppCatalog(dir);
  await catalog.remove('guia');
  await Promise.all(['CRM','Pedidos'].map(name=>catalog.add({name,url:'https://example.com/'+name,description:'Time'},'ana@example.com')));
  const again=new AppCatalog(dir); const apps=await again.list();
  assert.equal(apps.length,2); assert.equal(apps[0].name,'CRM');
  await again.remove(apps[0].id); assert.equal((await again.list()).length,1);
  assert.match(await readFile(path.join(dir,'apps.json'),'utf8'),/Pedidos/);
});
test('application URLs cannot become scripts, local network targets or internal control routes',()=>{
  for(const url of ['javascript:alert(1)','http://example.com','https://a:b@example.com','//example.com','/api/agents','/_ratoeira/api/portal','https://ratoeira.example.com/portal/','https://127.0.0.1/','https://[::1]/','https://169.254.169.254/','https://10.0.0.1/','https://foo.local/','/_ratoeira/pages/../api/']) {
    assert.throws(()=>validateApp({name:'CRM',url},'ratoeira.example.com'),undefined,url);
  }
  assert.equal(validateApp({name:' Meu CRM ',url:'/_ratoeira/pages/crm/'},'ratoeira.example.com').name,'Meu CRM');
  assert.throws(()=>validateApp({name:'',url:'https://example.com'}));
});
test('page reads stay within the published directory and reject symlinks and hidden files',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'ratoeira-pages-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(path.join(dir,'pages','demo'),{recursive:true});
  await writeFile(path.join(dir,'pages','demo','index.html'),'<h1>Demo</h1>');
  await writeFile(path.join(dir,'private.html'),'secret');
  await writeFile(path.join(dir,'pages','demo','.env'),'secret');
  await symlink(path.join(dir,'private.html'),path.join(dir,'pages','demo','link.html'));
  const page=await readPage(path.join(dir,'pages'),'demo/'); assert.equal(page.body.toString(),'<h1>Demo</h1>');
  for(const target of ['../private.html','demo/.env','demo/link.html','demo/%2e%2e/private.html','demo/index.html/../../private.html']) {
    await assert.rejects(readPage(path.join(dir,'pages'),target));
  }
});
