# Auditoria da arquitetura — Sistema de Gestão para Farmácia

Data: 15/10/2026 · Baseline: commit `c140fa4` · Repositório: `farmapdv01`

**O que é este documento.** O mapa da arquitetura como ela está hoje e os riscos ordenados por dano. Não
conserta nada: o que aparece aqui vira item de backlog para decidir depois.

**Como ler.** Cada achado tem `arquivo:linha` ou nome de migration. O que não deu para provar está na seção
de **hipóteses**, separado — nunca misturado com o que foi confirmado. Escala de risco:

| Nível | Significado |
|---|---|
| **P0** | Risco financeiro ou perda de dado com o sistema em uso normal |
| **P1** | Trava a operação diária da farmácia |
| **P2** | Dívida que encarece a próxima mudança |
| **P3** | Ergonomia e estética |

**Limitação declarada.** Este clone não tem `.env.local`, então nada foi executado contra banco. Todo achado
de RLS, policy e comportamento de Postgres é **leitura de SQL**, marcado como tal. A suíte de testes SQL e o
e2e não rodaram — seção 7.

---

## 1. Mapa em uma página

```
NAVEGADOR  (React 19 — Client e Server Components)
   │  PDV calcula subtotal, total, troco e desconto em código de tela
   │  demais telas leem views pelo Server Component
   ▼
NEXT.JS 16  (App Router · 21 rotas · 3 rotas de API · Server Actions)
   ├─ lib/supabase/server.ts ......... chave pública + cookie da sessão → respeita RLS
   ├─ lib/supabase/privilegiado.ts ... service_role → só orçamento do agente
   ├─ lib/auth/perfil.ts ............. papel do usuário (dono · atendente)
   └─ lib/ puro e testado ............ dinheiro · format · postgrest · csv · xlsx · pdf · tabela
   ▼
POSTGRES  (Supabase, sa-east-1)
   ├─ 12 tabelas ..... 10 com RLS; 8 delas com policy única `logado_tudo` FOR ALL using(true)
   ├─ 24 funções ..... 8 `security definer` = autoridade de escrita (transacional)
   └─ 11 views ....... + 4 funções relatorio_*(de, até) = autoridade de leitura
```

**As quatro camadas e a responsabilidade de cada uma:**

| Camada | Decide | Não decide |
|---|---|---|
| `app/` (telas) | o que mostrar, validação de formulário, contas de tela do PDV | preço, total cobrado, limite, desconto autorizado |
| `app/api/` | busca de produto e cliente (leitura, com sessão) | nada de escrita |
| `lib/` | formatação, parsing de dinheiro, transporte PostgREST | regra de negócio |
| `supabase/` | **tudo que é regra**: preço, desconto final, estoque, caixa, crediário, papel | apresentação |

**Rotas que existem hoje** (do build de produção, seção 7): `/` · `/login` · `/agente` · `/caixa` ·
`/clientes` (+ `[id]`, `novo`, `importar`) · `/crediario` · `/estoque` · `/produtos` (+ `[id]`, `novo`,
`importar`) · `/relatorios` · `/vendas` (+ `[id]`, `nova`) · `/api/agente` · `/api/clientes/busca` ·
`/api/produtos/busca`.

**Autoridade de escrita** — as 9 RPCs que o front pode chamar, e o papel que cada uma exige de fato:

| RPC | Papel exigido no código |
|---|---|
| `registrar_venda` | qualquer perfil **ativo** (sem papel) — `002:79-88` |
| `cancelar_venda` | dono — `003:50` |
| `abrir_caixa` | qualquer perfil ativo — `004:28-37` |
| `caixa_movimento` | qualquer perfil, **sem checar `ativo`** — `004:66-73` |
| `fechar_caixa` | dono **ou** atendente no banco (`018:52-54`), dono **apenas** na aplicação (`caixa/actions.ts:79`) |
| `produto_salvar` · `produto_entrada` · `produto_ajuste` | qualquer perfil ativo — `006:42-51`, `007:39-45` |
| `importar_produtos` · `importar_clientes` | dono — `009:61-63`, `015:251-253` |
| `receber_pagamento` | dono ou atendente — `014:49-51` |
| `cliente_salvar` | dono ou atendente, com guardas internas — `015:136-166` |

---

## 2. Fluxos críticos rastreados

Cada fluxo vai do clique até a migration. Onde a decisão muda de camada, está dito.

### 2.1 Venda no PDV — o fluxo mais protegido do sistema

```
/vendas/nova/page.tsx:17  →  <Pdv/> (client component)
   ├─ busca produto: GET /api/produtos/busca (debounce 150 ms, AbortController) — pdv.tsx:109-130
   ├─ carrinho guarda o preço EXIBIDO — pdv.tsx:194-206
   ├─ contas de tela: subtotal, total, falta, troco, desconto — pagamento.ts:36-84
   ├─ valida no navegador (carrinho, pagamento, falta > 0) — pdv.tsx:265-284
   ▼
Server Action finalizarVenda — vendas/nova/actions.ts:26-45
   │  revalida perfil (:26-27) e revalida carrinho/pagamento (:31-36)
   │  envia SÓ intenção: chave, cliente_id, itens[{produto_id, quantidade}], pagamentos, desconto
   ▼
RPC registrar_venda — 002_registrar_venda.sql:36-339 (uma função = uma transação)
   :79-88    auth.uid() + perfil ativo (sem checar papel)
   :93-97    idempotência pela chave (unique em 001_base.sql:88)
   :100-107  caixa: pega a sessão ABERTA MAIS RECENTE do sistema, sem vínculo com o operador
   :117-147  valida cada item (quantidade e limites)
   :149-158  agrega por produto em ordem fixa de produto_id (evita deadlock)
   :163-181  for update no produto, recalcula o subtotal com o preço DO BANCO
   :185-195  desconto (0 ≤ d ≤ subtotal, total > 0)
   :202-233  pagamentos por forma; cartão acima do total é recusado
   :237-266  crediário: cliente obrigatório, bloqueado, limite, for update, teto
   :278-335  grava vendas · venda_itens · estoque · venda_pagamentos · caixa · crediário
   :337-338  retorna {id, numero, total, troco}
   ▼
pdv.tsx:304-314  limpa o carrinho e ROTACIONA a chave de idempotência
```

