// Multiusuário: cada e-mail do mapa tem um Paseo próprio, rodando como um usuário Linux,
// num socket unix que só o grupo do gateway abre. No socket o Paseo não pede senha: a trava
// é a permissão do arquivo (ver docs/2026-10-07-teste-paseo-por-usuario.md).
// Na config: "users": {"ana@x.com": "ana"} ou {"ana@x.com": {"user":"ana", "repoDir":"/home/ana/trabalho"}}.
// repoDir é a pasta que a área Arquivos mostra e onde o chat abre conversa nova; sem ele,
// a pessoa fica sem Arquivos. Quem não está no mapa cai no Paseo único de antes (upstreamPort).
export const SOCKET_PADRAO='/run/ratoeira-{user}/paseo.sock';

export function normalizeUsers(users,socketPattern=SOCKET_PADRAO){
  const mapa=new Map();
  if(users==null)return mapa;
  if(typeof users!=='object'||Array.isArray(users))throw new Error('Invalid gateway configuration');
  if(typeof socketPattern!=='string'||!socketPattern.startsWith('/')||!socketPattern.includes('{user}'))throw new Error('Invalid gateway configuration');
  for(const [email,valor] of Object.entries(users)){
    const entrada=typeof valor==='string'?{user:valor}:valor;
    const user=entrada?.user;
    // nome de usuário Linux comum: sem barra, ponto ou espaço, pra não escapar do padrão do socket
    if(!/^[^@\s]+@[^@\s]+$/.test(email)||typeof user!=='string'||!/^[a-z_][a-z0-9_-]{0,31}$/.test(user))throw new Error('Invalid gateway configuration');
    const repoDir=entrada.repoDir;
    if(repoDir!=null&&(typeof repoDir!=='string'||!repoDir.startsWith('/')||repoDir.split('/').includes('..')))throw new Error('Invalid gateway configuration');
    mapa.set(email.toLowerCase(),{user,socketPath:socketPattern.replaceAll('{user}',user),...(repoDir?{repoDir}:{})});
  }
  return mapa;
}

// Quem vai pra onde. Sem `users`: todo mundo no Paseo único, como no kit 0.1.0.
// Com `users`: quem está no mapa vai pro Paseo dele; o Paseo único só pra quem estiver na lista
// explícita `paseoCompartilhado` (migração aos poucos); o resto fica sem ambiente (403).
// Motivo: o Paseo único roda como um usuário com sudo (o dono da instalação). Um e-mail esquecido
// no mapa não pode ganhar esse Paseo por padrão.
export function createAcesso({users, paseoSocket, paseoCompartilhado}={}){
  const mapa=users instanceof Map?users:normalizeUsers(users,paseoSocket);
  if(paseoCompartilhado!=null&&(!Array.isArray(paseoCompartilhado)||!mapa.size||paseoCompartilhado.some(e=>typeof e!=='string'||!/^[^@\s]+@[^@\s]+$/.test(e)||mapa.has(e.toLowerCase()))))
    throw new Error('Invalid gateway configuration');
  const compartilhado=new Set((paseoCompartilhado??[]).map(e=>e.toLowerCase()));
  return {
    users:mapa,
    usaPaseoUnico:!mapa.size||compartilhado.size>0,
    // {pessoa} = Paseo próprio; {unico:true} = Paseo único; null = sem ambiente
    ambiente(email){
      const pessoa=mapa.get(email);
      if(pessoa)return {pessoa};
      return !mapa.size||compartilhado.has(email)?{unico:true}:null;
    },
  };
}
