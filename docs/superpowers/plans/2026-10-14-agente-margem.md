# Agente de Margem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O agente passa a responder quais produtos têm a pior margem no período, só para o dono, sem
expor o custo histórico por leitura direta.

**Architecture:** Duas funções de banco no mesmo padrão das quatro `relatorio_*(p_de date, p_ate date)`
que já existem (`returns table`, sem `security definer`, checagem de papel dentro). O agente ganha uma
quinta intenção na lista fechada do prompt; o modelo **só classifica** e o texto continua sendo montado
em código. A exposição de `venda_itens.preco_custo` a `authenticated` é fechada no mesmo trabalho.

**Tech Stack:** Postgres 17 / Supabase (RLS, `security invoker`), Next.js 16 App Router, TypeScript,
Vitest (unitário) e o runner SQL próprio do projeto.

**Spec:** `docs/superpowers/specs/2026-10-14-agente-margem-design.md`

## Global Constraints

- **Toda mensagem ao usuário é em português**, e as mensagens de recusa são copiadas LITERALMENTE do
  banco quando a regra também existe lá.
- **O modelo só classifica.** O texto da resposta é montado em código (`montarResposta`). Nenhum número
  exibido vem do modelo.
- As funções **que leem custo** (`margem_produtos`, `margem_sem_custo` e a `relatorio_lucro` que já
  existe) são **`security definer`**, com a checagem de papel **dentro**. Isto CORRIGE o spec, que dizia
  o contrário: `relatorio_lucro` é `security invoker` hoje e só funciona **porque o custo vaza** —
  medido em 14/10/2026: `authenticated` lê `venda_itens.preco_custo` = `true`. Fechar o vazamento sem
  tornar a função `definer` **quebraria o relatório de lucro em produção**.
  ⚠️ `security definer` roda como o dono do banco e **ignora RLS**: por isso a checagem de papel dentro
  da função deixa de ser redundante e passa a ser a **única** barreira. Errar aqui vaza custo.
- Permissões, sempre as duas linhas: `revoke all on function ... from public, anon;` e
  `grant execute on function ... to authenticated, service_role;`
- **Margem é só do dono.** Mensagem: `Só o dono vê o lucro.` (a que `relatorio_lucro` já usa).
- **As funções devolvem SÓ INTEIROS.** `numeric` do Postgres chega pelo PostgREST como **string**, e o
  percentual viraria `NaN` justamente no número que ordena o ranking. O percentual é calculado em
  `montarResposta`, em código puro. A função **ordena** por percentual internamente sem devolvê-lo.
- `DIAS_MAXIMOS = 31` e `LIMITE_RESULTADOS = 10` (`app/(app)/agente/logica.ts:53,56`).
- **Margem sobre receita:** `(receita − custo) ÷ receita`. Ordenação pelo **percentual crescente**,
  desempate pelo valor em reais.
- **Produto sem custo fica fora do ranking** e é contado à parte.
- **Nos casos SQL, trechos de mensagem comparados SEM ACENTO.** O transporte do runner até o endpoint
  de SQL não preserva acento: um literal acentuado casa por acidente com mensagem corrompida no banco e
  falha quando o banco é corrigido (foi o que quebrou o caso `030` em 14/10/2026).

## Textos fixados (usar verbatim)

1. **Recusa de papel:** `Só o dono vê o lucro.` — a mesma de `relatorio_lucro`.
   ⚠️ **O banco tem esse texto CORROMPIDO hoje**: medido em 14/10/2026, `pg_get_functiondef` devolve
   `SÃ³ o dono vÃª o lucro.`, enquanto `016_relatorios.sql` tem o texto certo. A Task 2 **recria** a
   função copiando o arquivo, então ela conserta a codificação por tabela — e é por isso que o teste
   compara o trecho sem acento (`'dono v'`, que aparece igual nos dois).
2. **Período inválido:** `Período inválido: de e até são obrigatórios, em ordem, com no máximo 31 dias.`
   **Esta mensagem é NOVA**, e é uma divergência deliberada da função irmã: `relatorio_lucro` **não**
   levanta exceção para período torto — ela devolve zeros (registrado no `PROGRESSO.md` como ruling
   aceito da Etapa 7). Para o agente isso seria pior: período torto devolvendo "nenhum produto" é uma
   resposta **falsa**, não uma recusa. Então a função de margem valida e recusa.
   No teste, comparar `'31 dias'` **sem acento**. (Antes esta linha mandava comparar
   `'Periodo invalido'` — fragmento que **não existe** na mensagem gravada, e que reprovaria o caso com a
   função correta: o mesmo defeito de classe do `'apenas o dono'`. Corrigido em 14/10/2026 pela revisão
   da Task 1, Minor 12.)
