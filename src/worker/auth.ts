// 共通パスコード認証(Web Crypto のみ使用)
// セッションCookie = "<有効期限(秒)>.<HMAC署名>"。署名鍵はパスコード自体なので、
// パスコードを変更すると全端末のログインが自動で無効になる。

export const SESSION_COOKIE = 'yamame_session';
export const SESSION_DAYS = 180;

const enc = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 長さに関係なく一定時間で比較 */
export function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function createSessionToken(secret: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const exp = nowSec + SESSION_DAYS * 86400;
  return `${exp}.${await hmacHex(secret, `session:${exp}`)}`;
}

export async function verifySessionToken(
  secret: string, token: string | undefined, nowSec = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!token) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || !sig || exp < nowSec) return false;
  return safeEqual(sig, await hmacHex(secret, `session:${exp}`));
}
