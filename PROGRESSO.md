# PROGRESSO — Sistema de Gestão para Farmácia

Este arquivo é o registro de andamento. **Regra: uma etapa só vira ✅ com a
evidência colada** (o comando que rodou e o resultado que apareceu). Sem
evidência, fica 🟡.

Legenda: ⬜ pendente · 🟡 em andamento · ✅ concluída com evidência · ⛔ bloqueada

---

# ⏸ ONDE PARAMOS — 07/10/2026

**Branch:** `etapa-3-4-produtos-estoque-pdv`, HEAD `0821d0f` (o remoto está em `b76ab36`).
**Etapas 0, 1, 2 e 4 fechadas. A Etapa 3 está 🟡** — ver a linha dela na tabela de Etapas.
**As 15 tarefas do plano 2 (0 a 14) estão executadas**, mas a **revisão final do branch deu
"No"**: 1 Critical + 7 Important, listados abaixo. O plano está executado; o código ainda
não está pronto para merge.

**A revisão final do branch** (contexto limpo, range `9f0c524..3165750`) encontrou um
Critical que **derruba a evidência de aceite da Etapa 3**: em `lib/tabela.ts:175` e `:181`,
`somaGravada` e `somaPlanilha` somam a **mesma** variável pelo **mesmo** `parsearCentavos`.
As duas somas são idênticas por construção, então a tarja "As somas não batem — confira o
separador decimal" é código morto e a conferência contra erro de fator 100 que a spec §8.7
exige **não existe**. Isso também é defeito do plano (linha 701), que descreve a comparação
de forma autocontraditória e foi seguido à risca. Ver "O que falta, exatamente".

**O plano 2 está 100% executado: as 15 tarefas (0 a 14).** As duas últimas:

- **Tarefa 13 (Playwright)** ✅ — `de84f3b`, `52f781b` e `0821d0f`. A revisão mostrou que o
  teste de teclado clicava duas vezes e o comentário prometia uma cobertura que não existia;
  corrigido em `0821d0f` (busca por código de barras com setas + Enter, "Lançar" com Tab +
  Enter, nenhum clique) e **provado por mutação**: desligando o `Enter` da busca, o teste
  falha.
- **Tarefa 14 (PDF)** ✅ — `3165750`. **A importação de PDF NÃO entra na tela**, e a
  decisão foi medida, não suposta: o relatório real do sistema antigo **não tem linha de
  TOTAL impressa**, então o critério de aceite ("soma extraída == total impresso no PDF")
  não tem contra o que conferir. Sem conferência não se importa preço de medicamento
  (spec §1). A tela continua aceitando só `.xlsx` e `.csv`.

**Estado verificado no fim da sessão:**

| Comando | Resultado |
|---|---|
| `npm test` | **131 passed** (10 arquivos), exit 0 |
| `npm run test:sql` | **224 OK, 0 FALHOU de 8 arquivos**, exit 0 |
| `npm run test:sql:concorrencia` | **17 OK, 0 FALHOU**, exit 0 |
| `npm run test:e2e` | **4 passed (25,4 s)**, exit 0 — rodado 4 vezes na sessão, sempre 4 passed. O teste de teclado foi provado por mutação (desligando o `Enter` da busca, ele falha) |
| `npm run build` | exit 0, com `/produtos`, `/produtos/[id]`, `/produtos/novo`, `/produtos/importar`, `/estoque`, `/vendas`, `/vendas/nova` e `/api/produtos/busca` |
| `npm run lint` | ⛔ **exit 1** — 2 erros `react-hooks/set-state-in-effect` em `app/(app)/vendas/nova/pdv.tsx:60` e `:69`, mais 3 avisos (2 deles em `.superpowers/**`, e `fs` não usado em `tests/sql/concorrencia.mjs`). **Pendência aberta** — ver abaixo |