3. **Limite fora de 1..10:** `Limite inválido: informe um valor entre 1 e 10.` — mensagem nova, criada na Task 1 e que faltava nesta lista.
4. **Ranking vazio:** `Não houve venda com custo registrado no período.` — a frase que `montarResposta`
   devolve quando a lista volta vazia, no lugar de string vazia ou de uma tela em branco.

## Review Focus

Cinco entradas que a spec implica e que ninguém testaria por conta própria. Cada uma tem teste na
tarefa dona do código:

1. **Produto vendido com receita zero** (brinde, desconto de 100%): `margem ÷ receita` divide por zero.
   Esperado: a linha fica fora do ranking de percentual em vez de virar `NaN`/infinito.
2. **Período sem nenhuma venda:** o ranking fica **vazio**, não é erro — e a resposta diz isso em
   português.
3. **`p_limite` fora de 1..10:** recusa, como `validarLimite` já faz para as outras intenções.
4. **Atendente perguntando margem:** recusa **local**, antes de reservar orçamento e antes de qualquer
   envio ao provedor.
5. **Período maior que 31 dias** chegando pela margem: recusa, com o mesmo teto de vendas.

---

### Task 1: As duas funções de margem no banco

**Files:**
- Create: `supabase/migrations/019_margem_produtos.sql`
- Create: `tests/sql/casos/140_margem.sql`

**Interfaces:**
- Consumes: `vendas`, `venda_itens` (tabelas existentes), o helper `criar_usuario_teste(p_id, p_email, p_papel)`
  e `teste_ok`/`teste_erro` de `tests/sql/_fixtures.sql` e `_helper.sql`.
- Produces:
  - `public.margem_produtos(p_de date, p_ate date, p_limite integer default 10) returns table (produto_id uuid, nome text, quantidade bigint, receita bigint, custo bigint, margem bigint)` — **sem `percentual`**: o percentual é calculado em código (ver R1 no ledger). A função **ordena** por `margem::numeric / receita` crescente internamente.
  - `public.margem_sem_custo(p_de date, p_ate date) returns table (sem_custo bigint)`

- [ ] **Step 1: Escrever o caso SQL que falha**

`tests/sql/casos/140_margem.sql`, com cenário próprio: um usuário `dono`, um `atendente`, três produtos
com custo e **um produto vendido com `preco_custo = 0`**. As asserções mínimas:

```sql
perform teste_ok((select produto_id = v_pior from margem_produtos(HOJE - 30, HOJE, 10) limit 1),
  'caso 1: o ranking comeca pelo PIOR percentual');
perform teste_ok((select count(*) = 2 from margem_produtos(HOJE - 30, HOJE, 10)),
  'caso 2: o produto sem custo NAO entra no ranking');
perform teste_ok((select sem_custo = 1 from margem_sem_custo(HOJE - 30, HOJE)),
  'caso 3: o produto sem custo e contado a parte');
perform teste_erro('select margem_produtos(HOJE - 30, HOJE, 0)', 'limite',
  'caso 4: limite fora de 1..10 e recusado');
perform teste_erro('select margem_produtos(HOJE - 40, HOJE, 10)', 'periodo',
  'caso 5: periodo maior que 31 dias e recusado');
```

E o caso que o Review Focus exige, para o produto vendido com **receita zero** (brinde ou desconto de
100%) — `margem ÷ receita` divide por zero:

```sql
perform teste_ok((select count(*) = 0 from margem_produtos(HOJE - 30, HOJE, 10) where receita = 0),
  'caso 6: produto com receita zero NAO entra no ranking de percentual');
perform teste_ok((select sem_custo >= 0 from margem_sem_custo(HOJE - 30, HOJE)),
  'caso 6: e a funcao de contagem nao explode com receita zero presente');
```

Trocar de papel com `set_config('request.jwt.claims', ...)` e provar a recusa do atendente com o trecho
**sem acento** `'dono v'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql -- 140`
Expected: `FALHOU ... function margem_produtos(...) does not exist`

- [ ] **Step 3: Escrever a migration `019_margem_produtos.sql`**

Copiar a estrutura de `relatorio_lucro` (`supabase/migrations/016_relatorios.sql:87`): validação de
período **antes** da checagem de papel, `returns table`, **`security definer`** (ver Global Constraints), e as duas linhas de
permissão no fim. O corpo agrega `venda_itens` + `vendas` (`status = 'concluida'`, dia em São Paulo),
exclui `preco_custo = 0`, calcula `percentual` e ordena `percentual asc, margem asc`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:sql -- 140`
Expected: `9 OK, 0 FALHOU de 1 arquivos` (ou o número de asserções que o caso tiver)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/019_margem_produtos.sql tests/sql/casos/140_margem.sql
git commit -m "margem: as duas funcoes de margem por produto, com casos SQL"
```

