# Histórico de vendas (Etapa 5) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O dono vê as vendas de qualquer dia, abre uma venda inteira, cancela (com motivo) e o estoque volta — com a venda cancelada marcada na lista e fora do faturamento.

**Architecture:** Uma view nova, `v_vendas_historico`, vira a **única** fonte da lista e do detalhe: ela entrega o dia no fuso de São Paulo já pronto, os itens resumidos, as formas de pagamento e o estado do cancelamento. A tela não faz conta de dinheiro nem de fuso — só formata. `/vendas` passa a ter o dia no endereço (`?dia=`) e `/vendas/[id]` mostra a venda; o cancelamento é uma Server Action que chama a RPC `cancelar_venda`, que já existe e já está testada desde a Etapa 2.

**Tech Stack:** Next 16 (App Router, Server Components + Server Actions), Supabase/Postgres (view + RPC, RLS), Vitest, Playwright, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-10-06-sistema-farmacia-design.md` — §6 (views), §8.2 (matriz de cancelamento), §9 (mensagens), §10 (interface e ocultar valores), §13 (Etapa 5: "vejo o dia, abro uma venda, cancelo, estoque volta"; evidência: "venda noturna no dia certo").

## Global Constraints

- Dinheiro é **inteiro em centavos**; a conversão para reais só acontece em `lib/format.ts`, na borda de exibição.
- **Fuso:** toda data exibida ou agrupada é `America/Sao_Paulo`, e quem faz a conta é **a view** — a tela nunca refaz `at time zone`. Datas chegam à tela como `timestamp` sem fuso, já convertidas (mesma forma de `v_vendas_lista.criado_em`).
- **Mensagens em português**, sem termo técnico, dizendo o que fazer (spec §9). Quando o banco já devolve português, a mensagem vai crua para a tela (padrão de `app/(app)/caixa/actions.ts`).
- **Ocultar valores** é por endereço (`?ocultar=1`) e tem de sobreviver a: navegar de dia, abrir o detalhe e voltar (spec §10).
- **Só o dono cancela** (spec §8.2). O botão não aparece para o atendente e a RPC recusa de qualquer forma — a checagem de papel vive na função, não na tela.
- **Nada de dependência nova.** `middleware.ts` não existe neste projeto (é `proxy.ts`) — não criar.
- Comandos do projeto: `npm test` (Vitest), `npm run test:sql`, `npm run test:e2e` (Playwright), `npm run lint`, `npm run build`, `npm run migrar -- <arquivo>`.
- **Nunca rode `test:sql`, `test:sql:concorrencia` e `test:e2e` em paralelo:** os três escrevem no mesmo banco e o resultado vira falso negativo.

## Review Focus

O que a spec implica e nenhuma tarefa prova sozinha — cada linha já tem o teste que a amarra, na tarefa dona do código:

1. `?dia=` torturado (`abc`, `2026-1-5`, `2026-02-31`, vazio) — a tela cai em hoje com aviso e **nunca** dá erro 500. (Task 2, unitário; Task 3, aviso na tela; Task 5, e2e.)
2. Dia em que **todas** as vendas foram canceladas — a tela não pode dizer "nenhuma venda": mostra total R$ 0, a linha `Canceladas: N` e as vendas cinzas. (Task 2, `resumirCanceladas`; Task 3, estado vazio.)
3. `ocultar=1` sobrevivendo à navegação de dia e à ida e volta ao detalhe — nenhum valor pode vazar. (Task 5, e2e.)
4. Cancelar **duas vezes**, cancelar venda de **caixa já fechado**, cancelar com **motivo vazio** — mensagem em português na tela, sem 500, e a venda continua consistente. (Task 4, unitário do motivo; Task 5, e2e; casos 3–4 de `020_cancelamento.sql` já cobrem o banco.)
5. **Virada de dia no fuso**: venda das 22h e venda das 00h30 de São Paulo caem cada uma no seu dia, inclusive quando o dia pedido é ontem. (Task 1, caso SQL; Task 5, e2e com venda noturna inserida no banco.)

---

### Task 1: `v_vendas_historico` (migration 012)

**Files:**
- Create: `supabase/migrations/012_historico_vendas.sql`
- Create: `tests/sql/casos/080_historico.sql`

**Interfaces:**
- **Produces:** view `v_vendas_historico`, com estas colunas — `venda_id uuid`, `numero bigint`, `dia date`, `criado_em timestamp`, `cliente_id uuid`, `cliente_nome text`, `subtotal integer`, `desconto integer`, `total integer`, `troco integer`, `itens text`, `formas text`, `status text`, `cancelado_em timestamp`, `cancelado_por_nome text`, `motivo_cancelamento text`.
  - `dia` é a data **de São Paulo** (mesma expressão de `v_vendas_dia`) — é por ela que a tela filtra.
  - `criado_em` e `cancelado_em` são `timestamp` **sem fuso**, já convertidos para São Paulo.
  - A view **não filtra status**: a lista do dia precisa mostrar a venda cancelada, marcada.
- **Consumes:** `criar_usuario_teste`, `criar_produto`, `criar_caixa_aberto` (`tests/sql/_fixtures.sql`), `teste_ok` (`tests/sql/_helper.sql`), `registrar_venda`, `cancelar_venda`.
- **Não muda:** `v_vendas_lista` continua com `where status = 'concluida'` — é o contrato de faturamento da spec §6 e o que a Etapa 7 vai usar.

- [ ] **Step 1: Escrever o caso SQL que falha**

Em `tests/sql/casos/080_historico.sql`, um único bloco `do $$ ... $$` montando o cenário e as asserções abaixo. Cenário: dono `historico@farmacia.local` (padrão de `criar_usuario_teste`), `request.jwt.claims` com o `sub` dele, um caixa aberto, três produtos (`PRODUTO NOITE` a 450 com estoque 100, `PRODUTO HOJE` a 500 com 100, `PRODUTO CANCELADO` a 450 com 100) e três vendas, cada uma com `criado_em` **explícito e no passado**, para não colidir com venda real da farmácia no mesmo dia:

```sql
-- v_s_noite: 2x PRODUTO NOITE (900), dinheiro 1000
update vendas set criado_em = timestamptz '2026-01-16 01:00:00+00' where id = v_s_noite;  -- 22h de 15/01 em SP
-- v_s_hoje: 1x PRODUTO HOJE (500), dinheiro 1000
update vendas set criado_em = timestamptz '2026-01-16 13:00:00+00' where id = v_s_hoje;   -- 10h de 16/01 em SP
-- v_s_cancel: 1x PRODUTO CANCELADO (300), dinheiro 1000, cancelada com o caixa aberto
update vendas set criado_em = timestamptz '2026-01-17 14:00:00+00' where id = v_s_cancel;  -- 11h de 17/01 em SP
perform cancelar_venda(v_s_cancel, 'cliente desistiu');
```

As asserções, uma `perform teste_ok(...)` por linha (todas filtram por `venda_id` ou por um dia de janeiro, nunca contam a tabela inteira — a suíte roda contra o banco de produção):

```sql
perform teste_ok((select count(*) = 1 from v_vendas_historico where venda_id = v_s_cancel),
  'caso 1: a venda cancelada aparece em v_vendas_historico');