**A propriedade mais forte do sistema:** `registrar_venda` é uma única função plpgsql, sem `exception when`
nem transação autônoma. Qualquer `raise` aborta tudo — **não existe venda pela metade, nem estoque baixado
sem venda**. As únicas escritas fora do ciclo são o retorno antecipado de idempotência (`002:93-97`, que não
escreve) e o `revalidatePath` pós-commit (`actions.ts:52`, sem efeito em dado).

**A propriedade mais fraca:** o desconto. Chega como valor final, calculado na tela (`pagamento.ts:72-77`),
e o banco só confere os limites — nunca o percentual.

### 2.2 Caixa — onde a aplicação e o banco discordam

```
abrir:     tela.tsx:88-121 → actions.ts:33-43 → abrir_caixa  (004:17-51)
movimento: tela.tsx:156-172 → actions.ts:47-74 → caixa_movimento (004:56-98)
fechar:    tela.tsx:210-241 → actions.ts:76-112 → fechar_caixa (018:30-100)
esperado = inicial + Σ vendas dinheiro + Σ recebimentos dinheiro
           − Σ|cancelamentos dinheiro| − Σ|sangrias| + Σ|suprimentos|   — 018:71-83
congela  = status, fechado_por, fechado_em, valor_contado,
           esperado_dinheiro, diferenca, observacao                     — 018:90-97
```

**A divergência:** a migration `018` liberou o fechamento para dono **e** atendente (`018:52-54`) e a tela
passou a mostrar o formulário (`tela.tsx:205-241`) — mas a server action continua exigindo dono
(`caixa/actions.ts:79`). O atendente vê o formulário, preenche e recebe *"Só o dono pode fechar o caixa."*
O comentário em `tela.tsx:205-209` afirma o contrário do que o código faz.

### 2.3 Crediário — a dívida é uma view, não uma coluna

```
venda no crediário:  pdv.tsx:291 (só cliente_id) → registrar_venda (002:237-266) → 002:333-334
saldo:               v_clientes_devedores (005_views.sql:130-140)
                     saldo = coalesce(sum(case when tipo='compra' then valor else -valor end), 0)
                     join crediario_lancamentos (:137) · group by (:138) · having saldo > 0 (:139)
baixa:               receber.tsx:61-63 → crediario/actions.ts:26-63 → receber_pagamento (014:20-107)
```

**O que a dívida significa:** um lançamento `'compra'` soma, **qualquer outro tipo subtrai**
(`002:257-258`) — inclusive um `tipo` desconhecido, que ninguém valida. O saldo devedor **nunca** entra em
`esperado_dinheiro`; a venda no crediário grava movimento de caixa (`002:329-330`) mas não conta na gaveta,
e só a baixa em dinheiro conta depois (`014:101-102`, `005:159`).

### 2.4 Relatórios — a barreira não está onde parece

```
relatorios/page.tsx:18 (Server Component)
   :24-25  obtém "hoje" em America/Sao_Paulo e valida o período (periodo.ts:24-43)
   :27     criarClienteServidor() — chave PÚBLICA + cookie da sessão
   :31-37  RPCs relatorio_resumo · relatorio_formas_pagamento · relatorio_mais_vendidos
   :41-43  relatorio_lucro SOMENTE se perfil?.papel === 'dono'  ← conveniência de tela
   ▼
016_relatorios.sql:45/127/167   (security invoker)
020_fechar_custo_venda.sql:59-90 (security DEFINER + guarda de papel no corpo :77-80)
```

**Nenhuma view de `005`/`012` alimenta esta tela.** O gate `ehDono` de `page.tsx:41` é conveniência: a
barreira real é a checagem dentro da função `definer` (`020:77-80`) — e `definer` ignora RLS (`020:26-30`),
então essa linha é a única coisa entre o atendente e o lucro.

---

### 2.5 Agente — duas chamadas ao modelo, e o texto montado em código

```
agente/page.tsx:18-46 (server component) → formulario.tsx:72-118 (um POST por vez)
   │  fetch('/api/agente', { pergunta }) — pergunta crua, sem regra local
   ▼
POST app/api/agente/route.ts:222
   :228-234  autenticacaoAtual() — sessão e perfil
   :249-261  monta as deps: classificarAssunto · classificarFinanceiro · consultarFinanceiro
             · reservar · reconciliar · liberar · consultar   ← o grafo entra aqui
   ▼
processarPergunta — app/api/agente/orquestracao.ts:263
   :364      sem sessão → 401
   :367-369  papel fora de dono/atendente → 403
   :373      validarPergunta (500 chars, payload, triagem clínica/PII)
   :381-383  regex de lucro para atendente → 403   ← ANTES de gastar
   :414-417  flag do grafo: exige as três deps
   :419-430  RESERVA do orçamento (2 × 1373 µ$ fixo)
   :441-447  CHAMADA 1 — coordenador escolhe o assunto
   :456      validarAssunto (contrato exato {"assunto": ...})
   :462-466  fora_escopo → 400, com UMA chamada só
   :476-530  CHAMADA 2, ramo financeiro: classificar → validar → ler RPC → montar em código
   :533-614  CHAMADA 2, demais assuntos: classificador legado → view → montarResposta
   :496-497  reconcilia a reserva com a SOMA dos custos reais
   ▼
formulario.tsx:188-195  renderiza {resposta} | {erro}
```

**Chamadas ao modelo por pergunta: 2** (coordenador + especialista financeiro ou classificador legado),
**1** quando o coordenador devolve `fora_escopo`, **0** nas recusas locais, no 401/403 e no orçamento
esgotado.

**A propriedade central se sustenta:** o conteúdo cru do modelo **nunca** chega à tela. Os únicos caminhos
de `{resposta}` são `orquestracao.ts:529` e `:611-614`, e todo número é lido de view/RPC e formatado em
código (`logica.ts:452-519`, `:769-821`). **A exceção é a data**: o modelo escolhe o período
(`deepseek.ts:203-224`), ele é validado (`logica.ts:403`) e impresso no título (`logica.ts:438`) — é o
risco P1-6.

### 2.6 Produtos, estoque e importação — onde o preço entra

```
cadastro:   formulario.tsx:29-143 → actions.ts:16-33 → produto_salvar (006:15-122)
entrada:    formulario-estoque.tsx:36-65 → produto_entrada (007:19-80)   [motivo obrigatório]
ajuste:     formulario-estoque.tsx:67-91 → produto_ajuste (007:82-142)   [grava o DELTA, não o saldo]
importação: formulario.tsx:49-74 → actions.ts:121-235 (detecta o formato pela assinatura)
            ├─ xlsx lib/xlsx.ts:131-176 · csv lib/csv.ts:72-95 (Latin-1) · pdf actions.ts:146-148
            ├─ planilha → lib/tabela.ts:286-454 (apelidos, rodapé TOTAL, preços, dedup)
            ├─ PRÉVIA com JSON oculto (formulario.tsx:82-280) — nada foi gravado ainda
            └─ actions.ts:237-273 → importar_produtos (009:23-210)
                 passagem 1 valida tudo (:72-113) → passagem 2 grava (:131-205)
```