---

### Task 2: Fechar a leitura direta do custo — SEM quebrar o relatório de lucro

**Files:**
- Create: `supabase/migrations/020_fechar_custo_venda.sql`
- Create: `tests/sql/casos/150_permissoes_custo.sql`

**Interfaces:**
- Consumes: `margem_produtos` da Task 1; `relatorio_lucro(date, date)` de `016_relatorios.sql`.
- Produces: nada que outra tarefa consuma — é fechamento de permissão.

**⚠️ ESTA TAREFA NÃO É UMA REVOGAÇÃO SOZINHA.** Medido em 14/10/2026: `relatorio_lucro` é
`security invoker` e só enxerga `preco_custo` **porque `authenticated` também enxerga**. Revogar sem
recriar a função **quebra o relatório de lucro que a farmácia usa**. A ordem dentro da migration é:
primeiro recriar as funções como `security definer` com a checagem de dono dentro, **depois** revogar.

- [ ] **Step 1: Escrever o caso SQL que falha**

```sql
-- 1. o vazamento fecha
perform teste_ok(not has_column_privilege('authenticated', 'venda_itens', 'preco_custo', 'select'),
  'caso 1: authenticated NAO le preco_custo de venda_itens direto');
-- 2. o servidor continua lendo
perform teste_ok(has_column_privilege('service_role', 'venda_itens', 'preco_custo', 'select'),
  'caso 2: service_role continua lendo (o servidor precisa)');
-- 3. A GUARDA QUE IMPORTA: o relatorio de lucro continua funcionando para o dono
perform set_config('request.jwt.claims', jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
perform teste_ok((select lucro > 0 from relatorio_lucro(HOJE - 30, HOJE)),
  'caso 3: relatorio_lucro SEGUE funcionando depois do fechamento');
-- 4. e continua recusando o atendente
perform set_config('request.jwt.claims', jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
perform teste_erro('select * from relatorio_lucro(HOJE - 30, HOJE)', 'dono v',
  'caso 4: o atendente continua sem ver o lucro');
-- 5. o custo do CADASTRO segue legivel: a tela do produto depende disso
perform teste_ok(has_column_privilege('authenticated', 'produtos', 'preco_custo', 'select'),
  'caso 5: produtos.preco_custo continua legivel (a tela do produto depende)');
perform teste_ok((select count(*) > 0 from margem_produtos(HOJE - 30, HOJE, 10)),
  'caso 6: a margem continua funcionando depois do fechamento');
```

O caso 5 é a guarda contra o conserto virar defeito: `app/(app)/produtos/[id]/page.tsx:52` lê
`produtos.preco_custo` e **não pode** ser fechado junto. E o caso 3 é a razão desta tarefa existir
reescrita: **sem ele, o conserto quebraria o relatório de lucro em silêncio.**

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql -- 150`
Expected: `FALHOU: caso 1 ...` (hoje o `authenticated` lê)

- [ ] **Step 3: Escrever a migration `020_fechar_custo_venda.sql`**

Nesta ordem, e a ordem é o ponto:
1. `create or replace function public.relatorio_lucro(...)` — **cópia literal da 016**, mudando só
   `security invoker` → `security definer` e mantendo a checagem de papel que já existe dentro dela.
2. `revoke select (preco_custo) on public.venda_itens from authenticated;`
3. Repetir as duas linhas de permissão da função recriada (`revoke all ... from public, anon` e
   `grant execute ... to authenticated, service_role`).
Antes de fechar `v_lucro_periodo`, **conferir** se alguma tela a lê direto; se ler, **parar e reportar**
em vez de fechar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:sql -- 150` e depois `npm run test:sql -- 110`
Expected: o `150` verde **e** o `110_relatorios.sql` (que cobre lucro) **continuar** verde — é ele que
prova que o conserto não quebrou o que já existia

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/020_fechar_custo_venda.sql tests/sql/casos/150_permissoes_custo.sql
git commit -m "seguranca: fecha a leitura direta do custo sem quebrar o relatorio de lucro"
```

---

### Task 3: A intenção nova na lógica pura

**Files:**
- Modify: `app/(app)/agente/logica.ts:73` (`Intencao`), `:87` (`DadosResposta`), `:167` (`montarResposta`), `:745` (`validarClassificacao`)
- Modify: `lib/agente/deepseek.ts:49` (`PROMPT_CLASSIFICACAO`) e `promptClassificacao`
- Test: `app/(app)/agente/logica.test.ts`, `lib/agente/deepseek.test.ts`

**Interfaces:**
- Consumes: `LIMITE_RESULTADOS`, `DIAS_MAXIMOS` (`logica.ts:53,56`).
- Produces: `Intencao` ganha `'margem_produto'`; `DadosResposta` ganha a variante de margem com
  `produtos: { nome, receita, custo, margem, percentual }[]` e `semCusto: number`.

- [ ] **Step 1: Escrever os testes que falham**

Em `logica.test.ts`: `validarClassificacao({ intencao: 'margem_produto' }, HOJE)` devolve a intenção com
`de`/`ate` de 30 dias; período maior que 31 dias é recusado; `montarResposta` com dois produtos monta o
ranking **com os dois números** (reais e percentual) e a linha `N produtos ficaram de fora por não ter
custo cadastrado`; **ranking vazio** devolve uma frase em português, não string vazia.
Em `deepseek.test.ts`: `promptClassificacao(HOJE)` contém `margem_produto`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "app/(app)/agente/logica.test.ts" "lib/agente/deepseek.test.ts"`
Expected: FAIL — `'margem_produto'` não é uma intenção válida

