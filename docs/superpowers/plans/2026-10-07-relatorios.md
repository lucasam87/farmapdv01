# Relatórios (Etapa 7) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono (e o balcão) abre `/relatorios`, escolhe um período e vê os números que batem com o PDV — faturamento, quantidade, ticket médio, composição por forma de pagamento, top 10 mais vendidos e, só para o dono, receita, custo e lucro.

**Architecture:** Toda a agregação do período vive em **funções de leitura no Postgres** (migration `016`), não na tela: um período longo produziria dezenas de milhares de linhas se a soma fosse feita em JS, e o lucro precisa da checagem de papel onde as outras regras do projeto vivem — dentro da função (spec §7.4). A tela só formata e desenha. Isto **refina o desenho conversado**: em vez de acrescentar `dia` a `v_formas_pagamento`/`v_mais_vendidos` e somar no cliente, as duas leituras "por período" viram funções — o cliente não agrega nada.

**Tech Stack:** Next 16 (App Router, Server Components — a tela é servida por um form GET, como `/vendas`), Supabase/Postgres 17 (view + funções SQL `stable`), Vitest, Playwright, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-06-sistema-farmacia-design.md` — §6 (views de leitura), §7.4 (RLS e "a restrição de papel não fica só na RLS"), §8.3 (a conta do caixa), §9 (mensagens), §10 (interface: uma tarefa por tela), §13 Etapa 7 ("números batem com o PDV em 3 dias, incluindo venda após 21h"; evidência "3 dias conferidos").

## Global Constraints

- Dinheiro é **inteiro em centavos**; a conversão para reais só em `lib/format.ts`. Mensagem de dinheiro dentro do banco usa `centavos_em_reais()` (`002_registrar_venda.sql`).
- **Fuso:** a conversão vive nas views/funções (`at time zone 'America/Sao_Paulo'`); a tela nunca refaz conta de fuso.
- **`status = 'concluida'`** em toda agregação: venda cancelada não entra em nenhum número (spec §6, A7).
- **O lucro e o custo são do dono** (decisão do Lucas, 07/10/2026): a checagem é **da função**, não da tela.
- Nenhuma dependência nova. `middleware.ts` não existe aqui (é `proxy.ts`).
- Comandos: `npm test` · `npm run test:sql [-- arquivo]` · `npm run test:e2e` · `npm run lint` · `npm run build` · `npm run migrar -- <arquivo>`.
- **Nunca rodar `test:sql` e `test:e2e` em paralelo**; a suíte SQL não roda com caixa aberto.
- **O banco está com 0 vendas.** O critério "3 dias conferidos" com venda real **não pode ser provado agora**: a prova desta etapa é a equivalência por SQL (a soma do período igual à soma da tabela `vendas` no mesmo intervalo, dentro da transação do caso) e o e2e com a venda que ele mesmo faz. A conferência dos 3 dias reais fica **escrita como aberta** no `PROGRESSO.md` (Task 5) — mesmo tratamento que a Etapa 3 deu ao arquivo real do Nex.

## Review Focus

O que a spec implica e nenhuma tarefa prova sozinha — cada linha já aponta o teste que a amarra:

1. **Ticket médio do período = total ÷ quantidade**, nunca a média das médias diárias (o erro clássico e silencioso deste número) — T1 (SQL: 2 dias com volumes diferentes) e T2 (unitário da função pura que a tela usa para conferir).
2. **Venda após 21h cai no dia de São Paulo**, e a soma do período não perde nem duplica a venda da virada de data — T1 (SQL, com `criado_em` explícito) e T4 (e2e com a venda do dia).
3. **Lucro e custo nunca chegam ao navegador do atendente** (nem por chamada direta à função) — T1 (SQL com os dois papéis) e T3 (a tela não pede o que não pode ver).
4. **Período torto** (`2026-02-31`, `de` depois de `ate`, vazio) cai no padrão com aviso, nunca 500 nem número errado — T2 (unitário) e T4 (e2e).
5. **Venda cancelada não entra em nenhum número** do relatório (spec §6/A7) — T1 (SQL).

---

### Task 1: As funções de leitura do período (migration 016) + caso SQL 110

**Files:**
- Create: `supabase/migrations/016_relatorios.sql`
- Create: `tests/sql/casos/110_relatorios.sql`

**Interfaces:**
- **Produces** (todas `language sql`, `stable`, **sem** `security definer` — a função roda com os direitos de quem chama, então a RLS continua valendo, como as views depois da migration `013`; toda tabela é referenciada qualificada, `public.vendas`):
  - `relatorio_resumo(p_de date, p_ate date) returns table (faturamento bigint, vendas bigint, ticket_medio bigint)` — soma de `vendas.total` e `count(*)` das **concluídas** no intervalo (fuso SP), com `ticket_medio = round(faturamento / vendas)` e `0` quando `vendas = 0`.
  - `relatorio_lucro(p_de date, p_ate date) returns table (receita bigint, custo bigint, lucro bigint)` — **só dono**: se `perfis.papel <> 'dono'` levanta `Só o dono vê o lucro.` (mensagem nova, no estilo das outras; spec §9). `lucro = receita − custo` a partir de `venda_itens` das vendas concluídas do período.
  - `relatorio_formas_pagamento(p_de date, p_ate date) returns table (forma text, quantidade bigint, total bigint)` — de `venda_pagamentos` das concluídas do período, maior total primeiro.
  - `relatorio_mais_vendidos(p_de date, p_ate date, p_limite integer) returns table (produto_id uuid, nome text, quantidade bigint, total bigint)` — de `venda_itens` das concluídas do período, maior quantidade primeiro, `limit coalesce(p_limite, 10)`.
- **Consumes:** `vendas`, `venda_itens`, `venda_pagamentos`, `perfis` (`001_base.sql`), `centavos_em_reais` (`002`), e a expressão de dia `(criado_em at time zone 'America/Sao_Paulo')::date` — a **mesma** de `v_vendas_dia` (`005_views.sql:16`).
- **Não muda:** as views. `v_formas_pagamento` e `v_mais_vendidos` continuam agregando tudo (sem `dia`); quem lê por período são as funções novas. Fica registrado no cabeçalho da migration que a spec §6 descreve essas duas como "no período"/"por período" e que hoje isso é feito pelas funções — o drift é conhecido, não acidental.

- [ ] **Step 1: Escrever o caso SQL que falha**

`tests/sql/casos/110_relatorios.sql`, um `do $$ ... $$` com o cenário dos helpers (`criar_usuario_teste` dono + atendente, `criar_produto`, `criar_caixa_aberto`, `criar_cliente`, `set_config('request.jwt.claims', ...)`) e três vendas com **`criado_em` explícito e no passado** (para não colidir com venda real nem com outros casos), como em `040_views.sql`:

```sql
-- venda A: 3x PRODUTO A (R$ 10,00 cada) as 22h de 15/01 em SP  -> dia 2026-01-15
update vendas set criado_em = timestamptz '2026-01-16 01:00:00+00' where id = v_a;
-- venda B: 1x PRODUTO A + 1x PRODUTO B, dinheiro + pix, ao meio-dia de 16/01 -> dia 2026-01-16
update vendas set criado_em = timestamptz '2026-01-16 15:00:00+00' where id = v_b;
-- venda C: fora do periodo (17/01) e venda D: cancelada no dia 15/01
```

E as asserções (todas `perform teste_ok(...)`, com valores **calculados a partir do cenário**, nunca contando a tabela inteira):

```sql
-- ticket medio: 2 dias com volumes diferentes -> a media das medias daria outro numero
perform teste_ok((select faturamento = 900 + 2500 and vendas = 2 and ticket_medio = 1700
                    from relatorio_resumo(date '2026-01-15', date '2026-01-16')),
  'caso 1: ticket medio do periodo e total/quantidade, nao a media dos dias');