**Preço só tem duas portas e o cadastro não escreve estoque.** Quem define saldo é `produto_entrada` e
`produto_ajuste` (`006:4-11`, `007:1-17`) — cadastrar produto com estoque inicial exige dois passos.

**A planilha é lida por heurística, não por contrato.** O parser decide sozinho se um separador é decimal ou
milhar (`lib/dinheiro.ts:29-46`), e três dígitos após o separador são tratados como milhar. A prévia não
protege: ela mostra os dois lados usando o *mesmo* parser (`lib/tabela.ts:214-219, 445`), então um erro de
leitura aparece igualzinho na conferência.

**Importação é tudo-ou-nada — com uma exceção consciente.** As duas passagens rodam dentro de um único
statement (`009:69-131`), então um erro aborta o arquivo inteiro; mas a segunda ocorrência de um código
repetido é descartada no cliente e apenas contada (`tabela.ts:405-421`).

**Por que a importação tem 120 s de teto.** `010_importacao_timeout.sql` existe por um caso medido em
07/10/2026: o Supabase impõe `statement_timeout` de 8 s em `authenticated`, o dono clicou em "Confirmar
importação", o Action levou 9,28 s e **nada foi gravado** — o mesmo arquivo passava como `postgres`
(`010:1-19`). A tentativa de resolver por função foi removida (`010:22-29`) e a solução ficou no papel:
`alter role authenticated set statement_timeout='120s'` (`010:44`), com trabalho real medido em ~26 s.

---

## 3. Onde o dinheiro é decidido

Esta é a seção que responde "se eu mexer aqui, quanto custa".

**Dinheiro é inteiro em centavos, do formulário ao banco.** `lib/dinheiro.ts:53-58` converte texto para
centavos somando reais × 100 + centavos, sem passar por `float`; o banco valida o texto por regex antes do
cast (`002:140-142` para quantidade, `002:204-207` para valor) e só formata com `centavos_em_reais`
(`002:14-31`, inteiro puro). **Não existe `parseFloat` nem `toFixed` em caminho de dinheiro** — as duas
exceções são a divisão do desconto percentual e o ticket médio, ambas nos riscos P1.

**O preço cobrado é do banco; o desconto é do navegador.** O PDV envia só `produto_id` e `quantidade`
(`vendas/nova/pdv.tsx:287-295`), e `registrar_venda` recobra `preco_venda` sob `for update`, fotografando
`preco_unitario` e `preco_custo` no item (`002:167-181`, `002:289`). **Mas o desconto chega como valor
final**: o percentual é convertido em centavos na tela (`vendas/nova/pagamento.ts:72-77`) e o banco só
confere `0 ≤ desconto ≤ subtotal` e `total > 0` (`002:185-195`). Não há regra de quem pode dar desconto nem
teto por papel, e o banco não recalcula percentual para conferir.

**Estoque é informativo e baixa na mesma transação.** A baixa acontece dentro de `registrar_venda`
(`002:284-302`); `011_estoque_informativo.sql` tornou o saldo informativo, então nada bloqueia a venda por
falta de estoque.

**Caixa: o crediário registra mas não entra na gaveta.** A venda no crediário grava movimento
(`002:329-330`), e `v_caixa_atual` só soma `forma = 'dinheiro'` no esperado (`005:149-164`). O fechamento
calcula `esperado = inicial + vendas em dinheiro + recebimentos em dinheiro − |cancelamentos| − |sangrias| +
|suprimentos|` (`018:71-83`) e **congela** contado, esperado, diferença e observação (`018:90-97`).

**Cancelamento devolve estoque, mas só estorna dinheiro.** O estoque volta com movimento `'cancelamento'`
(`003:85-96`); o caixa estorna apenas a parcela em dinheiro (`003:100-111`) — **pix, débito e crédito não
geram estorno nenhum**; o crediário é estornado como um lançamento `'pagamento'` que aponta para a compra
(`003:116-127`). O cancelamento é exclusivo do dono (`003:50`).

**Custo e margem são protegidos por checagem dentro da função, não por RLS.** As funções de lucro e margem
são `security definer` com guarda de papel no corpo (`020:59-90`, `019:94-122`) — e `definer` **ignora
RLS**, então essa guarda é a única barreira. A leitura de `venda_itens.preco_custo` foi revogada de
`authenticated` (`020:169-178`), mas **a escrita não** (`020:117-129`), e `produtos.preco_custo` continua
legível por qualquer usuário logado — declarado como leitura legítima em `020:11-13`.

---

## 4. Riscos ranqueados

Ordenados por dano potencial. Cada linha tem evidência e o gatilho que a dispara.

### P0 — risco financeiro ou perda de dado em uso normal

**P0-1 · Qualquer usuário logado escreve direto nas tabelas de negócio, sem RPC e sem trilha.**
`001_base.sql:217-251` cria, para **8 tabelas** (`produtos`, `clientes`, `caixa_sessoes`, `vendas`,
`venda_itens`, `venda_pagamentos`, `caixa_movimentos`, `estoque_movimentos`, `crediario_lancamentos`), uma
única policy `for all to authenticated using (true) with check (true)`. A segurança repousa inteiramente nas
RPCs `security definer`; **não existe defesa em profundidade no nível da tabela**.
Evidência de que o privilégio existe: `tests/sql/casos/050_permissoes.sql:59-70` roda
`set local role authenticated` e afirma leitura nessas tabelas — e **nenhum teste afirma que INSERT/UPDATE/
DELETE são negados**; `150_permissoes_custo.sql:131` revoga SELECT de `venda_itens` de `authenticated`, o
que só tem efeito se o privilégio de tabela existir por padrão.
Impacto: alterar `total`/`status` de venda, **apagar lançamentos do crediário**, reescrever preço e custo de
item já vendido (`020:117-129`), mudar `limite_credito` e `bloqueado` de cliente (`001:221-223`) — tudo pelo
PostgREST, com a chave pública que já está no navegador (`lib/supabase/client.ts:13-17`).
Gatilho: um `PATCH`/`DELETE` direto. Não exige ataque: qualquer requisição fora do app faz isso.

