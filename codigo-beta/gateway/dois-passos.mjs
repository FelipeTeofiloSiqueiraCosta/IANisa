// Verificação em dois passos (desde 28/10/2026): código de 6 dígitos de app autenticador (TOTP, RFC 6238:
// SHA-1, 30 s, aceita o código de antes e o de depois pro relógio torto), códigos de reserva e o QR code.
// Sem serviço de fora: o segredo nasce aqui e fica na conta da pessoa (contas.mjs, pessoas.json, 600).
import {createHmac,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import qrcode from 'qrcode-generator';

const ALFABETO='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PASSO=30e3;

export function base32(buf){
  let bits=0,valor=0,saida='';
  for(const b of buf){valor=(valor<<8)|b;bits+=8;while(bits>=5){saida+=ALFABETO[(valor>>>(bits-5))&31];bits-=5;}}
  if(bits>0)saida+=ALFABETO[(valor<<(5-bits))&31];
  return saida;
}
function deBase32(s){
  let bits=0,valor=0;const saida=[];
  for(const c of String(s).toUpperCase().replace(/[\s=-]/g,'')){
    const i=ALFABETO.indexOf(c);if(i<0)throw new Error('segredo inválido');
    valor=(valor<<5)|i;bits+=5;if(bits>=8){saida.push((valor>>>(bits-8))&255);bits-=8;}
  }
  return Buffer.from(saida);
}

export const novoSegredo=()=>base32(randomBytes(20));

// código de um passo (contador = número de períodos de 30 s desde 1970)
export function codigo(segredo,contador){
  const msg=Buffer.alloc(8);msg.writeBigUInt64BE(BigInt(contador));
  const h=createHmac('sha1',deBase32(segredo)).update(msg).digest();
  const o=h[h.length-1]&15;
  return String((h.readUInt32BE(o)&0x7fffffff)%1e6).padStart(6,'0');
}

// Confere o código. Devolve o contador que bateu (pra não aceitar o mesmo código de novo) ou null.
// `ultimo`: contador do último código aceito dessa pessoa; código igual ou mais velho não vale.
export function conferir(segredo,digitado,{agora=Date.now(),ultimo=-1}={}){
  const d=String(digitado??'').replace(/\s/g,'');
  if(!/^\d{6}$/.test(d))return null;
  const atual=Math.floor(agora/PASSO);
  for(const c of [atual,atual-1,atual+1]){
    if(c<=ultimo)continue;
    if(timingSafeEqual(Buffer.from(codigo(segredo,c)),Buffer.from(d)))return c;
  }
  return null;
}

// Códigos de reserva: 10, no formato xxxx-xxxx (sem letra que confunde), guardados só como hash.
const RESERVA='abcdefghjkmnpqrstuvwxyz23456789';
export function novasReservas(n=10){
  return Array.from({length:n},()=>{const b=randomBytes(8);let s='';for(const x of b)s+=RESERVA[x%RESERVA.length];return s.slice(0,4)+'-'+s.slice(4);});
}
export const normalizarReserva=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
export const hashReserva=s=>createHash('sha256').update('reserva:'+normalizarReserva(s)).digest('base64url');
export const pareceReserva=s=>/^[a-z0-9]{8}$/.test(normalizarReserva(s))&&!/^\d{8}$/.test(normalizarReserva(s));

export function endereco(segredo,{email,emissor='Ratoeira'}){
  const e=encodeURIComponent(emissor);
  return `otpauth://totp/${e}:${encodeURIComponent(email)}?secret=${segredo}&issuer=${e}&algorithm=SHA1&digits=6&period=30`;
}
// QR code em SVG (sem script, só retângulos): vai inline na tela de entrar e na de Tua conta.
export function qrSvg(texto){
  const q=qrcode(0,'M');q.addData(texto);q.make();
  return q.createSvgTag({cellSize:4,margin:4,scalable:true,alt:{text:'QR code pro app autenticador'}});
}
