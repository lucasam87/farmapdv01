# PROGRESSO — Sistema de Gestão para Farmácia

Este arquivo é o registro de andamento. **Regra: uma etapa só vira ✅ com a
evidência colada** (o comando que rodou e o resultado que apareceu). Sem
evidência, fica 🟡.

Legenda: ⬜ pendente · 🟡 em andamento · ✅ concluída com evidência · ⛔ bloqueada

---

# ⏸ ONDE PARAMOS — 07/10/2026

**Branch:** `etapa-3-4-produtos-estoque-pdv`, HEAD = **o commit de fechamento desta etapa**
(`etapa-5: historico de vendas fechado, com a evidencia colada`, que só toca este arquivo; o
último commit de **código** da etapa é `4931f80`). O plano da etapa está em
`docs/superpowers/plans/2026-10-07-historico-vendas.md`.
**Etapas 0, 1, 2, 3, 4 e 5 fechadas.** A **Etapa 5 (histórico de vendas) virou ✅ em 07/10/2026**,
com a evidência colada na tabela de Etapas. A **Etapa 6 (clientes e crediário) é a próxima**:
saldo importado aparece, pagamento parcial atualiza, WhatsApp abre (spec §13, decisão B2 —
a importação de cliente **com saldo devedor inicial** passou a fazer parte dela).

**A revisão final do branch da Etapa 5 achou um vazamento:** as 11 views de `public` nasceram
sem `security_invoker`, então rodavam como o dono e ignoravam a RLS das tabelas — e o Supabase
concede `SELECT` a `anon` por *default privileges*. A chave pública (a do bundle do navegador)
lia `v_estoque_baixo` com produto real, sem login. A **migration `013_seguranca_views.sql`**
fechou isso nas 11 views (`alter view ... set (security_invoker = true)`), com sonda pela chave
pública e 4 asserções novas em `tests/sql/casos/050_permissoes.sql`.

## ✅ O CATÁLOGO REAL FOI IMPORTADO (07/10/2026)

O PDF do sistema antigo entrou: **5689 produtos**, todos ativos, nenhum sem código de barras.
Pelo caminho real da tela (PostgREST, papel `authenticated`): `{"criados": 5689, "ignorados": 0,
"atualizados": 0}` em **21,1 s**. Conferido no banco: soma dos preços de venda
**R$ 121.142,60**, preço médio R$ 21,29, **811 movimentos** de estoque, e a linha corrompida
(R$ 7,9 bi) **não entrou**.

**O que a importação corrigiu sozinha:** 7 linhas com nome e código de barras TROCADOS no
arquivo (o Nex gravou um no campo do outro). A prévia avisa que inverteu — conferido no banco:
`GLICERINA GRANADO`/`7896512911865`, `CITRATO DE SILDENAFILA`/`7896714226705`,
`CLORETO DE MAGNESIO PA`/`89128123238192` e mais 4.

**14 linhas entraram como estão** e estão listadas em `PROBLEMAS-NO-CATALOGO.csv` (git-ignored):
3 produtos SEM NOME (a descrição tem um código e não há nome em lugar nenhum — não dá para
inventar), 10 com código de fornecedor (`000127-WP`) ou garrancho (`DQEQWE123123`), e 1
rejeitada pelo preço. **Alerta que só a conferência humana pega:** `diltiazen 30mg` está no Nex
por **R$ 3.999,00** (o PDF traz isso literalmente) e passou na validação — corrija.

### ✅ O estoque passou a ser INFORMATIVO (07/10/2026) — a venda não bloqueia mais

**Decisão do Lucas.** Motivo: dos 5689 produtos importados, **4878 estavam com estoque zero** e
**1934 vieram de estoque NEGATIVO** no Nex. Com o estoque bloqueando, **86% do catálogo não podia
ser vendido** — o sistema não servia para o balcão.

**Migration `011_estoque_informativo`** (`10f5c2b`), três mudanças:
1. `registrar_venda` **não levanta mais** `Estoque insuficiente`;
2. a constraint **`produtos_estoque_atual_check (estoque_atual >= 0)` caiu** — o saldo pode ficar
   **negativo**, e o número passa a dizer quanto falta de verdade;
