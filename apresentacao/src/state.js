export const STORE_KEY = 'ianiza:marketing-preview:v1' + (globalThis.document?.documentElement?.dataset.previewScope ? ':' + document.documentElement.dataset.previewScope : '');
export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const catalog = {
  connectors: {
    drive: { name: 'Google Drive', short: 'D', color: '#278554', note: 'Arquivos e referências da equipe' },
    canva: { name: 'Canva', short: 'C', color: '#0b9d9b', note: 'Designs e identidade visual' },
    meta: { name: 'Meta Ads', short: '∞', color: '#3076df', note: 'Campanhas e resultados' },
    figma: { name: 'Figma', short: 'F', color: '#a05bce', note: 'Layouts e componentes' },
    youtube: { name: 'YouTube', short: '▶', color: '#d95646', note: 'Vídeos e referências' },
    notion: { name: 'Notion', short: 'N', color: '#333b35', note: 'Briefings e planejamento' },
    vercel: { name: 'Vercel', short: '▲', color: '#303a32', note: 'Páginas e publicações' },
  },
  skills: ['Criação de roteiros', 'Edição de vídeo', 'Vídeos para redes sociais', 'Planejamento de conteúdo', 'Análise de campanhas', 'Copy de conversão', 'Identidade visual', 'Landing pages', 'Pesquisa de referências', 'Revisão de conteúdo', 'Direção criativa'],
};
const session = (id, title, status, progress, step, minutes, messages = []) => ({ id, title, status, progress, step, minutes, messages, createdAt: Date.now(), queued: [] });
const msg = (role, text) => ({ id: uid(), role, text, time: 'Agora' });
export function initialState() {
  return {
    version: 1,
    members: [
      { id: 'clara', name: 'Clara', role: 'Head de marketing', type: 'human', color: '#d38e65', connectors: ['drive', 'notion', 'meta'], skills: ['Direção criativa', 'Planejamento de conteúdo'], sessions: [session('clara-1', 'Planejamento da campanha de novembro', 'waiting', 70, 'Revisando a proposta da campanha', 24, [msg('assistant', 'A proposta da campanha está pronta para sua revisão. Organizei os objetivos, a linha criativa e as entregas de cada pessoa.'), msg('user', 'Vamos priorizar a campanha de lançamento e manter uma linguagem próxima do nosso público.')])] },
      { id: 'vico', name: 'Vico', role: 'Videomaker', type: 'robot', color: '#e59465', connectors: ['drive', 'youtube', 'canva'], skills: ['Criação de roteiros', 'Vídeos para redes sociais', 'Pesquisa de referências'], sessions: [session('vico-1', 'Roteiro do vídeo de lançamento', 'working', 64, 'Criando as cenas e a narrativa', 8, [msg('user', 'Crie um roteiro de 45 segundos para o lançamento da nova coleção. O vídeo vai para o Instagram.'), msg('assistant', 'Já organizei as referências e defini uma narrativa em três momentos: a descoberta, os detalhes da coleção e o convite final. Agora estou desenvolvendo as cenas e as falas. O tom está leve, próximo e cheio de personalidade.')]), session('vico-2', 'Três ideias para Reels da semana', 'working', 35, 'Pesquisando referências visuais', 3, [msg('assistant', 'Estou buscando referências de vídeos curtos para transformar os diferenciais da coleção em três ideias de Reels.')]), session('vico-3', 'Vídeo institucional · versão final', 'done', 100, 'Roteiro e lista de cenas entregues', 42, [msg('assistant', 'Tudo pronto! O roteiro final tem 60 segundos, com a descrição de cada cena e sugestões de trilha. A versão foi organizada para o editor de vídeo.')])] },
      { id: 'lia', name: 'Lia', role: 'Social media', type: 'robot', color: '#9baf83', connectors: ['notion', 'canva', 'drive'], skills: ['Planejamento de conteúdo', 'Revisão de conteúdo'], sessions: [session('lia-1', 'Calendário de conteúdo · novembro', 'working', 48, 'Distribuindo os temas da semana', 12, [msg('assistant', 'Separei os conteúdos em descoberta, relacionamento e conversão. Estou organizando a primeira semana do calendário.')]), session('lia-2', 'Legendas da campanha', 'done', 100, 'Cinco legendas prontas', 34)] },
      { id: 'theo', name: 'Theo', role: 'Gestor de tráfego', type: 'robot', color: '#85a8b6', connectors: ['meta', 'drive', 'notion'], skills: ['Análise de campanhas', 'Pesquisa de referências'], sessions: [session('theo-1', 'Análise dos anúncios da coleção', 'waiting', 82, 'Aguardando sua decisão de orçamento', 16, [msg('assistant', 'O conjunto com vídeos curtos apresentou o melhor resultado. Posso preparar uma redistribuição do orçamento para você revisar? Nenhuma alteração foi feita nas campanhas.')])] },
      { id: 'cora', name: 'Cora', role: 'Copywriter', type: 'robot', color: '#c397a5', connectors: ['notion', 'drive'], skills: ['Copy de conversão', 'Revisão de conteúdo'], sessions: [session('cora-1', 'Textos da página de lançamento', 'working', 72, 'Refinando os títulos e chamadas', 7, [msg('assistant', 'A estrutura da página está definida. Agora estou refinando os títulos e as chamadas para manter uma mensagem clara do início ao fim.')])] },
      { id: 'duna', name: 'Duna', role: 'Designer', type: 'robot', color: '#c6ac6b', connectors: ['canva', 'figma', 'drive'], skills: ['Identidade visual', 'Pesquisa de referências'], sessions: [session('duna-1', 'Identidade visual da campanha', 'done', 100, 'Painel visual aprovado', 55, [msg('assistant', 'O painel visual está pronto: cores quentes, tipografia expressiva e uma direção fotográfica natural. Pode me passar a próxima criação.')])] },
      { id: 'noah', name: 'Noah', role: 'Web designer', type: 'robot', color: '#a6a0c4', connectors: ['figma', 'vercel', 'drive'], skills: ['Landing pages', 'Identidade visual'], sessions: [session('noah-1', 'Landing page da nova coleção', 'working', 41, 'Montando a primeira versão da página', 14, [msg('assistant', 'Estou montando a página com destaque para os produtos, os diferenciais da coleção e um caminho simples até a compra.')])] },
      { id: 'lucas', name: 'Lucas', role: 'Editor de vídeo', type: 'human', color: '#7b9e8c', connectors: ['drive', 'youtube'], skills: ['Edição de vídeo', 'Vídeos para redes sociais'], sessions: [session('lucas-1', 'Edição do teaser · coleção nova', 'working', 57, 'Ajustando os cortes e a trilha', 21, [msg('user', 'Organize uma lista com os cortes e as marcações de tempo para o teaser.'), msg('assistant', 'A lista de cortes está organizada. Estou conferindo o ritmo das transições com a trilha escolhida.')])] },
    ],
    activity: [
      { id: uid(), member: 'duna', text: 'finalizou a identidade visual da campanha', time: 'Há 5 min', kind: 'done' },
      { id: uid(), member: 'theo', text: 'precisa de uma decisão sobre o orçamento', time: 'Há 8 min', kind: 'waiting' },
      { id: uid(), member: 'vico', text: 'começou o roteiro do vídeo de lançamento', time: 'Há 12 min', kind: 'working' },
    ],
  };
}
export function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s?.version === 1 && Array.isArray(s.members) && Array.isArray(s.activity) && s.members.every(m => typeof m.id === 'string' && typeof m.name === 'string' && Array.isArray(m.sessions) && Array.isArray(m.connectors) && Array.isArray(m.skills) && m.sessions.every(s => Array.isArray(s.messages) && Array.isArray(s.queued)))) return s;
  } catch {}
  return initialState();
}
export function saveState(state) { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {} }
export const statusOf = m => m.sessions.some(s => s.status === 'waiting' || s.review?.status === 'awaiting_user') ? 'waiting' : m.sessions.some(s => s.status === 'changes') ? 'changes' : m.sessions.some(s => s.status === 'working') ? 'working' : m.sessions.some(s => s.status === 'review') ? 'review' : m.sessions.some(s => s.status === 'blocked') ? 'blocked' : m.sessions.some(s => s.status === 'assigned') ? 'assigned' : m.sessions.some(s => s.status === 'paused') ? 'paused' : 'available';
export const statusLabels = { working:'Trabalhando',waiting:'Precisa de você',available:'Disponível',paused:'Em pausa',done:'Aprovada pelo diretor',review:'Em revisão',changes:'Ajustes solicitados',blocked:'Aguardando o time',assigned:'Tarefa recebida' };
export const activeSessions = m => m.sessions.filter(s => s.status !== 'done');
