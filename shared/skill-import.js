// Um Markdown avulso pode ter o nome escolhido pela pessoa. O pacote interno
// mantém o arquivo principal canônico, sem alterar o arquivo original no computador.
export function normalizeSkillFiles(files) {
 return files.map(file=>{
  const root=typeof file.path==='string'&&!/[\\/]/.test(file.path);
  const main=root&&(file.path.toLowerCase()==='skill.md'||files.length===1&&/\.md$/i.test(file.path));
  return {...file,path:main?'SKILL.md':file.path};
 });
}

export const SKILL_LIMITS={files:64,total:24*1024*1024,image:8*1024*1024,text:128*1024,textTotal:1024*1024};
export const isHiddenSkillPath=name=>name.split('/').some(part=>part.startsWith('.')||part==='__MACOSX');
export function skillFrontmatter(text,key) {
 const header=text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];if(!header)return '';
 const m=header.match(new RegExp('^'+key+':[ \\t]*(.*)((?:\\r?\\n[ \\t]+.*)*)','m'));if(!m)return '';
 let value=m[1].trim(),rest=m[2].split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
 value=/^[|>][+-]?$/.test(value)?rest.join(' '):[value,...rest].join(' ');
 if(value.startsWith('"'))try{return JSON.parse(value);}catch{}
 return value.replace(/^(['"])([\s\S]*)\1$/,'$2').trim();
}
export function normalizeSkillMetadata(text) {
 const raw=skillFrontmatter(text,'name'),description=skillFrontmatter(text,'description');
 const name=raw.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
 if(!name||name.length>64)throw new Error('A skill precisa ter um nome de até 64 caracteres no cabeçalho (name).');
 if(!description||description.length>3000)throw new Error('A skill precisa ter uma descrição de até 3.000 caracteres no cabeçalho (description).');
 const title=skillFrontmatter(text,'title').slice(0,80)||(/^[a-z0-9-]+$/.test(raw)?raw.replace(/-/g,' ').replace(/^./,c=>c.toUpperCase()):raw).slice(0,80);
 if(raw!==name)text=text.replace(/^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---)/,(_,start,header,end)=>start+header.replace(/^name:[^\n]*(?:\r?\n[ \t]+[^\n]*)*/m,'name: '+name)+end);
 return {name,title,description,text};
}