3. `v_estoque_zerado` filtra **`<= 0`**, senão um produto que deve 3 unidades não apareceria em
   nenhuma lista de reposição. A aba da tela virou "Zerado ou negativo".

**O que NÃO mudou, de propósito:** `produto_ajuste` continua recusando ajuste para saldo
negativo — ajuste é **inventário**, e não existe contar -3 unidades na prateleira. Quem leva o
saldo a negativo é a venda, não a contagem.

**O `for update` continua, e por outro motivo.** O teste de concorrência mudou de significado: ele
provava que a segunda venda do último item era **recusada**; agora prova que o lock evita **saldo
perdido** — sem ele, as duas vendas leriam o mesmo estoque (1) e gravariam o mesmo `saldo_apos`
(0), e uma das baixas sumiria. O cenário passou a afirmar que os dois movimentos têm `saldo_apos`
**diferentes** (0 e −1) e o estoque final é **−1** com **duas** vendas. **18 OK, 0 FALHOU.**

**Verificado:** `npm run test:sql` → **237 OK, 0 FALHOU de 8 arquivos** (eram 231; o caso 2 de
`010_venda.sql` agora prova a agregação por outro ângulo e o caso 8 de `040_views.sql` cobre
estoque negativo). `npm test` 193 · lint exit 0 · build exit 0 · `npm run test:e2e` 8 passed.

⚠️ **`npm run test:sql` não roda com caixa aberto** — e `abrir_caixa` recusa se houver **qualquer**
sessão aberta, não só no mesmo terminal (é por isso que o `global-setup` do e2e insere a sessão
direto na tabela). Para rodar a suíte com a farmácia operando, a sessão precisa sair do caminho.
Por isso o `tests/sql/run.mjs` tem filtro por arquivo: `npm run test:sql -- 070_importacao.sql`.

## A leitura do PDF do sistema antigo (o que destravou)

O PDF **não tem linha de TOTAL impressa**, então a conferência "soma extraída × total
impresso" não tem contra o que conferir — esse foi o motivo de, na Tarefa 14, o PDF ter
ficado de fora. O que mudou: medindo o arquivo, descobri que **ele desenha a grade da tabela
com retângulos** (`x y w h re`), e que a página é **rotacionada** (`0 1 -1 0 595 0 cm`, um
`cm` que o leitor ignorava). Aplicando o `cm`, a grade sai regular (colunas em 93.5, 117.0,
173.0, 219.0, 275.0, 321.0, 377.0, 423.0, 459.0, 505.0) e cada trecho de texto pode ser
atribuído à célula em que cai — o que resolve de uma vez a rotação, o nome quebrado em
várias linhas dentro da célula e a falta de total.

**Critério de aceite combinado com o Lucas: a amostra conferida por ele na prévia** (não há
total para comparar). A verificação que eu fiz antes de aceitar: as 3 primeiras linhas
extraídas batem **exatamente** com a medição independente do texto cru do PDF —
`ACIDO ACETILSALICILI CO 100MG C3O EUROFARMA` · `7891317026370` · R$ 18,77 · custo 7.99.

**Os tropeços no caminho, para não repetir:**

| Tropeço | Causa | Correção |
|---|---|---|
| A tela voltou sem gravar nada (1ª vez) | O cadastro corrompido (R$ 7,9 bi) estoura o `integer` do Postgres e, como é tudo-ou-nada, derrubava o catálogo inteiro com erro cru | `fec4fc4`: preço acima de R$ 21.474.836,47 vira **linha inválida nomeada** |
| A tela voltou sem gravar nada (2ª vez) | O papel `authenticated` tem **`statement_timeout = 8s`** e a importação leva **26 s** | `84617f4` + migration **010**: `authenticated` → 120 s. `alter function ... set statement_timeout` **não funciona** (o timer já foi armado no início do statement) — está documentado na migration |
| 524 produtos recusados | O Nex imprime a palavra **`null`** no preço de custo | `989f459`: `null` = "sem custo" (chave omitida por linha) |
| Importação recusada inteira | **83 códigos de barras repetidos** no Nex (mesmo EAN em dois cadastros) | Decisão do Lucas: importa o **primeiro** cadastro e a prévia lista os ignorados |

