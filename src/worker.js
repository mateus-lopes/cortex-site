// Tranca do site: só serve os arquivos para quem tem o cookie de sessão assinado com a senha (secret SITE_SENHA).
// Sem a senha configurada, responde 403 para tudo. Nunca abre por padrão.
// Trocar a senha (`wrangler secret put SITE_SENHA`) derruba todas as sessões.

const COOKIE = 'sessao';
const DIAS = 90;
const enc = new TextEncoder();

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
}

// Compara em tempo constante (os dois lados viram HMAC do mesmo tamanho antes)
async function equal(a, b, secret) {
  const [x, y] = await Promise.all([hmac(secret, `cmp:${a}`), hmac(secret, `cmp:${b}`)]);
  return crypto.subtle.timingSafeEqual(enc.encode(x), enc.encode(y));
}

async function validSession(request, env) {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)sessao=([^;]+)/)?.[1];
  const [exp, sig] = value?.split('.') ?? [];
  if (!exp || !sig || !(Number(exp) > Date.now() / 1000)) return false;
  return equal(sig, await hmac(env.SITE_SENHA, `sessao:${exp}`), env.SITE_SENHA);
}

const safeNext = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') ? v : '/');

function loginPage(next, erro = false) {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Entrar · cortex</title>
<style>
:root { --bg: #f7f7f5; --surface: #fff; --text: #1c1d1f; --muted: #6a6d72; --border: #e3e3df; --accent: #2f5fb3; --danger: #b3322f; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #121314; --surface: #1a1b1d; --text: #e7e7e4; --muted: #9a9ca0; --border: #2a2c2f; --accent: #8db0f0; --danger: #f08a86; color-scheme: dark; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 16px; box-sizing: border-box; }
form { width: 100%; max-width: 340px; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
h1 { margin: 0 0 16px; font-size: 1.3rem; }
input { width: 100%; box-sizing: border-box; padding: 10px 12px; font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
button { margin-top: 12px; width: 100%; padding: 10px; font: inherit; font-weight: 600; color: #fff; background: var(--accent); border: 0; border-radius: 8px; cursor: pointer; }
@media (prefers-color-scheme: dark) { button { color: #10151f; } }
.erro { color: var(--danger); font-size: .9rem; margin: 10px 0 0; }
</style></head>
<body><form method="post" action="/entrar">
<h1>cortex</h1>
<input type="hidden" name="next" value="${next.replace(/[&<>"']/g, '')}">
<label for="senha" style="display:block;font-size:.9rem;color:var(--muted);margin-bottom:6px">Senha</label>
<input id="senha" name="senha" type="password" autocomplete="current-password" required autofocus>
${erro ? '<p class="erro">Senha errada.</p>' : ''}
<button type="submit">Entrar</button>
</form></body></html>`;
  return new Response(html, { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}

export default {
  async fetch(request, env) {
    // Só no `wrangler dev` (arquivo .dev.vars, que nunca vai para o deploy)
    if (env.DEV_SEM_SENHA === '1') return env.ASSETS.fetch(request);
    if (!env.SITE_SENHA) return new Response('Site fechado: senha ainda não configurada.', { status: 403 });

    const url = new URL(request.url);

    if (url.pathname === '/entrar' && request.method === 'POST') {
      const form = await request.formData();
      const next = safeNext(form.get('next'));
      if (!(await equal(String(form.get('senha') ?? ''), env.SITE_SENHA, env.SITE_SENHA))) {
        await new Promise((r) => setTimeout(r, 1500)); // atrasa quem tenta adivinhar
        return loginPage(next, true);
      }
      const exp = Math.floor(Date.now() / 1000) + DIAS * 86400;
      const cookie = `${COOKIE}=${exp}.${await hmac(env.SITE_SENHA, `sessao:${exp}`)}; Path=/; Max-Age=${DIAS * 86400}; HttpOnly; Secure; SameSite=Lax`;
      return new Response(null, { status: 303, headers: { location: next, 'set-cookie': cookie } });
    }

    if (url.pathname === '/sair') {
      return new Response(null, { status: 303, headers: { location: '/', 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` } });
    }

    if (!(await validSession(request, env))) return loginPage(url.pathname + url.search);

    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    out.headers.set('cache-control', 'private, no-store');
    out.headers.set('x-robots-tag', 'noindex');
    return out;
  },
};
