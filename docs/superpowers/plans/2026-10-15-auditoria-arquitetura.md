# Auditoria da arquitetura atual — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 2–8 rodam **em paralelo**;
> a 9 e a 10 só começam quando todas terminarem. Tarefas 2–7 e 9–11 são de **leitura apenas**.

**Goal:** Produzir `docs/auditoria-arquitetura-2026-10-15.md` — mapa da arquitetura real, fluxos críticos
rastreados do clique à migration, riscos em P0–P3 com evidência, pontos de extensão da v2, resultado real
da verificação executável e veredito das 5 perguntas de decisão.

**Architecture:** Sete coletores paralelos, cada um com um recorte fechado, devolvendo **fatos com
`arquivo:linha`** em vez de prosa. Eu confiro cada evidência citada antes de escrever: o que não for
confirmável vira hipótese, em seção separada. A redação é minha, em contexto único, para o documento ter
uma voz só.

**Tech Stack:** Node 24.20.0, npm 11.19.0, Next.js 16.3.8 (App Router), TypeScript 5.9.3, React 19.2.8,
Supabase (Postgres + Auth), Tailwind 4.3.3, Vitest 5.0.3, Playwright 1.63.0 (não executável aqui).

**Spec:** `docs/superpowers/specs/2026-10-15-auditoria-arquitetura-design.md`

**Baseline:** commit `c140fa4` — o repositório clonado em 15/10/2026, sem `node_modules` e sem `.env.local`.

## Global Constraints

- **Nada de código é alterado.** Auditoria descreve e prioriza; conserto vira item de backlog. Exceção
  única: `npm ci`, que só cria `node_modules/` (ignorado pelo git).
- **Regra de evidência.** Todo achado carrega `arquivo:linha` **ou** nome de migration, mais o comando ou a
  leitura que o provou. Achado sem prova vai para a seção de **hipóteses**, com o que falta para confirmar.
- **Eu confirmo a evidência.** Relato de coletor não entra na seção de riscos sem eu ter aberto o arquivo
  citado e visto a linha.
- **Escala P0–P3**, por dano e nunca por facilidade: **P0** risco financeiro ou perda de dado em uso normal;
  **P1** trava a operação diária; **P2** dívida que encara a próxima mudança; **P3** ergonomia e estética.
- **Nada de banco remoto.** Nenhuma migration é aplicada, nenhum SQL de escrita roda, nenhuma chave é
  criada. RLS e policy são **lidas**, e todo achado dessa classe é marcado com a origem "leitura de SQL".
- **Limitação declarada na cara do documento:** `test:sql`, `test:sql:concorrencia` e `test:e2e` **não
  rodam** — falta `.env.local`. Isso aparece na seção 7 como não executado, nunca como "passou".
- **Tudo em português**, valores em R$, datas `dd/mm/aaaa`, como manda a regra 4 do plano original.
- **Documento curto por seção.** A seção 1 (mapa) cabe em uma página. O resto é tabela e lista curta — quem
  lê tem TDAH (regra 9 do plano original).

## Prompt padrão do coletor (usar verbatim, trocando o recorte)

```
Você audita o repositório em C:\Users\lucas\OneDrive\Documentos\PROJETOS\farmapdv01 (Next.js 16 + Supabase,
sistema de gestão de farmácia). Baseline: commit c140fa4.

Leia APENAS este recorte: <RECORTE>.

Devolva, em português e sem prosa introdutória:
1. FLUXO — o caminho que o fluxo percorre, passo a passo, cada passo com arquivo:linha ou nome da migration.
2. DECISÕES — regras de negócio que o código impõe e que não estão escritas na spec
   (docs/superpowers/specs/2026-10-15-auditoria-arquitetura-design.md lista as specs existentes).
3. RISCOS CANDIDATOS — cada um com: o que é, arquivo:linha, impacto (financeiro / dado / operação),
   e o gatilho que o dispara. Sem recomendação de conserto nesta fase.
4. PONTOS DE EXTENSÃO — onde um módulo novo (fiscal, SNGPC, multi-loja, app do cliente) se plugaria, e o
   que já existe para isso.
5. NÃO CONSEGUI VERIFICAR — o que ficou em dúvida e o que seria preciso para confirmar.

REGRA: não altere nenhum arquivo. Não rode comando que escreva. Não execute SQL contra banco remoto.
Toda afirmação precisa de arquivo:linha. Se não tiver, diga explicitamente que é hipótese.
```