⚠️ **Etapa 9 (Vercel):** funções serverless têm limite de execução (10 s no Hobby, 60 s no
Pro) e **26 s não cabe no Hobby**. A importação do catálogo vai precisar de outro caminho no
deploy.

## ✅ A tela de caixa EXISTE agora (07/10/2026) — não estava em nenhuma etapa da spec

Achado desta sessão, e era buraco no **planejamento**, não bug de código: as três RPCs de
caixa estavam prontas e testadas desde a Etapa 2 (30 asserções em `030_caixa.sql`), a spec
lista "Caixa" entre as 9 entradas do menu (§10) e diz que o caixa está na v1 (decisão D2) —
mas **nenhuma das 11 etapas construía a tela**. Nada em `app/` chamava `abrir_caixa`,
`caixa_movimento` ou `fechar_caixa`; os únicos chamadores eram os testes SQL e o
`global-setup` do e2e, que **insere a sessão direto na tabela**. Foi por isso que o e2e nunca
pegou o problema. Na prática: o PDV recusava vender ("Abra o caixa para começar a vender") e
não havia como abrir.

**Construída em `5b74738`** (`app/(app)/caixa/`): abrir com valor inicial, sangria e
suprimento com motivo, resumo com a conta da spec §8.3 linha a linha, lista dos movimentos e
fechamento (só o dono, com observação obrigatória quando a diferença não é zero). 14 testes
de validação pura + **2 testes e2e pelo caminho do navegador**.

**Um achado que só apareceu no e2e:** `v_caixa_atual` tem **uma linha por terminal aberto**, e
`maybeSingle()` falha com duas — a tela mostraria "não há caixa aberto" com o caixa aberto. A
tela passou a pegar a sessão **mais recente**, que é o que `registrar_venda` e
`caixa_movimento` já faziam (`where status = 'aberto' order by aberto_em desc limit 1`): tela
e RPCs têm de apontar para a mesma sessão, senão o resumo mente.

⚠️ **Continua valendo:** a suíte `npm run test:sql` **não roda com um caixa aberto** — 5 casos
falham com "Já existe um caixa aberto" (010_venda caso 6, 030_caixa, 040_views,
050_permissoes). Como os testes rodam contra o **banco de produção**, a suíte não pode ser
rodada enquanto a farmácia estiver operando. Por isso o `tests/sql/run.mjs` ganhou um filtro
por arquivo: `npm run test:sql -- 070_importacao.sql`.

## O resto do estado

**As 15 tarefas do plano 2 (0 a 14) estão executadas** e a **revisão final do branch** (em
contexto limpo, range `9f0c524..3165750`) apontou **1 Critical + 7 Important**, **todos os
oito corrigidos**, cada um com teste que nasce vermelho. **`npm run lint` está exit 0.**
**Falta só o item 8** (o seletor de cliente do PDV, que é mudança de tela no balcão).

**O Critical e o que ele significava:** em `lib/tabela.ts`, `somaGravada` e a (então)
`somaPlanilha` somavam a **mesma** variável pelo **mesmo** `parsearCentavos` — as duas somas
eram idênticas por construção, a tarja "As somas não batem" era código morto e a conferência
contra erro de fator 100 da spec §8.7 **não existia**. O "Pronto quando" da Etapa 3 estava
apoiado numa identidade matemática. Isso também era defeito do plano (linha 701), que
descrevia a comparação de forma autocontraditória; **o plano foi corrigido junto**.

**O conserto:** `analisarTabela` agora devolve `totalImpresso` — o TOTAL que o sistema antigo
**imprimiu no rodapé do arquivo**, lido do `ehRodape` que antes era descartado — e
`somaConferida`, que só é `true` quando existe total impresso e ele bate ao centavo. Os dois
lados são independentes. Os limites estão escritos no código: a conferência pega defeito de
seleção e somatório (coluna trocada, linha perdida, rodapé que discorda), **não** pega um erro
sistemático dentro do próprio `parsearCentavos` (aí os dois lados deslocam juntos).

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

