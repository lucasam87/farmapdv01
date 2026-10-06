# Farmácia — Fundação, Login e Banco (Etapas 0–2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o Lucas logando no sistema e o banco pronto para receber uma venda atômica e correta — com os 13 casos críticos de dinheiro e estoque provados por teste automatizado.

**Architecture:** O Postgres é a autoridade: toda escrita multi-tabela é uma função SQL (`registrar_venda`, `cancelar_venda`, caixa), chamada por RPC; o Next.js só autentica e transporta. Migrations e testes SQL rodam por script Node (`pg`), porque `psql` não existe nesta máquina e o Docker está parado.

**Tech Stack:** Next.js 16.3.8 (App Router, TypeScript), React 19.3.0, Tailwind 4.3.3, shadcn/ui, Supabase (Postgres + Auth), Vitest 5.0.3, `pg` 8.23.1, npm. Sem pnpm, sem `src/`.

**Spec:** `docs/superpowers/specs/2026-10-06-sistema-farmacia-design.md` — este plano implementa as Etapas 0, 1 e 2 da spec (§13) e argumenta a partir dela. O executor lê os dois.

## Global Constraints

- Dinheiro sempre em **centavos inteiros** (`integer`). Nunca `float`, nunca `numeric` com decimal. Exibição `R$ 1.234,56`; datas `dd/mm/aaaa`.
- Todo texto de interface em **português do Brasil**.
- Agregação por dia sempre com `(criado_em at time zone 'America/Sao_Paulo')::date`. Nunca `criado_em::date`.
- **RLS ativado em todas as tabelas**, sem exceção. Políticas idempotentes (`drop policy if exists` antes de `create policy`).
- Toda função de escrita: `security definer` + `set search_path = public, pg_temp` + verificação de papel.
- O navegador **nunca** calcula dinheiro nem envia preço.
- Chaves secretas só em `.env.local` (fora do git). `.env.example` documentado.
- Versões **travadas** (não usar `latest`): `next@16.3.8`, `react@19.3.0`, `react-dom@19.3.0`, `tailwindcss@4.3.3`, `@supabase/supabase-js@2.117.2`, `@supabase/ssr@0.12.7`, `vitest@5.0.3`, `pg@8.23.1`, `dotenv@18.0.5`. Gerenciador: **npm** (11.17.0). Node 24.19.0.
- `app/` na raiz do projeto (sem `src/`), alias de import `@/*`.
- Nenhuma etapa vira ✅ no `PROGRESSO.md` sem a evidência colada. Um commit por etapa no formato `etapa-N: <descrição>`.

## Review Focus

Cinco classes de entrada/condição que a spec implica mas cujos testes não estão escritos nela — cada uma recebe teste na tarefa que possui o código:

1. **Venda que fecha em R$ 0,00** (desconto igual ao subtotal): a spec permite `total = subtotal - desconto` com `total >= 0`, então hoje isso passaria e a farmácia daria o produto. Uma pessoa razoável espera recusa. → Task 7.
2. **Quantidade fracionária (`"1.5"`) ou absurda (`999999`)**: o cast `::integer` estoura com erro técnico do Postgres vazando para a tela do balcão. → Task 7.
3. **Código de barras com zeros à esquerda (`"0012345"`) e nome com acento/emoji/quebra de linha**: qualquer conversão numérica perde os zeros e o produto nunca mais é encontrado pelo leitor. → Task 5.
4. **Duas vendas simultâneas disputando o último item**: a segunda precisa falhar com mensagem clara, nunca vender o que não existe. → Task 8.
5. **Usuário logado sem linha em `perfis`**, e sessão expirada no meio da operação: sem tratamento, vira tela branca ou erro técnico. → Task 3 e Task 4.

---

## Task 1: Scaffold com versões travadas (Etapa 0)

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `PROGRESSO.md`, `.env.example`, `.nvmrc`
- Modify: `.gitignore` (só se o scaffolder acrescentar entradas úteis)

**Interfaces:**
- Consumes: nada (primeira tarefa).
- Produces: projeto Next executável; scripts npm `dev`, `build`, `test`; `PROGRESSO.md` com as Etapas 0–11 e a tabela de versões travadas.

- [ ] **Step 1: Rodar o scaffolder na pasta atual**

```powershell
npx --yes create-next-app@16.3.8 . --ts --tailwind --eslint --app --use-npm --import-alias "@/*" --disable-git --yes
```

`--disable-git` porque o repositório já existe. Não usar `--src-dir`.

- [ ] **Step 2: Verificar que builda**

Run: `npm run build`
Expected: `Compiled successfully`, exit code 0.

- [ ] **Step 3: Instalar as dependências de teste e banco**

