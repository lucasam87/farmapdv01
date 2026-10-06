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

**A execução do plano 2 está em 12 de 15 tarefas.** Tarefas 0 a 12 ✅; a 13 (Playwright)
está **em andamento**; a 14 (PDF) não começou. Branch de trabalho:
**`etapa-3-4-produtos-estoque-pdv`**, HEAD `e1125b8` (ainda **só local**, não foi enviada).

**Estado verificado no fim da sessão:**

| Comando | Resultado |
|---|---|
| `npm test` | **118/118** (eram 12 antes do plano 2) |
| `npm run test:sql` | **224 OK, 0 FALHOU de 8 arquivos** (eram 119 de 6) |
| `npm run test:sql:concorrencia` | 17 OK, 0 FALHOU (não foi mexido nesta etapa) |
| `npm run build` | exit 0, com `/produtos`, `/produtos/[id]`, `/produtos/novo`, `/produtos/importar`, `/estoque`, `/vendas`, `/vendas/nova` e `/api/produtos/busca` |
| `npm run test:e2e` | **inconclusivo** — ver o item 1 abaixo |

**Banco:** migrations `006_produtos`, `007_estoque` e `008_importacao` aplicadas, com
`produto_salvar`, `produto_entrada`, `produto_ajuste` e `importar_produtos`.

**O que falta, exatamente:**

1. **Tarefa 13 (Playwright)** — a rodada 1 deu **1 passou (F3) e 3 falharam**, e as três
   falhas eram **defeito do teste, não do sistema** (uma sonda provou que a busca e o
   carrinho funcionam). Os defeitos foram corrigidos, mas a rodada 2 foi interrompida
   antes de ver o resultado. **Retomar rodando `npm run test:e2e`.** Se falhar de novo, a
   sonda em `.superpowers/probe-pdv.spec.ts` (com `.superpowers/probe-pdv.config.ts`,
   ambos git-ignored) imprime a resposta da rota de busca e o estado do carrinho na tela.
2. **Tarefa 14 (PDF)** — não começou. O critério é objetivo: a soma dos preços extraídos
   do PDF tem que bater **ao centavo** com o total impresso no próprio PDF. Se não bater,
   a importação de PDF **não** entra na tela e a tarefa termina registrando o motivo.
3. **Fechamento** — rodar a suíte inteira, marcar as Etapas 3 e 4 no `PROGRESSO.md` com a
   evidência colada, e pedir a revisão final do branch em contexto limpo.

**Lacuna registrada (importante):** as telas **não foram vistas por olho humano** — não há
navegador neste ambiente além do Playwright, e as Server Actions não têm endpoint público
para chamar por script. A verificação foi por build, por teste automatizado e por sonda.
Foi exatamente essa lacuna que deixou passar o bug de contraste da Etapa 1, então vale
abrir `npm run dev` e olhar as telas quando possível.

**O projeto está no GitHub:** https://github.com/lucasam87/farmapdv01 (**privado**), com as
branches `main` (`a9f55cd`) e `etapa-0-2-fundacao` (`9f0c524`) — conferidas hash a hash, e
auditadas: nenhum segredo subiu. Detalhes na seção "Publicado no GitHub". A branch do
plano 2 sobe com `git push -u origin etapa-3-4-produtos-estoque-pdv`.

# ▶ COMO RETOMAR EM OUTRA JANELA

Diga ao agente, nesta ordem:

1. **"Leia o `PROGRESSO.md` e o ledger em
   `.superpowers/sdd/2026-10-06-produtos-estoque-pdv/progress.md`. Estamos na branch
   `etapa-3-4-produtos-estoque-pdv`, com as tarefas 0 a 12 do plano 2 feitas. Vamos
   terminar a 13 (Playwright) e fazer a 14 (PDF)."** O ledger é o registro detalhado de
   **todas** as decisões (rulings) e do que já foi verificado. Ele é ignorado pelo git de
   propósito (é rascunho do processo), mas está no disco. O ledger do plano 1 está em
   `.superpowers/sdd/2026-10-06-fundacao-login-banco/progress.md`.

2. Confirmar a branch e rodar as suítes:
   - `git branch --show-current` → `etapa-3-4-produtos-estoque-pdv`
   - `npm test` → **118/118**
   - `npm run test:sql` → **224 OK, 0 FALHOU de 8 arquivos**
   - `npm run test:sql:concorrencia` → **17 OK, 0 FALHOU**
   - `npm run build` → exit 0