**Os testes e2e e SQL não se atropelam mais (era um defeito real):** a suíte e2e abre um
caixa no terminal `e2e` e, até `52f781b`, **deixava a sessão aberta no banco**. Com isso
`npm run test:sql` caía de 224 OK para **126 OK / 4 FALHOU** — "Já existe um caixa aberto."
em `030_caixa`, `040_views` e `050_permissoes`, e "caso 6: venda sem caixa aberto e
recusada — nenhuma excecao foi levantada" em `010_venda`. Agora existe
`tests/e2e/global-teardown.mjs`, chamado pelo `globalTeardown` do `playwright.config.ts`.
Conferido no banco depois da suíte: `caixas_abertos = 0`, `produtos_e2e = 0`,
`clientes_e2e = 0`, `vendas = 0`.

**O que falta, exatamente:**

1. **A revisão final do branch deu "No" (não mergear como está): 1 Critical + 7 Important.**
   O veredito completo está no ledger (`Fechamento: REVISAO FINAL do branch`). Os itens
   estão listados abaixo por gravidade, e o primeiro é o motivo de a Etapa 3 ter voltado
   para 🟡.
2. **Empurrar a branch** de novo depois de qualquer correção:
   `git push -u origin etapa-3-4-produtos-estoque-pdv` (hoje o remoto está em `b76ab36` e
   o local em `0821d0f` — o commit `0821d0f` ainda **não** subiu).
3. **Lint vermelho** — 2 erros reais em `pdv.tsx` (Tarefa 11); o ESLint também lê
   `.superpowers/**`, que é rascunho git-ignored (ruído a ignorar na config).

**Os defeitos da revisão, em ordem de gravidade:**

| # | Grau | O que é | Onde |
|---|---|---|---|
| 1 | **Critical** | `somaPlanilha` e `somaGravada` somam a **mesma** variável pelo mesmo `parsearCentavos`: as duas somas são **sempre iguais**, a tarja "As somas não batem" é código morto e a conferência contra fator 100 da spec §8.7 **não existe**. Conserto indicado: comparar com o TOTAL impresso no rodapé da própria planilha (o `ehRodape` já o identifica e hoje o descarta) — o mesmo critério que a Tarefa 14 usou no PDF, e a fixture `produtos_texto.xlsx` já tem rodapé | `lib/tabela.ts:175,181`; `formulario.tsx:35,97-101` |
| 2 | Important | O checkbox "Atualizar produtos que já existem" é **inerte**: desmarcar não muda nada, porque o form de confirmação manda `atualizar=sim` fixo. E a prévia não mostra **quantos** existentes serão atualizados, como o ruling prometia | `formulario.tsx:60` vs `:171`; `actions.ts:143` |
| 3 | Important | O PDV lê dinheiro digitado com parser próprio que diverge do `parsearCentavos` por **fator 100**: `"20.00"` é R$ 2.000,00 no balcão e R$ 20,00 na importação | `pdv.tsx:119`; `pagamento.ts:74` |
| 4 | Important | Desconto ilegível (`"abc"`, `"R$5"`) é silenciosamente tratado como **zero** e a venda fecha: `lerDesconto(...) ?? 0` joga fora o `null` que existe justamente para sinalizar inválido | `pdv.tsx:93` |
| 5 | Important | Termo de busca do usuário interpolado **cru** em `.or()` do PostgREST: vírgula ou parêntese quebram o filtro, e nome de medicamento com vírgula é comum | `api/produtos/busca/route.ts:30`; `produtos/page.tsx:43` |
| 6 | Important | ~~O teste "venda só com teclado" clicava duas vezes~~ — **CORRIGIDO em `0821d0f`**: agora busca pelo código de barras com `pressSequentially` + `ArrowDown` + `Enter`, aciona "Lançar" com `Tab` + `Enter` e **não tem nenhum clique**; provado por mutação (com o `Enter` da busca desligado o teste **falha**) | `tests/e2e/venda.spec.ts` |
| 7 | Important | `npm run lint` vermelho (ver acima) | `pdv.tsx:60,69` |
| 8 | Important | O cliente do PDV é um `<select>` limitado aos **500 primeiros**, e o plano pedia campo de busca: cliente fora do corte não consegue vender no crediário | `vendas/nova/page.tsx:24-28` |
| 9 | Important | Reimportar planilha **sem coluna de preço** grava `preco_venda = 0` nos produtos casados (o "chave ausente ≠ zero" só foi aplicado a `estoque_inicial`) — com o checkbox marcado por padrão | `preparacao.ts:20-22`; `008_importacao.sql:146-148` |