**P0-2 · O desconto é o único valor monetário decidido fora do banco.**
`app/(app)/vendas/nova/pagamento.ts:68-84` converte o percentual em centavos **na tela**; `registrar_venda`
só confere a faixa (`002:185-195`: `0 ≤ desconto ≤ subtotal` e `total > 0`). O banco **nunca** recebe o
percentual e não tem como reconferir. Não existe regra de quem pode dar desconto, nem teto por papel.
Impacto: venda de qualquer valor por 1 centavo, se o cliente HTTP for adulterado (`total > 0` é a única
barreira) — e, no uso honesto, divergência de arredondamento que ninguém confere.
Gatilho: `Math.round((subtotal * numero) / 100)` em `pagamento.ts:76`, o único `float` que decide valor.

**P0-3 · Preço com 3 ou mais decimais é lido como milhar e vira 1000×.**
`lib/dinheiro.ts:29-46`: o separador só é decimal se tiver **1 ou 2 dígitos** até o fim; três dígitos são
tratados como milhar. `parsearCentavos("26.275")` devolve `2627500` — **R$ 26.275,00** em vez de R$ 26,275.
A prévia da importação não protege: ela mostra os dois lados usando **o mesmo parser**
(`lib/tabela.ts:214-219, 445`), então o erro aparece igualzinho na conferência humana.
Gatilho: planilha de distribuidora com custo unitário de 3 casas, ou célula de fórmula.
Impacto: preço mil vezes maior no balcão, aplicado por importação — e o mesmo parser alimenta o cadastro
manual, então digitar "26.275" no formulário tem o mesmo destino.

> **⚠️ REVISADO EM 15/10/2026 — este item é P1, não P0.** Ao conferir a evidência antes de corrigir, três
> fatos reduziram o alcance: (1) a prévia **já** compara a soma lida com o TOTAL impresso no arquivo
> (`somaConferida`, `formulario.tsx:115`) e lista preços acima do limite do `integer` (`precosZerados`), então
> o caso sistemático com rodapé já era denunciado; (2) três dígitos depois do separador significam **milhar**
> na leitura pt-BR — é o parser que está certo, e "1.234" provando isso; (3) centavos é a unidade atômica do
> schema, então um preço com 3 casas decimais **não existe** no banco. O que sobra — arquivo com ponto
> decimal, 3 casas e **sem** rodapé TOTAL — foi mitigado com aviso na prévia (commit `4649be9`). Ver seção 11.

**P0-4 · Baixa de crediário sem idempotência: o mesmo pagamento pode ser lançado duas vezes.**
`014_receber_pagamento.sql:95-97` sempre insere; não há `unique` em `crediario_lancamentos`
(`001:178-189`) nem em `caixa_movimentos` (`001:142-153`). A única defesa é o botão desabilitado
(`crediario/receber.tsx:107`). A venda tem chave de idempotência (`001:88`); **o pagamento não tem**.
Gatilho: duplo clique, retry de rede ou reenvio da Server Action enquanto houver saldo.
Impacto: dívida baixada em dobro (ou crédito indevido ao cliente) e caixa inflado no
`recebimento_crediario` (`014:101-102`).

### P1 — trava a operação diária

| # | Risco | Evidência | Impacto e gatilho |
|---|---|---|---|
| **P1-1** | **Atendente não consegue fechar o caixa, embora o banco permita** | `caixa/actions.ts:79` exige `papel !== 'dono'`; `018:52-54` libera dono **e** atendente; a tela mostra o formulário (`tela.tsx:205-241`) | O atendente preenche e recebe *"Só o dono pode fechar o caixa."* No dia seguinte, `abrir_caixa` recusa com *"Já existe um caixa aberto"* (`004:45-47`): a operação fica presa até o dono aparecer |
| **P1-2** | **Sessão de caixa errada / caixa não é por operador** | `018:59-64` pega a sessão aberta mais recente **ignorando `terminal`**; `002:100-104` e `014:65-69` fazem o mesmo; `001:78-79` tem índice único por terminal, mas `004:45-47` recusa globalmente | Dois caixas abertos (a tela de dois terminais permite) e um fecha o do outro, congelando `valor_contado`/`esperado_dinheiro` na sessão alheia (`018:90-97`) |
| **P1-3** | **O saldo do crediário desaparece quando a soma assinada é ≤ 0** | `005:137-139` filtra `having saldo > 0`; a RPC usa o valor **assinado** (`014:80-89`); consumidores leem ausência como 0 (`clientes/page.tsx:163`, `[id]/page.tsx:81`, `fusao.ts:109`) | O crédito do cliente some da tela e a RPC recusa com *"O valor é maior que a dívida (-R$ X)"* — `clientes/validacao.ts:199-201` admite a anomalia |
| **P1-4** | **Cancelamento bloqueado por pagamento de OUTRA venda** | `003:62-74` bloqueia se existir **qualquer** `'pagamento'` do mesmo cliente com `criado_em` posterior — inclusive estorno de outro cancelamento (`003:122-127`) | O dono não consegue cancelar uma venda legítima porque o cliente quitou outra parcela depois. `003:54-59` (bloqueio após fechamento do caixa) é regra **projetada**, não defeito — esta é a diferença |
| **P1-5** | **Produto com preço zero é vendável e passa calado** | `009:188-193` cria produto novo com preço 0 quando a planilha não traz a coluna de preço; `011:172,190-193` só recusa se a **venda inteira** der 0 | Item de R$ 0,00 dentro de um carrinho com outro item pago passa sem aviso: perda de receita sem sinal no caixa |
| **P1-6** | **A data exibida pelo agente é valor do modelo** | `deepseek.ts:203-224` pede ao modelo que escolha o período; `orquestracao.ts:594` e `logica.ts:403` alimentam `de/ate`; o título imprime (`logica.ts:438`, `:500-501`, `:760`) | A propriedade "o modelo nunca escreve número" tem uma brecha: ele escreve **a data**. *"Essa semana"* pode virar 30 dias e a resposta sai certa para o período errado — exatamente a classe do bug *"vendas de hoje" respondendo dia 13*, que `deepseek.ts:188-196` registra como já ocorrido. Não há comparação entre o texto da pergunta e o intervalo |
| **P1-7** | **Reserva do agente queimada em falha ambígua, sem varredura** | `orquestracao.ts:419-430` reserva; falha ambígua da 2ª chamada não libera nem liquida (`:488-493`); erros de `reconciliar`/`liberar` são engolidos (`:337-351`); **nada no repo varre reservas `'reservada'`** | 2.746 µ$ ficam consumidos por pergunta que não respondeu, até o fim do mês, sem trilha. Gatilho: 5xx, timeout ou 429 no especialista |