**Estado verificado no fim da sessão (tudo rodado em sequência, sem nada em paralelo):**

| Comando | Resultado |
|---|---|
| `npm test` | **151 passed** (11 arquivos), exit 0 |
| `npm run test:sql` | **231 OK, 0 FALHOU de 8 arquivos**, exit 0 |
| `npm run test:sql:concorrencia` | **17 OK, 0 FALHOU**, exit 0 |
| `npm run test:e2e` | **6 passed (41,9 s)**, exit 0 |
| `npm run build` | exit 0 |
| `npm run lint` | ✅ **exit 0**, zero problemas (era exit 1 com 2 erros e 3 avisos) |

⚠️ **Nunca rode `test:sql`, `test:sql:concorrencia` e `test:e2e` em paralelo:** os três
mexem no mesmo banco e o resultado vira falso negativo (aconteceu nesta sessão: 126 OK /
4 FALHOU por causa disso).

**Os testes e2e e SQL não se atropelam mais (era um defeito real):** a suíte e2e abre um
caixa no terminal `e2e` e, até `52f781b`, **deixava a sessão aberta no banco**. Com isso
`npm run test:sql` caía de 224 OK para **126 OK / 4 FALHOU** — "Já existe um caixa aberto."
em `030_caixa`, `040_views` e `050_permissoes`, e "caso 6: venda sem caixa aberto e
recusada — nenhuma excecao foi levantada" em `010_venda`. Agora existe
`tests/e2e/global-teardown.mjs`, chamado pelo `globalTeardown` do `playwright.config.ts`.
Conferido no banco depois da suíte: `caixas_abertos = 0`, `produtos_e2e = 0`,
`clientes_e2e = 0`, `vendas = 0`.

**Migrations aplicadas:** `001` a `009`. A **`009_importacao_precos.sql`** é desta sessão:
ela faz a RPC `importar_produtos` parar de gravar zero por cima do preço quando a planilha
não traz a coluna (ver o item 9 na tabela abaixo).

**O que falta, exatamente:**

1. **O item 8 da revisão (o único que não foi corrigido)** — o seletor de cliente do PDV é
   um `<select>` com os **500 primeiros** clientes em ordem alfabética (`vendas/nova/page.tsx`),
   e o plano pedia **campo de busca**. Cliente fora do corte não consegue comprar no
   crediário. Os dois caminhos possíveis, para o Lucas escolher: (a) campo de busca com rota
   própria, como já é a busca de produto (`/api/clientes/busca`), ou (b) manter o `<select>` e
   só avisar quando a lista for cortada. **É mudança na tela do balcão, por isso não foi
   feita sozinha.**
2. ~~**Empurrar a branch** depois do commit do fechamento.~~ ✅ **Feito em 07/10/2026**:
   `git push origin etapa-3-4-produtos-estoque-pdv` → `06b0269..2f11075`, conferido hash a hash
   (local e remoto em `2f11075`), 125 arquivos no remoto, sem segredo no range.
3. ~~**Passar uma planilha REAL do sistema antigo pela tela de importação.**~~ ✅ **Não se aplica
   mais:** a Etapa 3 fechou em 07/10/2026 com o **catálogo real** importado pelo caminho da tela
   (5689 produtos, soma extraída × soma gravada em R$ 121.142,60). O arquivo real era **PDF**, não
   planilha, e a spec §13 registra o critério reescrito — o PDF continua fora da tela (§8.7 exige
   TOTAL impresso, que o relatório do Nex não tem).

**Os defeitos da revisão, com o que foi feito em cada um:**