---

### Task 1: Baseline e ambiente

**Files:**
- Read: `package.json`, `PROGRESSO.md` (seção "Versões travadas"), `git log -1`
- Create: `node_modules/` (por `npm ci`; ignorado pelo git)

- [ ] Confirmar o baseline: `git -C <repo> log --oneline -1` devolve `c140fa4`.
- [ ] Rodar `npm ci` na raiz. Se o npm 11 bloquear install script, registrar a saída literal — o
      `postinstall` do `unrs-resolver` já foi bloqueado antes e lint/build passam assim mesmo.
- [ ] Registrar as versões efetivas de Node e npm, e conferir contra a tabela do `PROGRESSO.md`.
- [ ] **Prova de limpeza:** `git status --short` não pode mostrar nada além de `node_modules/` ignorado.

---

### Task 2: Coletor F1 — PDV e venda

**Recorte:** `app/(app)/vendas/` (lista, `nova/`, `[id]/`), `lib/dinheiro.ts`, `lib/dinheiro.test.ts`,
`supabase/migrations/002_registrar_venda.sql`, `003_cancelar_venda.sql`, `012_historico_vendas.sql`,
`020_fechar_custo_venda.sql`.

- [ ] Rodar o prompt padrão com o recorte acima.
- [ ] Responder em especial: **onde o dinheiro vira inteiro e onde ele poderia virar float**; o que a RPC
      `registrar_venda` faz em transação única; o que acontece se ela falhar no meio (venda pela metade?).
- [ ] Rastrear o cancelamento (`003`) ponta a ponta: estoque volta? caixa é afetado? crediário é afetado?

### Task 3: Coletor F2 — Caixa

**Recorte:** `app/(app)/caixa/`, `supabase/migrations/004_caixa.sql`, `018_fechamento_atendente.sql`.

- [ ] Rodar o prompt padrão com o recorte acima.
- [ ] Responder em especial: o que o fechamento **calcula** e o que ele **congela**; o que acontece se dois
      atendentes fecharem ao mesmo tempo; se existe diferença entre caixa por atendente e caixa da loja.

### Task 4: Coletor F3 — Clientes e crediário

**Recorte:** `app/(app)/clientes/` (inclui `importar/`, `novo/`, `[id]/`), `app/(app)/crediario/`,
`supabase/migrations/014_receber_pagamento.sql`, `015_clientes.sql`, `app/api/clientes/`.

- [ ] Rodar o prompt padrão com o recorte acima.
- [ ] Responder em especial: como a dívida é calculada (view, soma, saldo); se pagamento parcial é
      suportado; o que impede a mesma venda de ser baixada duas vezes (idempotência); qual o risco de
      saldo divergente entre a view e a soma dos pagamentos.

### Task 5: Coletor F4 — Relatórios, views e RLS

**Recorte:** `supabase/migrations/005_views.sql`, `013_seguranca_views.sql`, `016_relatorios.sql`,
`019_margem_produtos.sql`, `app/(app)/relatorios/`, e **todas** as policies `create policy` das 20 migrations.

- [ ] Rodar o prompt padrão com o recorte acima.
- [ ] Produzir **inventário de RLS**: por tabela — RLS ligado? policies existentes? quem (papel) lê o quê?
      Tabela sem RLS ou policy permissiva demais é achado P0 ou P1, com a linha exata.
- [ ] Marcar cada achado com a origem: **leitura de SQL** — nada aqui foi executado contra banco.
- [ ] Listar as views e funções existentes com papel exigido, e apontar quais **vazam custo** para
      `authenticated` (o precedente conhecido: `venda_itens.preco_custo`).

### Task 6: Coletor F5 — Agente

**Recorte:** `lib/agente/` (inclui `deepseek.ts`), `app/api/agente/`, `app/(app)/agente/`,
`supabase/migrations/017_orcamento_agente.sql`, e as 3 specs do agente em `docs/superpowers/specs/`.

