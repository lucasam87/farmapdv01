# Auditoria da arquitetura atual — desenho

Data: 15/10/2026
Status: **decisões tomadas pelo Lucas em conversa** (abordagem 1: fluxos críticos + perguntas de decisão).
Esta spec precisa da revisão escrita dele antes de virar plano.

## Objetivo

O sistema já tem 20 migrations, 83 arquivos em `app/`, 22 em `lib/`, 33 em `tests/`, 5 specs e 7 planos.
A arquitetura real, porém, **não está escrita em lugar nenhum**: ela está distribuída entre o
`PLANO-SISTEMA-FARMACIA.md`, o `PROGRESSO.md` (65 KB de ledger) e o que o código decidiu sozinho ao longo de
nove etapas.

Esta auditoria produz **um documento**: o mapa da arquitetura como ela é hoje, com os riscos ordenados por
dano. Ela não conserta nada, não cria migration e não toca banco remoto. Serve para o Lucas escolher o que
atacar em seguida.

## Público e uso (decidido pelo Lucas)

**Para o Lucas decidir os próximos passos.** Detalhe no nível de decisão e fronteira — qual camada decide o
quê, onde estão os acoplamentos, o que quebra se mexer. Não é manual de linha de código, e não é documento
de produto para terceiros.

## Entregáveis

| Artefato | Caminho |
|---|---|
| Esta spec | `docs/superpowers/specs/2026-10-15-auditoria-arquitetura-design.md` |
| Plano de execução | `docs/superpowers/plans/2026-10-15-auditoria-arquitetura.md` |
| **Documento final** | `docs/auditoria-arquitetura-2026-10-15.md` |

## Estrutura do documento final

| # | Seção | O que traz |
|---|---|---|
| 1 | **Mapa em uma página** | As quatro camadas reais — `app/` (App Router), `lib/` (puro e testável), `supabase/migrations` (regra de negócio mora no Postgres), agente — e quem chama quem |
| 2 | **Fluxos críticos rastreados** | venda (`vendas/nova` → RPC `registrar_venda`), caixa, crediário, relatórios, agente: do clique à migration, com as funções e views de cada passo |
| 3 | **Onde o dinheiro é decidido** | centavos inteiros (nunca float), custo e margem (`019`, `020`), cancelamento (`003`), fechamento (`018`), RLS e views de segurança (`013`) |
| 4 | **Riscos ranqueados** | escala P0–P3, cada linha com impacto, evidência e recomendação |
| 5 | **Arquitetura implícita** | decisões que o código tomou e que **não** estão em nenhuma das 5 specs |
| 6 | **Dívida e pontos de extensão** | onde plugar v2 (fiscal, SNGPC, multi-loja, app do cliente) sem reescrever |
| 7 | **Verificação executável** | saída real de `npm ci`, `lint`, `build`, `test` — e o que não rodou, declarado como não rodado |
| 8 | **Decisões respondidas** | as perguntas abaixo, cada uma com veredito e o que falta para destravar |

### As perguntas de decisão (seção 8)

1. **Dá para aposentar o Nex hoje?** O plano declara a v1 sem NFC-e e sem SNGPC. O que mais falta, de fato.
2. **O agente em grafo escala?** Mais especialistas e mais perguntas contra o teto de custo e o limite de
   10 s do Hobby — o que estoura primeiro.
3. **Multi-loja exige reescrita?** Se o modelo de dados já tem o eixo de loja em produtos, estoque e venda,
   ou se é reescrita de schema.
4. **Onde estão os pontos únicos de falha financeira?** Cancelamento de venda, fechamento de caixa,
   baixa de crediário — o que acontece se cada um falhar no meio.
5. **Importação aguenta uso real?** Produtos e clientes: dado sujo, duplicado, planilha grande (as
   migrations `008`–`011` e `010_importacao_timeout` sugerem que já doeu).

## Método: como cada seção é provada

- **Seções 1–3** saem do rastreamento dos fluxos: começa na rota em `app/`, segue para a chamada em `lib/`,
  termina na função ou view do Postgres. O caminho inteiro é citado, não resumido.
- **Seção 4** nasce de candidatos levantados na coleta, não de opinião: cada risco precisa apontar o ponto
  exato do código e o que ele causa.
- **Seção 5** compara o que as 5 specs dizem com o que o código faz. Divergência é achado.
- **Seção 6** lista os pontos de extensão que já existem e os que faltam, por módulo da v2.
- **Seção 7** é resultado de comando, colado.
- **Seção 8** é redação sobre as seções anteriores — nenhuma pergunta se responde por intuição.

## Regra de evidência (a regra que dá valor ao documento)

Todo achado carrega **`arquivo:linha` ou nome da migration**, mais o comando ou a leitura que o provou.

O que não der para provar **não vira achado**: vai para uma seção separada, marcada como **hipótese**, com
o que seria necessário para confirmar. Documento sem essa separação transforma palpite em fato — foi o erro
que já custou um dia de trabalho no projeto do agente ("vendas de hoje" respondendo dia 13).

