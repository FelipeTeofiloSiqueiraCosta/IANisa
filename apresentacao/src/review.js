// This preview uses explicit fixtures, never a text heuristic or a real AI review.
export const reviewCriteria=[['brief','Objetivo e briefing'],['brand','Regras da empresa'],['quality','Qualidade da entrega']];
export const defaultReviewCriteria='Atender ao briefing, respeitar as regras do cérebro e entregar material consistente para a próxima etapa.';
export const normalizeReviewPolicy=(policy={})=>({mode:policy?.mode==='human'?'human':'director',criteria:String(policy?.criteria||defaultReviewCriteria).trim()||defaultReviewCriteria});
export const reviewPolicyFor=(state,task)=>normalizeReviewPolicy(state.campaigns.find(c=>c.id===task.campaignId)?.plan.reviewPolicy);
export function beginDirectorReview(state,policy,scenario='pass',previous=null,now=Date.now()){
  return {status:'pending',engine:'director-preview-v1',dueAt:now+2600,submittedAt:new Date(now).toISOString(),
    scenario:['pass','changes','unclear'].includes(scenario)?scenario:'unclear',policy:normalizeReviewPolicy(policy),
    brainRevision:state.brain.revision,knowledge:state.brain.entries.filter(e=>e.category!=='result').map(e=>({id:e.id,title:e.title,content:e.content,palette:e.palette||[]})),
    history:previous?.history||[]};
}
export function evaluateDirectorReview(state,review){
  const changed=review.brainRevision!==state.brain.revision,unclear=review.scenario==='unclear'||changed;
  const palette=review.knowledge.flatMap(e=>e.palette).join(', ')||'as cores oficiais cadastradas no cérebro';
  const findings=reviewCriteria.map(([id,label])=>({id,label,status:unclear?'unclear':review.scenario==='changes'&&id==='brand'?'failed':'passed',
    reason:unclear?(changed?'As regras mudaram durante a revisão. Precisamos confirmar qual versão deve orientar esta entrega.':'O cenário não fornece evidência suficiente para concluir este critério.'):
      id==='brief'?'O exemplo contempla o objetivo, os canais e os formatos combinados.':id==='brand'&&review.scenario==='changes'?`A proposta usa uma cor fora da paleta. Substituir pela paleta aprovada: ${palette}.`:id==='brand'?'O exemplo segue a paleta, o tom da marca e as condições combinadas.':'O exemplo está organizado e tem o contexto necessário para a próxima etapa.'}));
  // Failures return to the owner even when an additional human approval is configured.
  const failed=findings.filter(f=>f.status==='failed'),needsHuman=unclear||review.policy.mode==='human';
  const decision=failed.length?'changes':needsHuman?'awaiting_user':'approve';
  const feedback=failed.length?failed.map(f=>f.reason).join('\n'):unclear?'Preciso de uma definição do usuário: '+findings[0].reason:needsHuman?'Os critérios foram atendidos. Esta campanha foi configurada para também exigir sua aprovação.':'A entrega atende ao combinado. Aprovo e libero o resultado para a próxima etapa.';
  return {decision,feedback,findings,checks:findings.filter(f=>f.status==='passed').map(f=>f.id),evaluatedAt:new Date().toISOString(),brainRevision:review.brainRevision};
}
