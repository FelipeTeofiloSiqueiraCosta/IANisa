import { uid } from './state.js';

export const intakeFields=[
  {id:'audience',label:'Público',question:'Para quem é esse trabalho?',hint:'Quem deve receber a mensagem? Pode descrever o público sem usar termos técnicos.',placeholder:'Ex.: Pessoas que já compram nossa coleção…'},
  {id:'deliverables',label:'Entregas e formatos',question:'O que precisa ficar pronto?',hint:'Conte quais materiais, quantidades e formatos você precisa. Em vídeo, vale informar duração, cortes e legendas.',placeholder:'Ex.: 3 vídeos verticais de 30 segundos, com legendas…'},
  {id:'channels',label:'Canais',question:'Onde esse material vai ser usado?',hint:'Assim o time prepara o conteúdo no formato certo para cada lugar.',placeholder:'Ex.: Instagram Reels e página da campanha…'},
  {id:'deadline',label:'Prazo',question:'Para quando você precisa?',hint:'Se ainda não houver uma data, você pode pedir ao diretor para propor um prazo no planejamento.',placeholder:'Ex.: Até 20/11, às 18h, no horário de Brasília…',alternative:'Ainda sem data; o diretor deve propor um prazo no plano.'},
  {id:'offer',label:'Oferta e condições',question:'Qual oferta pode ser divulgada?',hint:'Precisamos combinar desconto, condições e limites antes de criar a campanha. Não vamos inventar preços ou promessas.',placeholder:'Ex.: Sem desconto; apresentar a coleção e convidar para a lista de interesse…',alternative:'Não divulgar preço ou desconto. O diretor deve confirmar a oferta no plano.'},
  {id:'assets',label:'Materiais e referências',question:'Quais materiais o time deve usar?',hint:'Indique o roteiro, os arquivos brutos, referências ou a pasta de trabalho. Se for produzir do zero, diga isso.',placeholder:'Ex.: Usar o roteiro aprovado e os arquivos da pasta da campanha…',alternative:'Produzir do zero, usando as referências disponíveis no cérebro.'},
];
const fieldById=id=>intakeFields.find(f=>f.id===id);
const plain=text=>String(text||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const editingIntent=text=>/\b(?:editar|edite|edicao)\b|\beditor(?:a)? de video\b/.test(plain(text));
const labelled=(text,labels)=>{for(const line of text.split('\n')){const match=line.match(/^\s*([^:]+):\s*(.+)$/);if(match&&labels.includes(plain(match[1])))return match[2].trim();}return '';};
export function createIntakeDraft(preferredMemberId=null){return {version:1,id:uid(),preferredMemberId,stage:'intro',request:'',title:'',answers:{},sources:{},answerDrafts:{},history:[],approvalMode:'director',createdAt:Date.now()};}
export function recordIntakeRequest(draft,text){
  text=String(text||'').trim();if(!text)throw new Error('Conte o que você precisa para começar a conversa.');
  const changed=text!==draft.request;draft.request=text;
  if(changed){draft.answers={};draft.sources={};draft.answerDrafts={};delete draft.editingKey;draft.title='';draft.history=[{role:'user',text,kind:'request'}];}
  const normalized=plain(text);draft.scope=draft.preferredMemberId||editingIntent(text)?'single':/campanha|black friday|lancamento/.test(normalized)?'campaign':'single';
  const explicit={
    audience:labelled(text,['publico','para quem','audiencia']),deliverables:labelled(text,['entregas','formatos','entregas e formatos']),channels:labelled(text,['canais','onde']),
    deadline:labelled(text,['prazo','data']),offer:labelled(text,['oferta','oferta e condicoes','condicoes']),assets:labelled(text,['materiais','referencias','materiais e referencias','arquivos']),
  };
  if(!explicit.audience)explicit.audience=text.match(/(?:p[úu]blico(?:-alvo)?(?:\s+(?:[ée]|de|s[ãa]o))?\s*:?\s*)([^.\n;]+)/i)?.[1]||'';
  if(!explicit.audience)explicit.audience=text.match(/\bpara\s+(?:(?:os|as)\s+)?(?:clientes|pessoas|mulheres|homens|empresas|lojistas|profissionais|consumidores|alunos|empreendedores)\b[^.\n;]*/i)?.[0]||'';
  if(!explicit.deadline)explicit.deadline=text.match(/(?:\bat[ée]\s+|\bprazo\s+(?:de\s+)?)([^.\n;]+)/i)?.[0]||(/sem (?:prazo|data)/i.test(text)?'Sem data definida; o diretor deve propor um prazo no plano.':'');
  if(!explicit.deadline)explicit.deadline=text.match(/\bpara\s+(?:amanh[ãa]|hoje|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|\d{1,2}\/\d{1,2})[^.\n;]*/i)?.[0]||'';
  if(!explicit.channels){const matches=[...text.matchAll(/instagram(?:\s+reels)?|tiktok|youtube(?:\s+shorts)?|linkedin|whatsapp|e-mail|email|landing page|p[áa]gina(?: da campanha)?|meta ads/gi)].map(m=>m[0]);explicit.channels=[...new Set(matches)].join(' · ');}
  if(!explicit.deliverables)explicit.deliverables=text.split(/[.\n]/).find(line=>/\d+\s*(?:s|segundos|minutos|posts?|carross[ée]is|v[íi]deos?|banners?|pe[çc]as?)\b/i.test(line))||'';
  if(!explicit.offer)explicit.offer=text.match(/(?:\b\d+\s*%\s*(?:de\s*)?(?:desconto|off)|\bsem desconto|\bn[ãa]o (?:anunciar|divulgar) (?:pre[çc]o|desconto))[^.\n;]*/i)?.[0]||'';
  if(!explicit.assets)explicit.assets=text.match(/(?:\b(?:j[áa] )?(?:tenho|temos|possuo|usar|use|utilizar)\s+(?:(?:o|os|a|as|um|uma)\s+)?(?:roteiro|arquivos?|brutos?|refer[êe]ncias?|pasta)|\bproduzir do zero)[^.\n;]*/i)?.[0]||'';
  for(const [id,value] of Object.entries(explicit))if(value&&!draft.answers[id]){draft.answers[id]=String(value).trim();draft.sources[id]='request';}
  draft.title=draft.title||(draft.scope==='campaign'&&/black friday/i.test(text)?'Campanha de Black Friday':editingIntent(text)?'Edição de vídeo':text.split(/[.\n]/)[0].slice(0,95));
  draft.stage=nextIntakeQuestion(draft)?'questions':'summary';return draft;
}
export const requiredIntakeFields=draft=>intakeFields.filter(f=>f.id!=='offer'||draft.scope==='campaign');
export const nextIntakeQuestion=draft=>draft.editingKey?fieldById(draft.editingKey):requiredIntakeFields(draft).find(f=>!String(draft.answers[f.id]||'').trim())||null;
export function answerIntakeQuestion(draft,id,text){
  const q=nextIntakeQuestion(draft),answer=String(text||'').trim();if(!q||q.id!==id)throw new Error('Esta pergunta já foi respondida. Confira o resumo do pedido.');if(!answer)throw new Error('Responda a pergunta ou escolha a opção sugerida.');
  draft.answers[id]=answer;draft.sources[id]='interview';delete draft.answerDrafts[id];
  draft.history.push({role:'assistant',text:q.question,field:id},{role:'user',text:answer,field:id});
  const editing=Boolean(draft.editingKey);delete draft.editingKey;draft.stage=editing?'summary':nextIntakeQuestion(draft)?'questions':'summary';return draft;
}
export function intakeContext(state){return state.brain.entries.filter(e=>['brand','voice','business'].includes(e.category)).map(e=>({id:e.id,title:e.title,content:e.content,palette:e.palette||[]}));}
export function intakeSummary(state,draft){
  const items=requiredIntakeFields(draft).map(f=>({id:f.id,label:f.label,value:draft.answers[f.id]||'',source:draft.sources[f.id]||'missing'})),knowledge=intakeContext(state);
  const criteria=items.map(f=>`${f.label}: ${f.value}`).join('\n')+'\nRegras da empresa: '+(knowledge.map(k=>k.title).join('; ')||'seguir as orientações do briefing; referências da empresa ainda não cadastradas.');
  return {items,knowledge,criteria};
}
export function confirmIntake(state,draft){
  if(!draft.request.trim()||nextIntakeQuestion(draft)||draft.stage!=='summary')throw new Error('Conclua a conversa e confira o resumo antes de enviar ao diretor.');
  if(!draft.title.trim())throw new Error('Dê um nome ao pedido antes de enviar.');
  const summary=intakeSummary(state,draft),confirmedAt=new Date().toISOString();
  let preferredMemberId=draft.preferredMemberId;
  if(!preferredMemberId&&draft.scope==='single'&&editingIntent(draft.request))preferredMemberId=state.members.find(m=>/editor/i.test(m.role))?.id||null;
  return {title:draft.title.trim(),preferredMemberId,brief:draft.request+'\n\nBRIEFING CONFERIDO NA ENTREVISTA\n'+summary.items.map(f=>`${f.label}: ${f.value}`).join('\n')+'\nRegras da empresa: '+summary.knowledge.map(k=>k.title).join('; '),
    reviewPolicy:{mode:draft.approvalMode==='human'?'human':'director',criteria:summary.criteria},
    intake:{version:1,id:draft.id,request:draft.request,answers:structuredClone(draft.answers),sources:{...draft.sources},history:structuredClone(draft.history),knowledge:summary.knowledge,brainRevision:state.brain.revision,confirmedAt,scope:draft.scope}};
}
export const interviewExample={request:'Quero uma campanha de Black Friday para a nova coleção. Precisamos de 3 vídeos verticais de 30 segundos com legendas, uma página e anúncios para Instagram Reels e Meta Ads.',answers:{
  audience:'Clientes que já acompanham a marca e pessoas interessadas na nova coleção.',deliverables:'3 vídeos verticais de 30 segundos com legendas, textos para Instagram, página da campanha e peças de anúncios.',channels:'Instagram Reels, página da campanha e Meta Ads.',
  deadline:'Até 20/11/2026, às 18h, no horário de Brasília.',offer:'Apresentar a coleção e convidar para a lista de interesse. Não anunciar desconto, preço ou condição comercial ainda não aprovada.',
  assets:'Usar o roteiro e os arquivos brutos indicados na pasta “Campanha Black Friday / Materiais”. A pasta é apenas uma referência de demonstração; nenhum arquivo real foi anexado.',
}};