```powershell
npm install --save-exact @supabase/supabase-js@2.117.2 @supabase/ssr@0.12.7
npm install --save-exact --save-dev vitest@5.0.3 pg@8.23.1 dotenv@18.0.5
```

- [ ] **Step 4: Registrar as versões instaladas em `PROGRESSO.md`**

Criar `PROGRESSO.md` com a tabela de etapas (⬜/🟡/✅/⛔, evidência, data) e uma tabela de versões lida de `package.json` — inclusive a versão de `typescript` que o scaffolder instalou, e a de `tailwindcss`. Esse é o registro que trava as versões. O `package-lock.json` **precisa** ser commitado: é ele que fixa as versões exatas das dependências indiretas.

- [ ] **Step 5: Criar `.env.example` e um `.env.local` vazio**

`SUPABASE_DB_URL` é a string **Session pooler** (porta 5432) — usada só pelas ferramentas locais (migrations e testes), nunca pelo app.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
DEEPSEEK_API_KEY=
SUPABASE_DB_URL=
```

Comentário em cada linha dizendo onde achar o valor no painel do Supabase. Criar também um `.env.local` **vazio** (o Lucas preenche na Task 3) para que o Step 6 seja verificável.

- [ ] **Step 6: Verificar que `.env.local` está ignorado**

Run: `git check-ignore -v .env.local`
Expected: linha terminando em `.gitignore:NN:.env*.local`

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "etapa-0: scaffold Next 16 com versoes travadas e PROGRESSO.md"
```

---

## Task 2: `lib/format.ts` — dinheiro e data (Etapa 1)

**Files:**
- Create: `lib/format.ts`, `lib/format.test.ts`, `vitest.config.ts`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Consumes: nada.
- Produces: `formatarMoeda(centavos: number): string`, `formatarData(iso: string): string`, `formatarDataHora(iso: string): string`. Todas puras. (`parsearMoeda` fica para o plano da Etapa 3, que é quem tem formulário de entrada.)

- [ ] **Step 1: Escrever o teste que falha**

Arquivo `lib/format.test.ts`, com estes casos exatos:

```ts
import { describe, it, expect } from 'vitest'
import { formatarMoeda, formatarData, formatarDataHora } from './format'

describe('formatarMoeda', () => {
  it('formata centavos no padrão brasileiro', () => {
    expect(formatarMoeda(123456)).toBe('R$ 1.234,56')
  })
  it('formata zero', () => {
    expect(formatarMoeda(0)).toBe('R$ 0,00')
  })
  it('formata valor negativo com o sinal antes do R$', () => {
    expect(formatarMoeda(-500)).toBe('-R$ 5,00')
  })
  it('usa ponto de milhar a partir de mil reais', () => {
    expect(formatarMoeda(100000)).toBe('R$ 1.000,00')
  })
})

describe('formatarData', () => {
  it('formata no padrão dd/mm/aaaa', () => {
    expect(formatarData('2026-10-05T12:00:00-03:00')).toBe('05/10/2026')
  })
  it('nao adianta o dia para uma venda das 22h em Sao Paulo', () => {
    // 05/10/2026 22:30 em SP = 06/10/2026 01:30 UTC
    expect(formatarData('2026-10-06T01:30:00Z')).toBe('05/10/2026')
  })
})

describe('formatarDataHora', () => {
  it('inclui a hora de Sao Paulo', () => {
    expect(formatarDataHora('2026-10-06T01:30:00Z')).toBe('05/10/2026 22:30')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/format.test.ts`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Implementar `lib/format.ts`**

Assinaturas exatas acima. Implementação: `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })` para dinheiro; para data, `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ... })` — **passar `timeZone` explicitamente**, senão a data depende do fuso da máquina que roda o build.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/format.test.ts`
Expected: PASS — 7 testes.

- [ ] **Step 5: Adicionar o script e conferir**

`package.json`: `"test": "vitest run"`.
Run: `npm test`
Expected: PASS, exit code 0.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "etapa-1: formatacao de moeda e data com fuso de Sao Paulo"
```

---

## Task 3: Projeto Supabase, clients, middleware e perfil (Etapa 1)

