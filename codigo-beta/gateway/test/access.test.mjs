import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { createAccessVerifier } from '../access.mjs';

const { privateKey, publicKey } = await generateKeyPair('RS256');
const issuer = 'https://test.cloudflareaccess.com';
const options = { issuer, audience: 'ratoeira-test', allowedEmails: ['ana@example.com'] };
const verify = createAccessVerifier(options, publicKey);
async function token(overrides = {}, key = privateKey) {
  return new SignJWT({ email: 'ana@example.com', exp: Math.floor(Date.now()/1000)+60, iss: issuer, aud: 'ratoeira-test', ...overrides })
    .setProtectedHeader({ alg: 'RS256' }).sign(key);
}

test('accepts the signed identity for this application and permitted email', async () => {
  const identity = await verify(await token());
  assert.equal(identity.email, 'ana@example.com');
  assert.ok(identity.exp > Date.now()/1000);
});
test('rejects missing or fabricated tokens', async () => {
  for (const value of [undefined, '', 'invented.jwt.value']) await assert.rejects(() => verify(value));
});
test('rejects another application, issuer, email or expired token', async () => {
  for (const override of [{aud:'another-app'}, {iss:'https://another.cloudflareaccess.com'}, {email:'outsider@example.com'}, {exp:1}, {exp:undefined}, {email:undefined}]) {
    const value = await token(override);
    await assert.rejects(() => verify(value));
  }
});
test('rejects a token signed by a different key', async () => {
  const other = await generateKeyPair('RS256');
  const value = await token({}, other.privateKey);
  await assert.rejects(() => verify(value));
});