### P2 — dívida que encarece a próxima mudança

| # | Dívida | Evidência |
|---|---|---|
| **P2-1** | Guarda de payload do agente mede o prompt errado: `orquestracao.ts:402` mede o prompt do classificador legado, mas o que sai é `promptAssunto`/`promptFinanceiro` (`deepseek.ts:155-164, 198-225`). `promptFinanceiro` ≈1932 dos 2048 chars assertados; pior caso ≈3932 de `LIMITE_PAYLOAD_BYTES=4096` | `financeiro.test.ts:299`, `logica.ts:27` |
| **P2-2** | Papel barrado **depois** do gasto quando o regex de lucro não pega: 2 chamadas pagas para produzir um 403 | `orquestracao.ts:516-518`, `:587-589` — e `orquestracao.test.ts:630-636` assume isso |
| **P2-3** | `produtos.preco_custo` legível por qualquer logado, enquanto *"margem é só do dono"* | `001:217-219`; `150_permissoes_custo.sql:192` **afirma** que é legível; contradiz `019:119-122`. `020:11-13` declara a leitura legítima — a contradição é o achado |
| **P2-4** | Especialista de Clientes existe e não está ligado: 2 chamadas pagas por pergunta de crediário que sempre recebe a recusa honesta | `logica.ts:279-346` (testado), não importado por `orquestracao.ts:1-23`; `deepseek.ts:137-143` oferece `clientes` ao coordenador |
| **P2-5** | **Não existe `loja_id` em nenhuma das 20 migrations.** A RLS permissiva mais as RPCs `definer` (onde RLS não vale — `019:37-45`) significam reimplementar escopo dentro de cada função | `001:30-43`, `001:160-171`; `codigo_barras` UNIQUE global (`001:32`); `estoque_atual` global (`001:38`) |
| **P2-6** | Importação não cabe no serverless: `alter role authenticated set statement_timeout='120s'` (`010:44`) é teto **global do papel**; trabalho real ~26 s (`010:20`); Hobby 10 s e Pro 60 s (`010:36-39`) | `010:1-19` documenta o caso medido de 9,28 s que gravou **nada** |
| **P2-7** | Guarda de papel duplicada em código e SQL — e as cópias divergiram (P1-1). Cada nova regra exige recriar a função inteira (`018:30`) | `caixa/actions.ts:16` e `:79` vs `018:52-54` |
| **P2-8** | Views exigem `security_invoker` **manual**: uma view nova sem o atributo reabre a leitura anônima (o incidente está documentado em `013:1-27`, medido: `anon` lia `v_estoque_baixo`) | `013:28-38`; alerta repetido em `lib/supabase/client.ts:5-10` |
| **P2-9** | O agente não é observável por decisão: nenhum registro de recusa ou de gasto | `deepseek.ts:10-15`, `orquestracao.ts:341,349` |
| **P2-10** | Erro cru do Postgres chega ao operador (`actions.ts:49` e equivalentes). No clique duplo do PDV, o `unique` de `001:88` produz erro em inglês em vez de replay amigável (`002:93-97` faz check-then-insert sem lock) | `001:88`, `002:93-97` |

### P3 — ergonomia, exibição e limpeza

| # | Item | Evidência |
|---|---|---|
| P3-1 | 7 avisos de lint: 4 de `<img>` e 3 de variável não usada | `npm run lint` (seção 7) |
| P3-2 | Ticket médio com `Math.round(Number(...))` — aritmética de exibição, não decide valor | `vendas/page.tsx:161` |
| P3-3 | `parsearCentavos` não tem guarda de `Number.isSafeInteger`, ao contrário de `parsearQuantidade` | `dinheiro.ts:58` vs `dinheiro.ts:71` |
| P3-4 | Estorno de cancelamento aparece rotulado como "Pagamento" no extrato | `003:122-126`, `clientes/[id]/page.tsx:37-40` |
| P3-5 | O texto `'Saldo importado do sistema antigo'` está duplicado em 4 pontos do código | `015:31-38`, `importar/analise.ts:137` |
| P3-6 | `centavos_em_reais` continua executável por `anon` — só formata inteiro, sem ler dado | `002:14`, sem `revoke` em nenhuma migration |

### O que a auditoria NÃO considera risco (apesar de parecer)

Três coisas que os coletores levantaram e que a verificação na fonte rebaixou. Ficam registradas para não
serem reabertas por engano:

1. **Cancelamento não estorna cartão/PIX.** `003:100-111` estorna só `forma = 'dinheiro'` — e está certo:
   cartão nunca entrou em `esperado_dinheiro`. `v_formas_pagamento` filtra `status = 'concluida'`
   (`005:65`), então a venda cancelada **sai** do faturamento. O que falta é trilha do estorno na operadora
   — nota operacional, não risco financeiro do sistema.
2. **`registrar_venda` não checa papel.** Aceita qualquer perfil ativo (`002:79-88`). Parece furo, mas o
   atendente **precisa** vender; a ausência de regra de desconto (P0-2) é o problema real, não o papel.
3. **Estoque negativo não bloqueia venda.** Decisão consciente e documentada (`011:4-9`): 4878 de 5689
   produtos estavam zerados e 1934 negativos — bloquear tornaria 86% do catálogo invendável.

---

## 5. Arquitetura implícita

O que o código decidiu e que **nenhuma das 5 specs registra**.

### As cinco fronteiras declaradas, conferidas uma por uma

A spec `2026-10-06-sistema-farmacia-design.md:77-85` declara cinco regras. Três se sustentam, duas têm
brecha:

| # | Fronteira declarada | Veredito |
|---|---|---|
| 1 | O navegador envia **intenção**, nunca preço, nunca total | **Parcial.** Preço e total não são enviados (`pdv.tsx:287-295`). Mas o **desconto** chega como valor final (`pagamento.ts:72-77` → `002:185-195`) — e desconto é dinheiro |
| 2 | O Next.js não faz aritmética de dinheiro nem decide regra | **Parcial.** O PDV calcula subtotal, total, troco e desconto (`pagamento.ts:36-84`). O banco reconfere subtotal, total e troco (`002:163-195`, `:271-275`), mas **não tem como reconferir o desconto** |
| 3 | O Postgres decide preço, desconto, limite, estoque, troco e caixa | **Confirmada com uma exceção:** o desconto é a única decisão da lista que o banco aceita pronta |
| 4 | O agente só lê, pelas mesmas views, nunca SQL livre | **Confirmada.** `lib/agente/` não fala com o banco (zero ocorrências), e `app/api/agente/route.ts:56,100` usa lista fechada de views com RPCs nomeadas (`:73,74,156,171,183`) |
| 5 | A chave secreta existe apenas no servidor | **Confirmada.** `DEEPSEEK_API_KEY` só em `lib/agente/deepseek.ts` (marcado `server-only`); `SUPABASE_SERVICE_ROLE_KEY` só em `lib/supabase/privilegiado.ts` |

### Decisões que o código tomou sozinho

- **A segurança real é a RPC, não a RLS.** As policies são `using(true)` para todo `authenticated`
  (`001:217-251`). O modelo mental do projeto é "o front chama RPC"; o banco não tem como impor isso.
- **"Sessão de caixa aberta" significa "a mais recente do sistema".** Implementado em quatro lugares
  independentes: `caixa/page.tsx:24`, `caixa/actions.ts:26`, `004:85-89`, `018:59-64`. A coluna
  `terminal` existe com índice único parcial (`001:66,78-79`), mas `abrir_caixa` recusa a segunda sessão
  **globalmente** (`004:45-47`) — duas regras que nunca foram reconciliadas.
- **Papel é decidido em dois lugares, e as cópias divergem.** `perfis.papel` é a autoridade (não é gravável
  por policy: `001:210-212`), mas a aplicação reimplementa a checagem — e a de `fechar_caixa` ficou para trás.
- **A dívida do cliente é derivada, nunca materializada.** `005:135` recalcula `compra − pagamento` a cada
  leitura; `014:80-83` repete a mesma soma sem o `having`. É o que permite o estorno virar um lançamento
  (`003:116-127`) em vez de um `update` — e é também a origem de P1-3.
- **Cancelamento depois do caixa fechado é bloqueado** (`003:54-59`), cumprindo a decisão consciente nº 3 da
  spec (§17). O texto da exceção ensina a saída: sangria com motivo no caixa de hoje.
- **Estoque é livro-razão, não saldo.** `estoque_movimentos` tem `saldo_apos`, `motivo`, `venda_id` e
  `usuario_id` (`001:160-171`); `produtos.estoque_atual` é a projeção. Foi o que permitiu tornar o estoque
  informativo (`011`) sem perder rastro.
- **`limite_credito = 0` significa "não faz crediário", nunca ilimitado** (`002:253-255`) — decisão de
  segurança registrada só em comentário.
- **Valor ausente ≠ zero** na importação, em três níveis (coluna, linha e célula): `tabela.ts:261-271`,
  `preparacao.ts:30-31`, `009:149-158`.

---

## 6. Dívida técnica e pontos de extensão

### Onde cada módulo da v2 se pluga

| Módulo | Existe hoje | O que falta | Custo de entrada |
|---|---|---|---|
| **NFC-e** | Mapa de pagamentos pronto (`002:304-307`); formato de dinheiro no banco (`centavos_em_reais`, `002:14-31`) | Campo fiscal em `vendas` (`002:278-282` não tem nenhum) e emissão **fora** da transação: o único ponto pós-venda é o retorno (`002:337-338` → `actions.ts:39-53`) | Médio — a transação não pode esperar a SEFAZ |
| **SNGPC / controlados** | `produtos.categoria` e `unidade` (`001:30-43`); dois únicos pontos onde quantidade se move: `002:284-302` e `003:85-96` | Classe, princípio ativo, código ANVISA, receita e lote. `venda_itens` congela nome e preço, mas **não** MS, lote nem receita | Médio-alto — é domínio novo, não coluna nova |
| **Lote e validade (FEFO)** | `estoque_movimentos` é o livro-razão com `saldo_apos` e `motivo` (`001:160-171`) | Saldo por lote e regra de saída FEFO | Alto — muda o consumo de estoque em `002` |
| **Multi-loja** | Nada. Apenas `caixa_sessoes.terminal` (`001:66`) | `loja_id` em produto, estoque, venda, caixa, cliente, relatórios e no ledger do agente; policies reescritas; **e escopo dentro de cada RPC**, porque `definer` ignora RLS (`019:37-45`) | Alto — é reescrita de schema e de todas as portas |
| **App do cliente** | `v_clientes_devedores` é o contrato de saldo, consumido em 5 pontos; `GET /api/clientes/busca` já exige sessão | Autenticação do cliente, e leitura que não dependa de `authenticated` do balcão | Médio |
| **Cobrança** | `linkWhatsApp` (`clientes/validacao.ts:231-239`) monta a mensagem — ninguém envia nada | Fila de cobrança | Baixo |
| **Agente com escrita** | Nada (e a spec `2026-10-09:98` proíbe) | Aprovação humana por ação | Alto |

### Dívida estrutural, por ordem de incômodo

1. **A RLS não protege o que as pessoas imaginam que ela protege** (P0-1).
2. **Cinco prompts e dois níveis de classificação sem guard de payload correto** (P2-1): o freio é uma
   asserção de teste (`<2048` chars), não código de produção.
3. **O dispatch do agente é `if`-chain**: cada especialista novo custa ~55 linhas de ramo duplicado
   (`orquestracao.ts:476-530` vs `:533-614`), mais enum, prompt, validador e montador.
4. **Regra de papel em dois lugares** (P2-7) — já divergiu uma vez.
5. **`security_invoker` é obrigação manual em toda view nova** (P2-8).
6. **Zero observabilidade no agente** (P2-9): não há como medir o que o teto consumiu sem resposta.

---

## 7. Verificação executável

Repositório clonado em 15/10/2026, sem `node_modules` e sem `.env.local`. Node v24.20.0, npm 11.19.0.

**`npm ci`** — sucesso em 47 s:

```
added 412 packages, and audited 413 packages in 47s
5 high severity vulnerabilities
npm warn install-scripts   unrs-resolver@1.12.2 (postinstall: node postinstall.js)
```

Os dois avisos são os mesmos já registrados no `PROGRESSO.md`: as 5 vulnerabilidades altas estão na
toolchain de lint (dependências de desenvolvimento) e o npm 11 bloqueou o `postinstall` do
`unrs-resolver` — lint e build passam assim mesmo, confirmado abaixo.