| # | Grau | O que era | Situação |
|---|---|---|---|
| 1 | **Critical** | `somaPlanilha` e `somaGravada` somavam a **mesma** variável pelo mesmo `parsearCentavos`: as somas eram **sempre iguais**, a tarja "As somas não batem" era código morto e a conferência contra fator 100 da spec §8.7 **não existia** | ✅ **`ced0a74`** — as duas somas viraram `totalImpresso` (o TOTAL impresso no rodapé do arquivo, via `ehRodape`) contra `somaGravada`, com `somaConferida`. 7 testes novos e a **fixture real** (`produtos_texto.xlsx`, rodapé `21,39`). Provado por mutação: somando a coluna de custo, 3 testes falham. O **plano** (linha 701) foi corrigido junto |
| 2 | Important | O checkbox "Atualizar produtos que já existem" era **inerte** (o form de confirmação mandava `sim` fixo) e a prévia não dizia **quantos** existentes seriam atualizados | ✅ **`f120328`** — a escolha viaja no estado (`Previa.atualizar`), o hidden usa o valor real e a prévia mostra "N produto(s) já existem e serão/não serão atualizados" (contagem em lotes de 200) |
| 3 | Important | O PDV lia dinheiro com parser próprio, divergente do `parsearCentavos` por **fator 100** (`"20.00"` = R$ 2.000,00 no balcão) | ✅ **`5f44851`** — os dois pontos passaram a usar `parsearCentavos`, com 4 testes novos |
| 4 | Important | Desconto ilegível virava **zero** calado e a venda fechava | ✅ **`5f44851`** — o `null` do `lerDesconto` agora **bloqueia** o finalizar com mensagem; teste e2e novo, provado por mutação |
| 5 | Important | Termo de busca interpolado **cru** no `.or()` do PostgREST: vírgula ou parêntese quebravam a busca | ✅ **`lib/postgrest.ts`** — valor entre aspas com escape; 7 testes de unidade + produto **com vírgula no nome** no cenário e2e, provado por mutação |
| 6 | Important | O teste "venda só com teclado" clicava duas vezes (e o comentário prometia uma cobertura que não existia) | ✅ **`0821d0f`** — nenhum clique; `ArrowDown` + `Enter` na busca, `Tab` + `Enter` no "Lançar"; provado por mutação |
| 7 | Important | `npm run lint` vermelho (2 erros + 3 avisos) | ✅ **`d2341bf`** — `useState` preguiçoso para a chave, `setResultados([])` saiu do corpo do efeito, `.superpowers/**` ignorado e `fs` não usado removido. **exit 0, zero problemas** |
| 8 | Important | Cliente do PDV é `<select>` limitado aos **500 primeiros**; o plano pedia campo de busca | ⬜ **PENDENTE** — ver o item 1 de "O que falta" |
| 9 | Important | Reimportar planilha **sem coluna de preço** gravava `preco_venda = 0` nos produtos casados | ✅ **`3fc1559`** — migration **009**, `colunasPresentes` no `analisarTabela`, chave ausente também para preço, e a tela avisa. 3 casos SQL novos (nasceram **vermelhos** contra a 008) + 3 testes de unidade. O `test:sql` foi de 224 para **231 OK** |

**Menores registrados pela revisão (não corrigidos):** `lib/pdf.ts` mistura linhas de páginas diferentes (y global); `lib/xlsx.ts:117` devolve o primeiro texto compartilhado quando `t="s"` vem sem `<v>`; `xlsx.ts:78-80` pode lançar `RangeError` em inglês; `/vendas` corta o dia em 50 linhas enquanto o cartão de resumo mostra o total certo; `lib/csv.ts:80` não trata quebra de linha dentro de aspas; o F3 dentro do próprio PDV não reposiciona o foco.

**Lacuna sem teste automatizado:** o conserto do item 2 (o checkbox) é verificado por tipo e
build, mas **não tem teste de comportamento** — as Server Actions exigem sessão e não há
harness para testá-las, e um e2e de importação escreveria no catálogo real. Fica registrado.

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
   `etapa-3-4-produtos-estoque-pdv`, com as 15 tarefas do plano 2 executadas e 8 dos 9
   defeitos da revisão final já corrigidos. Falta o item 8 (o seletor de cliente do PDV) e
   passar uma planilha real pela importação."** O ledger é o registro detalhado de **todas**
   as decisões (rulings) e do que já foi verificado. Ele é ignorado pelo git de propósito
   (é rascunho do processo), mas está no disco. O ledger do plano 1 está em
   `.superpowers/sdd/2026-10-06-fundacao-login-banco/progress.md`.

