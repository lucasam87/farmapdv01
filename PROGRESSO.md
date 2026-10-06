# PROGRESSO — Sistema de Gestão para Farmácia

Este arquivo é o registro de andamento. **Regra: uma etapa só vira ✅ com a
evidência colada** (o comando que rodou e o resultado que apareceu). Sem
evidência, fica 🟡.

Legenda: ⬜ pendente · 🟡 em andamento · ✅ concluída com evidência · ⛔ bloqueada

---

# ⏸ ONDE PARAMOS — 06/10/2026

**Branch:** `etapa-0-2-fundacao` (o `main` está intacto, só com spec e plano).
**Etapas 0, 1 e 2 fechadas. O plano 1 está 100% executado** — 11 tarefas: ambiente,
login, banco com RLS, funções de venda, cancelamento, caixa e as 10 views.

**Evidência da Etapa 2 (nível 1 da spec §12):**

| Comando | Resultado |
|---|---|
| `npm run test:sql` | **100 OK, 0 FALHOU de 5 arquivos**, exit 0 (3 rodadas seguidas, iguais) |
| `npm run test:sql:concorrencia` | **10 OK, 0 FALHOU**, exit 0 — B ficou 1096 ms bloqueada no lock e recebeu `Estoque insuficiente` |
| `npm test` | **12/12** |

**Próximo passo, exatamente:** escrever o **plano 2** (Etapas 3–4: produtos, estoque,
importação CSV e o PDV completo) com a skill `writing-plans`, a partir da spec
`docs/superpowers/specs/2026-10-06-sistema-farmacia-design.md`.

# ▶ COMO RETOMAR EM OUTRA JANELA

Diga ao agente, nesta ordem:

1. **"Leia o `PROGRESSO.md` e o ledger em
   `.superpowers/sdd/2026-10-06-fundacao-login-banco/progress.md`, e vamos escrever o
   plano 2 (Etapas 3–4)."** O ledger é o registro detalhado de **todas** as decisões
   (rulings) e do que já foi verificado. Ele é ignorado pelo git de propósito (é
   rascunho do processo), mas está no disco.

2. Antes de escrever qualquer coisa, rodar e conferir:
   - `npm test` → **12/12**
   - `npm run test:sql` → **100 OK, 0 FALHOU de 5 arquivos**
   - `npm run test:sql:concorrencia` → **10 OK, 0 FALHOU**
   - `git log --oneline` → os commits da etapa-2

3. Para testar a interface: `npm run dev` e abrir http://localhost:3000.

**Não é preciso refazer nada das Etapas 0, 1 e 2.** Estão commitadas e verificadas.
Não apague a branch nem o `.superpowers/`.

**Como as migrations são aplicadas (importante):** o banco **não** aceita conexão `pg`
(a senha nunca autenticou). Todo SQL de migration vai pelo endpoint de gerenciamento:

```
POST https://api.supabase.com/v1/projects/geywpaegovurwtfoacwt/database/query
Authorization: Bearer $SUPABASE_ACCESS_TOKEN
Content-Type: application/json
{ "query": "<conteúdo do arquivo .sql>" }
```

O script que faz isso (`aplicar-sql.mjs`) vive no `.superpowers` (scratch, fora do git).
Se ele sumir, são ~30 linhas de `fetch`. Migrations já aplicadas no projeto: `001_base`,
`002_registrar_venda`, `003_cancelar_venda`, `004_caixa`, `005_views` — todas as cinco
com HTTP 201.

**Os testes SQL também usam esse endpoint** (não o `pg`): `tests/sql/run.mjs` roda cada
arquivo de `tests/sql/casos/*.sql` numa transação com `ROLLBACK`, e
`tests/sql/concorrencia.mjs` dispara duas requisições simultâneas para provar o lock.

---

## Etapas

