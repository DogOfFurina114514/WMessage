// 认证工具：PBKDF2 密码哈希 + HMAC-SHA256 签名 Token（Web Crypto，无外部依赖）

const enc = new TextEncoder();

export function bytesToBase64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64ToBytes(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

export function randomSalt() {
  const s = new Uint8Array(16);
  crypto.getRandomValues(s);
  return bytesToBase64url(s);
}

export async function hashPassword(password, saltB64) {
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(saltB64), iterations: 150000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return bytesToBase64url(new Uint8Array(bits));
}

export function constEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPassword(password, saltB64, expectedHash) {
  const h = await hashPassword(password, saltB64);
  return constEq(h, expectedHash);
}

export function makeTokenPayload(uid) {
  return { uid, exp: Date.now() + 30 * 24 * 3600 * 1000 }; // 30 天有效
}

export async function createToken(payload, secret) {
  const body = bytesToBase64url(enc.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return `${body}.${bytesToBase64url(new Uint8Array(sig))}`;
}

export async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  let sigBytes;
  try {
    sigBytes = base64ToBytes(sig);
  } catch {
    return null;
  }
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  let ok = false;
  try {
    ok = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(body));
  } catch {
    return null;
  }
  if (!ok) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64ToBytes(body)));
    if (!payload || !payload.uid || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