## Escala de priorização

Ordenação por **dano potencial**, nunca por facilidade de conserto.

| Nível | Significado |
|---|---|
| **P0** | Risco financeiro ou perda de dado com o sistema em uso normal |
| **P1** | Trava a operação diária da farmácia, ou exige intervenção manual para contornar |
| **P2** | Dívida que encarece a próxima mudança de código |
| **P3** | Ergonomia e estética |

## Verificação executável — o que roda e o que não roda

**Roda neste ambiente** (Node 24.20.0, npm 11.19.0, repositório recém-clonado, sem `node_modules`):

| Comando | Observação |
|---|---|
| `npm ci` | npm 11 bloqueia install scripts por padrão — o `postinstall` do `unrs-resolver` já foi bloqueado antes e build/lint passam assim mesmo |
| `npm run lint` | |
| `npm run build` | |
| `npm test` | suíte vitest |

**Não roda aqui, e será declarado como não executado:**

| Comando | Por quê |
|---|---|
| `npm run test:sql` | exige banco — não existe `.env.local` neste clone |
| `npm run test:sql:concorrencia` | idem |
| `npm run test:e2e` | exige Supabase e navegadores do Playwright |

Consequência declarada: **todo achado sobre RLS, policies e comportamento real do Postgres é leitura de SQL,
não execução.** Isso entra no documento como limitação, no topo da seção 7 — nunca como "passou".

## Como o trabalho roda

A coleta pesada vai para subagentes paralelos, cada um com um recorte e devolvendo **fatos com evidência**,
não prosa. Isso preserva contexto para a redação, em vez de gastá-lo lendo 138 arquivos.

| Coletor | Recorte |
|---|---|
| F1 | PDV e venda: `app/(app)/vendas`, `lib/dinheiro.ts`, migrations `002`, `003`, `012`, `020` |
| F2 | Caixa: `app/(app)/caixa`, migrations `004`, `018` |
| F3 | Clientes e crediário: `app/(app)/clientes`, `app/(app)/crediario`, migrations `014`, `015` |
| F4 | Relatórios, views e RLS: migrations `005`, `013`, `016`, `019`, `app/(app)/relatorios` |
| F5 | Agente: `lib/agente`, `app/api/agente`, migration `017` e as 3 specs do agente |
| F6 | Suíte de testes e verificação executável (dona da seção 7) |
| F7 | Produtos, estoque e importação — **cobertura fina**, migrations `006`–`011` |

**Cada coletor devolve:** caminhos com linha, o que o fluxo faz, riscos candidatos com impacto, pontos de
extensão, e **o que não conseguiu verificar**.

**Limite de escopo dos coletores:** leitura apenas. Nenhum deles altera arquivo, cria migration ou executa
comando que escreva. A única exceção é o F6, que roda `npm ci` e os comandos de verificação.

## O que NÃO entra (YAGNI)

- Alterar código, corrigir bug, refatorar, criar migration — a auditoria **descreve e prioriza**; conserto
  vira item de backlog, em seção própria, para você decidir depois.
- Tocar o Supabase remoto, aplicar migration, rodar SQL de escrita.
- Auditoria de segurança ofensiva ou pentest. Segurança entra só onde cruza dinheiro e dado de cliente.
- Reescrever a documentação existente (`PLANO-SISTEMA-FARMACIA.md`, `PROGRESSO.md`, as 5 specs): o documento
  referencia, não substitui.
- Relatório de produto para terceiros — o leitor é o Lucas.

## Riscos declarados

- **Ambiente sem banco enfraquece as seções 3 e 4.** RLS e policy são lidas, não exercitadas. Mitigação:
  dizer isso na cara do documento e marcar cada achado de RLS com a origem (leitura de SQL).
- **A coleta em subagente pode inventar achado.** Mitigação: a regra de evidência é aplicada por mim na
  redação — achado sem `arquivo:linha` provado não entra na seção 4, vai para hipóteses.
- **`npm ci` pode falhar por bloqueio de install script do npm 11.** Se falhar, o documento registra a falha
  e o comando de contorno (`npm approve-scripts unrs-resolver`), sem esconder.
- **Documento virar textão.** Mitigação: mapa em uma página na seção 1; o resto por tabela e lista curta.

## Verificação e aceite

O documento está pronto quando:

1. as 8 seções existem e a seção 1 cabe em uma página;
2. **todo** item da seção 4 aponta arquivo:linha ou migration, e a evidência foi conferida por mim, não só
   relatada pelo coletor;
3. hipóteses estão em seção separada das confirmações;
4. a seção 7 cola a saída real dos comandos e declara explicitamente o que não rodou e por quê;
5. cada uma das 5 perguntas de decisão tem veredito e próximo passo concreto;
6. nenhum arquivo do projeto foi modificado além do próprio documento (conferido por `git status`).