2. Confirmar a branch e rodar as suítes (**em sequência, nunca em paralelo**):
   - `git branch --show-current` → `etapa-3-4-produtos-estoque-pdv`
   - `npm test` → **151 passed** (11 arquivos)
   - `npm run test:sql` → **231 OK, 0 FALHOU de 8 arquivos**
   - `npm run test:sql:concorrencia` → **17 OK, 0 FALHOU**
   - `npm run test:e2e` → **6 passed**
   - `npm run build` → exit 0
   - `npm run lint` → **exit 0** (zero problemas)

   ⚠️ **Nunca rode o `test:sql` em paralelo com o `test:sql:concorrencia`, nem com o e2e:**
   os três mexem no mesmo banco e o resultado vira falso negativo (já aconteceu: 126 OK /
   4 FALHOU por causa disso).

3. **O que sobrou: decidir o item 8 e rodar a planilha real.**
   - **Item 8:** o seletor de cliente do PDV (`app/(app)/vendas/nova/page.tsx`) é um
     `<select>` com os 500 primeiros clientes; cliente fora do corte não consegue comprar no
     crediário. Ou vira campo de busca (rota própria, como `/api/produtos/busca`), ou fica
     como está com aviso de corte. **É decisão da tela do balcão.**
   - **Planilha real:** pegue um arquivo de verdade do sistema antigo, abra
     `http://localhost:3000/produtos/importar`, e confira na prévia se "Total impresso na
     planilha" bate com "Soma que será gravada". Se a planilha não tiver rodapé TOTAL, a tela
     avisa que não há contra o que conferir.

4. Para ver a interface: `npm run dev` e abrir http://localhost:3000. **As telas do plano
   2 ainda não foram olhadas por olho humano** — vale conferir, é a lacuna que deixou passar
   o bug de contraste da Etapa 1.

**Sobre as migrations:** continuam por `npm run migrar` (o banco não aceita conexão `pg`).
As `006_produtos`, `007_estoque`, `008_importacao` e **`009_importacao_precos`** já estão
aplicadas. **Não** rodar `supabase db push`.