perform teste_ok((select ticket_medio = 0 and faturamento = 0 from relatorio_resumo(date '2026-01-01', date '2026-01-02')),
  'caso 1: periodo sem venda devolve zero, e nao divisao por zero');

-- a venda das 22h de 15/01 entra no dia 15 (fuso de Sao Paulo), nao no 16
perform teste_ok((select faturamento = 900 from relatorio_resumo(date '2026-01-15', date '2026-01-15')),
  'caso 2: a venda das 22h de 15/01 conta no dia 15');
-- cancelada fora: o dia 17/01 tem UMA venda, cancelada -> faturamento zero
perform teste_ok((select faturamento = 0 and vendas = 0 from relatorio_resumo(date '2026-01-17', date '2026-01-17')),
  'caso 2: o dia que so tem venda cancelada fatura zero');

-- lucro so para o dono
perform teste_ok((select lucro = (v_receita - v_custo) from relatorio_lucro(date '2026-01-15', date '2026-01-16')),
  'caso 3: lucro = receita - custo no periodo');
perform teste_erro($$select * from relatorio_lucro(date '2026-01-15', date '2026-01-16')$$,
  'Só o dono vê o lucro', 'caso 3: atendente nao le o lucro');  -- com os claims do atendente

-- formas de pagamento e mais vendidos do periodo
perform teste_ok((select sum(total) = 2500 from relatorio_formas_pagamento(date '2026-01-16', date '2026-01-16')),
  'caso 4: as formas de pagamento do dia somam o total vendido');