perform teste_ok((select count(*) = 1 from v_vendas_historico where venda_id = v_s_hoje),
  'caso 1: a venda concluida aparece em v_vendas_historico');

perform teste_ok((select status = 'cancelada'
                    and motivo_cancelamento = 'cliente desistiu'
                    and cancelado_por_nome = 'historico@farmacia.local'
                    and cancelado_em is not null
                    and total = 300
                    and itens = '1x PRODUTO CANCELADO'
                  from v_vendas_historico where venda_id = v_s_cancel),
  'caso 2: a cancelada vem com status, motivo, quem cancelou e o que foi vendido');

perform teste_ok((select count(*) = 0 from v_vendas_lista where venda_id = v_s_cancel),
  'caso 3: a cancelada nao aparece em v_vendas_lista');
perform teste_ok((select coalesce(sum(total), 0) = 0 from v_vendas_dia where dia = date '2026-01-17'),
  'caso 3: o dia da cancelada fica zerado em v_vendas_dia');

perform teste_ok((select dia = date '2026-01-15' and criado_em::time = time '22:00'
                  from v_vendas_historico where venda_id = v_s_noite),
  'caso 4: a venda das 22h de 15/01 tem dia 2026-01-15 e hora 22:00');
perform teste_ok((select coalesce(sum(total), 0) = 900 from v_vendas_dia where dia = date '2026-01-15'),
  'caso 4: o total do dia 15/01 e o dela');