- [ ] Rodar o prompt padrão com o recorte acima.
- [ ] Responder em especial: quantas **chamadas ao modelo** por pergunta hoje; se o modelo **escreve número**
      em algum caminho (a propriedade que o projeto inteiro sustenta é que não escreve — verificar, não
      assumir); como o orçamento é reservado e reconciliado; o que estoura primeiro entre o teto de custo e
      o limite de 10 s, se o número de especialistas crescer.

### Task 7: Coletor F7 — Produtos, estoque e importação (cobertura fina)

**Recorte:** `app/(app)/produtos/`, `app/(app)/estoque/`, `app/api/produtos/`,
`supabase/migrations/006_produtos.sql`, `007_estoque.sql`, `008_importacao.sql`,
`009_importacao_precos.sql`, `010_importacao_timeout.sql`, `011_estoque_informativo.sql`,
`lib/csv.ts`, `lib/xlsx.ts`.

- [ ] Rodar o prompt padrão com o recorte acima.
- [ ] Cobertura **fina**: este fluxo entra no mapa e nos pontos de extensão, mas não gera lista longa de
      risco. Registrar só o que for P0/P1 e por quê.
- [ ] Responder em especial: por que `010_importacao_timeout` existe (que dor real ela resolve); o que
      acontece com planilha grande, linha duplicada e código de barras repetido.

### Task 8: Coletor F6 — Verificação executável (dona da seção 7)

**Depende de:** Task 1 (`npm ci` concluído).

- [ ] Rodar, nesta ordem, colando a saída real de cada um:
      `npm run lint` · `npm run build` · `npm test`
- [ ] Registrar a contagem de testes (arquivos e casos) e o tempo de cada comando.
- [ ] Registrar como **não executado**, com o motivo: `npm run test:sql`, `npm run test:sql:concorrencia`,
      `npm run test:e2e`.
- [ ] Inventariar a suíte por área (`tests/`): quantos casos cobrem venda, caixa, crediário, relatórios,
      agente — e **onde não há teste nenhum**. Ausência de teste em caminho que mexe com dinheiro é achado.

---

### Task 9: Consolidação — mapa, arquitetura implícita, dívida

**Depende de:** Tasks 2–8.

- [ ] Escrever a **seção 1 (mapa em uma página)**: as 4 camadas e quem chama quem. Cabe em uma página.
- [ ] Escrever as **seções 2 e 3**: fluxos críticos rastreados e onde o dinheiro é decidido.
- [ ] Escrever a **seção 4**: riscos em P0–P3, cada linha com impacto, evidência e recomendação.
      **Antes de escrever cada linha, abrir o arquivo citado e conferir a linha.**
- [ ] Escrever a **seção 5**: arquitetura implícita — o que o código decidiu e nenhuma das 5 specs registra.
- [ ] Escrever a **seção 6**: pontos de extensão por módulo da v2 (fiscal, SNGPC, multi-loja, app cliente).
- [ ] Montar a **seção de hipóteses** com o que não deu para provar, separada da seção 4.

### Task 10: As 5 perguntas de decisão

**Depende de:** Task 9.

- [ ] Responder, uma por vez, com veredito e o que falta para destravar:
      1. **Dá para aposentar o Nex hoje?** 2. **O agente em grafo escala?**
      3. **Multi-loja exige reescrita?** 4. **Onde estão os pontos únicos de falha financeira?**
      5. **Importação aguenta uso real?**
- [ ] Cada veredito aponta para a seção que o sustenta. Nenhuma resposta por intuição.

### Task 11: Aceite e commit

- [ ] Conferir os 6 critérios de aceite da spec, um por um, e marcar cada um.
- [ ] **Prova de que só o documento mudou:** `git status --short` não pode listar nenhum arquivo do
      projeto alterado além de `docs/auditoria-arquitetura-2026-10-15.md`.
- [ ] Commit do plano e do documento na `main` local (a identidade do repo já está configurada:
      `Lucas <lucasam87@users.noreply.github.com>`). **Não fazer push.**

## Ordem de execução

```
Task 1 (ambiente)  ──┬── Tasks 2,3,4,5,6,7 (coletores, paralelos)
                     └── Task 8 (verificação)      ──┬── Task 9 ── Task 10 ── Task 11
```