perform teste_ok((select nome = 'PRODUTO A' and quantidade = 4
                    from relatorio_mais_vendidos(date '2026-01-15', date '2026-01-16', 10) limit 1),
  'caso 5: o ranking do periodo soma os dias (3 + 1 do mesmo produto)');
perform teste_ok((select count(*) = 0 from relatorio_mais_vendidos(date '2026-01-17', date '2026-01-17', 10)),
  'caso 5: venda fora do periodo nao entra no ranking');
```

**Antes de escrever:** leia `tests/sql/_helper.sql` (`teste_ok`, `teste_erro`) e `tests/sql/casos/040_views.sql` (o padrão de `criado_em` explícito e de `set_config` para trocar de papel). Os valores de `v_receita`/`v_custo` do caso 3 saem do `preco_custo` que você definir no cenário.

- [ ] **Step 2: Rodar e ver falhar**
Run: `npm run test:sql -- 110_relatorios.sql`
Expected: `FALHOU ... function relatorio_resumo(date, date) does not exist` e `0 OK, 1 FALHOU`.

- [ ] **Step 3: Escrever a migration**

`supabase/migrations/016_relatorios.sql` com as quatro funções. Decisões que a assinatura não resolve: o intervalo é **inclusivo** nas duas pontas (`>= p_de and <= p_ate`); o dia de cada venda é a expressão de São Paulo (a mesma da `v_vendas_dia`); toda agregação filtra `v.status = 'concluida'`; `p_de`/`p_ate` nulos ou invertidos devolvem **zero linhas / zeros** em vez de erro (a tela valida antes, e o banco não pode estourar); e as funções são legíveis por `authenticated` (`grant execute ... to authenticated`, `revoke ... from public, anon`), sem `security definer`.

- [ ] **Step 4: Aplicar e ver passar**
Run: `npm run migrar -- 016_relatorios.sql` → `1 de 1 migrations aplicadas`, HTTP 201.
Run: `npm run test:sql -- 110_relatorios.sql` → todas `OK`.
Run: `npm run test:sql` → **325 + as suas asserções**, 0 FALHOU de **12 arquivos** (diga o número real).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/016_relatorios.sql tests/sql/casos/110_relatorios.sql
git commit -m "relatorios: as leituras do periodo em funcoes SQL, com o lucro so do dono"
```

---

### Task 2: `app/(app)/relatorios/periodo.ts` — o período, puro

**Files:**
- Create: `app/(app)/relatorios/periodo.ts`
- Test: `app/(app)/relatorios/periodo.test.ts`

**Interfaces:**
- **Produces** (funções puras, sem Supabase/React):
  - `type Periodo = { de: string; ate: string }`
  - `atalhos(hoje: string): { rotulo: string; periodo: Periodo }[]` — **Hoje**, **Ontem**, **7 dias** (hoje − 6 até hoje), **Este mês** (dia 1 do mês até hoje).
  - `validarPeriodo(de: string | undefined, ate: string | undefined, hoje: string): { periodo: Periodo; aviso: boolean }` — datas ausentes → **Hoje**; qualquer data inválida (reuse `validarDia` de `../vendas/dia`), ou `de` depois de `ate` → **Hoje** com `aviso: true`.
  - `diasDoPeriodo(periodo: Periodo): number` — quantos dias o intervalo cobre (inclusive), para a legenda da tela.
  - `ticketMedio(faturamento: number, vendas: number): number` — `vendas === 0 ? 0 : Math.round(faturamento / vendas)` (a mesma conta da função SQL; é o que a tela usa para o cartão e o que o teste unitário amarra).
- **Consumes:** `validarDia`, `diaAnterior`, `diaSeguinte` de `app/(app)/vendas/dia.ts` (**importe, não copie**; não altere aquele arquivo — ele foi revisado na Etapa 5).

- [ ] **Step 1: Escrever os testes que falham**

`app/(app)/relatorios/periodo.test.ts` (Vitest, `describe/it` em português, no estilo de `app/(app)/vendas/dia.test.ts`):

