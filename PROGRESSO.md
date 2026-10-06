# PROGRESSO — Sistema de Gestão para Farmácia

Este arquivo é o registro de andamento. **Regra: uma etapa só vira ✅ com a
evidência colada** (o comando que rodou e o resultado que apareceu). Sem
evidência, fica 🟡.

Legenda: ⬜ pendente · 🟡 em andamento · ✅ concluída com evidência · ⛔ bloqueada

---

# ⏸ ONDE PARAMOS — 06/10/2026 (segunda sessão do dia)

**Branch:** `etapa-0-2-fundacao` (o `main` está intacto, só com spec e plano).
**Etapas 0, 1 e 2 fechadas. O plano 1 está 100% executado** — 11 tarefas: ambiente,
login, banco com RLS, funções de venda, cancelamento, caixa e as 10 views.

**Evidência da Etapa 2 (nível 1 da spec §12):**

| Comando | Resultado |
|---|---|
| `npm run test:sql` | **119 OK, 0 FALHOU de 6 arquivos**, exit 0 (3 rodadas seguidas, iguais) |
| `npm run test:sql:concorrencia` | **17 OK, 0 FALHOU**, exit 0 — último item: B bloqueada ~1 s e recusada com `Estoque insuficiente`; limite de crediário: B bloqueada e recusada com `Limite excedido` |
| `npm test` | **12/12** |

**O plano 2 foi escrito, revisado e commitado** (`6de378e`, 15 tarefas) e a execução
**começou pela tarefa zero, que está ✅** (ver abaixo): o CLI está ligado ao projeto e o
histórico `001`–`005` está reparado — o `supabase link` e o `migration repair` funcionam
sem a senha do banco.

**O projeto está no GitHub:** https://github.com/lucasam87/farmapdv01 (**privado**), com as
duas branches (`main` em `a9f55cd` e `etapa-0-2-fundacao` em `58553e0`) — conferidas hash a
hash contra o local, e auditadas: nenhum segredo subiu. Detalhes na seção
"Publicado no GitHub" mais abaixo. Daqui para frente, `git push` sobe sozinho.

**Onde a sessão parou, exatamente:** a tarefa zero do plano 2 está ✅ (CLI ligado e
histórico reparado). A próxima tarefa é a **1** (`produto_salvar`).

# ▶ COMO RETOMAR EM OUTRA JANELA

Diga ao agente, nesta ordem:

1. **"Leia o `PROGRESSO.md` e o ledger em
   `.superpowers/sdd/2026-10-06-produtos-estoque-pdv/progress.md`, e vamos executar o
   plano 2 (Etapas 3–4)."** O ledger é o registro detalhado de **todas** as decisões
   (rulings) e do que já foi verificado. Ele é ignorado pelo git de propósito (é
   rascunho do processo), mas está no disco. O ledger do plano 1, com toda a história da
   fundação, está em `.superpowers/sdd/2026-10-06-fundacao-login-banco/progress.md`.

2. Antes de escrever qualquer coisa, rodar e conferir:
   - `npm test` → **12/12**
   - `npm run test:sql` → **119 OK, 0 FALHOU de 6 arquivos**
   - `npm run test:sql:concorrencia` → **17 OK, 0 FALHOU**
   - `git log --oneline` → os commits da etapa-2 e o commit do plano 2

3. A **tarefa zero já está feita** (CLI ligado, histórico reparado). Os comandos dela,
   para referência:

   ```powershell
   $env:SUPABASE_ACCESS_TOKEN = (Select-String -Path ".env.local" -Pattern '^SUPABASE_ACCESS_TOKEN=(.+)$').Matches.Groups[1].Value.Trim()
   npx --yes supabase@2.120.0 link --project-ref geywpaegovurwtfoacwt --yes
   npx --yes supabase@2.120.0 migration repair --status applied 001 002 003 004 005 --linked
   npx --yes supabase@2.120.0 migration list --linked
   ```

   **Não** rodar `supabase db push` em momento nenhum: ele exige conexão direta no banco.

5. Para testar a interface: `npm run dev` e abrir http://localhost:3000.

**Não é preciso refazer nada das Etapas 0, 1 e 2.** Estão commitadas e verificadas.
Não apague a branch nem o `.superpowers/`.

**Como as migrations são aplicadas (importante):** o banco **não** aceita conexão `pg`
(a senha nunca autenticou), então `supabase db push` e `psql` não servem. O caminho é o
endpoint de gerenciamento, e ele já está versionado no repositório:

```powershell
npm run migrar                  # aplica supabase/migrations/*.sql em ordem
npm run migrar -- 006_produtos.sql   # aplica só uma
```

