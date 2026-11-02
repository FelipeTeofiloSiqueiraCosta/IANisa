// Independente do codigo-beta. Inspiração: gateway/contas.mjs e entrada.mjs.
// Uma organização por instalação; identidades e permissões pertencem ao servidor.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';

const scrypt = promisify(scryptCallback);
const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const HOUR = 3600000, DAY = 24 * HOUR;
export const TTL = { setup: HOUR, invite: DAY, reset: HOUR, session: 12 * HOUR, remember: 14 * DAY, idle: DAY };
export const digest = value => createHash('sha256').update(String(value)).digest('base64url');
const token = () => randomBytes(32).toString('base64url');
export function problem(status, message) { return Object.assign(new Error(message), { status }); }
const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.created_at, lastLoginAt: u.last_login_at });
const emailOf = value => {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@<>"'\\]{1,64}@[^\s@<>"'\\]+\.[^\s@<>"'\\]+$/.test(email)) throw problem(400, 'Informe um e-mail válido.');
  return email;
};
const nameOf = (value, label = 'nome') => {
  const name = String(value ?? '').trim();
  if (!name || name.length > 80 || /[\x00-\x1f\x7f<>]/.test(name)) throw problem(400, `Informe um ${label} de até 80 caracteres.`);
  return name;
};
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) throw problem(400, 'Use uma senha de 12 a 200 caracteres.');
}
async function hashPassword(password) {
  validatePassword(password);
  const salt = randomBytes(16).toString('base64url');
  const key = await scrypt(password.normalize('NFC'), salt, 32, COST);
  return `scrypt$${salt}$${key.toString('base64url')}`;
}
async function verifyPassword(password, stored) {
  const [, salt, encoded] = stored.split('$');
  const expected = Buffer.from(encoded, 'base64url');
  const actual = await scrypt(String(password ?? '').normalize('NFC'), salt, 32, COST);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createAccounts({ directory, now = Date.now }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const filename = path.join(directory, 'access.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS organization (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','member')), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, last_login_at INTEGER);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, hash TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
      email TEXT, name TEXT, role TEXT, created_by TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', used_at INTEGER);
    CREATE TABLE IF NOT EXISTS attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, target TEXT, at INTEGER NOT NULL);
  `);
  if(db.prepare('SELECT count(*) AS n FROM organization').get().n>1){db.close();throw new Error('Esta instalação aceita somente uma empresa. Confira o backup de acesso.');}
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS organization_single_installation ON organization((1))');
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
  const org = () => get('SELECT * FROM organization LIMIT 1') ?? null;
  const userById = id => get('SELECT * FROM users WHERE id = ?', id);
  const audit = (actor, action, target = null) => run('INSERT INTO audit(actor_id,action,target,at) VALUES (?,?,?,?)', actor ?? null, action, target, now());
  const dummyHash = await hashPassword(token());
  // Não deixa pedidos paralelos de scrypt consumirem memória sem limite.
  let hashing = 0;
  async function expensive(fn) { if (hashing >= 2) throw problem(429, 'Há muitas tentativas agora. Aguarde alguns segundos.'); hashing++; try { return await fn(); } finally { hashing--; } }
  function throttle(key, limit, duration = 15 * 60000) {
    const k = digest(key), old = get('SELECT * FROM attempts WHERE key = ?', k);
    if (old?.until_at > now() && old.count >= limit) throw problem(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.');
    run('INSERT INTO attempts(key,count,until_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,until_at=excluded.until_at', k, old?.until_at > now() ? old.count + 1 : 1, old?.until_at > now() ? old.until_at : now() + duration);
    run('DELETE FROM attempts WHERE until_at < ?', now());
  }
  function liveLink(raw, kinds) {
    if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw problem(410, 'Este link é inválido, expirou ou já foi usado. Peça um novo link ao administrador.');
    const l = get('SELECT * FROM links WHERE hash = ?', digest(raw));
    if (!l || l.status !== 'pending' || l.expires_at <= now() || !kinds.includes(l.kind)) throw problem(410, 'Este link é inválido, expirou ou já foi usado. Peça um novo link ao administrador.');
    return l;
  }
  function newLink(kind, fields = {}) {
    const raw = token(), id = randomUUID(), expiresAt = now() + TTL[kind];
    if (fields.email) run("UPDATE links SET status='revoked' WHERE kind=? AND email=? AND status='pending'", kind, fields.email);
    else if (kind === 'setup') run("UPDATE links SET status='revoked' WHERE kind='setup' AND status='pending'");
    run('INSERT INTO links(id,hash,kind,email,name,role,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)', id, digest(raw), kind, fields.email ?? null, fields.name ?? null, fields.role ?? null, fields.createdBy ?? null, now(), expiresAt);
    return { id, token: raw, expiresAt, email: fields.email, name: fields.name, role: fields.role };
  }
  function sessionFor(user, remember = false) {
    const raw = token(), expiresAt = now() + (remember ? TTL.remember : TTL.session);
    run('DELETE FROM sessions WHERE expires_at <= ? OR last_seen <= ?', now(), now() - TTL.idle);
    // Cada conta mantém no máximo dez sessões.
    run('DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 9)', user.id);
    run('INSERT INTO sessions VALUES (?,?,?,?,?)', digest(raw), user.id, now(), expiresAt, now());
    return { token: raw, expiresAt, maxAge: Math.floor((expiresAt - now()) / 1000), user: publicUser(user), organization: org(), csrf: digest('csrf:' + raw) };
  }
  function authenticated(raw) {
    const s = raw && get('SELECT * FROM sessions WHERE hash=?', digest(raw));
    const u = s && userById(s.user_id);
    if (!s || s.expires_at <= now() || s.last_seen + TTL.idle <= now() || u?.status !== 'active') throw problem(401, 'Sua sessão terminou. Entre novamente.');
    if (now() - s.last_seen > 60000) run('UPDATE sessions SET last_seen=? WHERE hash=?', now(), s.hash);
    return { user: publicUser(u), organization: org(), csrf: digest('csrf:' + raw), expiresAt: s.expires_at };
  }
  function admin(raw) { const a = authenticated(raw); if (a.user.role !== 'admin') throw problem(403, 'Somente administradores podem gerenciar pessoas e convites.'); return a; }
  function inviteView(l) { return { id:l.id, email:l.email, name:l.name, role:l.role, createdAt:l.created_at, expiresAt:l.expires_at, status:l.status === 'pending' && l.expires_at <= now() ? 'expired' : l.status }; }
  return {
    close: () => db.close(),
    initialized: () => Boolean(org()),
    createSetupLink() { if (org()) return null; return transaction(() => newLink('setup')); },
    inspectLink(raw, kind) {
      const l = liveLink(raw, [kind]);
      if (kind === 'setup' && org()) throw problem(410, 'O primeiro acesso já foi configurado. Entre com sua conta.');
      if (kind === 'reset' && get('SELECT status FROM users WHERE email=?', l.email)?.status !== 'active') throw problem(410, 'Este link não está mais disponível.');
      return { name:l.name, email:l.email, role:l.role, expiresAt:l.expires_at, organization:org() };
    },
    async setup(input, ip) {
      throttle('setup:' + ip, 15); liveLink(input.token, ['setup']);
      const email = emailOf(input.email), name = nameOf(input.name), organization = nameOf(input.organization, 'nome da empresa');
      const passwordHash = await expensive(() => hashPassword(input.password));
      return transaction(() => {
        if (org()) throw problem(409, 'O primeiro acesso já foi configurado.');
        const l = liveLink(input.token, ['setup']), id = randomUUID();
        run('INSERT INTO organization VALUES (?,?)', randomUUID(), organization);
        run('INSERT INTO users(id,email,name,role,password_hash,created_at,last_login_at) VALUES (?,?,?,?,?,?,?)', id, email, name, 'admin', passwordHash, now(), now());
        run("UPDATE links SET status='used',used_at=? WHERE id=?", now(), l.id);
        audit(id, 'setup', id);
        return sessionFor(userById(id));
      });
    },
    async login(input, ip) {
      throttle('login-ip:' + ip, 30);
      const email = emailOf(input.email); throttle('login:' + ip + ':' + email, 5);
      if (typeof input.password !== 'string' || input.password.length > 200) throw problem(401, 'E-mail ou senha incorretos.');
      const u = get('SELECT * FROM users WHERE email=?', email);
      const valid = await expensive(() => verifyPassword(input.password, u?.password_hash ?? dummyHash));
      if (!valid || u?.status !== 'active') throw problem(401, 'E-mail ou senha incorretos.');
      return transaction(() => {
        const current = userById(u.id);
        if (current.status !== 'active' || current.password_hash !== u.password_hash) throw problem(401, 'E-mail ou senha incorretos.');
        run('DELETE FROM attempts WHERE key=?', digest('login:' + ip + ':' + email));
        run('UPDATE users SET last_login_at=? WHERE id=?', now(), u.id);
        audit(u.id, 'login');
        return sessionFor(userById(u.id), input.remember === true);
      });
    },
    authenticated,
    logout(raw) { run('DELETE FROM sessions WHERE hash=?', digest(raw)); },
    list(raw) { admin(raw); return { users:all('SELECT * FROM users ORDER BY created_at').map(publicUser), invitations:all("SELECT * FROM links WHERE kind='invite' ORDER BY created_at DESC LIMIT 200").map(inviteView) }; },
    invite(raw, input) {
      const a = admin(raw), email = emailOf(input.email), name = nameOf(input.name);
      if (!['admin','member'].includes(input.role)) throw problem(400, 'Escolha Administrador ou Membro.');
      return transaction(() => {
        if (get('SELECT id FROM users WHERE email=?', email)) throw problem(409, 'Essa pessoa já possui uma conta. Gerencie o acesso na lista de pessoas.');
        if (get("SELECT id FROM links WHERE kind='invite' AND email=? AND status='pending' AND expires_at>?", email, now())) throw problem(409, 'Já existe um convite pendente para este e-mail. Gere um novo link na lista de convites.');
        const l = newLink('invite', { email, name, role:input.role, createdBy:a.user.id }); audit(a.user.id, 'invite', l.id); return l;
      });
    },
    renewInvite(raw, id) {
      const a = admin(raw);
      return transaction(() => {
        const l = get("SELECT * FROM links WHERE id=? AND kind='invite'", id);
        if (!l || l.status === 'used' || get('SELECT id FROM users WHERE email=?', l.email)) throw problem(409, 'Este convite já foi aceito ou não está disponível.');
        const result = newLink('invite', { email:l.email, name:l.name, role:l.role, createdBy:a.user.id }); audit(a.user.id, 'renew-invite', result.id); return result;
      });
    },
    revokeInvite(raw, id) {
      const a = admin(raw);
      if (!run("UPDATE links SET status='revoked' WHERE id=? AND kind='invite' AND status='pending'", id).changes) throw problem(409, 'Este convite não está mais pendente.');
      audit(a.user.id, 'revoke-invite', id);
    },
    async accept(input, ip, rawSession) {
      throttle('accept:' + ip, 20); const l = liveLink(input.token, ['invite','reset']);
      // Um convite não troca silenciosamente a identidade de alguém que está conectado.
      if (rawSession) { let a; try { a = authenticated(rawSession); } catch {} if (a && a.user.email !== l.email) throw problem(409, 'Você está conectado com outra conta. Saia antes de usar este link.'); }
      const name = l.kind === 'invite' ? nameOf(input.name) : l.name;
      const passwordHash = await expensive(() => hashPassword(input.password));
      return transaction(() => {
        const current = liveLink(input.token, ['invite','reset']); let u = get('SELECT * FROM users WHERE email=?', current.email);
        if (current.kind === 'invite') {
          if (u) throw problem(409, 'Essa conta já existe. Entre com sua senha.');
          const id = randomUUID(); run('INSERT INTO users(id,email,name,role,password_hash,created_at,last_login_at) VALUES (?,?,?,?,?,?,?)', id, current.email, name, current.role, passwordHash, now(), now()); u = userById(id);
        } else {
          if (u?.status !== 'active') throw problem(410, 'Este link não está mais disponível.');
          run('UPDATE users SET password_hash=? WHERE id=?', passwordHash, u.id);
          run('DELETE FROM sessions WHERE user_id=?', u.id);
        }
        run("UPDATE links SET status='used',used_at=? WHERE id=?", now(), current.id);
        audit(u.id, current.kind === 'invite' ? 'accept-invite' : 'reset-password', u.id);
        return sessionFor(userById(u.id));
      });
    },
    updateUser(raw, id, input) {
      const a = admin(raw);
      return transaction(() => {
        const u = userById(id); if (!u) throw problem(404, 'Pessoa não encontrada.');
        const role = input.role ?? u.role, status = input.status ?? u.status;
        if (!['admin','member'].includes(role) || !['active','disabled'].includes(status)) throw problem(400, 'Permissão ou situação inválida.');
        if (id === a.user.id && (status !== 'active' || role !== 'admin')) throw problem(409, 'Você não pode remover o próprio acesso de administrador.');
        if (u.role === 'admin' && u.status === 'active' && (role !== 'admin' || status !== 'active') && get("SELECT count(*) AS n FROM users WHERE role='admin' AND status='active'").n <= 1) throw problem(409, 'A organização precisa de pelo menos um administrador.');
        run('UPDATE users SET role=?,status=? WHERE id=?', role, status, id);
        if (status === 'disabled') { run('DELETE FROM sessions WHERE user_id=?', id); run("UPDATE links SET status='revoked' WHERE email=? AND status='pending'", u.email); }
        audit(a.user.id, 'update-access', id); return publicUser(userById(id));
      });
    },
    resetLink(raw, id) {
      const a = admin(raw), u = userById(id);
      if (!u || u.status !== 'active') throw problem(409, 'A conta precisa estar ativa para recuperar a senha.');
      return transaction(() => { const l = newLink('reset', { email:u.email, name:u.name, createdBy:a.user.id }); audit(a.user.id, 'reset-link', id); return l; });
    },
    async changePassword(raw, input, ip) {
      const a = authenticated(raw), u = userById(a.user.id); throttle('password:' + ip + ':' + u.id, 5);
      if (typeof input.currentPassword !== 'string' || input.currentPassword.length > 200) throw problem(400, 'Informe sua senha atual.');
      const valid = await expensive(() => verifyPassword(input.currentPassword, u.password_hash));
      if (!valid) throw problem(400, 'A senha atual está incorreta.');
      const hash = await expensive(() => hashPassword(input.password));
      return transaction(() => {
        authenticated(raw); if (userById(u.id).password_hash !== u.password_hash) throw problem(409, 'A senha foi alterada. Entre novamente.');
        run('UPDATE users SET password_hash=? WHERE id=?', hash, u.id);
        run('DELETE FROM sessions WHERE user_id=?', u.id);
        run("UPDATE links SET status='revoked' WHERE kind='reset' AND email=? AND status='pending'", u.email);
        audit(u.id, 'change-password', u.id); return sessionFor(userById(u.id));
      });
    },
  };
}