```ts
const HOJE = '2026-10-07'
// ausentes -> hoje, sem aviso
expect(validarPeriodo(undefined, undefined, HOJE)).toEqual({ periodo: { de: HOJE, ate: HOJE }, aviso: false })
// torto -> hoje COM aviso (nunca 500, nunca numero errado)
expect(validarPeriodo('2026-02-31', '2026-03-01', HOJE).aviso).toBe(true)
expect(validarPeriodo('2026-03-01', '2026-02-01', HOJE)).toEqual({ periodo: { de: HOJE, ate: HOJE }, aviso: true })
expect(validarPeriodo('abc', 'abc', HOJE).aviso).toBe(true)
// atalhos
const a = atalhos(HOJE)
expect(a.find((x) => x.rotulo === 'Hoje')!.periodo).toEqual({ de: HOJE, ate: HOJE })
expect(a.find((x) => x.rotulo === 'Ontem')!.periodo).toEqual({ de: '2026-10-06', ate: '2026-10-06' })
expect(a.find((x) => x.rotulo === '7 dias')!.periodo).toEqual({ de: '2026-10-01', ate: HOJE })
expect(a.find((x) => x.rotulo === 'Este mês')!.periodo).toEqual({ de: '2026-10-01', ate: HOJE })
// dias do periodo e o ticket medio (total / quantidade, nunca media das medias)
expect(diasDoPeriodo({ de: '2026-10-01', ate: '2026-10-07' })).toBe(7)
expect(ticketMedio(0, 0)).toBe(0)
expect(ticketMedio(3400, 2)).toBe(1700)          // 2 vendas, R$ 34,00
expect(ticketMedio(900 + 2500, 2)).toBe(1700)    // a media das medias (450+2500)/2 daria 1475
```

- [ ] **Step 2: Rodar e ver falhar** — `npm test -- periodo.test.ts` → `Failed to resolve import "./periodo"`.
- [ ] **Step 3: Implementar `periodo.ts`.** Aritmética de data por `Date.UTC` (como `dia.ts`), nunca `new Date(string)` sem fuso; o mês de "Este mês" sai do `hoje` (não do relógio da máquina).
- [ ] **Step 4: Rodar e ver passar** — `npm test -- periodo.test.ts` → PASS; `npm run lint` exit 0.
- [ ] **Step 5: Commit**

```bash
git add "app/(app)/relatorios/periodo.ts" "app/(app)/relatorios/periodo.test.ts"
git commit -m "relatorios: o periodo e o ticket medio em modulo puro e testado"
```

---

### Task 3: `/relatorios` — a tela

**Files:**
- Create: `app/(app)/relatorios/page.tsx`

**Interfaces:**
- **Consumes:** as quatro funções da T1 (via `supabase.rpc`), `validarPeriodo`, `atalhos`, `ticketMedio`, `diasDoPeriodo` (T2), `perfilAtual`, `formatarMoeda`.
- **Produces:** a rota `/relatorios?de=YYYY-MM-DD&ate=YYYY-MM-DD`; `data-testid` = `periodo-de`, `periodo-ate`, `periodo-hoje`, `periodo-ontem`, `periodo-7dias`, `periodo-mes`, `aviso-periodo`, `card-faturamento`, `card-vendas`, `card-ticket`, `card-lucro`, `formas-pagamento`, `linha-forma`, `mais-vendidos`, `linha-vendido`, `erro-relatorio`.

- [ ] **Step 1: A página.** Server Component com `searchParams: Promise<{ de?: string | string[]; ate?: string | string[] }>` (**com a guarda de `Array.isArray`, como `/clientes`**), `hoje` em São Paulo, `validarPeriodo`, e o form GET no topo (dois `<input type="date">` + botão **Ver**, mais os atalhos como links que preservam o período no endereço).
  - **Erro de consulta nunca vira número**: se qualquer `rpc` devolver `error`, a tela mostra `Não foi possível carregar os relatórios. Recarregue.` em aviso vermelho (`role="alert"`, `data-testid="erro-relatorio"`) e **não desenha cartão nenhum** — a lição das Etapas 5 e 6.
  - **Lucro só para o dono:** `perfilAtual()` decide; para o atendente, o cartão de lucro **não existe na página** e a `rpc('relatorio_lucro')` **não é chamada** (a função também recusaria — defesa em profundidade, spec §7.4).
  - Cartões: faturamento (`formatarMoeda`), quantidade de vendas, ticket médio (use `ticketMedio` sobre o que veio da função, para os dois lados usarem a mesma conta) e lucro com a receita e o custo embaixo, menores.
  - Listas: formas de pagamento (forma, quantidade, total) e top 10 mais vendidos (nome, quantidade, total). Sem tabela lotada: linhas enxutas, fontes grandes (spec §10).
  - Legenda do período: `7 dias · 01/10/2026 a 07/10/2026` e o aviso de período inválido quando `aviso`.