O script (`scripts/aplicar-migration.mjs`) usa `SUPABASE_ACCESS_TOKEN` +
`NEXT_PUBLIC_SUPABASE_URL` do `.env.local` e sai com código 1 se falhar.
Migrations já aplicadas no projeto: `001_base`, `002_registrar_venda`,
`003_cancelar_venda`, `004_caixa`, `005_views`.

⚠️ **O `supabase link` NÃO precisa da senha do banco** — isto foi medido em 06/10/2026 e
substitui o que este arquivo dizia antes (dizia que precisava; estava errado). Com o
`SUPABASE_ACCESS_TOKEN` no ambiente, `supabase link --project-ref <ref> --yes` sai com
código 0 e o `migration repair --linked` também funciona sem senha. O que **não** funciona
é `supabase db push`, porque ele exige conexão direta no banco — por isso as migrations
continuam por `npm run migrar`.

✅ **O CLI está ligado e o histórico está reparado** (tarefa zero do plano 2, 06/10/2026):
`supabase/.temp/project-ref` = `geywpaegovurwtfoacwt`, `linked-project.json` com
`"name":"farmaciapdv"`, e as cinco migrations marcadas como aplicadas pela API —
`migration repair --status applied 001 002 003 004 005 --linked` saiu com código 0 e
`supabase_migrations.schema_migrations` ficou com as cinco linhas (`001` base, `002`
registrar_venda, `003` cancelar_venda, `004` caixa, `005` views). `migration list --linked`
mostra `Local` e `Remote` preenchidos nas cinco. `supabase/config.toml` é versionado;
`supabase/.temp/` é estado de máquina e está no `.gitignore`.

```powershell
npx --yes supabase@2.120.0 migration list --linked
```

**Os testes SQL também usam esse endpoint** (não o `pg`): `tests/sql/run.mjs` roda cada
arquivo de `tests/sql/casos/*.sql` numa transação com `ROLLBACK`, e
`tests/sql/concorrencia.mjs` dispara requisições simultâneas para provar os locks
(último item do estoque e limite de crediário do mesmo cliente).

---

## Etapas

| # | Etapa | Status | Evidência | Data |
|---|---|---|---|---|
| 0 | Decisões e ambiente | ✅ | Next 16.3.8, versões travadas no `package.json`, `PROGRESSO.md`; commits `498a53d`, `80a7f5d`; `npm run build` → Compiled successfully | 06/10/2026 |
| 1 | Base + login | ✅ | `npm test` **12/12**; `npm run build` exit 0 com `ƒ /`, `ƒ /login` e `ƒ Proxy (Middleware)`; `npm run lint` exit 0; HTTP: `/login` 200 e `/vendas`, `/produtos`, `/`, `/logins` → **307 → /login**; login pela API de Auth **HTTP 200 com access_token**; logs do dev server: `POST /login 200` → `GET / 200` (menu) → `POST / sair()` → `GET /login`; `GET /vendas 404` prova sessão válida em requisição nova; bug de contraste corrigido em `8ffbbf7` | 06/10/2026 |
| 2 | Banco + funções | ✅ | Migrations 001–005 aplicadas e verificadas: **10 tabelas, 10 com RLS, 10 políticas, `pg_trgm`**, índice único parcial de caixa, e as funções `registrar_venda`, `cancelar_venda`, `abrir_caixa`, `caixa_movimento`, `fechar_caixa` + as 10 views. `npm run test:sql` → **119 OK, 0 FALHOU de 6 arquivos**; `npm run test:sql:concorrencia` → **17 OK, 0 FALHOU**; `npm test` → 12/12. Revisão final em contexto limpo apontou 1 Critical + 4 Important, todos corrigidos com teste que nasceu vermelho: `anon` perdeu o EXECUTE das RPCs de escrita (`050_permissoes.sql`), o limite de crediário ganhou `for update` no cliente (cenário 2 da concorrência), o termo "cancelamentos em dinheiro" da §8.3 ganhou teste, RLS passou a ser exercitada de verdade, e `npm run migrar` passou a ser o caminho versionado de aplicar migration | 06/10/2026 |
| 3 | Produtos e estoque | 🟡 | tarefa 0 do plano 2 ✅ (CLI do Supabase ligado e histórico `001`–`005` reparado); Tarefas 1–3 = migrations 006–008, 8 = importação, 9 = telas — ainda não executadas, por isso sem evidência | 06/10/2026 |
| 4 | PDV | ⬜ | plano 2 escrito: Tarefas 11–12 (PDV e lista do dia) e Tarefa 13 (Playwright como evidência). Nada executado ainda, por isso sem evidência | — |
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

## Tarefas do Plano 2

Plano: `docs/superpowers/plans/2026-10-06-produtos-estoque-pdv.md` (commit `6de378e`).
Escrito e revisado em 06/10/2026. **A execução começou pela tarefa 0, que está ✅** — as
demais seguem pendentes. Ledger de execução:
`.superpowers/sdd/2026-10-06-produtos-estoque-pdv/progress.md`.