**`npm run lint`** — saída: `✖ 7 problems (0 errors, 7 warnings)`, exit code 0. Todos os avisos são
`no-img-element` (4 ocorrências em `app/(app)/layout.tsx:61`, `app/(app)/page.tsx:7`,
`app/(auth)/login/page.tsx:49`) e variável não usada (3 em `app/api/agente/orquestracao.ts:22` e no teste
`orquestracao-grafo.test.ts:92-94`). **Zero erros.**

**`npm run build`** — sucesso. Next.js 16.3.8 com Turbopack: compilou em 9,2 s, TypeScript em 8,1 s, 21
páginas geradas, exit code 0. O build produziu a lista de rotas usada na seção 1.

**`npm test`** — sucesso em 2,47 s:

```
Test Files  29 passed | 1 skipped (30)
     Tests  539 passed | 8 skipped (547)
```

As 30 suítes cobrem: agente (12 arquivos), produtos e importação (4), clientes e importação (4), vendas (4),
caixa, relatórios, `lib/` inteiro. Os 8 testes pulados estão em `lib/pdf.test.ts` (6) e
`app/(app)/agente/relativas.test.ts` (2).

**Não executado — declarado como não executado, não como aprovado:**

| Comando | Motivo | O que fica sem prova |
|---|---|---|
| `npm run test:sql` | exige banco; não há `.env.local` | as ~30 asserções de `tests/sql/casos/` — permissões, RLS e corpo das RPCs em execução real |
| `npm run test:sql:concorrencia` | idem | corrida entre transações: abertura de caixa concorrente e idempotência |
| `npm run test:e2e` | exige Supabase e navegadores do Playwright | os dois cenários e2e e a integração real de tela |

**Consequência direta:** todo achado de RLS desta auditoria é **leitura de SQL** — as policies foram lidas
nos arquivos de migration, e o efeito real dos *default privileges* do Supabase não pôde ser medido aqui.
Onde isso enfraquece o achado, ele está marcado.

---

## 8. As cinco decisões

### 1. Dá para aposentar o Nex hoje?

**Não — e o bloqueio maior não é o que a spec aponta.** A spec diz que faltam NFC-e e SNGPC, e isso é
verdade legalmente. Mas a auditoria mostra que o sistema ainda não está pronto **operacionalmente**, por
três motivos independentes do fisco:

- o atendente não consegue fechar o caixa (P1-1), o que trava a operação no fim do dia;
- cancelamento legítimo é recusado por pagamento de outra venda (P1-4);
- qualquer usuário logado pode escrever direto nas tabelas de negócio (P0-1).

**Próximo passo concreto:** corrigir P1-1 antes de qualquer uso em paralelo — é uma linha de código
(`caixa/actions.ts:79`) e hoje ela impede o cenário de teste mais básico.

### 2. O agente em grafo escala?

**Escala em custo, não em estrutura.** O grafo está ligado em produção (`route.ts:249-261`,
`orquestracao.ts:414-417`) e faz **2 chamadas fixas** por pergunta, independentemente do número de
especialistas. Então nem o teto mensal nem os 10 s crescem com especialistas novos.

O que **não** escala:

1. **O prompt do coordenador cresce linearmente** — um bullet por especialista (`deepseek.ts:137-147`). O
   único freio é uma asserção de teste (`<2048` chars), não o guard de runtime, que mede outro prompt
   (P2-1). Hoje `promptFinanceiro` já está em ≈1932 de 2048.
2. **A reserva é fixa em ×2** (`orquestracao.ts:421`) — no dia em que uma pergunta precisar de 3 chamadas
   (encadear caixa e compras), a terceira sai sem reserva.
3. **O dispatch é `if`-chain duplicado** (P2-4 e dívida 3), com um especialista de Clientes já escrito e
   não ligado.

**Veredito:** aguenta chegar a 5 especialistas com as 2 chamadas atuais; a partir daí, o custo do trabalho é
reescrever o dispatch, não o orçamento.

### 3. Multi-loja exige reescrita?

**Sim, reescrita — não é feature flag.** Não existe `loja_id` em nenhuma das 20 migrations. E os três
agravantes: as policies `using(true)` teriam de ser reescritas; as RPCs são `security definer`, então **a
RLS não vale dentro delas** e o escopo por loja teria de ser checado no corpo de cada função (`019:37-45`
documenta o princípio); e `codigo_barras` é UNIQUE global (`001:32`), com `estoque_atual` como coluna única
(`001:38`).

**Próximo passo, se multi-loja for prioridade:** decidir primeiro se o saldo de estoque passa a ser
(produto, loja) — é a decisão que determina se o resto é migração ou reescrita.

### 4. Onde estão os pontos únicos de falha financeira?

Quatro, e **nenhum deles é a transação de venda**:

| Ponto único | O que acontece | Onde |
|---|---|---|
| **Sessão de caixa global** | Dois caixas abertos e um fecha/congela o do outro | `018:59-64`, `002:100-104` |
| **Baixa de crediário sem chave** | Duplo clique baixa a dívida duas vezes | `014:95-97` |
| **Desconto sem autoridade** | Venda a 1 centavo por cliente adulterado | `pagamento.ts:76`, `002:185-195` |
| **Escrita direta nas tabelas** | Qualquer logado altera venda, dívida e limite de crédito | `001:217-251` |

**O que está sólido:** `registrar_venda` é uma função plpgsql única, sem tratamento de exceção nem
transação autônoma. Qualquer `raise` faz rollback integral — **não existe venda pela metade nem estoque
baixado sem venda**. Essa é a propriedade mais forte do sistema e ela merece um teste de regressão próprio.

### 5. Importação aguenta uso real?

**Em transacionalidade, sim** — duas passagens dentro de um statement, tudo-ou-nada (`009:69-131`). **Em
três frentes, não:**

1. **Preço de 3 decimais vira ×1000** (P0-3) — e a prévia não pega, porque usa o mesmo parser.
2. **Produto sem código de barras duplica a cada reimportação** (P1-5): o único campo obrigatório é `nome`
   (`tabela.ts:136`) e a linha sem código passa pelo dedup (`tabela.ts:413`), sempre criando novo
   (`009:137-140`) — catálogo dividido, busca com dois resultados, histórico partido.
3. **O teto de 120 s não cabe no plano Hobby** (10 s) nem folgado no Pro (60 s), com trabalho real de ~26 s
   (P2-6). A solução atual é uma configuração global do papel `authenticated` — ou seja, a importação
   determina o timeout de **todo** o sistema.