**Não é preciso refazer nada das Etapas 0, 1 e 2.** Estão commitadas e verificadas.
Da Etapa 3, as tarefas estão feitas — o que falta é passar uma planilha real. Não apague a
branch nem o `.superpowers/`.

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
| 3 | Produtos e estoque | ✅ | As 11 tarefas do plano 2 desta etapa (0–10 e 14) ✅: CLI do Supabase ligado (histórico `001`–`005` reparado), `produto_salvar` (`d998d92`), `produto_entrada`/`produto_ajuste` (`f96db63`), `importar_produtos` (`6b76b94`), os leitores `dinheiro`/`csv`/`xlsx`/`tabela` e as telas de importação, produtos e estoque. `npm run test:sql` → **231 OK, 0 FALHOU de 8 arquivos**; `npm test` → **151 passed**; `npm run build` exit 0 com `ƒ /produtos`, `ƒ /produtos/[id]`, `ƒ /produtos/novo`, `ƒ /produtos/importar` e `ƒ /estoque`. **A conferência "soma extraída × TOTAL impresso no arquivo" da spec §8.7 agora EXISTE e está testada** (`ced0a74`): ela era uma identidade matemática até a revisão final do branch apontar que os dois lados saíam da mesma variável; hoje o outro lado é o TOTAL impresso no rodapé, e o plano foi corrigido junto. A reimportação também deixou de zerar preço (`3fc1559`, migration `009`). **A etapa VIRA ✅ em 07/10/2026:** o catálogo **REAL** do sistema antigo entrou (5689 produtos, 21,1 s) pelo caminho real da tela — PostgREST com o papel `authenticated` — e a conferência soma extraída × soma gravada bateu em **R$ 121.142,60**. O critério original pedia "a planilha real", mas o arquivo real só existia em **PDF**, e o PDF foi medido e decidido fora da tela (o relatório do Nex não imprime TOTAL, então a conferência da §8.7 ficaria sem contra o que conferir). Busca e entrada de estoque conferidas em `75a5adc`, `09950c7` e `f96db63` | 07/10/2026 |
| 4 | PDV | ✅ | `/vendas/nova` (`751e3da`) com teclado, pagamento dividido e idempotência, e `/vendas` (`15198f6`) com valores ocultáveis; 21 testes das contas de pagamento (4 novos), provados por mutação. **Tarefa 13 fechada** e a revisão final corrigida: `npm run test:e2e` → **6 passed (41,9 s)**, exit 0 — venda só com teclado (**sem nenhum clique**, provado por mutação), clique duplo produzindo UMA venda (idempotência), desconto ilegível bloqueando a venda, produto com vírgula no nome sendo achado, F3 a partir de `/produtos` e limite de crediário. Commits `de84f3b`, `52f781b`, `0821d0f`, `5f44851`. **Pendência conhecida:** o seletor de cliente é um `<select>` com os 500 primeiros (item 8 da revisão) | 07/10/2026 |
| 5 | Histórico de vendas | ✅ | As 6 tarefas deste plano ✅: a view `v_vendas_historico` (`bbdbad7` + `24d19d0`, migration `012`) que **NÃO filtra status** e entrega o `dia` no fuso de São Paulo, as contas de data puras em `app/(app)/vendas/dia.ts` (`b0f6539`), `/vendas` com o **dia no endereço** (`?dia=`), setas, seletor de data, resumo e linha de canceladas (`f5b3140`), o detalhe `/vendas/[id]` com o cancelamento do dono pela RPC `cancelar_venda` e motivo obrigatório (`46ac185`) e o e2e (`4931f80`). **Evidência colada em 07/10/2026, medida nesta ordem, sem nada em paralelo:** `npm test` → **210 passed (14 arquivos)**; `npm run test:sql` → **246 OK, 0 FALHOU de 9 arquivos** (eram 237 de 8; entrou `tests/sql/casos/080_historico.sql`); `npm run lint` exit 0; `npm run build` exit 0 com `ƒ /vendas` e `ƒ /vendas/[id]`; `npm run test:e2e` → **14 passed (1,5 m)**, 6 deles do histórico. **O critério da etapa está provado pelo navegador:** "vejo o dia, abro uma venda, cancelo, o estoque volta" e "a venda noturna cai no dia certo" (a venda das 22h de ontem aparecendo em ONTEM, não em hoje). **Bug corrigido no caminho (`f5b3140`): o ticket médio aparecia 100× maior** — a view devolve **centavos** e a tela **multiplicava por 100** (`Math.round(Number(dia?.ticket_medio ?? 0) * 100)`), como se a view devolvesse reais; era a **multiplicação**, não uma divisão, que inflava o número. **Não virou teste:** o líquido zero do estoque é **inferido** (o caso 3 do e2e lê o estoque antes da venda e confere que o mesmo número voltou depois do cancelamento, mas **nunca observa o saldo entre a venda e o cancelamento** — venda que não baixasse e cancelamento que não devolvesse passariam); a navegação de dia com `?ocultar=1` **não é exercida** (o e2e cobre lista → detalhe, não dia anterior/seguinte oculto); a asserção de que não há "R$" na lista oculta olha **só a primeira linha**; a **volta** do detalhe não é exercida — o e2e vai de lista → detalhe e nunca clica em **"Voltar para o dia"**, que é justamente o link que repassa o `ocultar` (ida e volta do item 3 do Review Focus, só a ida está provada); e o item 2 do Review Focus — um dia em que **todas** as vendas foram canceladas **não pode dizer "nenhuma venda"** — só tem teste da função pura `resumirCanceladas`, **não da regra da tela** (`vendas.length === 0` sobre a lista do histórico) | 07/10/2026 |
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