| Tarefa | Entrega | Status |
|---|---|---|
| 0 | Supabase CLI ligado + `migration repair` das 001–005 | ✅ `project-ref` = `geywpaegovurwtfoacwt`, `repair` exit 0, `supabase_migrations.schema_migrations` com as 5 versões |
| 1 | `produto_salvar` — cadastro e edição sem tocar no estoque | ⬜ |
| 2 | `produto_entrada` e `produto_ajuste` — livro-razão manda | ⬜ |
| 3 | `importar_produtos` — tudo ou nada, casa por código de barras | ⬜ |
| 4 | `lib/dinheiro.ts` (`parsearCentavos`, `parsearQuantidade`) | ⬜ |
| 5 | `lib/csv.ts` — aspas, separador, Latin-1 | ⬜ |
| 6 | `lib/xlsx.ts` + fixtures `.xlsx` geradas com Python/openpyxl | ⬜ |
| 7 | `lib/tabela.ts` — cabeçalho tolerante, rodapé, duas somas | ⬜ |
| 8 | Tela de importação com prévia e conferência de somas | ⬜ |
| 9 | `/produtos`, `/produtos/novo`, `/produtos/[id]` — busca, entrada, ajuste | ⬜ |
| 10 | `/estoque` — abas baixo / zerado / parado | ⬜ |
| 11 | `/vendas/nova` — PDV com teclado, pagamento dividido, idempotência | ⬜ |
| 12 | `/vendas` — lista do dia com valores ocultáveis | ⬜ |
| 13 | Playwright — teclado, clique duplo, F3, limite de crediário | ⬜ |
| 14 | PDF — medir contra o total impresso e decidir (pode terminar inviável) | ⬜ |

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

3. **O `supabase link` também não precisa da senha do banco** (medido em
   06/10/2026): só o `SUPABASE_ACCESS_TOKEN`. O que não funciona é `supabase db
   push`, porque exige conexão direta.

Para ver a senha do usuário de teste:

```powershell
Select-String -Path "C:\DEEPSEEK WORKSPACE\PROJETO 1\.env.local" -Pattern '^USUARIO_SENHA'
```

## Publicado no GitHub — FEITO em 06/10/2026

**Repositório:** https://github.com/lucasam87/farmapdv01 — **privado** (o nome do
repositório é `farmapdv01`; o projeto local continua sendo a pasta `PROJETO 1`).
Descrição e tópicos preenchidos (`farmacia`, `pdv`, `nextjs`, `supabase`, `postgresql`,
`typescript`, `rls`).

**As duas branches estão no remoto e conferidas hash a hash:**

| Branch | Commit | Confere com o local |
|---|---|---|
| `main` | `a9f55cd` | ✅ |
| `etapa-0-2-fundacao` | `58553e0` | ✅ |

Ambas com `-u`, então `git push` sozinho já sobe o trabalho daqui para frente. **53
arquivos** no remoto, igual ao local.

**Autenticação:** `gh` (GitHub CLI **2.102.0**, instalado via winget) autenticado na conta
`lucasam87` pelo cofre de credenciais do Windows (`gh auth status` → `✓ Logged in to
github.com account lucasam87 (keyring)`), escopos `repo`, `read:org`, `gist`.
`gh auth setup-git` rodado, então o `git push` usa a mesma credencial.

**Auditoria do que subiu — nenhum segredo:**

- Nenhum valor de `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_URL` (senha do banco),
  `USUARIO_SENHA` ou `NEXT_PUBLIC_SUPABASE_ANON_KEY` aparece em nenhum dos 53 arquivos.
- O único `.env*` versionado é o `.env.example`, e ele está **vazio de valores** (as quatro
  variáveis existem sem valor). O `.env.local` **não** subiu.
- `.superpowers/` (ledgers e rascunhos) não subiu.
- **O que aparece e não é segredo:** o e-mail do usuário de teste
  (`lucas@farmacia.local`, documentado de propósito neste arquivo) e o *ref* do projeto
  Supabase (`geywpaegovurwtfoacwt`) em duas linhas deste `PROGRESSO.md`. É identificador,
  não credencial.

**E-mail dos próximos commits:** `lucasam87@users.noreply.github.com` (configurado local
neste repositório). Os commits anteriores usam `lucas@farmacia.local` e ficaram como
estavam.

**Histórico do que deu errado, para não repetir:** o login do `gh` é por código de
dispositivo (~10 minutos de validade) e exige o Lucas abrir
https://github.com/login/device; **quatro códigos** precisaram ser gerados ao longo da
sessão antes de um ser autorizado a tempo.

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