- [ ] **Step 3: Implementar na `logica.ts` e no prompt**

Estender o tipo `Intencao` e o mapa de validação; adicionar `margem_produto` ao prompt com a mesma
redação das outras (`"de"`/`"ate"` aceitam `AAAA-MM-DD`, `"limite"` de 1 a 10); montar a resposta com
os dois números.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "app/(app)/agente/logica.test.ts" "lib/agente/deepseek.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/agente/logica.ts" "app/(app)/agente/logica.test.ts" lib/agente/deepseek.ts lib/agente/deepseek.test.ts
git commit -m "agente: a quinta intencao, margem por produto"
```

---

### Task 4: A consulta, o papel e o caminho até a tela

**Files:**
- Modify: `app/api/agente/route.ts:32` (`consultar`), `app/api/agente/orquestracao.ts`
- Test: `app/api/agente/orquestracao.test.ts`

**Interfaces:**
- Consumes: `margem_produtos` e `margem_sem_custo` (Task 1), `Intencao` com `'margem_produto'` (Task 3).
- Produces: `Deps.consultar` passa a aceitar a intenção de margem; a orquestração recusa o papel antes
  de reservar.

- [ ] **Step 1: Escrever os testes que falham**

Em `orquestracao.test.ts`, com as dependências simuladas: **atendente** perguntando margem recebe
`403` com a mensagem do dono e **`reservar` não é chamado** (esse é o ponto: a recusa é antes do gasto);
**dono** perguntando margem com ranking vazio recebe `200` com a frase de "nenhum produto".

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "app/api/agente/orquestracao.test.ts"`
Expected: FAIL — a intenção nova não é tratada

- [ ] **Step 3: Implementar**

`route.ts:32` ganha o ramo da margem chamando `.rpc('margem_produtos', { p_de, p_ate, p_limite })` e
`.rpc('margem_sem_custo', ...)`. `orquestracao.ts` ganha a guarda de papel **antes** de `deps.reservar`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "app/api/agente/orquestracao.test.ts"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/agente/route.ts app/api/agente/orquestracao.ts app/api/agente/orquestracao.test.ts
git commit -m "agente: consulta de margem e recusa de papel antes do gasto"
```

---

### Task 5: Aceite real e bateria completa

**Files:**
- Nenhum arquivo de produção. Spec temporária de aceite, apagada depois.

**Interfaces:**
- Consumes: tudo das tarefas 1 a 4.
- Produces: a evidência colada no `PROGRESSO.md`.

- [ ] **Step 1: Rodar o aceite real contra o banco**

Logar como **dono** e perguntar *"onde eu estou perdendo margem?"* pela rota real
(`POST /api/agente`), conferindo que a resposta traz produtos reais e a contagem de sem-custo. Depois
logar como **atendente** e conferir a recusa, **sem** consumo de orçamento.

- [ ] **Step 2: Rodar a bateria inteira**

Run: `npm test` · `npx tsc --noEmit` · `npm run lint` · `npm run build` · `npm run test:sql` · `npm run test:e2e`
Expected: tudo verde, exceto o que já estava vermelho antes desta feature (`040_views.sql` por dado de
teste velho, e os timeouts de `lib/pdf.test.ts` sob carga — conferir no `PROGRESSO.md` se ainda valem).

- [ ] **Step 3: Apagar a spec temporária e conferir a árvore**

Run: `git status --porcelain`
Expected: vazio

- [ ] **Step 4: Registrar a evidência no `PROGRESSO.md` e commitar**

```bash
git add PROGRESSO.md
git commit -m "docs: agente de margem entregue, com a evidencia"
```