perform teste_ok((select count(*) = 0 from v_vendas_historico where dia = date '2026-01-14'),
  'caso 5: um dia sem venda nao devolve linha');
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:sql -- 080_historico.sql`
Expected: `FALHOU 080_historico.sql: ... relation "v_vendas_historico" does not exist` e `0 OK, 1 FALHOU`.

- [ ] **Step 3: Escrever a migration**

Em `supabase/migrations/012_historico_vendas.sql`, a view (o comentário do topo explica por que ela não filtra status e por que `v_vendas_lista` fica intacta):

```sql
create or replace view v_vendas_historico as
select v.id                                                        as venda_id,
       v.numero,
       (v.criado_em at time zone 'America/Sao_Paulo')::date        as dia,
       (v.criado_em at time zone 'America/Sao_Paulo')              as criado_em,
       v.cliente_id,
       c.nome                                                      as cliente_nome,
       v.subtotal,
       v.desconto,
       v.total,
       v.troco,
       (select string_agg(i.quantidade || 'x ' || i.nome_produto, ', ' order by i.nome_produto)
          from venda_itens i where i.venda_id = v.id)              as itens,
       (select string_agg(distinct p.forma, ', ')
          from venda_pagamentos p where p.venda_id = v.id)         as formas,
       v.status,
       (v.cancelado_em at time zone 'America/Sao_Paulo')           as cancelado_em,
       (select pr.nome from perfis pr where pr.id = v.cancelado_por) as cancelado_por_nome,
       v.motivo_cancelamento
from vendas v
left join clientes c on c.id = v.cliente_id;
```

Nada de índice novo: a tabela `vendas` de uma farmácia é pequena e o índice de expressão não se paga.

- [ ] **Step 4: Aplicar a migration**

Run: `npm run migrar -- 012_historico_vendas.sql`
Expected: `OK    012_historico_vendas.sql (... chars, HTTP 201)` e `1 de 1 migrations aplicadas`, exit 0.

- [ ] **Step 5: Rodar o caso e ver passar**

Run: `npm run test:sql -- 080_historico.sql`
Expected: 8 linhas `OK  caso ...` e `8 OK, 0 FALHOU de 1 arquivos`, exit 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/012_historico_vendas.sql tests/sql/casos/080_historico.sql
git commit -m "migration 012: v_vendas_historico mostra a cancelada com motivo e o dia de Sao Paulo"
```

---

### Task 2: `app/(app)/vendas/dia.ts` — as contas de data e o resumo, puras

**Files:**
- Create: `app/(app)/vendas/dia.ts`
- Test: `app/(app)/vendas/dia.test.ts`

**Interfaces:**
- **Produces** (tudo função pura, sem `import` de Supabase nem de React):
  - `validarDia(texto: string | undefined, hoje: string): { dia: string; aviso: boolean }`
  - `diaAnterior(dia: string): string`
  - `diaSeguinte(dia: string): string`
  - `rotuloDoDia(dia: string, hoje: string): string` — `'Hoje'`, `'Ontem'` ou `'DD/MM/AAAA'`
  - `horaDe(semFuso: string): string` — `'HH:MM'`
  - `dataHoraDe(semFuso: string): string` — `'DD/MM/AAAA HH:MM'`
  - `resumirCanceladas(vendas: { status: string; total: number }[]): { quantidade: number; total: number }`
  - `type VendaHistorico` — o formato da linha da view (usado pela Task 3): `venda_id: string; numero: number; dia: string; criado_em: string; cliente_id: string | null; cliente_nome: string | null; subtotal: number; desconto: number; total: number; troco: number; itens: string | null; formas: string | null; status: string; cancelado_em: string | null; cancelado_por_nome: string | null; motivo_cancelamento: string | null`
- **Consumes:** nada.

- [ ] **Step 1: Escrever os testes que falham**

Em `app/(app)/vendas/dia.test.ts` (Vitest, `import { describe, expect, it } from 'vitest'`):

