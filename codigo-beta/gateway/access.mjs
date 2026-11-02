import { createRemoteJWKSet, jwtVerify } from 'jose';

export function createAccessVerifier({ issuer, audience, allowedEmails }, key) {
  if (!issuer?.startsWith('https://') || !audience || !allowedEmails?.length) {
    throw new Error('Missing Access configuration');
  }
  const keys = key ?? createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer));
  const allowed = new Set(allowedEmails.map(email => email.toLowerCase()));
  return async token => {
    if (typeof token !== 'string' || token.length > 16384) throw new Error('Invalid identity');
    const { payload } = await jwtVerify(token, keys, {
      issuer, audience, algorithms: ['RS256'], requiredClaims: ['exp', 'email', 'iss', 'aud'],
    });
    if (typeof payload.email !== 'string' || !allowed.has(payload.email.toLowerCase())) {
      throw new Error('Email not permitted');
    }
    return { email: payload.email.toLowerCase(), exp: payload.exp };
  };
}
