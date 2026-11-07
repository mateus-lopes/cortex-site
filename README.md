# cortex-site

Site **só de leitura** do vault pessoal `cortex` (Obsidian). Este repo tem só o código: as notas vêm do vault (privado) na hora do build.

```
vault cortex ──git push──▶ GitHub Action (cortex/.github/workflows/site.yml) ──build──▶ Cloudflare Worker "cortex"
```

## Segurança
- O `src/worker.js` pede uma senha antes de servir qualquer arquivo. Acertando, grava um cookie de sessão assinado (HMAC com a senha) que vale 90 dias. `/sair` encerra a sessão.
- A senha é o secret `SITE_SENHA` do Worker (`npx wrangler secret put SITE_SENHA`); trocar a senha derruba todas as sessões. Sem ela, o site responde **403** para tudo.

## O que vira o quê
- Seções do menu: `Finanças`, `Igreja`, `Projetos`, `Pessoal`. A nota com o nome da pasta é a página da seção; sem ela, o build lista as notas.
- De `Sistema/` entram só as notas da raiz e de `Painéis/` (fora do menu). Credenciais, Scripts, Templates nunca entram.
- `[[links]]` viram links; `![[imagem.jpg|320]]` sai de `Sistema/Anexos`.
- Blocos `dataview`: o build interpreta o subconjunto usado (`TABLE WITHOUT ID`, `FROM`, `WHERE`, `GROUP BY`, `SORT`). O que não entender, remove (aviso no log).
- Frontmatter aparece recolhido em "Propriedades".

## Desenvolvimento
```bash
npm install
npm run build   # lê ../../cortex por padrão (CONTENT_DIR muda)
npm run dev     # precisa de .dev.vars com DEV_SEM_SENHA=1 para abrir sem senha
npm run deploy
```