```ts
const HOJE = '2026-10-07'

// validarDia: o endereco e entrada de usuario. Data torta cai em hoje COM aviso;
// sem parametro nao e erro — e so a tela abrindo no dia de hoje.
expect(validarDia('2026-01-15', HOJE)).toEqual({ dia: '2026-01-15', aviso: false })
expect(validarDia(undefined, HOJE)).toEqual({ dia: HOJE, aviso: false })
expect(validarDia('', HOJE)).toEqual({ dia: HOJE, aviso: false })
expect(validarDia('abc', HOJE)).toEqual({ dia: HOJE, aviso: true })
expect(validarDia('2026-1-5', HOJE)).toEqual({ dia: HOJE, aviso: true })      // sem zero a esquerda
expect(validarDia('2026-02-31', HOJE)).toEqual({ dia: HOJE, aviso: true })    // 31 de fevereiro nao existe
expect(validarDia('2026-13-01', HOJE)).toEqual({ dia: HOJE, aviso: true })

// virada de mes, ano e ano bissexto
expect(diaAnterior('2026-03-01')).toBe('2026-02-28')
expect(diaAnterior('2024-03-01')).toBe('2024-02-29')
expect(diaAnterior('2026-01-01')).toBe('2025-12-31')
expect(diaSeguinte('2026-12-31')).toBe('2027-01-01')

// rotulo: a tela diz "Hoje"/"Ontem" em vez de obrigar a comparar data
expect(rotuloDoDia('2026-10-07', HOJE)).toBe('Hoje')
expect(rotuloDoDia('2026-10-06', HOJE)).toBe('Ontem')
expect(rotuloDoDia('2026-01-15', HOJE)).toBe('15/01/2026')

// o PostgREST devolve timestamp sem fuso; aceitamos 'T' e espaco
expect(horaDe('2026-01-15T22:00:00')).toBe('22:00')
expect(horaDe('2026-01-15 22:00:00')).toBe('22:00')
expect(dataHoraDe('2026-01-15T22:00:00')).toBe('15/01/2026 22:00')

// a linha "Canceladas: N" da tela
expect(resumirCanceladas([])).toEqual({ quantidade: 0, total: 0 })
expect(
  resumirCanceladas([
    { status: 'cancelada', total: 300 },
    { status: 'concluida', total: 500 },
    { status: 'cancelada', total: 100 },
  ]),
).toEqual({ quantidade: 2, total: 400 })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -- dia.test.ts`
Expected: FAIL — `Failed to resolve import "./dia"` (o módulo ainda não existe).

- [ ] **Step 3: Implementar `dia.ts`**

Detalhes que a assinatura não decide:

- `validarDia`: aceita só `/^\d{4}-\d{2}-\d{2}$/` **e** confere que a data existe, com `const d = new Date(\`${texto}T00:00:00Z\`)` e `d.toISOString().slice(0, 10) === texto` (UTC para o fuso da máquina não entrar na conta). Texto vazio ou ausente → hoje, sem aviso.
- `diaAnterior`/`diaSeguinte`: `new Date(\`${dia}T00:00:00Z\`)` ± 1 dia, devolvido com `toISOString().slice(0, 10)`.
- `horaDe`/`dataHoraDe`: casam com `/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/` e montam a string — não usam `Date`, porque o texto não tem fuso e o `Intl` do navegador aplicaria o fuso dele.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -- dia.test.ts`
Expected: PASS, exit 0.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/vendas/dia.ts" "app/(app)/vendas/dia.test.ts"
git commit -m "vendas: contas de data do historico em modulo puro e testado"
```

---

### Task 3: `/vendas` — o dia no endereço, setas e a cancelada na lista

**Files:**
- Modify: `app/(app)/vendas/page.tsx` (reescrita; hoje é a casca da Task 12 do plano 2)

**Interfaces:**
- **Consumes:** `v_vendas_historico` e `v_vendas_dia` (Task 1); `validarDia`, `diaAnterior`, `diaSeguinte`, `rotuloDoDia`, `horaDe`, `resumirCanceladas`, `type VendaHistorico` (Task 2); `formatarMoeda` (`lib/format.ts`).
- **Produces:** rotas e identificadores que a Task 5 procura — endereço `/vendas?dia=YYYY-MM-DD&ocultar=1`, `data-testid` = `dia-anterior`, `dia-seguinte`, `dia-hoje`, `ocultar`, `aviso-dia`, `linha-venda`, `resumo-canceladas`, e `data-cancelada="1"` na linha cancelada (um elemento não pode ter dois `data-testid`); o `h1` é `Vendas — Hoje` / `Vendas — Ontem` / `Vendas — 15/01/2026`; cada linha é um link para `/vendas/<venda_id>?dia=<dia>&ocultar=1`.

- [ ] **Step 1: Reescrever a página**

Regras que a tela decide:

1. `searchParams` é `Promise<{ dia?: string; ocultar?: string }>`. `hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })` (como já está hoje). `const { dia, aviso } = validarDia(params.dia, hoje)`.
2. Duas consultas: `v_vendas_dia` com `.eq('dia', dia).maybeSingle()` (o resumo) e `v_vendas_historico` com `.eq('dia', dia).order('criado_em', { ascending: false }).limit(200)`.
3. Aviso de data torta, quando `aviso`: `<p data-testid="aviso-dia">Data inválida no endereço. Mostrando hoje.</p>`.
4. Navegação: `<Link data-testid="dia-anterior" href={comOcultar(`/vendas?dia=${diaAnterior(dia)}`)}>‹ Dia anterior</Link>`, o equivalente `dia-seguinte`, um `dia-hoje` para `/vendas`, e um `<form method="get">` com `<input type="date" name="dia" defaultValue={dia}>`, `<input type="hidden" name="ocultar" value={oculto ? '1' : ''}>` e botão **Ver**. `comOcultar` só acrescenta `&ocultar=1` quando `oculto` — é o que impede o valor de reaparecer ao trocar de dia.
5. Resumo do dia (três cartões, como hoje) + quando `resumirCanceladas(vendas).quantidade > 0`, a linha `data-testid="resumo-canceladas"` com `Canceladas: {n} · {valor(total)}` (valor ocultável).
6. Lista: cada venda é um `<Link>` com `data-testid="linha-venda"`; quando `status === 'cancelada'`, o **mesmo** elemento recebe `data-cancelada="1"` (não troque o `data-testid`: o e2e procura a linha pelos dois), fica em cinza com `line-through`, mostra a tarja **Cancelada** e o `motivo_cancelamento`.
7. Estado vazio só quando **não há nenhuma linha**: `Nenhuma venda em {rotulo}.` — um dia em que todas foram canceladas continua mostrando as vendas.
8. `valor(centavos)` continua sendo `oculto ? '••••' : formatarMoeda(centavos)`.

- [ ] **Step 2: Conferir que compila e que o lint passa**

Run: `npm run build`
Expected: exit 0, com `ƒ /vendas` na lista de rotas.
Run: `npm run lint`
Expected: exit 0, zero problemas.

- [ ] **Step 3: Conferir à mão no navegador (obrigatório: o e2e da Task 5 ainda não existe)**