| # | Etapa | Status | Evidência | Data |
|---|---|---|---|---|
| 0 | Decisões e ambiente | ✅ | Next 16.3.8, versões travadas no `package.json`, `PROGRESSO.md`; commits `498a53d`, `80a7f5d`; `npm run build` → Compiled successfully | 06/10/2026 |
| 1 | Base + login | ✅ | `npm test` **12/12**; `npm run build` exit 0 com `ƒ /`, `ƒ /login` e `ƒ Proxy (Middleware)`; `npm run lint` exit 0; HTTP: `/login` 200 e `/vendas`, `/produtos`, `/`, `/logins` → **307 → /login**; login pela API de Auth **HTTP 200 com access_token**; logs do dev server: `POST /login 200` → `GET / 200` (menu) → `POST / sair()` → `GET /login`; `GET /vendas 404` prova sessão válida em requisição nova; bug de contraste corrigido em `8ffbbf7` | 06/10/2026 |
| 2 | Banco + funções | ✅ | Migrations 001–005 aplicadas (HTTP 201) e verificadas: **10 tabelas, 10 com RLS, 10 políticas, `pg_trgm`**, índice único parcial de caixa, e as funções `registrar_venda`, `cancelar_venda`, `abrir_caixa`, `caixa_movimento`, `fechar_caixa` + as 10 views. `npm run test:sql` → **100 OK, 0 FALHOU de 5 arquivos** (3 rodadas iguais); `npm run test:sql:concorrencia` → **10 OK, 0 FALHOU** (B bloqueada 1096 ms, recebeu `Estoque insuficiente`; sem o `for update` o teste reprova — provado por mutação); `npm test` → 12/12. Commits `3f91530`, `f0e73b6`, `35d91ef`, `286bf5b`, `0b24a6a` + o fechamento | 06/10/2026 |
| 3 | Produtos e estoque | ⬜ | — | — |
| 4 | PDV | ⬜ | — | — |
| 5 | Histórico de vendas | ⬜ | — | — |
| 6 | Clientes e crediário | ⬜ | — | — |
| 7 | Relatórios | ⬜ | — | — |
| 8 | Agente de IA | ⬜ | — | — |
| 9 | Publicar na Vercel | ⬜ | — | — |
| 10 | Migração de dados | ⬜ | — | — |
| 11 | Uso paralelo e corte | ⬜ | — | — |

## Tarefas do Plano 1

Plano: `docs/superpowers/plans/2026-10-06-fundacao-login-banco.md`

| Tarefa | Entrega | Status |
|---|---|---|
| 1 | Scaffold Next 16 com versões travadas + `PROGRESSO.md` | ✅ |
| 2 | `lib/format.ts` (moeda e data) com testes | ✅ 7/7 |
| 3 | Clients Supabase, `proxy.ts`, `perfilAtual` | ✅ 12/12 |
| 4 | Login, logout e menu de 9 entradas | ✅ |
| 5 | Migration 001: 10 tabelas, constraints e RLS | ✅ |
| 6 | Runner de testes SQL (transação + rollback) | ✅ `3f91530` |
| 7 | `registrar_venda` | ✅ `f0e73b6` |
| 8 | Teste de concorrência | ✅ `35d91ef` |
| 9 | `cancelar_venda` | ✅ `286bf5b` |
| 10 | Funções de caixa | ✅ `0b24a6a` |
| 11 | Views de leitura + fuso de São Paulo | ✅ |

## Credenciais e segredos

**Nada disso está no git.** O `.env.local` é ignorado desde o primeiro commit, e
o `.env.example` é só o modelo vazio.

