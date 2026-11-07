// Segunda tranca, além do Cloudflare Access: só serve o site se a requisição trouxer um token do Access válido
// (assinatura, audiência, emissor e validade). Sem configuração ou sem token, responde 403. Nunca abre por padrão.

let certs = { keys: [], fetchedAt: 0 };

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const decodeJson = (s) => JSON.parse(new TextDecoder().decode(b64url(s)));

async function keyFor(kid, issuer) {
  const fresh = Date.now() - certs.fetchedAt < 3600_000;
  let jwk = fresh && certs.keys.find((k) => k.kid === kid);
  if (!jwk) {
    const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
    if (!res.ok) return null;
    certs = { keys: (await res.json()).keys ?? [], fetchedAt: Date.now() };
    jwk = certs.keys.find((k) => k.kid === kid);
  }
  return jwk ? crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']) : null;
}

async function validToken(token, env) {
  const issuer = `https://${env.ACCESS_TEAM}.cloudflareaccess.com`;
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return false;
  const header = decodeJson(h);
  const payload = decodeJson(p);
  if (header.alg !== 'RS256') return false;
  const aud = [payload.aud].flat();
  const now = Date.now() / 1000;
  if (payload.iss !== issuer || !aud.includes(env.ACCESS_AUD) || !(payload.exp > now) || payload.nbf > now) return false;
  const key = await keyFor(header.kid, issuer);
  if (!key) return false;
  return crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
}

const deny = (msg) => new Response(msg, { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });

export default {
  async fetch(request, env) {
    // Só no `wrangler dev` (arquivo .dev.vars, que nunca vai para o deploy)
    if (env.DEV_SEM_ACCESS === '1') return env.ASSETS.fetch(request);
    if (!env.ACCESS_TEAM || !env.ACCESS_AUD) return deny('Site fechado: Cloudflare Access ainda não configurado.');
    const token = request.headers.get('cf-access-jwt-assertion');
    try {
      if (!token || !(await validToken(token, env))) return deny('Acesso negado.');
    } catch {
      return deny('Acesso negado.');
    }
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'private, no-store');
    out.headers.set('x-robots-tag', 'noindex');
    return out;
  },
};