3. **Primeiro passo concreto: `npm run test:e2e`** — a rodada 1 deu 1 passou (F3) e 3
   falharam por defeito do teste (corrigido); a rodada 2 foi interrompida antes do
   resultado. A sonda em `.superpowers/probe-pdv.spec.ts` mostra a busca e o carrinho na
   tela, se precisar. O Chromium do Playwright já está baixado (153.0.8010.12).

4. Depois, a **Tarefa 14 (PDF)**: o critério é a soma dos preços extraídos bater ao
   centavo com o total impresso no próprio PDF. Se não bater, o PDF não entra na tela e a
   tarefa termina registrando o motivo.

5. Para ver a interface: `npm run dev` e abrir http://localhost:3000. **As telas do plano
   2 ainda não foram olhadas por olho humano** — vale conferir.

**Sobre as migrations:** continuam por `npm run migrar` (o banco não aceita conexão `pg`).
As `006_produtos`, `007_estoque` e `008_importacao` já estão aplicadas. **Não** rodar
`supabase db push`.

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
| 3 | Produtos e estoque | 🟡 | Tarefas 0–3, 5–10 do plano 2 ✅: CLI do Supabase ligado (histórico `001`–`005` reparado), `produto_salvar` (`d998d92`), `produto_entrada`/`produto_ajuste` (`f96db63`), `importar_produtos` (`6b76b94`), os leitores `dinheiro`/`csv`/`xlsx`/`tabela` e as telas de importação, produtos e estoque. `npm run test:sql` → **224 OK, 0 FALHOU de 8 arquivos**; `npm test` → **118/118**; `npm run build` exit 0. **Faltam a Tarefa 14 (PDF) e a conferência da soma planilha × gravada contra uma planilha real do sistema antigo** (as fixtures cobrem o formato) | 06/10/2026 |
| 4 | PDV | 🟡 | `/vendas/nova` (`751e3da`) com teclado, pagamento dividido e idempotência, e `/vendas` (`15198f6`) com valores ocultáveis; 18 testes das contas de pagamento, provados por mutação. **Falta a Tarefa 13 fechar**: a rodada 1 do Playwright deu 1 passou / 3 falharam por defeito do teste (corrigido) e a rodada 2 foi interrompida. Sem ela a Etapa 4 não tem a evidência que a spec §13 exige | 06/10/2026 |
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
| 1 | `produto_salvar` — cadastro e edição sem tocar no estoque | ✅ `d998d92` |
| 2 | `produto_entrada` e `produto_ajuste` — livro-razão manda | ✅ `f96db63` |
| 3 | `importar_produtos` — tudo ou nada, casa por código de barras | ✅ `6b76b94` |
| 4 | `lib/dinheiro.ts` (`parsearCentavos`, `parsearQuantidade`) | ✅ `8720020`, 19 testes |
| 5 | `lib/csv.ts` — aspas, separador, Latin-1 | ✅ `19f337d`, 14 testes |
| 6 | `lib/xlsx.ts` + fixtures `.xlsx` geradas com Python/openpyxl | ✅ `d31b8a4`, 11 testes, sem dependência nova |
| 7 | `lib/tabela.ts` — cabeçalho tolerante, rodapé, duas somas | ✅ `1a359a0`, 22 testes |
| 8 | Tela de importação com prévia e conferência de somas | ✅ `741ee68` |
| 9 | `/produtos`, `/produtos/novo`, `/produtos/[id]` — busca, entrada, ajuste | ✅ `75a5adc`, 18 testes de validação |
| 10 | `/estoque` — abas baixo / zerado / parado | ✅ `09950c7` |
| 11 | `/vendas/nova` — PDV com teclado, pagamento dividido, idempotência | ✅ `751e3da`, 18 testes de pagamento |
| 12 | `/vendas` — lista do dia com valores ocultáveis | ✅ `15198f6` |
| 13 | Playwright — teclado, clique duplo, F3, limite de crediário | 🟡 `e1125b8`: rodada 1 deu 1 passou / 3 falharam por defeito de teste; defeitos corrigidos, rodada 2 não concluída |
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