**Dependência humana (bloqueia esta tarefa):** o Lucas precisa criar o projeto Supabase novo em `sa-east-1` e colocar em `.env.local` a URL, a chave pública (anon/publishable) e a `SUPABASE_DB_URL` (Session pooler). **Sem isso a Etapa 1 não anda** — login é Supabase Auth.

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/auth/rotas.ts`, `lib/auth/rotas.test.ts`, `middleware.ts`
- Modify: `.env.local` (criado pelo Lucas, não versionado)

**Interfaces:**
- Consumes: nada das tarefas anteriores.
- Produces:
  - `criarClienteNavegador(): SupabaseClient` (de `lib/supabase/client.ts`)
  - `criarClienteServidor(): Promise<SupabaseClient>` (de `lib/supabase/server.ts`, usa `await cookies()` — Next 16 tem `cookies()` assíncrono)
  - `rotaPublica(pathname: string): boolean` (de `lib/auth/rotas.ts`) — `true` só para `/login` e `/auth/*`
  - `perfilAtual(): Promise<{ id: string; nome: string; papel: 'dono' | 'atendente' } | null>`

- [ ] **Step 1: Escrever o teste que falha de `rotaPublica`**

`lib/auth/rotas.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rotaPublica } from './rotas'

describe('rotaPublica', () => {
  it('libera o login', () => { expect(rotaPublica('/login')).toBe(true) })
  it('libera as rotas de auth', () => { expect(rotaPublica('/auth/callback')).toBe(true) })
  it('protege a raiz', () => { expect(rotaPublica('/')).toBe(false) })
  it('protege as telas do app', () => {
    for (const r of ['/vendas', '/vendas/nova', '/produtos', '/estoque',
                     '/clientes', '/crediario', '/caixa', '/relatorios', '/agente']) {
      expect(rotaPublica(r)).toBe(false)
    }
  })
  it('nao confunde prefixo parecido com rota publica', () => {
    expect(rotaPublica('/logins')).toBe(false)
    expect(rotaPublica('/logindefake')).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/auth/rotas.test.ts`
Expected: FAIL — não resolve `./rotas`.

- [ ] **Step 3: Implementar `lib/auth/rotas.ts`**

`rotaPublica` compara o caminho por segmento (`pathname === '/login' || pathname.startsWith('/auth/')`), nunca por `includes` — senão `/logins` vira público.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/auth/rotas.test.ts`
Expected: PASS — 5 testes.

- [ ] **Step 5: Implementar os clients do Supabase**

`lib/supabase/client.ts` e `lib/supabase/server.ts` no padrão do `@supabase/ssr@0.12.7`: `createBrowserClient` / `createServerClient` com adaptador de cookies. No servidor, o adaptador precisa de `getAll` e `setAll`, com `try/catch` no `setAll` (Server Components não podem escrever cookie). `criarClienteServidor` é `async` e faz `await cookies()`.

- [ ] **Step 6: Implementar `middleware.ts`**

Uma instância de `createServerClient` por requisição, chamando `supabase.auth.getUser()` (nunca `getSession()`, que não valida o token). Se `!user && !rotaPublica(pathname)` → redirect para `/login`. **Sempre devolver o `response` que o Supabase construiu** (é ele que carrega os cookies de refresh), inclusive nos redirects.

- [ ] **Step 7: Implementar `perfilAtual()`**

Consulta `perfis` pelo `user.id`. Sem linha em `perfis` → retorna `null`. É o insumo da Task 4 para a mensagem `Usuário sem perfil cadastrado. Fale com o responsável.`

- [ ] **Step 8: Verificar que builda e que o type-check passa**

Run: `npm run build`
Expected: exit code 0, sem erro de tipo.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "etapa-1: clients supabase, middleware de sessao e checagem de perfil"
```

---

## Task 4: Login, logout e casca do app (Etapa 1)

**Files:**
- Create: `app/(auth)/login/page.tsx`, `app/(auth)/login/actions.ts`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`
- Delete: `app/page.tsx` — obrigatório: `app/page.tsx` e `app/(app)/page.tsx` resolvem ambos para `/` e o build falha por rota duplicada

**Interfaces:**
- Consumes: `criarClienteServidor` e `perfilAtual` (Task 3).
- Produces: rotas `/login` e `/` renderizando o menu com 9 entradas: Vendas, Nova venda, Produtos, Estoque, Clientes, Crediário, Caixa, Relatórios, Agente. Ações `entrar(formData)` e `sair()`.

- [ ] **Step 1: Apagar `app/page.tsx`**

Sem isso o build falha com rota `/` duplicada (ela passa a viver em `app/(app)/page.tsx`).

- [ ] **Step 2: Implementar `app/(auth)/login/page.tsx`**

Formulário com e-mail e senha, textos em português, botão único `Entrar`. Server Action `entrar` chama `signInWithPassword`; em erro, mostra `E-mail ou senha incorretos.` (nunca a mensagem crua do Supabase).

- [ ] **Step 3: Implementar a casca `app/(app)/layout.tsx`**

Layout server-side: chama `perfilAtual()`. Se `null` → renderiza apenas `Usuário sem perfil cadastrado. Fale com o responsável.` com botão `Sair`, **sem** o menu. Senão, renderiza menu lateral e o botão `Sair` (Server Action `sair` com `signOut` + redirect para `/login`).

Esta é a segunda linha de defesa: se o middleware falhar em algum caminho, o layout não deixa passar.

- [ ] **Step 4: Verificar o fluxo manualmente (evidência da Etapa 1)**

Criar o usuário no painel do Supabase (Authentication → Users) e a linha em `perfis` com `papel = 'dono'`. Depois, com `npm run dev` rodando:
1. Acessar `http://localhost:3000/vendas` sem sessão → deve cair em `/login`.
2. Logar → deve ver o menu com 9 entradas.
3. Recarregar (F5) → continua logado.
4. Clicar `Sair` → volta para `/login`, e `/vendas` redireciona de novo.

Guardar o resultado como evidência no `PROGRESSO.md`.

- [ ] **Step 5: Verificar que builda**

Run: `npm run build`
Expected: exit code 0.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "etapa-1: login, logout, menu lateral e guarda de perfil"
```

- [ ] **Step 7: Marcar a Etapa 1 no `PROGRESSO.md`**

Status ✅, com a evidência do Step 4 e a data. Commit `etapa-1: fechamento com evidencia`.

---

## Task 5: Migration 001 — tabelas, RLS e perfil inicial (Etapa 2)

**Files:**
- Create: `supabase/migrations/001_base.sql`
- Modify: `PROGRESSO.md`

**Interfaces:**
- Consumes: `SUPABASE_DB_URL` do `.env.local`.
- Produces: as 10 tabelas, índices, constraints e RLS na forma final descrita na spec §7.1–§7.4, na ordem de criação `perfis → produtos → clientes → caixa_sessoes → vendas → venda_itens → venda_pagamentos → caixa_movimentos → estoque_movimentos → crediario_lancamentos`.

- [ ] **Step 1: Escrever `supabase/migrations/001_base.sql`**

Implementar exatamente a spec §7.1–§7.4 (colunas, checks, índices, FKs, RLS idempotente). Sem inventar coluna. Atenção a três pontos que a spec exige e são fáceis de esquecer:
- `create unique index caixa_um_aberto_por_terminal on caixa_sessoes (terminal) where status = 'aberto';`
- `create index produtos_nome_trgm on produtos using gin (nome gin_trgm_ops);` — exige `create extension if not exists pg_trgm;` antes.
- `add constraint venda_itens_produto_unico unique (venda_id, produto_id);`

- [ ] **Step 2: Aplicar a migration**

O runner da Task 6 ainda não existe, então aplicar com um comando único:

```powershell
node -e "const {Client}=require('pg');const d=require('dotenv').config({path:'.env.local'}).parsed;const fs=require('fs');const c=new Client({connectionString:d.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(fs.readFileSync('supabase/migrations/001_base.sql','utf8'))).then(()=>{console.log('migration aplicada');return c.end()}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: `migration aplicada`, exit code 0.

- [ ] **Step 3: Verificar o resultado no banco**

Run:

```powershell
node -e "const {Client}=require('pg');const d=require('dotenv').config({path:'.env.local'}).parsed;const c=new Client({connectionString:d.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"select tablename, rowsecurity from pg_tables where schemaname='public' order by tablename\")).then(r=>{console.table(r.rows);return c.end()}).catch(e=>{console.error(e.message);process.exit(1)})"
```

Expected: 10 linhas, **todas** com `rowsecurity = true`. Se alguma vier `false`, a migration está errada — corrigir e reaplicar.

- [ ] **Step 4: Criar o primeiro dono em `perfis`**

Depois de criar o usuário no painel do Supabase, inserir a linha com `papel = 'dono'` (SQL pelo mesmo comando do Step 2, ou pelo painel). Sem isso ninguém entra — a Task 4 mostra `Usuário sem perfil cadastrado.`

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-2: migration base com tabelas, constraints e RLS"
```

---

## Task 6: Runner de testes SQL (Etapa 2)

**Files:**
- Create: `tests/sql/run.mjs`, `tests/sql/_helper.sql`, `tests/sql/_fixtures.sql`, `tests/sql/casos/001_sanidade.sql`
- Modify: `package.json` (script `test:sql`)

**Interfaces:**
- Consumes: `SUPABASE_DB_URL` do `.env.local`.
- Produces:
  - `teste_ok(p_condicao boolean, p_nome text): void` (em `_helper.sql`)
  - `criar_usuario_teste(p_id uuid, p_email text): uuid`, `criar_produto(p_nome text, p_preco_venda integer, p_estoque integer): uuid`, `criar_caixa_aberto(p_usuario_id uuid): uuid` (em `_fixtures.sql`)
  - `npm run test:sql` → roda todo `tests/sql/casos/*.sql`, imprime `OK`/`FALHOU` por arquivo, sai com código 1 se qualquer caso falhar.

**Protocolo (decidido, não deixar em aberto):** cada arquivo de caso roda em **transação própria**, com `_helper.sql` + `_fixtures.sql` antes, e `ROLLBACK` no final — inclusive de `auth.users`. Um erro = `FALHOU` daquele arquivo, e o runner segue para o próximo. Vários `teste_ok` podem viver no mesmo arquivo; o primeiro que falhar aborta o arquivo e o `raise exception` nomeia a asserção.

- [ ] **Step 1: Escrever o caso de sanidade que falha**

`tests/sql/casos/001_sanidade.sql`:

```sql
do $$
begin
  perform teste_ok(
    (select count(*) = 10 from pg_tables where schemaname = 'public'),
    'existem 10 tabelas no schema public');
  perform teste_ok(
    (select count(*) = 10 from pg_tables where schemaname = 'public' and rowsecurity = true),
    'todas as 10 tabelas tem RLS ativado');
  perform teste_ok(
    (select codigo_barras = '0012345' from (
       insert into produtos (codigo_barras, nome, preco_venda, estoque_atual)
       values ('0012345', 'DIPIRONA 500mg ção 🧪', 450, 10)
       returning codigo_barras) t),
    'codigo de barras preserva zeros a esquerda e nome aceita acento e emoji');
end $$;
```

A terceira asserção é o Review Focus 3.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql`
Expected: FALHOU — o script ainda não existe (`Cannot find module tests/sql/run.mjs`).

- [ ] **Step 3: Implementar `tests/sql/_helper.sql`**

```sql
create or replace function teste_ok(p_condicao boolean, p_nome text)
returns void language plpgsql as $$
begin
  if p_condicao is null or not p_condicao then
    raise exception 'FALHOU: %', p_nome;
  end if;
  raise notice 'OK  %', p_nome;
end $$;
```

- [ ] **Step 4: Implementar `tests/sql/_fixtures.sql`**

`criar_usuario_teste` insere em `auth.users` com lista explícita de colunas (`id`, `instance_id` = `'00000000-0000-0000-0000-000000000000'`, `aud` = `'authenticated'`, `role` = `'authenticated'`, `email`, `encrypted_password` = `''`, `email_confirmed_at`, `created_at`, `updated_at`) e depois em `perfis` com `papel = 'dono'`.

Se o insert falhar por coluna nova obrigatória, descobrir a lista com:

```powershell
node -e "const {Client}=require('pg');const d=require('dotenv').config({path:'.env.local'}).parsed;const c=new Client({connectionString:d.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(\"select column_name, is_nullable, column_default from information_schema.columns where table_schema='auth' and table_name='users' and is_nullable='NO' order by ordinal_position\")).then(r=>{console.table(r.rows);return c.end()})"
```

`criar_produto` insere em `produtos` e devolve o id. `criar_caixa_aberto` insere em `caixa_sessoes` com `status='aberto'` e devolve o id.

- [ ] **Step 5: Implementar `tests/sql/run.mjs`**

Ler `.env.local` com `dotenv`, conectar com `pg` (`ssl: { rejectUnauthorized: false }`). Para cada arquivo `tests/sql/casos/*.sql` em ordem alfabética: `BEGIN` → `_helper.sql` → `_fixtures.sql` → caso → `ROLLBACK`. Escutar o evento `notice` e imprimir a mensagem. Em exceção, imprimir `FALHOU <arquivo>: <mensagem>` e continuar. No fim, imprimir `X OK, Y FALHOU de Z arquivos` e `process.exit(Y > 0 ? 1 : 0)`.

Comentários curtos em português.

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test:sql`
Expected: 3 linhas `OK`, depois `3 OK, 0 FALHOU de 1 arquivos`, exit code 0.

- [ ] **Step 7: Provar que o runner reprova de verdade**

Acrescentar temporariamente `perform teste_ok(false, 'caso que deve falhar');` ao arquivo de sanidade.
Run: `npm run test:sql`
Expected: `FALHOU` com o nome do caso, exit code 1. **Remover a linha depois** e rodar de novo para confirmar exit code 0. Um runner que nunca reprova não é evidência de nada.

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "etapa-2: runner de testes SQL com transacao e rollback"
```

---

## Task 7: `registrar_venda` (Etapa 2)

**Files:**
- Create: `supabase/migrations/002_registrar_venda.sql`, `tests/sql/casos/010_venda.sql`
- Modify: `package.json` (nada, se o runner já cobre `casos/`)

**Interfaces:**
- Consumes: `teste_ok`, `criar_usuario_teste`, `criar_produto`, `criar_caixa_aberto` (Task 6); tabelas (Task 5).
- Produces: `registrar_venda(p_chave_idempotencia uuid, p_cliente_id uuid, p_itens jsonb, p_pagamentos jsonb, p_desconto integer) returns jsonb` — devolve `{"id": uuid, "numero": bigint, "total": integer, "troco": integer}`.

Formato de `p_itens`: `[{"produto_id":"uuid","quantidade":2}]`.
Formato de `p_pagamentos`: `[{"forma":"dinheiro","valor":6000}]`.

- [ ] **Step 1: Escrever os casos que falham**

`tests/sql/casos/010_venda.sql`, seguindo a ordem de validação da spec §8.1. Casos, com os valores exatos:

| # | Cenário | Esperado |
|---|---|---|
| 1 | 2× produto de R$ 4,50, dinheiro R$ 20,00 | venda criada, `total = 900`, `troco = 1100`, estoque caiu 2 |
| 2 | ×3 + ×4 do mesmo produto com estoque 5 | exceção `Estoque insuficiente`, estoque **continua 5** (Review Focus: A1) |
| 3 | `quantidade: 0` e `quantidade: -1` | exceção, estoque intacto (A2) |
| 4 | `quantidade: "1.5"` | exceção com mensagem de português, **não** erro de sintaxe do Postgres (Review Focus 2) |
| 5 | `quantidade: 999999` | exceção `Quantidade máxima por item`, não *integer out of range* (Review Focus 2) |
| 6 | sem caixa aberto | exceção `Abra o caixa para começar a vender.` |
| 7 | `desconto` maior que o subtotal | exceção |
| 8 | `desconto` igual ao subtotal (total R$ 0,00) | exceção `O desconto não pode zerar a venda.` (Review Focus 1) |
| 9 | PIX 6.000 numa venda de 5.000 | exceção `O valor no cartão não pode ser maior que o total.` |
| 10 | PIX 3.000 + dinheiro 2.500 numa venda de 5.000 | venda criada, `troco = 500` |
| 11 | crediário dentro do limite | venda criada + lançamento `compra` no crediário |
| 12 | crediário acima do limite | exceção `Limite excedido` |
| 13 | crediário com `limite_credito = 0` | exceção `não tem crediário liberado` |
| 14 | crediário com cliente bloqueado | exceção `bloqueado` |
| 15 | crediário sem cliente | exceção `Crediário exige cliente` |
| 16 | mesma `chave_idempotencia` duas vezes | segunda devolve o **mesmo** `id`/`numero`, e existe **uma** venda |
| 17 | `p_itens` vazio (`[]`) | exceção `Carrinho vazio` |
| 18 | venda às 22h de 05/10 (SP) | aparece em `v_vendas_dia` no dia `2026-10-05`, não `2026-10-06` (A3) |

O caso 18 depende das views (Task 11). Se a Task 11 ainda não existir, marcar o caso 18 como pendente dentro do arquivo e movê-lo para a Task 11 — não deixar um teste que nunca roda.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql`
Expected: `FALHOU 010_venda.sql: function registrar_venda(...) does not exist`.

- [ ] **Step 3: Implementar `supabase/migrations/002_registrar_venda.sql`**

Implementar `registrar_venda` seguindo **a ordem exata da spec §8.1**, na assinatura acima. Pontos que não podem faltar:
- `security definer` + `set search_path = public, pg_temp`;
- agregação por `produto_id` antes de validar estoque;
- `for update` com `order by produto_id` (ordem fixa evita deadlock);
- validação de quantidade: inteiro, `> 0`, `<= 9999` — usar `(v_item->>'quantidade') ~ '^\d+$'` antes do cast, para o erro ser de português e não `invalid input syntax`;
- `desconto` `>= 0`, `<= subtotal`, e `total > 0` (Review Focus 1);
- regra de pagamentos por forma e cálculo do troco **somente sobre dinheiro**;
- early return pela `chave_idempotencia`, antes de qualquer validação;
- um `caixa_movimentos` por forma de pagamento;
- lançamento `compra` no crediário apenas sobre a parcela do crediário.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:sql`
Expected: todos os `OK` do arquivo, `0 FALHOU`.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-2: registrar_venda atomica com validacao e idempotencia"
```

---

## Task 8: Teste de concorrência (Etapa 2)

**Files:**
- Create: `tests/sql/concorrencia.mjs`
- Modify: `package.json` (script `test:sql:concorrencia`)

**Interfaces:**
- Consumes: `registrar_venda` (Task 7).
- Produces: `npm run test:sql:concorrencia` — prova que duas vendas simultâneas do último item não vendem duas vezes.

**Nota de desenho:** este é o único teste que **grava fora de transação** (duas conexões concorrentes não cabem em um rollback comum). Ele precisa limpar tudo o que criou no fim, e falha se a limpeza não for possível.

- [ ] **Step 1: Escrever o teste que falha**

`tests/sql/concorrencia.mjs`: cria usuário de teste, caixa aberto e um produto com `estoque_atual = 1`. Abre duas conexões `pg`. Na conexão A: `BEGIN` + `registrar_venda` de 1 unidade, **sem** commit. Na conexão B: chamar `registrar_venda` de 1 unidade e medir o tempo — B tem que ficar **bloqueada** até A terminar. A commita; então B deve **falhar** com `Estoque insuficiente`. Depois, limpar: apagar venda, itens, movimentos, caixa, produto, perfil e usuário de teste.

- [ ] **Step 2: Rodar e ver o estado atual**

Run: `npm run test:sql:concorrencia`
Expected: FALHOU — o script ainda não existe.

- [ ] **Step 3: Implementar a verificação de bloqueio**

Critérios de aprovação explícitos, impressos como `OK`/`FALHOU`:
- B ficou bloqueada por pelo menos 200 ms (prova o `for update`);
- depois do commit de A, B falhou com mensagem contendo `Estoque insuficiente`;
- o estoque final do produto é **0**, e existe **exatamente uma** venda;
- a limpeza removeu todas as linhas criadas.

Se B **passar** (vender as duas), o teste falha — é exatamente o bug que ele existe para pegar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:sql:concorrencia`
Expected: todos `OK`, exit code 0, e a verificação de limpeza confirma 0 linhas de teste restantes.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-2: teste de concorrencia provando que o ultimo item nao vende duas vezes"
```

---

## Task 9: `cancelar_venda` (Etapa 2)

**Files:**
- Create: `supabase/migrations/003_cancelar_venda.sql`, `tests/sql/casos/020_cancelamento.sql`

**Interfaces:**
- Consumes: `registrar_venda` (Task 7), fixtures (Task 6).
- Produces: `cancelar_venda(p_venda_id uuid, p_motivo text) returns void`.

- [ ] **Step 1: Escrever os casos que falham**

`tests/sql/casos/020_cancelamento.sql`, seguindo a matriz da spec §8.2:

| # | Cenário | Esperado |
|---|---|---|
| 1 | cancelar venda com caixa aberto | estoque volta ao valor original; existe movimento `cancelamento` |
| 2 | cancelar a mesma venda duas vezes | exceção `Esta venda já foi cancelada em` |
| 3 | cancelar sendo `atendente` | exceção `Só o dono pode cancelar vendas.` |
| 4 | cancelar venda de caixa já fechado | exceção `caixa já fechado` |
| 5 | venda no crediário + pagamento posterior do cliente | exceção `já fez pagamento após esta venda` |
| 6 | venda no crediário sem pagamento posterior | estorno registrado; saldo do cliente volta a zero |
| 7 | venda cancelada em `v_vendas_dia` | não aparece no total do dia (A7) — depende da Task 11 |

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql`
Expected: `FALHOU 020_cancelamento.sql: function cancelar_venda(...) does not exist`.

- [ ] **Step 3: Implementar `supabase/migrations/003_cancelar_venda.sql`**

Assinatura acima; `security definer` + `search_path`; checagem de papel; `select ... for update` na venda; as cinco decisões da spec §8.2 nesta ordem: já cancelada → permissão → caixa fechado → pagamento posterior → cancelar. Ao cancelar: status, `cancelado_em`, `cancelado_por`, `motivo_cancelamento`, estoque de volta com `saldo_apos`, movimento de caixa de estorno **só se a venda tinha dinheiro**, e estorno no crediário.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:sql`
Expected: `0 FALHOU`.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-2: cancelar_venda com matriz de decisao e estornos"
```

---

## Task 10: Funções de caixa (Etapa 2)

**Files:**
- Create: `supabase/migrations/004_caixa.sql`, `tests/sql/casos/030_caixa.sql`

**Interfaces:**
- Consumes: `registrar_venda` (Task 7).
- Produces:
  - `abrir_caixa(p_valor_inicial integer) returns uuid`
  - `caixa_movimento(p_tipo text, p_valor integer, p_motivo text) returns void` — `p_tipo` em `'sangria' | 'suprimento'`
  - `fechar_caixa(p_valor_contado integer, p_observacao text) returns jsonb` — devolve `{esperado_dinheiro, diferenca}`

- [ ] **Step 1: Escrever os casos que falham**

`tests/sql/casos/030_caixa.sql`:

| # | Cenário | Esperado |
|---|---|---|
| 1 | abrir caixa com R$ 100,00 | sessão `aberto` |
| 2 | abrir um segundo caixa | exceção `Já existe um caixa aberto.` (índice único parcial) |
| 3 | sangria de R$ 30,00 e suprimento de R$ 10,00 | esperado cai R$ 20,00 |
| 4 | venda de R$ 9,00 em dinheiro com R$ 20,00 recebidos | esperado sobe R$ 9,00 (o troco de R$ 11,00 não conta como entrada) |
| 5 | venda no PIX | **não** altera `esperado_dinheiro` |
| 6 | fechamento: inicial 10.000 + venda dinheiro 900 − sangria 3.000 | `esperado_dinheiro = 7900` |
| 7 | contado 7.800 | `diferenca = -100`, fechamento **acontece** |
| 8 | fechamento sem observação com diferença ≠ 0 | exceção exigindo observação |
| 9 | mexer em caixa já fechado | exceção |
| 10 | caixa fechado + tentativa de venda | exceção `Abra o caixa` |

O caso 4 é o que prova que o troco não infla o caixa — é o erro de caixa mais comum.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql`
Expected: `FALHOU 030_caixa.sql: function abrir_caixa(...) does not exist`.

- [ ] **Step 3: Implementar `supabase/migrations/004_caixa.sql`**

As três funções na assinatura acima, `security definer` + `search_path`. `abrir_caixa` insere a sessão com `aberto_por = auth.uid()`. `fechar_caixa` só o papel `dono`, calcula a fórmula da spec §8.3, grava e vira a sessão para `fechado` (imutável depois). Nenhuma dessas funções aceita valor negativo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:sql`
Expected: `0 FALHOU`.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-2: abrir, movimentar e fechar caixa"
```

---

## Task 11: Views de leitura e fechamento da Etapa 2

**Files:**
- Create: `supabase/migrations/005_views.sql`, `tests/sql/casos/040_views.sql`
- Modify: `tests/sql/casos/010_venda.sql` (mover o caso 18 para cá), `tests/sql/casos/020_cancelamento.sql` (idem, caso 7), `PROGRESSO.md`

**Interfaces:**
- Consumes: tudo das Tasks 5–10.
- Produces: as views da spec §6: `v_caixa_atual`, `v_vendas_dia`, `v_vendas_lista`, `v_estoque_baixo`, `v_estoque_zerado`, `v_clientes_devedores`, `v_mais_vendidos`, `v_lucro_periodo`, `v_estoque_parado`, `v_formas_pagamento`.

- [ ] **Step 1: Escrever os casos que falham**

`tests/sql/casos/040_views.sql`:

| # | Cenário | Esperado |
|---|---|---|
| 1 | venda às 22h de 05/10 (SP) | `v_vendas_dia` mostra `2026-10-05`, nunca `2026-10-06` (A3) |
| 2 | venda cancelada | não entra em `v_vendas_dia` **nem** em `v_lucro_periodo` (A7) |
| 3 | venda com itens de custo conhecido | `v_lucro_periodo` = Σ`(preco_unitario − preco_custo) × quantidade` |
| 4 | venda PIX 3.000 + dinheiro 2.000 | `v_formas_pagamento` mostra duas linhas, 3.000 e 2.000 |
| 5 | venda no crediário | aparece em `v_formas_pagamento` com a forma `crediario` e **não** entra em `v_caixa_atual.esperado_dinheiro` |
| 6 | dois clientes devendo valores diferentes | `v_clientes_devedores` ordena pelo maior |
| 7 | cliente com compra 5.000 e pagamento 2.000 | saldo devedor 3.000 |
| 8 | produto com estoque 2 e mínimo 3; outro com 0 | aparece em `v_estoque_baixo` e em `v_estoque_zerado` respectivamente |
| 9 | produto com estoque e sem venda há 61 dias | aparece em `v_estoque_parado` |

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql`
Expected: `FALHOU 040_views.sql: relation "v_vendas_dia" does not exist`.

- [ ] **Step 3: Implementar `supabase/migrations/005_views.sql`**

As 10 views da spec §6. Regra que não pode escapar em nenhuma delas: `where status = 'concluida'` e `(criado_em at time zone 'America/Sao_Paulo')::date`. O crediário nunca entra em `esperado_dinheiro` (spec §6, nota).

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:sql`
Expected: `0 FALHOU` em todos os arquivos de caso (010, 020, 030, 040).

- [ ] **Step 5: Marcar a Etapa 2 no `PROGRESSO.md`**

Status ✅ com a evidência: a saída completa de `npm run test:sql` e de `npm run test:sql:concorrencia`. Colar o resumo (`N OK, 0 FALHOU`) e a data.

- [ ] **Step 6: Commit final da etapa**

```powershell
git add -A
git commit -m "etapa-2: views de leitura, fuso de Sao Paulo e fechamento da etapa"
```

---

## Depois deste plano

As Etapas 3–11 seguem em planos próprios, escritos quando o anterior fechar (cada um já produz software utilizável):

| Plano | Etapas | Entrega |
|---|---|---|
| 2 | 3–4 | Produtos, estoque, importação CSV e o PDV completo |
| 3 | 5–6 | Histórico de vendas, clientes e crediário |
| 4 | 7–8 | Relatórios e agente de IA |
| 5 | 9–11 | Publicação, migração de dados e uso paralelo |

Motivo da divisão: um plano único das 12 etapas seria uma transcrição de milhares de linhas, e cada etapa executada invalidaria partes dele.