- [ ] **Step 2: Verificar** — `npm run build` exit 0 com `ƒ /relatorios`; `npm run lint` exit 0; `npm test`.
- [ ] **Step 3: Commit**

```bash
git add "app/(app)/relatorios/page.tsx"
git commit -m "tela de relatorios: o periodo escolhido e os numeros dele na mesma tela"
```

---

### Task 4: e2e dos relatórios

**Files:**
- Create: `tests/e2e/relatorios.spec.ts`

**Interfaces:**
- **Consumes:** a tela da T3, o PDV (venda no crediário/dinheiro) e o cenário do `global-setup` (caixa aberto no terminal `e2e`, `PRODUTO_E2E` a R$ 5,00) — como em `tests/e2e/crediario.spec.ts`, que é o modelo a espelhar (inclusive o `loadEnvFile` e o `entrar`).
- **Produces:** nada que outra tarefa use.

- [ ] **Step 1: Escrever os testes** (4):

```ts
// (1) a tela abre no periodo de hoje, com os 4 cartoes e as 2 listas
// (2) venda nova aparece no relatorio: faz a venda no PDV (R$ 5,00), abre /relatorios
//     no periodo de hoje e confere que o faturamento AUMENTOU pelo valor da venda
//     (leia o faturamento ANTES, para nao depender do que a suite ja vendeu) e que o
//     produto aparece em `mais-vendidos`
// (3) periodo torto cai em hoje com aviso: /relatorios?de=2026-02-31&ate=2026-02-31
//     -> `aviso-periodo` visivel e os cartoes ainda renderizados
// (4) os atalhos mudam o periodo no endereco e o numero acompanha (Ontem, se nao houve
//     venda ontem, mostra faturamento R$ 0,00 — o que prova que o filtro funciona)
```

- [ ] **Step 2: Rodar** — `npm run test:e2e` → **21 + 4 = 25 passed**, exit 0.
- [ ] **Step 3: Rodar a suíte SQL inteira** (depois do e2e, nunca em paralelo) — o número real da T1, 0 FALHOU. Se cair "Já existe um caixa aberto", o teardown não limpou: confira por select somente-leitura e **não conserte o banco à mão**.
- [ ] **Step 4: Commit**

```bash
git add tests/e2e/relatorios.spec.ts
git commit -m "e2e dos relatorios: a venda do dia aparece, o periodo torto avisa e o atalho filtra"
```

---

### Task 5: Fechar a Etapa 7 no `PROGRESSO.md`

**Files:**
- Modify: `PROGRESSO.md` (cabeçalho "ONDE PARAMOS" + linha da Etapa 7)

- [ ] **Step 1: Rodar tudo em série** — `npm test`, `npm run test:sql`, `npm run lint`, `npm run build`, `npm run test:e2e`; cole cada número.
- [ ] **Step 2: Atualizar o `PROGRESSO.md`** — linha da Etapa 7 ✅ com os números, os hashes e o critério da spec; o cabeçalho apontando a **Etapa 8 (agente de IA)**; e a frase honesta: **os "3 dias conferidos" com venda real continuam abertos** (hoje o banco tem 0 vendas; a prova desta etapa é a equivalência por SQL e o e2e), mais o que mais não virou teste (o lucro escondido do atendente não é provável no e2e, que só tem usuário dono).
- [ ] **Step 3: Commit**

```bash
git add PROGRESSO.md
git commit -m "etapa-7: relatorios fechados, com a evidencia colada"
```

---

## Self-Review deste plano

- **Cobertura da spec:** §6 (as agregações por período, e o drift das duas views registrado no cabeçalho da `016`), §7.4 (o lucro checado **dentro** da função, T1), §8.3 (nada aqui mexe na gaveta), §9 (mensagens literais nas T1/T3), §10 (uma tarefa por tela, linhas enxutas), §13 Etapa 7 (o critério e a evidência, com a lacuna declarada na T5).
- **Escolhas que ficam explícitas:** período padrão **Hoje**; atalhos Hoje/Ontem/7 dias/Este mês; o lucro só do dono; nada de exportar/graficos (fora de escopo declarado no desenho aprovado).
- **Tipos:** as quatro funções da T1 são consumidas só pela T3; `Periodo`/`ticketMedio` (T2) são usados pela T3 e pelo teste unitário; nada é redefinido.
- **Riscos de sequência:** T2 não depende de nada; T3 depende de T1+T2; T4 depende de T3. T5 é o fecho.
- **Proporção:** o plano diz as assinaturas, as mensagens, os `data-testid` e as asserções — não transcreve os componentes.