---

## 9. Hipóteses (o que NÃO foi provado)

Separado de propósito: nada aqui é fato verificado. Cada item diz o que falta para confirmar.

| Hipótese | Por que não foi provada | Como confirmar |
|---|---|---|
| Os *default privileges* do Supabase concedem INSERT/UPDATE/DELETE em tabela a `authenticated` | Exigiria banco. A inferência é forte: `050:59-70` prova leitura, `150:131` prova que revogar tem efeito, e nenhum teste nega escrita | `select has_table_privilege('authenticated','vendas','update')` |
| O exportador real produz preço com 3+ casas decimais | Não há amostra do arquivo real; `lib/xlsx.test.ts:38` só cobre "4.5" | Uma amostra da planilha da distribuidora |
| A corrida entre cancelamento e pagamento em READ COMMITTED leva o saldo a negativo | A intercalação não foi exercitada; o predicado por `criado_em` (`003:62-69`) é o defeito lógico, a execução é hipótese | `npm run test:sql:concorrencia` contra banco |
| Deadlock entre `receber_pagamento` (`014:75`, só cliente) e `registrar_venda` (`002:241-246`, produtos e depois cliente) | Ordem de lock não exercitada | Teste de concorrência com as duas transações |
| As migrations 017–020 estão aplicadas no banco exatamente como escritas | Sem acesso a `supabase_migrations` | Consultar o histórico de migrations do projeto |
| O teto real de 10 s da Vercel Hobby | Config de runtime não lida; a spec reporta medição própria (`2026-10-15-agente-grafo-design.md:79-103`) | Verificar o plano e medir a rota |
| O driver devolve `bigint` como número ou texto (afeta P1-3) | Depende da versão do PostgREST; a armadilha está documentada em `fusao.ts:35-39` | Uma leitura real da view |
| Os testes de unidade de importação prendem os casos de borda de preço | `importar/actions.test.ts` e `validacao.test.ts` não foram lidos | Ler os dois arquivos |
| O coordenador escolhe `clientes`/`caixa`/`compras` na prática | Sem chamada ao provedor | Log de uma sessão real |

---

## 10. Ordem sugerida de ataque

Não é prescrição — é a leitura da auditoria sobre custo × dano. Os três primeiros são baratos e destravam
o uso em paralelo com o Nex.

| Ordem | Item | Esforço | Por quê primeiro |
|---|---|---|---|
| ~~1~~ | ~~**P1-1** caixa do atendente~~ **FEITO** (`8c97363`) | 1 linha | Travava a operação diária |
| 2 | **P0-2** autoridade do desconto | Migration pequena + **regra sua** | É dinheiro saindo pelo caminho mais curto |
| 3 | **P0-4** chave de idempotência na baixa | Uma coluna `unique` + parâmetro | Mesmo padrão que a venda já usa (`001:88`) |
| 4 | **P0-1** escrita direta nas tabelas | Migração **escrita** (`021`), falta aplicar | Fecha o maior buraco; não exige decisão de escopo |
| 5 | **P0-3 → P1** preço de 3 decimais | **Aviso entregue** (`4649be9`); falta decidir se recusa | A prévia agora avisa; a regra é sua |
| 6 | **P1-6** data do agente | Comparar a pergunta com o período devolvido, ou fixar o período em código | É a classe de bug que já custou um dia |
| 7 | **P1-2** caixa por operador/terminal | Reconciliar `004:45-47` com `001:78-79` | Pré-requisito real de multi-loja |

---

## 11. Atualizações depois da auditoria

A auditoria acima é o retrato do commit `c140fa4`. Esta seção registra o que mudou depois dela, para o
documento não envelhecer mentindo.

### `8c97363` — P1-1 corrigido (atendente fecha o caixa)

A action `caixa/actions.ts` passou a checar o papel por `validarPapelFechamento` (`validacao.ts`), que aceita
dono **e** atendente, espelhando `018:52-54`. A constante `SO_O_DONO` foi removida do caixa — era a única
cópia divergente (as de importação continuam, porque nesses o banco concorda: `009:61-63`, `015:251-253`).
Três testes novos prendem a regressão; a suíte foi de 539 para 542 casos.

### `4649be9` — P0-3 rebaixado para P1 e mitigado

O aviso agora existe onde faltava: `convencaoDecimal` (`lib/tabela.ts`) infere o separador decimal **pelo
próprio arquivo** e a prévia acusa os preços com 3+ dígitos depois desse mesmo separador, mostrando a
contagem e até 5 exemplos. **Nada é recusado nem corrigido** — a linha entra como foi lida e o dono decide.
Sem essa inferência o aviso daria falso positivo em todo arquivo que usa ponto como milhar. Seis testes
novos; a suíte foi de 542 para 548. O que continua em aberto é a **regra**: recusar a linha, ou só avisar.

### P0-1 — a decisão que eu disse que era necessária, não era

Ao preparar a correção, a varredura do repositório inteiro (`.ts`, `.tsx`, `.mjs`, `.js`) mostrou **zero**
`.insert(`, `.update(`, `.delete(` e `.upsert(`: toda escrita passa por RPC `security definer`, que roda com
privilégio do dono e **não depende** do grant de quem chama. Fechar a porta lateral do PostgREST, portanto,
não quebra nada e não exige decidir se o atendente tem escopo — a pergunta do P0-1 continua aberta para
outros fins (leitura e multi-loja), mas não bloqueia esta correção.

**Escrito e NÃO aplicado:** `supabase/migrations/021_fechar_escrita_direta.sql` e o caso
`tests/sql/casos/160_escrita_direta.sql` ficaram **fora do git** de propósito. Aplicar exige o banco de
produção (`npm run migrar 021_fechar_escrita_direta.sql`) e provar exige
`npm run test:sql -- 160_escrita_direta.sql` — e commitar antes disso deixaria a migração armada para o
`npm run migrar` (que aplica todas as pendentes) rodar sem nunca ter passado. Nenhum SQL desta auditoria foi
executado: não havia `.env.local` em nenhuma das duas máquinas.

---

*Auditoria conduzida em 15/10/2026 sobre o commit `c140fa4`, com sete coletores em paralelo (PDV, caixa,
crediário, RLS/views, agente, produtos e verificação executável). Toda evidência citada foi conferida na
fonte antes de entrar na seção 4. Nenhum arquivo do projeto foi modificado além deste documento e da spec e
do plano que o antecedem.*