**Menores registrados pela revisão:** `lib/pdf.ts` mistura linhas de páginas diferentes (y global); `lib/xlsx.ts:117` devolve o primeiro texto compartilhado quando `t="s"` vem sem `<v>`; `xlsx.ts:78-80` pode lançar `RangeError` em inglês; `/vendas` corta o dia em 50 linhas enquanto o cartão de resumo mostra o total certo; `lib/csv.ts:80` não trata quebra de linha dentro de aspas; o F3 dentro do próprio PDV não reposiciona o foco; o ESLint lê `.superpowers/**`.

**Lacuna registrada (continua valendo):** as telas **não foram vistas por olho humano** —
não há navegador neste ambiente além do Playwright (headless), e as Server Actions não têm
endpoint público para chamar por script. A verificação é por build, por teste automatizado
e por sonda. Foi exatamente essa lacuna que deixou passar o bug de contraste da Etapa 1,
então vale abrir `npm run dev` e olhar as telas: http://localhost:3000.

**Sobre o PDF real (`tests/fixtures/produtos-nex.pdf`):** é o catálogo REAL da farmácia e
traz o preço de custo de cada produto, então **entrou no `.gitignore`** e não sobe. A
fixture versionada é a sintética `tests/fixtures/produtos.pdf`, gerada por
`scripts/gerar-fixture-pdf.py` (Python puro, sem reportlab e sem fpdf). Os números da
medição contra o arquivo real ficam no ledger e nos testes "PDF real do Nex" de
`lib/pdf.test.ts`, que são **pulados** quando o arquivo não existe no clone.

**O projeto está no GitHub:** https://github.com/lucasam87/farmapdv01 (**privado**), com as
branches `main` (`a9f55cd`) e `etapa-0-2-fundacao` (`9f0c524`) — conferidas hash a hash, e
auditadas: nenhum segredo subiu. Detalhes na seção "Publicado no GitHub".

# ▶ COMO RETOMAR EM OUTRA JANELA

Diga ao agente, nesta ordem:

1. **"Leia o `PROGRESSO.md` e o ledger em
   `.superpowers/sdd/2026-10-06-produtos-estoque-pdv/progress.md`. Estamos na branch
   `etapa-3-4-produtos-estoque-pdv`, com as 15 tarefas do plano 2 executadas, e a revisão
   final do branch deu 'No': 1 Critical + 7 Important. Vamos corrigir os defeitos, começando
   pelo Critical da soma planilha × gravada."** O ledger é o registro detalhado de **todas**
   as decisões (rulings) e do que já foi verificado. Ele é ignorado pelo git de propósito
   (é rascunho do processo), mas está no disco. O ledger do plano 1 está em
   `.superpowers/sdd/2026-10-06-fundacao-login-banco/progress.md`.

2. Confirmar a branch e rodar as suítes:
   - `git branch --show-current` → `etapa-3-4-produtos-estoque-pdv`
   - `npm test` → **131 passed**
   - `npm run test:sql` → **224 OK, 0 FALHOU de 8 arquivos**
   - `npm run test:sql:concorrencia` → **17 OK, 0 FALHOU**
   - `npm run build` → exit 0
   - `npm run test:e2e` → **4 passed**
   - `npm run lint` → **exit 1** (esperado hoje; faz parte dos defeitos a corrigir)

   ⚠️ **Nunca rode o `test:sql` em paralelo com o `test:sql:concorrencia`, nem com o e2e:**
   os três mexem no mesmo banco e o resultado vira falso negativo.

3. **Primeiro passo concreto: o Critical.** O defeito está em `lib/tabela.ts:175` e `:181`
   (as duas somas usam a mesma variável, então nunca divergem) e aparece em
   `app/(app)/produtos/importar/formulario.tsx:35,97-101`. O caminho indicado pela revisão:
   comparar a soma extraída com o TOTAL impresso no rodapé da própria planilha — o
   `ehRodape` (`lib/tabela.ts:94-104`) já identifica essa linha e hoje a descarta, e a
   fixture `tests/fixtures/produtos_texto.xlsx` já tem rodapé (`21,39`). **Escreva o teste
   primeiro**: ele tem que nascer vermelho.