| Variável no `.env.local` | Para que serve | Situação |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto | ✅ `geywpaegovurwtfoacwt.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave pública (publishable) | ✅ |
| `DEEPSEEK_API_KEY` | agente de IA (Etapa 8) | vazio, ainda não é usada |
| `SUPABASE_DB_URL` | conexão direta no banco | ⚠️ **a senha está errada/placeholder e NÃO é usada** — ver abaixo |
| `SUPABASE_ACCESS_TOKEN` | Personal Access Token (`sbp_`) | ✅ é o que aplica migrations e roda SQL |
| `USUARIO_EMAIL` / `USUARIO_SENHA` / `USUARIO_ID` | login de teste | ✅ `lucas@farmacia.local` |

**Dois pontos importantes para a próxima sessão:**

1. **Não perca tempo com a senha do banco.** Ela nunca autenticou (testamos
   session pooler, transaction pooler e conexão direta, todos recusaram), e o
   projeto **não precisa dela**: migrations, SQL e testes passam pelo endpoint
   `POST /v1/projects/{ref}/database/query` usando o `SUPABASE_ACCESS_TOKEN`. Se
   um dia quiser o caminho com `pg`, terá que resetar a senha no painel
   (*Project Settings → Infrastructure*, ou o botão **Connect**).

2. **O Personal Access Token precisa ser revogado no fim do projeto.**
   Supabase → avatar (canto superior direito) → *Account* → *Access Tokens* →
   lixeira. Enquanto ele existir, ele dá acesso à conta inteira. **Isto é
   pendência aberta.**

Para ver a senha do usuário de teste:

```powershell
Select-String -Path "C:\DEEPSEEK WORKSPACE\PROJETO 1\.env.local" -Pattern '^USUARIO_SENHA'
```

## Decisões de projeto que não estão na spec

- **O app é sempre claro (v1).** O `apps/globals.css` fixa `color-scheme: light`
  e não segue o tema do sistema. Motivo: com o Windows em modo escuro, o texto
  herdado ficava claro sobre fundo claro e **o que o usuário digitava sumia**.
  Foi bug real, encontrado pelo Lucas, invisível para os testes.
- **Usuário da farmácia é criado pela API de administração** (com
  `email_confirm: true`), não à mão no painel. A linha em `perfis` é obrigatória:
  sem ela o app mostra "Usuário sem perfil cadastrado".
- **O aviso de hidratação no console é de extensão do navegador**
  (`data-bry-content-script-bryweb` no `<html>`), não do nosso código. Não
  perseguir.

## Versões travadas

Registrado em 06/10/2026, a partir do `package.json` e do que está em
`node_modules`. Todas as dependências estão em **versão exata** (sem `^` e sem
`latest`); o `package-lock.json` é commitado e é ele que fixa a árvore inteira.

| Pacote | Versão |
|---|---|
| Node.js | 24.19.0 |
| npm | 11.17.0 |
| next | 16.3.8 |
| react | 19.2.8 |
| react-dom | 19.2.8 |
| typescript | 5.9.3 |
| tailwindcss | 4.3.3 |
| @tailwindcss/postcss | 4.3.3 |
| @supabase/supabase-js | 2.117.2 |
| @supabase/ssr | 0.12.7 |
| vitest | 5.0.3 |
| pg | 8.23.1 |
| dotenv | 18.0.5 |
| eslint | 9.39.5 |
| eslint-config-next | 16.3.8 |
| @types/node | 24.19.1 |
| @types/react | 19.3.0 |
| @types/react-dom | 19.3.0 |

## Riscos conhecidos do ambiente

- **5 vulnerabilidades de severidade alta** em `npm audit`, todas na toolchain de
  lint (`braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` →
  `eslint-config-next`). São **dependências de desenvolvimento**: não entram no
  bundle nem rodam em produção. Sem correção não-destrutiva disponível. Reavaliar
  quando o Next publicar correção.
- **npm 11 bloqueia install scripts por padrão**: `unrs-resolver@1.12.2` teve o
  `postinstall` bloqueado. Build e lint passam assim mesmo. Se o lint falhar,
  rodar `npm approve-scripts unrs-resolver`.
- O scaffolder recusou a pasta `PROJETO 1` como nome de pacote (espaço e
  maiúsculas). O projeto foi gerado em pasta temporária e movido para a raiz; o
  campo `name` do `package.json` é `farmacia`.
- **Next 16 renomeou `middleware.ts` para `proxy.ts`** (função `proxy`, runtime
  Node). Não recriar `middleware.ts`: ele seria ignorado em silêncio e o
  redirecionamento de quem não está logado pararia de funcionar.