Run: `npm run dev` (deixe em um terminal) e abra `http://localhost:3000/vendas?dia=2026-01-15`.
Expected: título `Vendas — 15/01/2026`, lista vazia (ou as vendas daquele dia) e, em `/vendas?dia=abc`, o aviso de data inválida com o dia de hoje.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/vendas/page.tsx"
git commit -m "historico: o dia no endereco, setas e a venda cancelada marcada na lista"
```

---

### Task 4: `/vendas/[id]` — a venda inteira e o cancelamento do dono

**Files:**
- Create: `app/(app)/vendas/[id]/page.tsx`
- Create: `app/(app)/vendas/[id]/tela.tsx`
- Create: `app/(app)/vendas/[id]/actions.ts`
- Create: `app/(app)/vendas/[id]/cancelamento.ts`
- Test: `app/(app)/vendas/[id]/cancelamento.test.ts`

**Interfaces:**
- **Produces:**
  - `validarMotivo(texto: string): { ok: true; motivo: string } | { ok: false; mensagem: string }`
  - `cancelarVenda(_anterior: Resultado | null, formData: FormData): Promise<Resultado>`, com `export type Resultado = { ok: true; mensagem: string } | { ok: false; mensagem: string }`
  - `TelaVenda` (client), com os textos que a Task 5 procura: `h1` `Venda {numero}`, `data-testid="status-venda"`, `data-testid="bloco-cancelada"`, `data-testid="itens"`, `data-testid="ok"` / `data-testid="erro"` no recado do resultado (o mesmo par de `caixa/tela.tsx`, com `role="status"` e `role="alert"`), botão **Confirmar cancelamento**, campo rotulado **Motivo do cancelamento**, link **Voltar para o dia**.
- **Consumes:** `v_vendas_historico` (Task 1); `horaDe`, `dataHoraDe`, `rotuloDoDia` (Task 2); `perfilAtual` (`lib/auth/perfil.ts`); `criarClienteServidor` (`lib/supabase/server.ts`); `formatarMoeda`; tabelas `venda_itens` (`nome_produto`, `quantidade`, `preco_unitario`, `total`) e `venda_pagamentos` (`forma`, `valor`).

- [ ] **Step 1: Escrever os testes do motivo (falham)**

Em `app/(app)/vendas/[id]/cancelamento.test.ts`:

```ts
expect(validarMotivo('')).toEqual({ ok: false, mensagem: 'Escreva o motivo do cancelamento.' })
expect(validarMotivo('   ')).toEqual({ ok: false, mensagem: 'Escreva o motivo do cancelamento.' })
expect(validarMotivo('ab')).toEqual({ ok: false, mensagem: 'Motivo muito curto: escreva pelo menos 3 letras.' })
expect(validarMotivo('cliente desistiu')).toEqual({ ok: true, motivo: 'cliente desistiu' })
expect(validarMotivo('  cliente desistiu  ')).toEqual({ ok: true, motivo: 'cliente desistiu' })
expect(validarMotivo('a'.repeat(201))).toEqual({ ok: false, mensagem: 'Motivo muito longo: no máximo 200 letras.' })
```

Run: `npm test -- cancelamento.test.ts` → Expected: FAIL (módulo não existe).

- [ ] **Step 2: Implementar `cancelamento.ts` e passar**

`validarMotivo` faz `trim()` e devolve o motivo **já sem espaços nas pontas** (é ele que vai para o banco).
Run: `npm test -- cancelamento.test.ts` → Expected: PASS.

- [ ] **Step 3: Escrever a action `cancelarVenda`**

Espelha `app/(app)/caixa/actions.ts`: `perfilAtual()` → sem perfil, `'Usuário sem perfil cadastrado. Fale com o responsável.'`; `validarMotivo(String(formData.get('motivo') ?? ''))`; `p_venda_id` vem de `String(formData.get('venda_id') ?? '')`; `supabase.rpc('cancelar_venda', { p_venda_id, p_motivo })`; em erro devolve `error.message` cru (já é português: "Só o dono pode cancelar vendas.", "Venda do dia 05/10 com caixa já fechado. ..."); em sucesso `revalidatePath('/vendas')`, `revalidatePath(\`/vendas/${venda_id}\`)` e `{ ok: true, mensagem: 'Venda cancelada. O estoque voltou.' }`.

- [ ] **Step 4: Escrever a página e a tela**

`page.tsx` (server): `params` e `searchParams` são `Promise` no Next 16. Lê `v_vendas_historico` com `.eq('venda_id', id).maybeSingle()`; se não vier linha, `notFound()`. Lê `venda_itens` (`.eq('venda_id', id).order('nome_produto')`) e `venda_pagamentos` (`.eq('venda_id', id)`), e `perfilAtual()` para `ehDono`.

`tela.tsx` (client, `'use client'` + `useActionState`): mostra número, `dataHoraDe(criado_em)`, cliente (ou "sem cliente"), as formas de pagamento, a tabela de itens (quantidade, nome, unitário, total), desconto, troco e total — valores ocultáveis por `ocultar`, recebido como prop e propagado no link **Voltar para o dia** (`/vendas?dia=${dia}&ocultar=1`). Se `status === 'cancelada'`: faixa cinza `data-testid="bloco-cancelada"` com `Cancelada em {dataHoraDe(cancelado_em)} por {cancelado_por_nome}: {motivo_cancelamento}` e **nenhum** formulário. Se concluída e `ehDono`: formulário com `venda_id` escondido, o motivo e **Confirmar cancelamento**; se concluída e não for dono: `Cancelamento é só do dono.`

- [ ] **Step 5: Verificar compilação e lint**

Run: `npm run build` → Expected: exit 0, com `ƒ /vendas/[id]`.
Run: `npm run lint` → Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/vendas/[id]"
git commit -m "detalhe da venda: itens, pagamentos e o cancelamento pelo caminho do dono"
```

---

### Task 5: e2e do histórico (`tests/e2e/historico.spec.ts`)

**Files:**
- Create: `tests/e2e/historico.spec.ts`
- Modify: `tests/e2e/global-setup.mjs` (só se for preciso mais um produto — não deve ser: o cenário atual já tem estoque 20 e caixa aberto no terminal `e2e`)

**Interfaces:**
- **Consumes:** tudo das Tasks 3 e 4 (`data-testid`, endereços, rótulos); `PRODUTO_E2E` = `PRODUTO E2E PARACETAMOL`, `CODIGO_E2E` = `999000111`, preço 500, estoque 20 (repetidos no arquivo, como em `venda.spec.ts` — o globalSetup é `.mjs` e o spec é CommonJS: `import` entre os dois falha).
- **Produces:** nada que outra tarefa use.

- [ ] **Step 1: Escrever o spec**

Cabeçalho igual ao de `venda.spec.ts`: `process.loadEnvFile(...)` do `.env.local`, `EMAIL`/`SENHA`, `async function entrar(page)`, `test.beforeEach`, e — porque o spec **não pode** importar o `.mjs` — uma cópia local de `consultar(query)` (o mesmo `fetch` em `POST https://api.supabase.com/v1/projects/<ref>/database/query` com `SUPABASE_ACCESS_TOKEN`) mais as constantes de `PRODUTO_E2E`, `CODIGO_E2E` e do produto de estoque.

Seis testes:

```ts
// (1) navegar no tempo. `?dia=abc` e data torta: cai em hoje com aviso, sem 500.
await page.goto('/vendas?dia=abc')
await expect(page.getByTestId('aviso-dia')).toBeVisible()
await page.goto('/vendas')
await expect(page.getByRole('heading', { name: 'Vendas — Hoje' })).toBeVisible()
await page.getByTestId('dia-anterior').click()
await expect(page.getByRole('heading', { name: 'Vendas — Ontem' })).toBeVisible()
await page.getByTestId('dia-hoje').click()
await expect(page.getByRole('heading', { name: 'Vendas — Hoje' })).toBeVisible()

// (2) venda do PDV -> aparece no historico -> o detalhe mostra item e total.
//     A venda e de R$ 5,00: PRODUTO_E2E por CODIGO_E2E, F6 (dinheiro),
//     Valor do pagamento 10,00, Lancar, F2, confirmacao "registrada".
await page.goto('/vendas')
const linha = page.getByTestId('linha-venda').filter({ hasText: PRODUTO_E2E }).first()
await linha.click()
await expect(page.getByRole('heading', { name: /^Venda \d+$/ })).toBeVisible()
await expect(page.getByTestId('itens')).toContainText(PRODUTO_E2E)
await expect(page.getByTestId('itens')).toContainText('R$ 5,00')

// (3) cancelar com motivo: a lista marca, o detalhe conta a historia e o
//     estoque volta a 20 — lido na TELA do produto, nao no banco.
//     Detalhe: <dt>Estoque</dt><dd>20</dd> (produtos/[id]/page.tsx).
await page.getByLabel('Motivo do cancelamento').fill('cliente desistiu')
await page.getByRole('button', { name: 'Confirmar cancelamento' }).click()
await expect(page.getByTestId('ok')).toContainText('Venda cancelada')
await expect(page.getByTestId('bloco-cancelada')).toContainText('cliente desistiu')
await page.goto('/vendas')
await expect(page.locator('[data-cancelada="1"]').filter({ hasText: PRODUTO_E2E })
  .first()).toContainText('Cancelada')
const id = (await consultar(`select id from produtos where nome = '${PRODUTO_E2E}'`))[0].id
await page.goto(`/produtos/${id}`)
const blocoEstoque = page.locator('dl > div').filter({ has: page.locator('dt', { hasText: /^Estoque$/ }) })
await expect(blocoEstoque.locator('dd')).toHaveText('20')

// (4) cancelar sem motivo e bloqueado (nada muda no banco). Venda NOVA, feita
//     aqui como no teste (2): a do teste (3) ja esta cancelada.
await page.getByLabel('Motivo do cancelamento').fill('')
await page.getByRole('button', { name: 'Confirmar cancelamento' }).click()
await expect(page.getByTestId('erro')).toContainText('Escreva o motivo do cancelamento.')

// (5) ocultar valores sobrevive a navegacao: nenhum "R$ " na lista nem no detalhe.
await page.goto('/vendas?ocultar=1')
await expect(page.getByTestId('linha-venda').first()).toContainText('••••')
await page.getByTestId('linha-venda').first().click()
await expect(page).toHaveURL(/ocultar=1/)
await expect(page.locator('body')).not.toContainText('R$')
```

Mais um teste, o do critério da Etapa 5 — **venda noturna no dia certo** —, com a venda inserida direto no banco (como o `global-setup` já faz com o caixa), porque não há como fazer o PDV gravar às 22h de ontem:

```ts
// (6) venda das 22h de ontem (horario de Sao Paulo) aparece em ONTEM e nao em HOJE.
const id = (await consultar(`select id from produtos where nome = '${PRODUTO_E2E}'`))[0].id
const sessao = (await consultar(`select id from caixa_sessoes where terminal = 'e2e' and status = 'aberto'`))[0].id
// O `at time zone 'America/Sao_Paulo'` NAO pode faltar: o timestamp montado e
// sem fuso, e o Postgres o interpretaria no fuso do servidor (UTC) — 22:00 UTC e
// 19:00 em SP, que ainda e "ontem", e o teste passaria pelo motivo errado.
const linhas = await consultar(`
  insert into vendas (chave_idempotencia, caixa_sessao_id, usuario_id, subtotal, total, valor_pago,
                      criado_em)
  values (gen_random_uuid(), '${sessao}',
          (select id from perfis where papel = 'dono' order by criado_em limit 1),
          500, 500, 500,
          ((((now() at time zone 'America/Sao_Paulo')::date - 1) + time '22:00')
             at time zone 'America/Sao_Paulo'))
  returning numero
`)
const numeroNoturno = linhas[0].numero
```

Depois: `await page.goto('/vendas')` e `await expect(page.getByTestId('linha-venda').filter({ hasText: \`Venda ${numeroNoturno} ·\` })).toHaveCount(0)`; `await page.getByTestId('dia-anterior').click()` e o mesmo filtro passa a `toHaveCount(1)`. O teardown já apaga as vendas da sessão e2e (`tests/e2e/global-teardown.mjs` → `limpar()`), então esta venda some no fim da suíte.

- [ ] **Step 2: Rodar a suíte e ver passar**

Run: `npm run test:e2e`
Expected: **14 passed** (os 8 de hoje + os 6 novos), exit 0. Se algo falhar por causa do cenário, corrija o **teste**, não o produto: o cenário é do `global-setup`.

- [ ] **Step 3: Rodar a suíte SQL inteira (o e2e precisa ter limpado o caixa)**

Run: `npm run test:sql`
Expected: `245 OK, 0 FALHOU de 9 arquivos` (237 + os 8 novos), exit 0. **Se der "Já existe um caixa aberto", o teardown não rodou** — confira `select count(*) from caixa_sessoes where status = 'aberto'` antes de culpar o teste.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/historico.spec.ts
git commit -m "e2e do historico: navegar no tempo, detalhe, cancelamento e a venda noturna no dia certo"
```

---

### Task 6: Fechar a Etapa 5 no `PROGRESSO.md`

**Files:**
- Modify: `PROGRESSO.md` (cabeçalho "ONDE PARAMOS", linha da Etapa 5 na tabela de Etapas)

**Interfaces:**
- **Consumes:** os números das Tasks 1–5.
- **Produces:** nada.

- [ ] **Step 1: Rodar tudo, em sequência, sem nada em paralelo**

```bash
npm test
npm run test:sql
npm run lint
npm run build
npm run test:e2e
```

Cole o resultado de cada um na tabela de evidência do `PROGRESSO.md` (a regra do arquivo: **etapa só vira ✅ com a evidência colada**).

- [ ] **Step 2: Atualizar o `PROGRESSO.md`**

Etapa 5 na tabela de Etapas: status ✅ e, na coluna de evidência, a contagem de testes SQL/unitários/e2e e os hashes dos commits; o cabeçalho "ONDE PARAMOS" passa a apontar a Etapa 6 (clientes e crediário) como a próxima, com o `HEAD` novo. Se algum item do "Review Focus" deste plano não tiver virado teste, escreva isso no arquivo em vez de esconder.

- [ ] **Step 3: Commit**

```bash
git add PROGRESSO.md
git commit -m "etapa-5: historico de vendas fechado, com a evidencia colada"
```

---

## Self-Review deste plano

- **Cobertura da spec:** §6 (`v_vendas_historico` na Task 1, `v_vendas_lista` intacta), §8.2 (Task 4 usa a RPC como ela está; o botão só aparece para o dono), §9 (mensagens das Tasks 2–4), §10 (dia, ocultar valores e uma tarefa por tela nas Tasks 3–4), §13 Etapa 5 (critério e evidência nas Tasks 5–6).
- **Escopo:** uma etapa, um plano. `v_vendas_dia` já existia; nada de relatório de período (Etapa 7).
- **Tipos:** `VendaHistorico` (Task 2) é o formato que as Tasks 3 e 4 consomem; `Resultado` é o mesmo tipo de `caixa/actions.ts`; `validarMotivo` é usado só pela Task 4.
- **Proporção:** o plano descreve decisões (nomes, testids, assertions, datas isoladas dos testes), não transcreve os componentes.