4. Depois, na ordem: item 2 (checkbox de atualização inerte), 3 e 4 (dinheiro do PDV —
   unificar em `parsearCentavos` e não engolir o `null` do desconto), 5 (escape na busca),
   7 (lint) e 9 (reimportação sem coluna de preço zerando preço). Os itens 6 já está feito
   (`0821d0f`) e o 8 (busca de cliente) é decisão de tela.

5. Para ver a interface: `npm run dev` e abrir http://localhost:3000. **As telas do plano
   2 ainda não foram olhadas por olho humano** — vale conferir.

**Sobre as migrations:** continuam por `npm run migrar` (o banco não aceita conexão `pg`).
As `006_produtos`, `007_estoque` e `008_importacao` já estão aplicadas. **Não** rodar
`supabase db push`.

**Não é preciso refazer nada das Etapas 0, 1 e 2.** Estão commitadas e verificadas.
Da Etapa 3, as tarefas estão feitas — o que falta é o conserto do Critical e a conferência
com uma planilha real. Não apague a branch nem o `.superpowers/`.

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
| 3 | Produtos e estoque | 🟡 | As 11 tarefas do plano 2 desta etapa (0–10 e 14) ✅: CLI do Supabase ligado (histórico `001`–`005` reparado), `produto_salvar` (`d998d92`), `produto_entrada`/`produto_ajuste` (`f96db63`), `importar_produtos` (`6b76b94`), os leitores `dinheiro`/`csv`/`xlsx`/`tabela` e as telas de importação, produtos e estoque. `npm run test:sql` → **224 OK, 0 FALHOU de 8 arquivos**; `npm test` → **131 passed**; `npm run build` exit 0 com `ƒ /produtos`, `ƒ /produtos/[id]`, `ƒ /produtos/novo`, `ƒ /produtos/importar` e `ƒ /estoque`. **A etapa NÃO fecha por dois motivos, os dois apontados na revisão final do branch:** (a) **a conferência "soma planilha × soma gravada" da spec §8.7 NÃO existe** — `lib/tabela.ts:175` e `:181` somam a MESMA variável pelo MESMO `parsearCentavos`, então as duas somas são sempre idênticas, a tarja "As somas não batem" é código morto e o "Pronto quando" da etapa (spec §13) está apoiado numa identidade matemática; (b) a conferência contra uma planilha REAL do sistema antigo nunca foi feita (as fixtures cobrem o formato). O PDF foi medido e decidido (não entra na tela) | 07/10/2026 |
| 4 | PDV | ✅ | `/vendas/nova` (`751e3da`) com teclado, pagamento dividido e idempotência, e `/vendas` (`15198f6`) com valores ocultáveis; 18 testes das contas de pagamento, provados por mutação. **Tarefa 13 fechada**: `npm run test:e2e` → **4 passed (34,1 s)**, exit 0, repetido com **4 passed** de novo — venda só com teclado, clique duplo produzindo UMA venda (idempotência), F3 a partir de `/produtos` e limite de crediário. Commits `de84f3b` e `52f781b` (o e2e passou a desmontar o cenário; antes deixava caixa aberto e quebrava a suíte SQL) | 07/10/2026 |
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
Escrito e revisado em 06/10/2026. **As 15 tarefas (0 a 14) estão executadas** — o plano 2
está fechado. Ledger de execução:
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
| 13 | Playwright — teclado, clique duplo, F3, limite de crediário | ✅ `de84f3b` e `52f781b`: **4 passed (34,1 s)**, exit 0, repetido com 4 passed. Dois defeitos de teste corrigidos (ordem de FK na limpeza e o rótulo do seletor de cliente) e, depois, o defeito real de o e2e deixar caixa aberto e quebrar a suíte SQL |
| 14 | PDF — medir contra o total impresso e decidir (pode terminar inviável) | ✅ `3165750`: `lib/pdf.ts` + 13 testes + gerador de fixture em Python puro. **Decisão: o PDF não entra na tela** — o relatório real do Nex não tem linha de TOTAL, então não há contra o que conferir a soma, e sem conferência não se importa preço de medicamento (spec §1). A tela segue aceitando só `.xlsx` e `.csv` |

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
