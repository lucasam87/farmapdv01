# Farmácia — Produtos, Estoque, Importação e PDV (Etapas 3–4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O Lucas cadastra e importa o catálogo real da farmácia (planilha do Nex), dá entrada e ajuste de estoque, e faz uma venda inteira só com o teclado no balcão — com o estoque caindo e o clique duplo não duplicando nada.

**Architecture:** O Postgres continua sendo a autoridade: o navegador manda intenção, o banco decide preço, estoque e total. As três funções SQL novas (`produto_salvar`, `produto_entrada`, `produto_ajuste`) e `importar_produtos` são as únicas escritas de produto e estoque, e **nenhuma delas escreve `produtos.estoque_atual` fora do livro-razão** `estoque_movimentos`. A leitura de arquivo é a exceção declarada: o parse (CSV/XLSX) acontece em TypeScript puro e testado com Vitest, mas nada é gravado por ele — quem grava é a RPC, tudo ou nada.

**Tech Stack:** Next.js 16.3.8 (App Router, TypeScript), React 19.2.8, Tailwind 4.3.3, Supabase (Postgres + Auth + RLS), Vitest 5.0.3, Playwright (novo, apenas `devDependencies`), `zlib` do Node para `.xlsx`, Python + `openpyxl` (fora do projeto) para gerar fixtures. Sem pnpm, sem `src/`, sem biblioteca de planilha no `package.json`.

**Spec:** `docs/superpowers/specs/2026-10-06-sistema-farmacia-design.md` — este plano implementa as Etapas 3 e 4 da spec (§13) e argumenta a partir dela: §5 (contrato de RPCs), §8.6 (estoque), §8.7 (importação), §9 (mensagens), §10 (interface e teclado), §12 (estratégia de testes). O executor lê os dois.

**Plano anterior:** `docs/superpowers/plans/2026-10-06-fundacao-login-banco.md` (Etapas 0–2, concluído). O ledger com todas as decisões está em `.superpowers/sdd/2026-10-06-fundacao-login-banco/progress.md`.

---

## Global Constraints

- Dinheiro sempre em **centavos inteiros** (`integer`). Nunca `float`, nunca `numeric` com decimal. Exibição `R$ 1.234,56`; datas `dd/mm/aaaa`.
- Todo texto de interface em **português do Brasil**. Nenhum erro técnico do Postgres pode aparecer na tela.
- Agregação por dia sempre com `(criado_em at time zone 'America/Sao_Paulo')::date`. Nunca `criado_em::date`.
- **RLS ativado em todas as tabelas**, sem exceção. Políticas idempotentes (`drop policy if exists` antes de `create policy`). As tabelas novas deste plano não existem: as 10 da Etapa 2 já bastam. Se alguma tarefa achar que precisa de tabela nova, é sinal de erro de desenho — falar antes.
- Toda função de escrita: `security definer` + `set search_path = public, pg_temp` + verificação de `auth.uid()`, de linha em `perfis`, de `ativo` e de papel.
- Toda função de escrita termina com `revoke all on function ... from public, anon` e `grant execute on function ... to authenticated, service_role`. **`from anon` é obrigatório**: no Supabase o `EXECUTE` chega a `anon` por *default privileges*, e revogar só de `PUBLIC` não tira nada (bug real corrigido na Etapa 2).
- O navegador **nunca** calcula dinheiro nem envia preço unitário. Ele envia `produto_id` e `quantidade`.
- Toda Server Action que chama RPC devolve `{ ok: false, mensagem }` com o texto da exceção em português. Nunca `throw` cru (dá tela de erro em inglês).
- Versões **travadas** (sem `^`, sem `latest`). Gerenciador: **npm** (11.17.0). Node 24.19.0. `app/` na raiz, alias `@/*`.
- **Migrations:** o banco **não** aceita conexão `pg` (a senha nunca autenticou). Aplicar sempre com `npm run migrar` (ou `npm run migrar -- 006_produtos.sql` para uma só). `supabase db push` e `psql` **não** funcionam.
- **Testes SQL:** rodam pelo endpoint de gerenciamento, nunca por `pg`. `npm run test:sql` roda cada `tests/sql/casos/*.sql` numa transação com `ROLLBACK`.
- Nenhuma etapa vira ✅ no `PROGRESSO.md` sem a evidência colada. Um commit por etapa no formato `etapa-N: <descrição>`.
- O app é **sempre claro** na v1 (`color-scheme: light`). Não introduzir `prefers-color-scheme`.
- O Next 16 usa **`proxy.ts`**, não `middleware.ts`. `cookies()` é assíncrono. Ler `node_modules/next/dist/docs/` antes de escrever código de Next — as APIs mudaram.

---

## Review Focus

Cinco formas de entrada que a spec implica e que nenhum teste dela cobre, mais prováveis primeiro. Cada uma recebe teste na tarefa dona do código.

1. **Código de barras que perdeu os zeros dentro da planilha.** Se a coluna do Excel for numérica, `0012345` já virou `12345` **antes** de nós lermos. Completar zeros seria inventar um código que pode casar com o produto errado. → Task 6 e Task 8.
2. **Preço lido com fator 100 errado.** Célula de texto `"4,50"` contra célula numérica `4.5` na mesma planilha (acontece em export parcialmente formatado). → Task 5, Task 6 e Task 8.
3. **Arquivo que não é o que diz ser.** `.xls` binário antigo renomeado para `.xlsx`, `.xlsx` corrompido, planilha sem cabeçalho reconhecível, ZIP sem `sheet1.xml`. Tem que virar mensagem em português com o motivo — nunca stack trace. → Task 6 e Task 8.
4. **Quantidade fracionária ou absurda no cadastro e na entrada de estoque.** `"1.5"` ou `999999` no formulário vira erro de sintaxe do Postgres na cara do balcão se o texto não for validado antes do cast. → Task 1, Task 2 e Task 9.
5. **Clique duplo e teclado no PDV.** Duas teclas rápidas ou dois cliques em `Finalizar` não podem gerar duas vendas; e a venda inteira tem que ser possível sem tocar no mouse. → Task 11 e Task 13.

---

## File Structure

