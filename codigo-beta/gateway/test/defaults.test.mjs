import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../public/defaults.js',import.meta.url),'utf8');
const preset={provider:'claude',model:'claude-opus-5',thinkingOptionId:'high'};
function openBrowser(raw, options={}) {
  let value=raw;
  runInNewContext(script,{
    document:{getElementById:()=>options.withoutConfig ? null : {textContent:JSON.stringify(preset)}},
    localStorage:{
      getItem:()=>{if(options.blocked)throw new Error('Storage unavailable');return value;},
      setItem:(_key,next)=>{value=next;},
    },
  });
  return value;
}
test('a first visit selects Claude Opus 5 High and keeps the normal permission mode',()=>{
  const saved=JSON.parse(openBrowser(null));
  assert.equal(saved.provider,'claude');
  assert.deepEqual(saved.providerPreferences.claude,{model:'claude-opus-5',thinkingByModel:{'claude-opus-5':'high'}});
  assert.equal(saved.providerPreferences.claude.mode,undefined);
});
test('an existing agent or model choice is never overwritten on reload',()=>{
  for(const preferences of [
    {provider:'codex',providerPreferences:{codex:{model:'chosen-model'}}},
    {provider:'claude',providerPreferences:{claude:{model:'claude-sonnet-5',thinkingByModel:{'claude-sonnet-5':'low'}}}},
  ]) {
    const raw=JSON.stringify(preferences);
    assert.equal(openBrowser(raw),raw);
  }
});
test('unrelated preferences and an existing Claude effort survive initialization',()=>{
  const value=openBrowser(JSON.stringify({isolation:'worktree',providerPreferences:{claude:{thinkingByModel:{'claude-opus-5':'low'}}}}));
  const saved=JSON.parse(value);
  assert.equal(saved.isolation,'worktree');
  assert.equal(saved.providerPreferences.claude.thinkingByModel['claude-opus-5'],'low');
  assert.equal(openBrowser(value),value);
});
test('unavailable storage, invalid saved values or missing defaults do not block the app',()=>{
  assert.equal(openBrowser(null,{blocked:true}),null);
  assert.equal(openBrowser(null,{withoutConfig:true}),null);
  for(const raw of ['invalid','null','[]','"string"']) assert.equal(openBrowser(raw),raw);
});