**Criados — banco (3 migrations, 2 arquivos de caso):**

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/006_produtos.sql` | `produto_salvar` |
| `supabase/migrations/007_estoque.sql` | `produto_entrada`, `produto_ajuste` |
| `supabase/migrations/008_importacao.sql` | `importar_produtos` |
| `tests/sql/casos/060_estoque.sql` | Casos de produto, entrada e ajuste |
| `tests/sql/casos/070_importacao.sql` | Casos de importação |

**Criados — leitura de arquivo e dinheiro (4 módulos puros, 4 testes):**

| Arquivo | Responsabilidade |
|---|---|
| `lib/dinheiro.ts` | `parsearCentavos` — texto do usuário para centavos |
| `lib/csv.ts` | Ler CSV: aspas, separador, encoding |
| `lib/xlsx.ts` | Ler `.xlsx` com `zlib` do Node, sem dependência |
| `lib/tabela.ts` | Tipo `Tabela`, mapa de cabeçalho tolerante, rodapé |

**Criados — telas e ações:**

| Arquivo | Responsabilidade |
|---|---|
| `app/(app)/produtos/page.tsx` | Busca e lista |
| `app/(app)/produtos/novo/page.tsx` | Cadastro |
| `app/(app)/produtos/[id]/page.tsx` | Detalhe, entrada, ajuste |
| `app/(app)/produtos/actions.ts` | Server Actions de produto e estoque |
| `app/(app)/produtos/importar/page.tsx` | Prévia e confirmação |
| `app/(app)/produtos/importar/actions.ts` | Analisar e importar |
| `app/(app)/estoque/page.tsx` | Abas baixo / zerado / parado |
| `app/(app)/vendas/page.tsx` | Casca do histórico do dia |
| `app/(app)/vendas/nova/page.tsx` | PDV |
| `app/(app)/vendas/nova/pdv.tsx` | Client Component do PDV |
| `app/(app)/vendas/nova/actions.ts` | Server Action de venda |
| `app/api/produtos/busca/route.ts` | Busca de produto chamada a cada tecla pelo PDV |
| `app/(app)/atalhos.tsx` | Atalho global `F3` |

**Criados — testes e fixtures:**

| Arquivo | Responsabilidade |
|---|---|
| `tests/e2e/venda.spec.ts` | Playwright: teclado, duplo clique |
| `tests/fixtures/produtos.xlsx` | Fixture binária (preço numérico) |
| `tests/fixtures/produtos_texto.xlsx` | Fixture binária (preço texto + rodapé) |
| `scripts/gerar-fixtures-xlsx.py` | Gera as duas fixtures (não roda no app) |

**Modificados:** `package.json` (scripts `test:e2e`), `app/(app)/layout.tsx` (monta o atalho), `PROGRESSO.md` (evidência).

---

## Task 0: Supabase CLI ligado e histórico de migrations verdadeiro

**Files:**
- Create: `supabase/config.toml` (gerado pelo CLI), `supabase/.temp/*` (gerado, ignorado)
- Modify: `.gitignore` (ignorar `supabase/.temp/`), `PROGRESSO.md`

**Interfaces:**
- Consumes: `SUPABASE_ACCESS_TOKEN` e `NEXT_PUBLIC_SUPABASE_URL` do `.env.local` (já existem).
- Produces: projeto ligado ao CLI (`supabase/.temp/project-ref`), e `supabase_migrations.schema_migrations` com as versões `001`–`005` marcadas como aplicadas.

**Contexto já sondado (não repetir a descoberta):** `supabase link` **não** pede a senha do banco quando o `SUPABASE_ACCESS_TOKEN` está no ambiente — comprovado com exit 0. O `migration repair --linked` também **não** usa o pooler e grava o histórico pela API. O que continua fora de alcance é `supabase db push` (exige conexão direta), então **migrations seguem por `npm run migrar`**.

- [ ] **Step 1: Confirmar que o token está disponível para o CLI**

```powershell
$env:SUPABASE_ACCESS_TOKEN = (Select-String -Path ".env.local" -Pattern '^SUPABASE_ACCESS_TOKEN=(.+)$').Matches.Groups[1].Value.Trim()
if (-not $env:SUPABASE_ACCESS_TOKEN) { throw "SUPABASE_ACCESS_TOKEN ausente no .env.local" }
"token presente"
```

Expected: `token presente`. Se falhar, parar: sem token nenhuma migration foi aplicada até hoje.

- [ ] **Step 2: Ligar o projeto ao CLI**

```powershell
npx --yes supabase@2.120.0 link --project-ref geywpaegovurwtfoacwt --yes
```

Expected: `Finished supabase link.`, exit 0. Confere em `supabase/.temp/linked-project.json` o `"ref":"geywpaegovurwtfoacwt"` e `"name":"farmaciapdv"`.

- [ ] **Step 3: Marcar as cinco migrations já aplicadas**

```powershell
npx --yes supabase@2.120.0 migration repair --status applied 001 002 003 004 005 --linked
```

Expected: `Repaired migration history: [001 002 003 004 005] => applied`.

**Não** rodar `supabase db push` em nenhum momento: ele exigiria a senha do banco, que nunca autenticou.

- [ ] **Step 4: Verificar o histórico**

```powershell
npx --yes supabase@2.120.0 migration list --linked
```

Expected: as cinco linhas com `Local` e `Remote` preenchidos (`001` a `005`), sem linha sobrando só de um lado.

- [ ] **Step 5: Ignorar o estado local do CLI**

Acrescentar ao `.gitignore`:

```
supabase/.temp/
```

`supabase/config.toml` **é commitado** (é configuração do projeto); `supabase/.temp/` é estado de máquina.

- [ ] **Step 6: Registrar no `PROGRESSO.md`**

Acrescentar na seção de migrations: o CLI está ligado, o histórico `001`–`005` está reparado, e **a regra continua sendo `npm run migrar`** — `db push` não funciona porque o banco não aceita conexão `pg`. Corrigir também a frase atual do `PROGRESSO.md` que diz que o `supabase link` precisa da senha do banco: **não precisa**, foi medido.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "etapa-3: CLI do Supabase ligado e historico de migrations reparado"
```

---

## Task 1: `produto_salvar` — cadastro e edição que não tocam no estoque

**Files:**
- Create: `supabase/migrations/006_produtos.sql`, `tests/sql/casos/060_estoque.sql`
- Modify: `tests/sql/_fixtures.sql` (nova fixture `criar_produto_completo`)

**Interfaces:**
- Consumes: `auth.uid()`, `perfis`, `produtos`, `teste_ok`/`teste_erro` (`tests/sql/_helper.sql`), `criar_usuario_teste` (`tests/sql/_fixtures.sql`).
- Produces:
  - `produto_salvar(p_produto_id uuid, p_codigo_barras text, p_nome text, p_categoria text, p_unidade text, p_preco_custo integer, p_preco_venda integer, p_estoque_minimo integer, p_ativo boolean) returns uuid` — `p_produto_id` nulo cria; não nulo edita. **Nunca escreve `estoque_atual`.**
  - `criar_produto_completo(p_nome text, p_preco_venda integer default 0, p_preco_custo integer default 0, p_codigo_barras text default null, p_estoque integer default 0, p_estoque_minimo integer default 0) returns uuid` (em `_fixtures.sql`) — insere **direto na tabela**, sem passar pela RPC, para os cenários montarem estado.

- [ ] **Step 1: Escrever os casos que falham**

`tests/sql/casos/060_estoque.sql`, seguindo o padrão de `010_venda.sql` (usuário simulado por `request.jwt.claims`, sem troca de role).

**Três regras do runner que o arquivo tem que respeitar** (levantadas de `tests/sql/run.mjs`):
1. O arquivo contém **um único `do $$ ... $$;`** e **não** pode ter `begin;`, `commit;` nem `rollback;` — o runner já envolve tudo numa transação e faz o `ROLLBACK` dele.
2. O caso **não** cria nem trunca `teste_log`: isso é do `_helper.sql`, que roda antes.
3. Nome de asserção no padrão da suíte: minúsculo, prefixado por `caso N:` (o mesmo N do comentário da seção), **sem acento** — os únicos acentos ficam nas mensagens de erro esperadas por `teste_erro`, que são copiadas literais da migration.

Valores exatos:

| # | Cenário | Esperado |
|---|---|---|
| 1 | `produto_salvar(null, '0012345', 'DIPIRONA 500mg', 'Analgésico', 'un', 250, 450, 5, true)` | produto criado, `codigo_barras = '0012345'` (zeros preservados), `estoque_atual = 0` |
| 2 | criar com `p_codigo_barras = ''` duas vezes | as duas criam, e as duas linhas têm `codigo_barras is null` (a coluna é `unique`) |
| 3 | criar com `''` e depois com `'   '` | a segunda cria também, `codigo_barras is null` nas duas |
| 4 | editar nome e preço do produto do caso 1 | nome e `preco_venda` novos, `atualizado_em > criado_em` |
| 5 | editar passando `p_nome = null` / `btrim = ''` | exceção `Informe o nome do produto.` |
| 6 | editar passando `p_preco_venda = -1` | exceção `O preço não pode ser negativo.` |
| 7 | `p_unidade = null` | grava `'un'` |
| 8 | código de barras já usado por outro produto | exceção `Já existe um produto com o código de barras` |
| 9 | `p_produto_id` de produto inexistente | exceção `Produto não encontrado.` |
| 10 | editar um produto que está com `estoque_atual = 7` | continua `7` — a função não tem como mexer no estoque |
| 11 | usuário `atendente` salva produto | funciona (dono e atendente podem, spec §5) |
| 12 | `has_function_privilege('anon', 'produto_salvar(uuid,text,text,text,text,integer,integer,integer,boolean)', 'execute')` | falso |

A asserção 12 fica **aqui**, e não no `050_permissoes.sql`, porque é nesta tarefa que a função nasce. A asserção de `anon` é a que nasceu vermelha na Etapa 2 por causa das *default privileges* do Supabase — é ela que prova que o `revoke ... from anon` foi escrito.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql`
Expected: `FALHOU 060_estoque.sql: function produto_salvar(...) does not exist` (ou `criar_produto_completo` inexistente).

- [ ] **Step 3: Acrescentar a fixture `criar_produto_completo`**

Em `tests/sql/_fixtures.sql`, ao lado de `criar_produto`. A assinatura está no bloco Interfaces. Ela insere direto em `produtos` com as colunas dadas e devolve o `id`. Existe separada de `criar_produto` porque os casos deste plano precisam de código de barras e estoque mínimo no cenário.

- [ ] **Step 4: Implementar `supabase/migrations/006_produtos.sql`**

Cabeçalho do arquivo: comentário dizendo que esta função é a **única** porta de cadastro e edição de produto e que ela **de propósito não tem parâmetro de estoque** — quem move estoque é `produto_entrada`/`produto_ajuste` (Task 2). O bloco de verificação de usuário e papel copia o de `004_caixa.sql` (Sessão expirada / sem perfil / desativado). Regras:

- `p_produto_id is null` → `insert`; senão `select ... for update`, e se `not found` → `Produto não encontrado.`
- `codigo_barras`: `nullif(btrim(coalesce(p_codigo_barras, '')), '')` — é isso que faz `''` e `'   '` virarem `null` (casos 2 e 3). Antes do insert/update, se o valor não for nulo, checar duplicidade em outro produto e levantar `Já existe um produto com o código de barras % (`%`).` com o código e o nome do dono.
- `nome` obrigatório: `p_nome is null or btrim(p_nome) = ''` → `Informe o nome do produto.`
- `preco_custo` e `preco_venda` nulos viram `0`; negativos → `O preço não pode ser negativo.`
- `estoque_minimo` nulo vira `0`; negativo → `O estoque mínimo não pode ser negativo.`
- `unidade` nula ou vazia vira `'un'`.
- `ativo` é `coalesce(p_ativo, true)`; **não** permitir desativar o último produto ativo é YAGNI, não fazer.
- No update: `atualizado_em = now()`.
- Rodapé de permissões com a lista completa de tipos, `from public, anon`.

- [ ] **Step 5: Aplicar a migration**

```powershell
npm run migrar -- 006_produtos.sql
```

Expected: `OK    006_produtos.sql (... HTTP 201)` e `1 de 1 migrations aplicadas`, exit 0.

- [ ] **Step 6: Rodar e ver passar**

Run: `npm run test:sql`
Expected: as asserções do `060_estoque.sql` como `OK`, e `0 FALHOU` em todos os arquivos. A contagem total sobe (era 119).

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "etapa-3: produto_salvar sem tocar no estoque"
```

---

## Task 2: `produto_entrada` e `produto_ajuste` — o livro-razão manda

**Files:**
- Create: `supabase/migrations/007_estoque.sql`
- Modify: `tests/sql/casos/060_estoque.sql` (acrescentar os casos)

**Interfaces:**
- Consumes: `produtos`, `estoque_movimentos` (constraint `estoque_movimentos_qtd_nao_zero`), helpers de teste.
- Produces:
  - `produto_entrada(p_produto_id uuid, p_quantidade integer, p_custo integer, p_motivo text) returns integer` — devolve o **novo saldo**. Grava movimento `entrada`, e atualiza `preco_custo` **apenas quando `p_custo` não é nulo**.
  - `produto_ajuste(p_produto_id uuid, p_novo_saldo integer, p_motivo text) returns integer` — devolve o **novo saldo**. Grava o **delta** como movimento `ajuste`, com `saldo_apos = p_novo_saldo`.

- [ ] **Step 1: Escrever os casos que falham**

Acrescentar ao `060_estoque.sql` (mesmo bloco `do $$`, depois dos casos da Task 1):

| # | Cenário | Esperado |
|---|---|---|
| 13 | entrada de 10 num produto com estoque 0 | saldo 10; **um** movimento `entrada` com `quantidade = 10` e `saldo_apos = 10` |
| 14 | entrada com `p_custo = 300` | `produtos.preco_custo = 300` |
| 15 | entrada com `p_custo = null` | `preco_custo` **não muda** |
| 16 | entrada com `p_quantidade = 0` e `-1` | exceções `maior que zero`, e nenhum movimento novo |
| 17 | entrada sem motivo (`null` e `'   '`) | exceção `Informe o motivo` |
| 18 | ajuste de saldo 10 para 7 | saldo 7; movimento `ajuste` com `quantidade = -3` (o **delta**) e `saldo_apos = 7` |
| 19 | ajuste de 7 para 7 | exceção `já está em` — o livro-razão proíbe movimento zero |
| 20 | ajuste para valor negativo | exceção `não pode ser negativo` |
| 21 | ajuste sem motivo | exceção `Informe o motivo` |
| 22 | três entradas seguidas de 5, 3, 2 | saldo 10 e **três** movimentos com `saldo_apos` 5, 8, 10 (o rastro fecha a conta) |
| 23 | produto inexistente, nas duas funções | exceção `Produto não encontrado.` |
| 24 | `has_function_privilege('anon', ...)` nas duas | falso |

O caso 22 é o que prova que o livro-razão explica o saldo — se `saldo_apos` fosse o saldo antigo ou a quantidade, a soma não fecharia.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql`
Expected: `FALHOU 060_estoque.sql: function produto_entrada(...) does not exist`.

- [ ] **Step 3: Implementar `supabase/migrations/007_estoque.sql`**

Ambas: bloco de verificação de usuário e papel (copiar de `004_caixa.sql`), `select ... from produtos where id = p_produto_id for update` (o `for update` é obrigatório: sem ele, duas entradas simultâneas leem o mesmo saldo e uma sobrescreve a outra), e `not found` → `Produto não encontrado.`

`produto_entrada`:
- `p_quantidade` nulo ou `<= 0` → `A quantidade precisa ser maior que zero.`
- motivo obrigatório (`null` ou `btrim = ''`) → `Informe o motivo da entrada.`
- custo negativo → `O custo não pode ser negativo.`
- `update produtos set estoque_atual = estoque_atual + p_quantidade, preco_custo = coalesce(p_custo, preco_custo), atualizado_em = now()`
- `insert into estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id)` com `tipo = 'entrada'` e `saldo_apos` = saldo novo.

`produto_ajuste`:
- `p_novo_saldo` nulo ou `< 0` → `O saldo não pode ser negativo.`
- motivo obrigatório → `Informe o motivo do ajuste.`
- delta = `p_novo_saldo - estoque_atual`; se `delta = 0` → `Este produto já está em % unidade(s).`
- `update produtos set estoque_atual = p_novo_saldo, atualizado_em = now()`
- `insert into estoque_movimentos` com `tipo = 'ajuste'`, `quantidade = delta`, `saldo_apos = p_novo_saldo`.

Rodapé de permissões das duas.

- [ ] **Step 4: Aplicar a migration**

```powershell
npm run migrar -- 007_estoque.sql
```

Expected: `OK    007_estoque.sql (... HTTP 201)`, exit 0.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:sql`
Expected: `0 FALHOU`, com as asserções novas de entrada e ajuste como `OK`.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "etapa-3: entrada e ajuste de estoque com livro-razao"
```

---

## Task 3: `importar_produtos` — tudo ou nada, casando por código de barras

**Files:**
- Create: `supabase/migrations/008_importacao.sql`, `tests/sql/casos/070_importacao.sql`

**Interfaces:**
- Consumes: `produtos`, `estoque_movimentos`, helpers de teste, `perfis`.
- Produces: `importar_produtos(p_linhas jsonb, p_atualizar_existentes boolean) returns jsonb` → `{"criados": N, "atualizados": M, "ignorados": K}`.

Formato exato de `p_linhas` (uma chave ausente é diferente de valor nulo — é isso que decide se a coluna é tocada):

```json
[
  {"codigo_barras": "0012345", "nome": "DIPIRONA 500mg", "categoria": "Analgésico",
   "unidade": "un", "preco_custo": 250, "preco_venda": 450,
   "estoque_inicial": 10, "estoque_minimo": 5}
]
```

Regras: casa por `codigo_barras` quando ele existe; `p_atualizar_existentes = true` atualiza nome, categoria, unidade, preços, estoque mínimo e ativo, e **só mexe no estoque quando `estoque_inicial` está presente**; `false` conta em `ignorados` e não toca em nada; linha sem código de barras nunca casa, sempre cria; `estoque_inicial` presente e diferente de zero grava movimento `entrada` com motivo `Estoque inicial`; `estoque_inicial = 0` não grava movimento (a constraint proíbe quantidade zero).

- [ ] **Step 1: Escrever os casos que falham**

`tests/sql/casos/070_importacao.sql`:

| # | Cenário | Esperado |
|---|---|---|
| 1 | duas linhas novas | `criados = 2`, as duas existem com preço e `codigo_barras` certos |
| 2 | linha com `estoque_inicial: 10` | produto com `estoque_atual = 10` e **um** movimento `entrada` de 10 com motivo `Estoque inicial` |
| 3 | linha com `estoque_inicial: 0` | produto criado, estoque 0, **nenhum** movimento |
| 4 | linha com código já existente e `p_atualizar_existentes = true` | `atualizados = 1`, **não** cria segundo produto, preço mudou |
| 5 | a mesma linha com `p_atualizar_existentes = false` | `ignorados = 1`, preço **não** mudou |
| 6 | reimportar produto com estoque 10 informando `estoque_inicial: 4` | estoque vai para 4 com movimento `entrada` de `-6` |
| 7 | reimportar **sem** a chave `estoque_inicial` | estoque **não muda** (`10` continua `10`) |
| 8 | uma linha válida + uma com `nome` vazio | exceção `Linha 2: informe o nome do produto.` e a linha 1 **não** foi gravada |
| 9 | uma linha com `preco_venda: -1` | exceção nomeando a linha |
| 10 | uma linha com `estoque_inicial: -5` | exceção nomeando a linha |
| 11 | duas linhas com o **mesmo** código de barras | exceção dizendo o código repetido |
| 12 | `p_linhas = '[]'` | exceção `Nenhuma linha para importar.` |
| 13 | `p_linhas` nulo | exceção `Nenhuma linha para importar.` |
| 14 | `has_function_privilege('anon', 'importar_produtos(jsonb,boolean)', 'execute')` | falso |
| 15 | papel `atendente` chamando a função | exceção `Só o dono pode importar produtos.` |

O caso 8 é o da spec §12 (caso 13): "Importação com uma linha inválida → nada gravado". A asserção tem que conferir **as duas coisas**: a exceção **e** a ausência da linha válida no banco.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql`
Expected: `FALHOU 070_importacao.sql: function importar_produtos(jsonb, boolean) does not exist`.

- [ ] **Step 3: Implementar `supabase/migrations/008_importacao.sql`**

Estrutura obrigatória: verificação de usuário, perfil, `ativo` e **papel `dono`**; guarda de lista vazia/nula; depois **duas passagens** — a primeira valida **todas** as linhas e levanta exceção na primeira inválida (é isso que garante o "nada gravado" sem precisar de savepoint), a segunda grava. O nome da linha errada vem de `ordinality`: usar `jsonb_array_elements(p_linhas) with ordinality as t(linha, ordem)` e montar `format('Linha %s: ...', ordem)`.

Validações da primeira passagem, nesta ordem: `nome` vazio; `preco_custo`/`preco_venda`/`estoque_minimo`/`estoque_inicial` negativos; `estoque_inicial` presente e não inteiro. Código de barras repetido dentro do próprio arquivo: detectar com `having count(*) > 1` sobre os códigos não nulos e levantar `O código de barras % aparece mais de uma vez na planilha.` — sem isso, a segunda linha sobrescreve a primeira em silêncio.

Gravação de cada linha: normalizar código (`nullif(btrim(...), '')`), buscar produto pelo código; achou e `p_atualizar_existentes` → `update` (e estoque só se a chave existir, com `produto_entrada`-like: movimento `entrada` com o delta, permitindo delta negativo como no caso 6, e **sem** gravar movimento quando o delta é 0); achou e não atualizar → `ignorados++`; não achou → `insert` e, se `estoque_inicial` presente e `<> 0`, movimento `entrada` com motivo `Estoque inicial`; `criados++`.

Estoque inicial em produto criado: `estoque_inicial` ausente → `0` (é cadastro novo, não há saldo anterior a preservar). Movimento só quando o valor é `<> 0`, por causa da constraint.

Rodapé de permissões.

- [ ] **Step 4: Aplicar a migration**

```powershell
npm run migrar -- 008_importacao.sql
```

Expected: `OK    008_importacao.sql (... HTTP 201)`, exit 0.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:sql`
Expected: `0 FALHOU`. Anotar a contagem final de OK — é a evidência da Etapa 3 que vai para o `PROGRESSO.md`.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "etapa-3: importar_produtos tudo ou nada casando por codigo de barras"
```

---

## Task 4: `lib/dinheiro.ts` — texto do usuário para centavos

**Files:**
- Create: `lib/dinheiro.ts`, `lib/dinheiro.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `parsearCentavos(texto: string): number | null` — `"4,50"` → `450`; `"4.50"` → `450`; `"R$ 1.234,56"` → `123456`; `"4"` → `400`; `""`, `"abc"`, `"4,5,0"`, `"-1"`, `null`/`undefined` → `null`.
  - `parsearQuantidade(texto: string): number | null` — inteiro de `1` a `9999`; recusa `"1.5"`, `"0"`, `"-1"`, `"10000"`, `"abc"`.

`lib/format.ts` **não muda**: ele formata para exibição, este módulo lê o que o usuário digita. São direções opostas.

- [ ] **Step 1: Escrever o teste que falha**

`lib/dinheiro.test.ts`, com casos exatos:

```ts
import { describe, it, expect } from 'vitest'
import { parsearCentavos, parsearQuantidade } from './dinheiro'

describe('parsearCentavos', () => {
  it('le virgula decimal', () => { expect(parsearCentavos('4,50')).toBe(450) })
  it('le ponto decimal', () => { expect(parsearCentavos('4.50')).toBe(450) })
  it('le ponto de milhar com virgula decimal', () => { expect(parsearCentavos('1.234,56')).toBe(123456) })
  it('le centavos sem separador como reais inteiros', () => { expect(parsearCentavos('4')).toBe(400) })
  it('aceita o cifrao e espacos', () => { expect(parsearCentavos(' R$ 4,50 ')).toBe(450) })
  it('recusa texto', () => { expect(parsearCentavos('abc')).toBeNull() })
  it('recusa dois separadores decimais', () => { expect(parsearCentavos('4,5,0')).toBeNull() })
  it('recusa vazio e nulo', () => {
    expect(parsearCentavos('')).toBeNull()
    expect(parsearCentavos('   ')).toBeNull()
    expect(parsearCentavos(null as unknown as string)).toBeNull()
  })
  it('recusa negativo', () => { expect(parsearCentavos('-1')).toBeNull() })
})

describe('parsearQuantidade', () => {
  it('le inteiro simples', () => { expect(parsearQuantidade('7')).toBe(7) })
  it('aceita os limites 1 e 9999', () => {
    expect(parsearQuantidade('1')).toBe(1)
    expect(parsearQuantidade('9999')).toBe(9999)
  })
  it('recusa fracionario', () => { expect(parsearQuantidade('1.5')).toBeNull() })
  it('recusa zero, negativo e acima do limite', () => {
    expect(parsearQuantidade('0')).toBeNull()
    expect(parsearQuantidade('-1')).toBeNull()
    expect(parsearQuantidade('10000')).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/dinheiro.test.ts`
Expected: FAIL — `Failed to resolve import "./dinheiro"`.

- [ ] **Step 3: Implementar `lib/dinheiro.ts`**

`parsearCentavos`: remover `R$` e espaços (inclusive `\u00A0`), e então decidir pelo **último** separador presente — se o último for `,` ou `.` seguido de 1 ou 2 dígitos, ele é decimal; os outros separadores são de milhar e saem. Sem separador decimal, o número é em reais: multiplicar por 100. Usar `Math.round` e nunca soma em ponto flutuante acumulada. Recusar se sobrar qualquer caractere que não seja dígito ou separador, e se houver mais de um separador decimal. **Armadilha:** `parseFloat('4,50')` devolve `4` e `parseFloat('1.234')` devolve `1.234` — nenhum dos dois é aceitável; não usar `parseFloat` no valor cru.

`parsearQuantidade`: exigir `/^\d+$/` no texto já sem espaços antes de converter — mesma razão do `A11` da spec, para `"1.5"` virar `null` e não `1`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: PASS — 12 testes antigos + os novos, exit 0.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-3: leitura de dinheiro e quantidade digitados"
```

---

## Task 5: `lib/csv.ts` — ler CSV de verdade

**Files:**
- Create: `lib/csv.ts`, `lib/csv.test.ts`

**Interfaces:**
- Consumes: nada (módulo puro).
- Produces:
  - `type Tabela = { colunas: string[]; linhas: string[][] }` — o tipo comum de entrada dos formatos. **Definido neste arquivo** e reexportado por `lib/tabela.ts` (Task 7).
  - `lerCsv(texto: string): Tabela` — detecta o separador pelo cabeçalho e respeita aspas.
  - `pareceLatin1(bytes: Uint8Array): boolean` — `true` quando há bytes `>= 0x80` que não formam UTF-8 válido.

- [ ] **Step 1: Escrever o teste que falha**

`lib/csv.test.ts`. Casos exatos:

```ts
import { describe, it, expect } from 'vitest'
import { lerCsv, pareceLatin1 } from './csv'

describe('lerCsv', () => {
  it('le ponto e virgula como separador', () => {
    const t = lerCsv('nome;preco\nDIPIRONA;4,50')
    expect(t.colunas).toEqual(['nome', 'preco'])
    expect(t.linhas).toEqual([['DIPIRONA', '4,50']])
  })
  it('le virgula como separador quando e o cabecalho', () => {
    const t = lerCsv('nome,preco\nDIPIRONA,4.50')
    expect(t.linhas).toEqual([['DIPIRONA', '4.50']])
  })
  it('nao quebra dentro de aspas', () => {
    const t = lerCsv('nome;preco\n"DIPIRONA; 500mg";4,50')
    expect(t.linhas[0]).toEqual(['DIPIRONA; 500mg', '4,50'])
  })
  it('aceita aspas escapadas', () => {
    const t = lerCsv('nome\n"GEL ""MENTA"""')
    expect(t.linhas[0]).toEqual(['GEL "MENTA"'])
  })
  it('preserva zeros a esquerda do codigo de barras', () => {
    const t = lerCsv('codigo;nome\n0012345;DIPIRONA')
    expect(t.linhas[0][0]).toBe('0012345')
  })
  it('ignora linha em branco no fim', () => {
    expect(lerCsv('nome\nDIPIRONA\n\n').linhas).toEqual([['DIPIRONA']])
  })
  it('remove o BOM do inicio', () => {
    expect(lerCsv('\uFEFFnome\nDIPIRONA').colunas).toEqual(['nome'])
  })
  it('aceita quebra de linha CRLF', () => {
    expect(lerCsv('nome;preco\r\nDIPIRONA;4,50\r\n').linhas).toEqual([['DIPIRONA', '4,50']])
  })
})

describe('pareceLatin1', () => {
  it('reconhece UTF-8 valido', () => {
    expect(pareceLatin1(new TextEncoder().encode('AÇÃO'))).toBe(false)
  })
  it('reconhece Latin-1', () => {
    // "AÇÃO" em Latin-1: Ç e Ã sao um byte so (0xC7, 0xC3)
    expect(pareceLatin1(new Uint8Array([0x41, 0xc7, 0xc3, 0x4f]))).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/csv.test.ts`
Expected: FAIL — `Failed to resolve import "./csv"`.

- [ ] **Step 3: Implementar `lib/csv.ts`**

Separador: contar `;` e `,` **fora de aspas** na primeira linha; o que tiver mais vence; empate resolve para `;` (export brasileiro). Sem nenhum dos dois, tratar a linha inteira como uma coluna só.

Leitor de campos: percorrer caractere a caractere com um estado `dentroDeAspas`; `""` dentro de aspas vira `"`; separador fora de aspas fecha o campo; `\r\n` e `\n` fecham a linha. **Não** usar `split(';')` — é exatamente o erro que o teste da dipirona `"DIPIRONA; 500mg"` pega. Linha cujo único conteúdo é vazio é descartada. BOM (`\uFEFF`) é removido do primeiro campo.

`pareceLatin1`: tentar `new TextDecoder('utf-8', { fatal: true }).decode(bytes)`; se lançar, é Latin-1. Sem `fatal`, o decoder substitui por `U+FFFD` e nunca lança — o teste de Latin-1 falharia.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/csv.test.ts`
Expected: PASS — 10 testes.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-3: leitor de CSV com aspas, separador e encoding"
```

---

## Task 6: `lib/xlsx.ts` — ler `.xlsx` com o `zlib` do Node

**Files:**
- Create: `lib/xlsx.ts`, `lib/xlsx.test.ts`, `tests/fixtures/produtos.xlsx`, `tests/fixtures/produtos_texto.xlsx`, `scripts/gerar-fixtures-xlsx.py`

**Interfaces:**
- Consumes: `Tabela` de `lib/csv.ts`.
- Produces: `lerXlsx(bytes: Uint8Array): Tabela` — lança `Error` com mensagem em português quando o arquivo não é um `.xlsx` legível.

**Decisão de desenho (registrada):** nenhuma biblioteca de planilha entra no `package.json`. Um `.xlsx` é um ZIP de XML; `zlib.inflateRawSync` já está no Node. O leitor cobre **só** o subconjunto que um export de sistema usa: valores diretos (`<v>`) e *shared strings*, primeira planilha, sem fórmula, sem data. O que estiver fora do subconjunto **falha com erro claro** em vez de ler errado. **Gatilho de troca:** se o arquivo real do Nex não for lido por este leitor, a decisão muda para `read-excel-file` e isso vira uma tarefa própria — não improvisar dentro desta.

- [ ] **Step 1: Gerar as fixtures (fora do projeto)**

`scripts/gerar-fixtures-xlsx.py`, rodado com o Python do harness (`openpyxl 3.1.5` já instalado). Duas planilhas:

- `tests/fixtures/produtos.xlsx`: cabeçalho `codigo_barras;nome;categoria;unidade;preco_custo;preco_venda;estoque_atual;estoque_minimo` (**colunas separadas de verdade**, não uma coluna com `;`), 3 linhas, **preços como número** (`4.5`), código de barras como **texto** (`'0012345'`), nome com acento (`DIPIRONA 500mg ção`), e **uma linha com preço como texto** (`'4,50'`) para o teste de mistura.
- `tests/fixtures/produtos_texto.xlsx`: preços todos como **texto** com vírgula, uma coluna extra irrelevante no meio, as colunas em ordem **diferente**, e uma última linha **rodapé** `TOTAL` com a soma dos preços na coluna de preço e as outras células vazias.

O script **não** é dependência do app nem roda no build; existe para as fixtures serem reproduzíveis. Rodar uma vez e commitar os dois `.xlsx`.

Expected: os dois arquivos existem em `tests/fixtures/`.

- [ ] **Step 2: Escrever o teste que falha**

`lib/xlsx.test.ts`, lendo as fixtures com `fs.readFileSync` e comparando com o CSV equivalente:

```ts
// casos exatos
it('le a planilha com preco numerico', () => {
  const t = lerXlsx(bytes('produtos.xlsx'))
  expect(t.colunas).toContain('nome')
  expect(t.linhas.length).toBe(4)          // 3 produtos + a linha de preco em texto
})
it('preserva o codigo de barras com zeros a esquerda', () => {
  const t = lerXlsx(bytes('produtos.xlsx'))
  expect(t.linhas[0][0]).toBe('0012345')
})
it('le celula numerica sem passar por texto', () => {
  const t = lerXlsx(bytes('produtos.xlsx'))
  expect(Number(t.linhas[0][5])).toBe(4.5) // preco_venda
})
it('le planilha com preco em texto e rodape', () => {
  const t = lerXlsx(bytes('produtos_texto.xlsx'))
  expect(t.linhas.at(-1)![0].toUpperCase()).toContain('TOTAL')
})
it('recusa arquivo que nao e xlsx', () => {
  expect(() => lerXlsx(new TextEncoder().encode('nome;preco\nDIPIRONA;4,50')))
    .toThrow(/não é uma planilha/)
})
it('recusa xlsx truncado', () => {
  const inteiro = bytes('produtos.xlsx')
  expect(() => lerXlsx(inteiro.slice(0, 200))).toThrow()
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx vitest run lib/xlsx.test.ts`
Expected: FAIL — `Failed to resolve import "./xlsx"`.

- [ ] **Step 4: Implementar `lib/xlsx.ts`**

Ler o ZIP pelas entradas do *central directory* (procurar a assinatura `PK\x01\x02` a partir do fim do arquivo, não varrer o arquivo inteiro do começo — assim uma sequência `PK` dentro dos dados não confunde o leitor). Descomprimir cada entrada com `zlib.inflateRawSync` (método 8) ou copiar direto (método 0). Extrair as entradas `xl/worksheets/sheet1.xml` e `xl/sharedStrings.xml`.

Do `sheet1.xml`: para cada `<row>`, para cada `<c>`, ler o atributo `r` para descobrir a **coluna** (`A`, `B`, ... `AA`) — célula vazia simplesmente não existe no XML, então sem a coluna a linha sai desalinhada; preencher os buracos com string vazia. Valor: se `t="s"`, `<v>` é índice em `sharedStrings`; se `t="inlineStr"`, o texto está em `<is><t>`; caso contrário, `<v>` é o valor literal. Desescapar as cinco entidades XML (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`) — sem isso `DIPIRONA & CIA` chega quebrado.

Converter o índice da coluna em número é o ponto que erra fácil: `A`→0, `Z`→25, `AA`→26. Implementar `colunaParaIndice` como função separada e exportá-la para o teste cobrir `A`, `Z`, `AA`, `AB`.

Para descobrir a primeira linha do cabeçalho: a primeira linha com pelo menos duas células não vazias. Título e data no topo não podem virar cabeçalho.

Erros: se o arquivo não começa com `PK`, lançar `Error('Este arquivo não é uma planilha .xlsx. Se o Nex exportou .xls, exporte de novo como .xlsx.')`; se faltar `sheet1.xml` ou o ZIP estiver corrompido, lançar `Error('Não foi possível ler a planilha. O arquivo pode estar corrompido ou protegido por senha.')`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run lib/xlsx.test.ts`
Expected: PASS — 6 testes (mais os de `colunaParaIndice`).

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "etapa-3: leitor de xlsx proprio, sem dependencia nova"
```

---

## Task 7: `lib/tabela.ts` — cabeçalho tolerante, rodapé e formato

**Files:**
- Create: `lib/tabela.ts`, `lib/tabela.test.ts`

**Interfaces:**
- Consumes: `Tabela` (de `lib/csv.ts`).
- Produces:
  - `export type { Tabela }` (reexportado de `lib/csv.ts` para as telas importarem de um lugar só)
  - `detectarFormato(nomeArquivo: string, bytes: Uint8Array): 'csv' | 'xlsx' | 'desconhecido'` — pela assinatura do conteúdo primeiro, extensão como desempate.
  - `normalizarCabecalho(texto: string): string` — minúsculas, sem acento, sem espaços e `_` nas pontas.
  - `indiceDasColunas(colunas: string[]): { mapa: Record<string, number>; faltando: string[] }` — mapeia os campos canônicos para o índice da coluna, por lista de apelidos.
  - `ehRodape(linha: string[]): boolean`
  - `type LinhaProduto = { codigo_barras: string | null; nome: string; categoria: string | null; unidade: string; preco_custo: number; preco_venda: number; estoque_atual: number | null; estoque_minimo: number; erros: string[] }`
  - `analisarTabela(tabela: Tabela): { linhas: LinhaProduto[]; faltando: string[]; descartadas: number; somaPlanilha: number; somaGravada: number; validas: number; invalidas: number; avisos: string[] }`

**Apelidos do mapa canônico** (normalizados): `codigo_barras` ← `codigo`, `cod barras`, `codigo de barras`, `codigo_barras`, `ean`, `ean13`, `barra`; `nome` ← `nome`, `produto`, `descricao`, `descricao do produto`; `categoria` ← `categoria`, `grupo`, `secao`; `unidade` ← `unidade`, `un`, `embalagem`; `preco_custo` ← `preco_custo`, `custo`, `valor custo`, `vl custo`, `preco de compra`; `preco_venda` ← `preco_venda`, `preco`, `valor`, `vl venda`, `preco de venda`, `pv`; `estoque_atual` ← `estoque_atual`, `estoque`, `qtd`, `quantidade`, `saldo`; `estoque_minimo` ← `estoque_minimo`, `minimo`, `estoque min`, `ponto de pedido`.

Único obrigatório: `nome`. Ausente → entra em `faltando` e a prévia **não** deixa confirmar.

**Somas, e por que são duas:** `somaGravada` é a soma de `preco_venda` das linhas válidas, em centavos — é o que a RPC grava. `somaPlanilha` é a soma do valor **cru** da coluna de preço, lido como número, com o **mesmo** `parsearCentavos`; quando os dois divergem, a causa é decimal lido errado (fator 100) e a prévia mostra os dois lado a lado.

- [ ] **Step 1: Escrever o teste que falha**

`lib/tabela.test.ts`. Casos exatos:

```ts
it('mapeia apelidos de cabecalho sem acento e com espacos', () => {
  const { mapa } = indiceDasColunas(['Codigo de Barras', 'Descrição', 'VL VENDA', 'Qtde'])
  expect(mapa.codigo_barras).toBe(0)
  expect(mapa.nome).toBe(1)
  expect(mapa.preco_venda).toBe(2)
  expect(mapa.estoque_atual).toBe(3)
})
it('aponta o campo obrigatorio que falta', () => {
  expect(indiceDasColunas(['codigo', 'preco']).faltando).toEqual(['nome'])
})
it('reconhece rodape de total', () => {
  expect(ehRodape(['TOTAL', '', '', '', '1234.56'])).toBe(true)
  expect(ehRodape(['Total geral', '', ''])).toBe(true)
  expect(ehRodape(['DIPIRONA', '', '4,50'])).toBe(false)
})
it('le preco numerico e preco em texto com o mesmo resultado', () => {
  const a = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4.5']] })
  const b = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4,50']] })
  expect(a.linhas[0].preco_venda).toBe(450)
  expect(b.linhas[0].preco_venda).toBe(450)
})
it('descarta o rodape em vez de contar como linha invalida', () => {
  const r = analisarTabela({
    colunas: ['nome', 'preco'],
    linhas: [['DIPIRONA', '4,50'], ['TOTAL', '4,50']],
  })
  expect(r.validas).toBe(1)
  expect(r.descartadas).toBe(1)
  expect(r.invalidas).toBe(0)
})
it('nome vazio vira linha invalida nomeada', () => {
  const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['', '4,50']] })
  expect(r.invalidas).toBe(1)
  expect(r.linhas[0].erros[0]).toContain('nome')
})
it('preco ilegivel vira linha invalida, nao zero', () => {
  const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['DIPIRONA', '4,5O']] })
  expect(r.invalidas).toBe(1)
  expect(r.linhas[0].preco_venda).toBe(0)
})
it('codigo vazio vira null', () => {
  const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '']] })
  expect(r.linhas[0].codigo_barras).toBeNull()
})
it('preserva zeros a esquerda do codigo', () => {
  const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '0012345']] })
  expect(r.linhas[0].codigo_barras).toBe('0012345')
})
it('avisa quando o codigo chegou sem zeros a esquerda', () => {
  const r = analisarTabela({ colunas: ['nome', 'codigo'], linhas: [['DIPIRONA', '12345']] })
  expect(r.avisos.join(' ')).toContain('zeros')
})
it('as duas somas coincidem quando o preco e lido certo', () => {
  const r = analisarTabela({ colunas: ['nome', 'preco'], linhas: [['A', '4,50'], ['B', '5,50']] })
  expect(r.somaPlanilha).toBe(1000)
  expect(r.somaGravada).toBe(1000)
})
it('detecta formato por assinatura', () => {
  expect(detectarFormato('x.xlsx', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('xlsx')
  expect(detectarFormato('x.csv', new TextEncoder().encode('nome;preco'))).toBe('csv')
  expect(detectarFormato('x.xlsx', new TextEncoder().encode('nome;preco'))).toBe('desconhecido')
})
```

O caso do aviso de zeros à esquerda é o Review Focus 1: o código **está** lá, mas pode ter perdido zeros dentro da planilha. A regra para avisar: código só de dígitos, com 5 ou mais dígitos, que não começa com `0`. A decisão de desenho é **avisar e importar o que veio** (o código é único e a RPC casa por ele), nunca completar zeros por conta própria — inventar zeros pode casar com outro produto.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run lib/tabela.test.ts`
Expected: FAIL — `Failed to resolve import "./tabela"`.

- [ ] **Step 3: Implementar `lib/tabela.ts`**

`normalizarCabecalho`: `toLowerCase()`, `normalize('NFD').replace(/[\u0300-\u036f]/g, '')`, trocar `_` por espaço, colapsar espaços e cortar as pontas. **Sem isso**, `Descrição` e `descricao` seriam colunas diferentes.

`analisarTabela`: para cada linha, se `ehRodape` → `descartadas++` e segue; senão monta `LinhaProduto` usando `parsearCentavos` (Task 4) e `parsearQuantidade` quando há quantidade; acumula erros em `erros`. `estoque_atual` é `null` quando a coluna não existe na planilha, e é isso que faz a RPC **não mexer** no estoque de produto existente (Task 3, caso 7) — a diferença entre "não veio" e "veio 0" é o coração da reimportação segura.

`ehRodape`: primeira célula não vazia normalizada contém `total` **e** nenhuma outra célula não vazia contém letra. Assim `['TOTAL', '', '', '', '1234.56']` é rodapé, mas um produto chamado `TOTAL DIPIRONA` com categoria não é.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run lib/tabela.test.ts`
Expected: PASS — 12 testes.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-3: tabela normalizada com mapa de cabecalho tolerante"
```

---

## Task 8: Tela de importação — prévia, duas somas, confirmação

**Files:**
- Create: `app/(app)/produtos/importar/page.tsx`, `app/(app)/produtos/importar/actions.ts`

**Interfaces:**
- Consumes: `detectarFormato`, `analisarTabela`, `Tabela` (Task 7); `lerCsv`, `pareceLatin1` (Task 5); `lerXlsx` (Task 6); `criarClienteServidor` (`lib/supabase/server.ts`); `produtoAtual`-like: nada — o perfil vem de `perfilAtual()` (`lib/auth/perfil.ts`).
- Produces:
  - Server Action `analisarArquivo(formData: FormData): Promise<{ ok: true; previa: Previa } | { ok: false; mensagem: string }>`
  - Server Action `confirmarImportacao(formData: FormData): Promise<{ ok: true; resumo: Resumo } | { ok: false; mensagem: string }>`
  - `type Previa = { colunas: Tabela['colunas']; primeiras: string[][]; validas: number; invalidas: number; descartadas: number; somaPlanilha: number; somaGravada: number; faltando: string[]; avisos: string[]; erros: { linha: number; erros: string[] }[]; json: string }`
  - `type Resumo = { criados: number; atualizados: number; ignorados: number }`
  - As duas ações **só** existem para `papel = 'dono'`; atendente recebe `{ ok: false, mensagem: 'Só o dono pode importar produtos.' }` sem chamar a RPC.

**Contrato de upload:** a Server Action recebe o arquivo, decide o formato por assinatura, lê e analisa. O arquivo **não** volta ao cliente: o JSON já validado viaja num `<input type="hidden">` com o resultado de `analisarTabela`. Sem `sessionStorage`, sem reupload.

- [ ] **Step 1: Escrever a ação `analisarArquivo` e ver o erro na tela**

Antes de implementar, rodar `npm run dev`, abrir `/produtos/importar` e confirmar `404` (a página ainda não existe). É o estado inicial esperado.

- [ ] **Step 2: Implementar `app/(app)/produtos/importar/actions.ts`**

`analisarArquivo`: conferir papel via `perfilAtual()`; ler `arquivo` do `FormData` (`File`); `arrayBuffer()` → `Uint8Array`; `detectarFormato(arquivo.name, bytes)`:
- `'xlsx'` → `lerXlsx(bytes)`, embrulhado em `try/catch` que devolve `{ ok: false, mensagem: erro.message }` (é aqui que os erros em português da Task 6 chegam à tela);
- `'csv'` → decodificar; se `pareceLatin1(bytes)`, decodificar com `TextDecoder('windows-1252')` e acrescentar o aviso `O arquivo está em Latin-1 (padrão antigo do Windows). Os acentos foram convertidos — confira os nomes antes de confirmar.`;
- `'desconhecido'` → `{ ok: false, mensagem: 'Formato não reconhecido. Envie uma planilha .xlsx ou um arquivo .csv.' }`

Depois `analisarTabela(tabela)` e montar a `Previa`: `primeiras` = as **5 primeiras** linhas válidas como texto, `erros` = as linhas inválidas com o número da linha **no arquivo** (não no array), `json` = `JSON.stringify(linhasValidas)`.

`confirmarImportacao`: conferir papel; ler `linhas` (o JSON do campo oculto) e `atualizar` (`'sim'`/`'nao'`); se o JSON estiver vazio, `{ ok: false, mensagem: 'Nenhuma linha para importar.' }`; chamar a RPC via `criarClienteServidor()`:

```ts
const { data, error } = await supabase.rpc('importar_produtos', {
  p_linhas: JSON.parse(linhas),
  p_atualizar_existentes: atualizar === 'sim',
})
```

`error` → `{ ok: false, mensagem: error.message }` (a mensagem da RPC já vem em português e nomeando a linha). `data` → `{ ok: true, resumo: data }`.

- [ ] **Step 3: Implementar `app/(app)/produtos/importar/page.tsx`**

Server Component com `perfilAtual()`; se `papel !== 'dono'`, mostrar `Só o dono pode importar produtos.` e nada mais. Senão: um formulário `multipart/form-data` com `type="file"` `accept=".xlsx,.csv"`, um checkbox `atualizar` já marcado (sua escolha: reimportar atualiza por código de barras) e o botão `Analisar arquivo` — que usa `useActionState` porque a ação **devolve** dados em vez de redirecionar (esta tela é a exceção: as outras telas usam o padrão de redirect do plano 1). Se veio `previa`, renderizar:

1. as **duas somas lado a lado**, com `formatarMoeda`: `Soma na planilha` e `Soma que será gravada`, e uma tarja vermelha quando `somaPlanilha !== somaGravada` dizendo `As somas não batem — confira o separador decimal antes de importar.`;
2. `validas` / `invalidas` / `descartadas`;
3. os `avisos` em amarelo;
4. `faltando` (impede o botão de confirmar) quando não vazio, com o texto `Não encontrei a coluna obrigatória: nome.`;
5. a tabela com as 5 primeiras linhas;
6. as linhas inválidas com o motivo, em lista;
7. o botão `Confirmar importação` (desabilitado se `faltando` não estiver vazio ou `validas = 0`) chamando `confirmarImportacao` com o JSON oculto.

Depois de importar: `Importados: N novos, M atualizados, K ignorados.` e link `Ver produtos`.

- [ ] **Step 4: Verificar a tela com um arquivo de verdade**

Rodar `npm run dev`, abrir `/produtos/importar`, subir `tests/fixtures/produtos.xlsx` e `tests/fixtures/produtos_texto.xlsx`, e conferir na tela: as duas somas iguais no primeiro, rodapé descartado no segundo, e a tarja vermelha aparecendo quando se troca um preço do arquivo por `"4.5O"` (letra O).

Expected: a prévia aparece, a importação grava, e `/produtos` passa a listar o que foi importado. **Guardar a tela como evidência da Etapa 3.**

- [ ] **Step 5: Confirmar que a importação é tudo ou nada na tela**

Editar temporariamente o JSON oculto pelo console do navegador para incluir uma linha com `nome: ''` e confirmar: aparece a mensagem `Linha N: informe o nome do produto.` e **nenhum** produto novo entra em `/produtos`.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "etapa-3: tela de importacao com previa e conferencia de somas"
```

---

## Task 9: `/produtos` — busca, lista, detalhe, entrada e ajuste

**Files:**
- Create: `app/(app)/produtos/page.tsx`, `app/(app)/produtos/novo/page.tsx`, `app/(app)/produtos/[id]/page.tsx`, `app/(app)/produtos/actions.ts`

**Interfaces:**
- Consumes: RPCs `produto_salvar`, `produto_entrada`, `produto_ajuste` (Tasks 1–2); `parsearCentavos`, `parsearQuantidade` (Task 4); `formatarMoeda`, `formatarDataHora` (`lib/format.ts`); `criarClienteServidor`, `perfilAtual`.
- Produces: Server Actions `salvarProduto(formData)`, `registrarEntrada(formData)`, `registrarAjuste(formData)` — todas `Promise<{ ok: true } | { ok: false; mensagem: string }>`, exceto `salvarProduto`, que em sucesso faz `redirect('/produtos/<id>')`.

**Telas:**
- `/produtos`: busca por nome (`ilike` sobre `produtos_nome_trgm`) **ou** código de barras exato, filtro por categoria, checkbox `mostrar inativos`, limite de **50** linhas com o aviso `Mostrando 50 de N. Refine a busca.` quando houver mais. Coluna de estoque destacada em vermelho quando `estoque_atual <= estoque_minimo` e em cinza quando `= 0`. Link `Novo produto` e link `Importar planilha`.
- `/produtos/novo`: formulário com nome, código de barras, categoria, unidade, preço de custo, preço de venda, estoque mínimo e ativo. **Não existe campo de estoque** — o texto na tela explica: `O estoque inicial entra depois, em Entrada de estoque.`
- `/produtos/[id]`: dados do produto, botão `Editar`, formulário de `Entrada` (quantidade, custo opcional, motivo) e de `Ajuste` (saldo novo, motivo), e as últimas 20 linhas de `estoque_movimentos` com data, tipo, quantidade, saldo após e motivo.

- [ ] **Step 1: Escrever os casos de quantidade inválida (Review Focus 4)**

Antes das telas, escrever o teste que prova que o texto do formulário não chega cru ao banco. Em `lib/dinheiro.test.ts` (Task 4) os casos já existem; aqui o caso é de **fronteira de ação**: `registrarEntrada` com `quantidade = '1.5'` devolve `{ ok: false, mensagem: 'Quantidade inválida. Use um número inteiro de 1 a 9999.' }` **sem** chamar a RPC. Conferir por leitura de código nesta tarefa; o teste automatizado disso é o Playwright da Task 13.

- [ ] **Step 2: Implementar `app/(app)/produtos/actions.ts`**

Todas: `perfilAtual()` primeiro (sem perfil → `{ ok: false, mensagem: 'Usuário sem perfil cadastrado. Fale com o responsável.' }`).

`salvarProduto`: `parsearCentavos` nos dois preços e `parseInt` com validação no estoque mínimo; qualquer `null` de parse → mensagem específica (`Preço de venda inválido. Use por exemplo 4,50.`), **sem** chamar a RPC. `p_produto_id` vem de um campo oculto (vazio = cadastro novo → `null`). Sucesso → `revalidatePath('/produtos')` e `redirect`.

`registrarEntrada`: `parsearQuantidade` na quantidade; custo opcional com `parsearCentavos` (vazio → `null`, para o caso 15 da Task 2); motivo obrigatório; chama a RPC; sucesso → `revalidatePath` do detalhe e `{ ok: true }`.

`registrarAjuste`: saldo novo com `parseInt` validado `>= 0`; motivo obrigatório; chama a RPC.

- [ ] **Step 3: Implementar as três páginas**

Server Components; leitura direto das tabelas pelo cliente de servidor (a RLS já libera para `authenticated`). Os formulários usam `useActionState` para exibir a mensagem de erro no lugar do formulário, e o padrão de campos com `bg-white text-slate-900` (o bug de contraste da Etapa 1 não pode voltar). Fontes grandes, poucos botões, uma tarefa por tela (spec §10).

- [ ] **Step 4: Verificar na tela**

`npm run dev`, e conferir em `/produtos`: cadastrar `DIPIRONA 500mg` com preço `4,50`; ver que o produto aparece com estoque `0`; entrar em `Entrada` com quantidade `10` e motivo `Compra inicial`; ver o estoque virar `10` e o movimento aparecer na lista; fazer um `Ajuste` para `7` e ver o movimento com quantidade `-3` e saldo `7`; tentar `Ajuste` para `7` de novo e ver a recusa.

Expected: tudo isso funciona, e nenhuma tela mostra erro técnico. **Guardar como evidência.**

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "etapa-3: telas de produtos, entrada e ajuste de estoque"
```

---

## Task 10: `/estoque` — as três abas

**Files:**
- Create: `app/(app)/estoque/page.tsx`

**Interfaces:**
- Consumes: views `v_estoque_baixo`, `v_estoque_zerado`, `v_estoque_parado` (migration `005_views.sql`); as Server Actions de `app/(app)/produtos/actions.ts` (Task 9).
- Produces: tela com abas `Baixo`, `Zerado`, `Parado há 60 dias`, cada uma com contagem no rótulo.

Não cria função de banco: as três views já existem desde a Etapa 2 e a tela é só leitura. Colunas de `v_estoque_baixo` e `v_estoque_zerado`: `produto_id`, `nome`, `estoque_atual`, `estoque_minimo`. De `v_estoque_parado`: `produto_id`, `nome`, `estoque_atual`, `ultima_venda`, `referencia`.

- [ ] **Step 1: Implementar a tela**

Server Component. A aba vem de `searchParams.aba` (`'baixo'` padrão). Cada aba consulta a view correspondente com `limit 50` e renderiza a lista com nome, estoque atual, mínimo e — na aba `Parado` — a `referencia` formatada (`formatarData`), com o texto explicando: `Produto que nunca foi vendido conta os 60 dias a partir do cadastro.` Cada linha tem os botões `Entrada` e `Ajuste`, que abrem um `<details>` embutido com o mesmo formulário da Task 9 (mesmas Server Actions).

- [ ] **Step 2: Verificar na tela**

Com `npm run dev`: criar um produto com estoque `2` e mínimo `3` (aparece em `Baixo`); zerar outro (aparece em `Zerado`); conferir que `Parado` está vazio para produtos recém-criados (nenhum produto novo pode aparecer como parado — é a regra da Task 11 do plano 1).

- [ ] **Step 3: Commit**

```powershell
git add -A
git commit -m "etapa-3: tela de estoque com as tres listas"
```

---

## Task 11: `/vendas/nova` — o PDV

**Files:**
- Create: `app/(app)/vendas/nova/page.tsx`, `app/(app)/vendas/nova/pdv.tsx`, `app/(app)/vendas/nova/actions.ts`

**Interfaces:**
- Consumes: RPC `registrar_venda(p_chave_idempotencia, p_cliente_id, p_itens, p_pagamentos, p_desconto)` (Etapa 2); `parsearCentavos` (Task 4); `criarClienteServidor`.
- Produces: Server Action `finalizarVenda(entrada: EntradaVenda): Promise<{ ok: true; venda: VendaRegistrada } | { ok: false; mensagem: string }>` com

```ts
type ItemCarrinho = { produto_id: string; nome: string; preco_unitario: number; quantidade: number }
type EntradaVenda = {
  chave: string                       // uuid gerado pelo PDV, estável até a venda fechar
  cliente_id: string | null
  itens: { produto_id: string; quantidade: number }[]
  pagamentos: { forma: 'dinheiro' | 'pix' | 'debito' | 'credito' | 'crediario'; valor: number }[]
  desconto: number                    // centavos
}
type VendaRegistrada = { id: string; numero: number; total: number; troco: number }
```

`preco_unitario` no carrinho é **só para exibir**: ele não é enviado na `EntradaVenda` e o banco não o aceita do cliente (spec §4, regra 1).

**Desenho do estado:** o carrinho vive no Client Component. O `chave` é gerado uma vez (na montagem) e **só é trocado depois de uma venda concluída** — é isso que faz o clique duplo devolver a mesma venda, porque `registrar_venda` sai pela idempotência antes de qualquer validação (spec §8.1, passo 1).

- [ ] **Step 1: Implementar a Server Action `finalizarVenda`**

`perfilAtual()` → sem perfil, `{ ok: false, mensagem: 'Usuário sem perfil cadastrado. Fale com o responsável.' }`. Guarda de carrinho vazio no servidor também (defesa em profundidade). Chamar:

```ts
const { data, error } = await supabase.rpc('registrar_venda', {
  p_chave_idempotencia: entrada.chave,
  p_cliente_id: entrada.cliente_id,
  p_itens: entrada.itens,
  p_pagamentos: entrada.pagamentos,
  p_desconto: entrada.desconto,
})
```

`error` → `{ ok: false, mensagem: error.message }` — a mensagem já está em português (spec §9). `data` → `{ ok: true, venda: data }`. Sucesso → `revalidatePath('/vendas')`.

- [ ] **Step 2: Implementar `app/(app)/vendas/nova/pdv.tsx`**

`'use client'`. Estrutura, de cima para baixo:

1. **Busca** (`<input>` com `ref`, `autoFocus`): a cada mudança, debounce de 200 ms, chama um endpoint de busca e mostra até 8 resultados num dropdown. Setas `↑`/`↓` mudam a seleção, `Enter` adiciona o selecionado, `Escape` fecha. Busca por código de barras exato **ou** `ilike` no nome. Leitor de código de barras funciona sozinho: ele digita e manda `Enter`.
2. **Carrinho**: tabela com produto, quantidade, preço unitário, subtotal. `+`/`-` por linha, e a quantidade editável por digitação. `Delete` remove a linha selecionada.
3. **Total** em fonte grande e destacada (`text-4xl`), recalculado só para exibir.
4. **Cliente** (opcional, exceto quando há crediário): campo de busca de cliente. Selecionado, mostra nome, limite e dívida atual.
5. **Desconto**: aceita `5` (reais) ou `5%`, com `parsearCentavos`. Guarda em centavos.
6. **Pagamentos**: linhas com forma e valor. Atalhos: `F6` dinheiro, `F7` PIX, `F8` débito, `F9` crédito, `F10` crediário. Mostra quanto falta para fechar.
7. **Botão `Finalizar`** (`F2`): chama `finalizarVenda`, desabilitado enquanto a chamada está em voo (`enviando`), e desabilitado se o carrinho estiver vazio.
8. Depois de `ok`: faixa de confirmação `Venda 123 registrada. Troco R$ 11,00.`, carrinho limpo, `chave` renovada, foco de volta na busca. Depois de `ok: false`: a mensagem em vermelho **acima** do total, carrinho intacto.

**Onde buscar os produtos:** a busca precisa de uma rota de API (`app/api/produtos/busca/route.ts`) porque é chamada do cliente a cada tecla — uma Server Action em cada tecla seria pior. A rota confere sessão, exige termo com 2+ caracteres e devolve **apenas** `id`, `nome`, `codigo_barras`, `preco_venda`, `estoque_atual`.

- [ ] **Step 3: Implementar `app/(app)/vendas/nova/page.tsx`**

Server Component que confere `perfilAtual()` e busca a lista de clientes para o seletor (nome, limite, dívida atual por `v_clientes_devedores`), passando como props para o `pdv.tsx`.

- [ ] **Step 4: Verificar a venda à mão**

`npm run dev`, abrir `/vendas/nova`, abrir o caixa em `/caixa` se não estiver aberto, e fazer uma venda inteira **sem tocar no mouse**: digitar o nome, `↓`/`Enter`, mudar quantidade, `F6`, digitar o valor recebido, `F2`. Conferir o troco na tela, o estoque caindo em `/produtos`, e o movimento em `v_caixa_atual`.

Expected: venda registrada, troco correto, estoque caído, nada de erro técnico.

- [ ] **Step 5: Provar o clique duplo à mão**

Apertar `F2` duas vezes o mais rápido possível e conferir em `/vendas` que existe **uma** venda. Se aparecerem duas, não corrigir na tela: o defeito é de idempotência e o teste que o pega é o da Task 13 — investigar antes.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "etapa-3: PDV com teclado, pagamento dividido e idempotencia"
```

---

## Task 12: `/vendas` — a casca do histórico do dia

**Files:**
- Create: `app/(app)/vendas/page.tsx`

**Interfaces:**
- Consumes: view `v_vendas_lista` e `v_vendas_dia` (`005_views.sql`); `formatarMoeda`, `formatarDataHora`.
- Produces: lista das vendas de hoje com valores ocultáveis.

O histórico completo, o detalhe da venda e o cancelamento são a **Etapa 5** (plano 3) — esta tela existe para o PDV ter para onde mandar o atendente e para a spec §10 não ficar sem a tela de Vendas.

- [ ] **Step 1: Implementar a tela**

Server Component. Cabeçalho com o resumo de hoje vindo de `v_vendas_dia` (quantidade, total, ticket médio). Lista de `v_vendas_lista` do dia, limite 50, com número, hora, cliente e total. Um botão `Ocultar valores` (spec §10, como no Nex) que troca os totais por `••••` — o estado vem de `searchParams.ocultar`, sem JavaScript de cliente. Cada linha leva para `/vendas/<id>`, que **ainda não existe** nesta etapa: o link fica desabilitado com o texto `Detalhe na próxima etapa`, para não criar um 404.

- [ ] **Step 2: Verificar na tela**

Com uma venda feita na Task 11: `npm run dev`, abrir `/vendas`, conferir a venda de hoje listada, o resumo do dia batendo com o total da venda, e o botão `Ocultar valores` funcionando.

- [ ] **Step 3: Commit**

```powershell
git add -A
git commit -m "etapa-4: lista de vendas do dia com valores ocultaveis"
```

---

## Task 13: Playwright — teclado, duplo clique e F3

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/venda.spec.ts`
- Modify: `package.json` (script `test:e2e`, `devDependency` `@playwright/test` travada)

**Interfaces:**
- Consumes: a aplicação rodando (`npm run dev`) e o usuário de teste do `.env.local` (`USUARIO_EMAIL`, `USUARIO_SENHA`).
- Produces: `npm run test:e2e` — suíte Playwright que sobe o dev server sozinha via `webServer`.

**Versão:** instalar com `npm install --save-exact --save-dev @playwright/test@<versão atual estável>` e anotar a versão exata no `PROGRESSO.md`. Baixar o Chromium: `npx playwright install chromium`. **Este é o único navegador necessário** — a farmácia usa Chrome no balcão.

- [ ] **Step 1: Escrever o teste de login e venda por teclado**

`tests/e2e/venda.spec.ts`, com `test.beforeEach` fazendo login pela tela (`/login`) com as credenciais do `.env.local`:

```ts
test('faz uma venda inteira so com o teclado', async ({ page }) => {
  await page.goto('/vendas/nova')
  await page.keyboard.type('DIPIRONA')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('carrinho')).toContainText('DIPIRONA')
  await page.keyboard.press('F6')          // dinheiro
  await page.keyboard.type('20,00')
  await page.keyboard.press('F2')          // finalizar
  await expect(page.getByTestId('confirmacao')).toContainText('registrada')
})
```

O teste não pode usar `page.click` em nenhum ponto depois do login — é isso que prova o "só com teclado" da spec §13.

- [ ] **Step 2: Rodar e ver o estado atual**

Run: `npx playwright test`
Expected: o teste falha na primeira execução se a busca, os atalhos ou o `data-testid` ainda não existirem com esses nomes — acrescentar os `data-testid` que faltarem no `pdv.tsx` (`carrinho`, `confirmacao`, `total`, `falta`) é parte desta tarefa.

- [ ] **Step 3: Escrever o teste do clique duplo**

```ts
test('clique duplo em Finalizar produz uma unica venda', async ({ page }) => {
  await page.goto('/vendas/nova')
  // monta o carrinho e o pagamento...
  const finalizar = page.getByRole('button', { name: 'Finalizar' })
  await finalizar.dblclick()
  await page.goto('/vendas')
  await expect(page.getByTestId('linha-venda')).toHaveCount(1)
})
```

Este é o Review Focus 5 e o critério "clique duplo não duplica" da Etapa 4. Se contar 2, o defeito é real e é de idempotência — **parar e investigar**, não afrouxar o teste.

- [ ] **Step 4: Escrever o teste do F3 e o do limite de crediário**

```ts
test('F3 abre a nova venda a partir de outra tela', async ({ page }) => {
  await page.goto('/produtos')
  await page.keyboard.press('F3')
  await expect(page).toHaveURL(/\/vendas\/nova/)
})
test('crediario acima do limite mostra a mensagem em portugues', async ({ page }) => {
  // produto de valor alto, cliente com limite baixo, pago em crediario
  await expect(page.getByTestId('erro')).toContainText('Limite excedido')
})
```

O `F3` exige o `app/(app)/atalhos.tsx` (Client Component montado no `layout.tsx`) com `preventDefault()`. O `preventDefault` é obrigatório: sem ele o Chrome abre a busca (C4 da spec). O atalho é ignorado quando o `target` é `input`, `textarea` ou `select` **na tela de vendas** — na tela de nova venda o `F3` continua valendo e só reposiciona o foco na busca.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:e2e`
Expected: os 4 testes passam, exit 0.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "etapa-4: e2e de teclado, clique duplo, F3 e limite de crediario"
```

---

## Task 14: PDF — tentar, medir e decidir (tarefa independente)

**Files:**
- Create: `lib/pdf.ts`, `lib/pdf.test.ts`, `tests/fixtures/produtos.pdf` (gerado do mesmo conteúdo das fixtures `.xlsx`)
- Modify: `app/(app)/produtos/importar/actions.ts` (aceitar `.pdf` **apenas** se esta tarefa terminar viável)

**Interfaces:**
- Consumes: `Tabela` (Task 5), `analisarTabela` (Task 7).
- Produces: `lerPdf(bytes: Uint8Array): Tabela` — ou, se a tarefa terminar inviável, apenas a conclusão registrada.

**Por que esta tarefa é diferente das outras, e por que ela pode terminar sem código de produção:** PDF não tem tabela, tem texto posicionado. Um extrator sempre *parece* funcionar nos primeiros casos e erra em nome que quebra linha ou coluna que junta. O produto de uma extração de PDF é uma **Tabela reconstruída**, e a única prova aceitável de que ela está certa é objetiva:

> **Critério de aceite:** a soma dos preços extraídos tem que bater, ao centavo, com o **total impresso no próprio PDF**. Se não bater, a importação de PDF **não** entra na tela, e a tarefa termina registrando o motivo.

Não existe versão "quase certa" desta tarefa: importar preço de medicamento não conferido é exatamente o que a spec §1 chama de inaceitável.

- [ ] **Step 1: Obter um PDF real e decidir se a tarefa continua**

Você (Lucas) gera no Nex o relatório de produtos em PDF, se ele existir. Se o Nex oferecer **somente** o PDF e ele tiver uma linha de `TOTAL`, a tarefa continua. Se não houver PDF disponível, **encerrar esta tarefa aqui** com a conclusão `O Nex não exporta PDF de produtos; a importação fica em Excel e CSV.` e ir para o fechamento da etapa.

- [ ] **Step 2: Extrair o texto do PDF**

Implementar `lerPdf` com extração de texto por fluxo (`... Tj`, `... TJ`, arrays de texto) sobre os streams descomprimidos com `zlib.inflateSync`. Guardar, para cada trecho, a **posição** (`Td`/`TD`/`Tm`) — sem posição não há como saber a qual coluna um valor pertence, e ler só a ordem do texto embaralha produto e preço.

Reconstruir a tabela agrupando por linha de base (`y`) e ordenando por `x`. Testar com `tests/fixtures/produtos.pdf` (gerado com Python, mesmo conteúdo das fixtures `.xlsx`) e conferir que a `Tabela` resultante é igual à do `.xlsx`.

- [ ] **Step 3: Medir o critério de aceite e escrever o teste**

```ts
it('a soma dos precos extraidos bate com o total impresso no PDF', () => {
  const texto = textoDoPdf(bytes('produtos.pdf'))          // inclui a linha de total
  const total = parsearCentavos(linhaDeTotal(texto))       // lido do PROPRIO pdf
  const r = analisarTabela(lerPdf(bytes('produtos.pdf')))
  expect(r.somaGravada).toBe(total)
})
it('o total do PDF e lido do arquivo, nao digitado no teste', () => {
  expect(linhaDeTotal(textoDoPdf(bytes('produtos.pdf')))).toMatch(/TOTAL/i)
})
```

`textoDoPdf` e `linhaDeTotal` são funções **do próprio `lib/pdf.ts`**, exportadas para o teste. O segundo teste existe para o primeiro não poder ser trapaceado: se o total fosse digitado à mão no teste, o teste deixaria de provar o que existe para provar.

- [ ] **Step 4: Decidir, e registrar a decisão no ledger**

Duas saídas possíveis, e **só duas**:

- **Bate ao centavo** → ligar `.pdf` no `accept` da tela de importação (Task 8), com o `lerPdf`, e registrar no ledger a decisão de aceitar PDF com o número medido.
- **Não bate** → remover o `lerPdf` do caminho de produção (o código pode ficar em `lib/pdf.ts` com o teste que documenta a limitação), deixar a tela aceitando só `.xlsx` e `.csv`, e registrar no ledger: `PDF não reconstrói a tabela com precisão suficiente para preço de medicamento — importação fica em Excel/CSV.`

Nos dois casos, a decisão e a evidência vão para o `PROGRESSO.md`.

- [ ] **Step 5: Commit (nos dois casos)**

```powershell
git add -A
git commit -m "etapa-4: leitura de PDF de produtos medida contra o total impresso"
```

---

## Fechamento da etapa

- [ ] **Step 1: Rodar a suíte inteira**

```powershell
npm test
npm run test:sql
npm run test:sql:concorrencia
npm run test:e2e
npm run build
npm run lint
```

Expected: `npm test` verde; `npm run test:sql` com **0 FALHOU** (a contagem de OK sobe em relação aos 119 da Etapa 2); `test:sql:concorrencia` 17 OK / 0 FALHOU; `test:e2e` 4 passando; `build` exit 0; `lint` exit 0.

- [ ] **Step 2: Marcar as Etapas 3 e 4 no `PROGRESSO.md`**

Status ✅ com a evidência colada: a linha final de cada suíte, a contagem de OK do `test:sql`, o resultado das duas importações de fixture, e a conferência manual de `/produtos`, `/estoque` e do PDV. Se a Task 14 terminou inviável, isso também entra — decisão registrada é evidência, não pendência.

- [ ] **Step 3: Atualizar o handoff**

Reescrever a seção `ONDE PARAMOS` do `PROGRESSO.md` e ajustar `COMO RETOMAR` para o plano 3 (Etapas 5–6: histórico de vendas, clientes e crediário), incluindo `receber_pagamento` — a única RPC da spec §5 que sobra para ele.

- [ ] **Step 4: Commit final e revisão**

```powershell
git add -A
git commit -m "etapa-4: PDV fechado com evidencia"
```

Depois do commit, pedir a revisão do branch inteiro em contexto limpo (o plano 1 fez isso e encontrou 1 Critical + 4 Important que a suíte verde não pegava). O ledger deste plano vai em `.superpowers/sdd/2026-10-06-produtos-estoque-pdv/progress.md`.

---

## Notas de escopo

**Fica para o plano 3 (Etapas 5–6):** `receber_pagamento`, tela de crediário, histórico completo de vendas, detalhe da venda e cancelamento na tela, importação de clientes com saldo devedor inicial (B2 da spec), cobrança por WhatsApp.

**Fica para a v2:** lote e validade, NFC-e, SNGPC, impressora de cupom, alertas de vencimento.

**Dependências do Lucas nesta etapa:** nenhuma credencial nova. Continua pendente, para o fim do projeto, **revogar o Personal Access Token** do Supabase (o CLI agora depende dele também).
