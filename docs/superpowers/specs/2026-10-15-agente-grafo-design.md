# Agente em grafo com especialistas — desenho

Data: 15/10/2026
Status: **decisões tomadas pelo Lucas em conversa.** Esta spec ainda precisa da revisão escrita dele antes
de virar plano.

## Objetivo

O agente de hoje responde **5 perguntas** e todos os especialistas leem **o mesmo banco**. O Lucas quer
mais capacidade de interação e escolheu, entre as opções apresentadas, **vários agentes especialistas com
um coordenador**.

**O que ganha sobre "mais intenções numa lista única":** cada especialista carrega **o próprio prompt, o
próprio conjunto de dados e a própria regra de papel**. A lista única de 12 intenções é onde o modelo
começa a confundir perguntas parecidas ("mais vendidos" vs "mais lucrei"); separar por domínio reduz o
universo de cada classificação.

## A decisão que define a segurança do desenho

**O coordenador SÓ ROTEIA.** Ele escolhe o especialista e devolve o texto que o especialista montou **em
código**.

**O modelo NÃO escreve número, em nenhum dos dois níveis.** É a propriedade que o projeto inteiro
sustenta: o bug que custou um dia de trabalho — *"vendas de hoje" respondendo o dia 13* — aconteceu
porque o modelo **inventou uma data**. Hoje isso é impossível por construção, e continua sendo.

Se um dia o coordenador passar a **redigir** a resposta final, esta spec precisa ser reescrita: é outra
classe de risco, e não um ajuste.

## Desenho

```
pergunta
   │
   ▼
COORDENADOR  (1 chamada ao modelo)  → classifica num dos 5 especialistas, ou fora_escopo
   │
   ▼
ESPECIALISTA (1 chamada ao modelo)  → classifica a consulta DENTRO do domínio dele
   │
   ▼
consulta no banco (view ou função)  → o texto é MONTADO EM CÓDIGO
```

**Duas chamadas ao modelo por pergunta** (hoje é uma).

### Os cinco especialistas, e onde cada um lê

| especialista | fonte | trabalho de banco |
|---|---|---|
| **Estoque e margem** | `v_estoque_baixo`, `v_estoque_zerado`, `v_estoque_parado`, `margem_produtos`, `margem_sem_custo` | **nenhum** |
| **Vendas e financeiro** | `relatorio_resumo`, `relatorio_lucro`, `relatorio_formas_pagamento`, `relatorio_mais_vendidos` | **nenhum** |
| **Clientes e crediário** | `v_clientes_devedores`, `v_vendas_historico` | **nenhum** |
| **Caixa** | `v_caixa_atual`, `caixa_movimentos` | **nenhum** |
| **Compras e reposição** | **nada existe** | **do zero** — uma view que cruze giro × estoque × margem |

**Quatro dos cinco não precisam de banco.** É o achado que barateia o trabalho: o sistema já tem 11 views
e 6 funções, e o agente usa uma fração delas.

### Papel, por especialista

- **Margem e lucro: só o dono.** A regra já existe dentro de `margem_produtos` e de `relatorio_lucro` —
  a recusa é do banco, não da tela.
- **Estoque, clientes, vendas e financeiro (sem lucro): os dois papéis.**
- **Caixa: a decidir pelo Lucas.** A tela é dos dois, mas é o dinheiro da gaveta.
- A checagem de papel acontece **antes de qualquer gasto** — mesmo padrão de hoje
  (`orquestracao.ts:377`), provado por teste.

## O orçamento — NÃO precisa de banco (correção de uma afirmação minha anterior)

Eu havia dito ao Lucas que cobrir N chamadas seria "trabalho de banco". **Está errado, e conferi no
código:** `agente_orcamento_reservar(p_mes date, p_micros bigint)` aceita **qualquer valor positivo** e só
o valida contra o teto do mês; `agente_orcamento_reconciliar(p_reserva_id, p_custo_micros)` recebe o custo
**real**.

Então basta: **reservar `N × RESERVA_MICROS`** (hoje `RESERVA_MICROS = 1.373`, o pior caso de uma
chamada) e **reconciliar a soma** dos custos reais das N chamadas. Nenhuma migration.

## O limite de 10 s do Hobby — MEDIDO E RESOLVIDO A FAVOR DO DESENHO

As funções serverless no plano Hobby cortam em 10 s. Eu tratei isso como o risco número um, **estimando
~3 s por chamada**. **A medição diz outra coisa** (sonda em 15/10/2026, contra a API real, modelo
`deepseek-flash`, `temperature: 0`, JSON mode):

| etapa | tempo | tokens |
|---|---|---|
| chamada do **coordenador** | **791 ms** | 231 de entrada, 71 de saída |
| chamada do **especialista** | **525 ms** | 160 de entrada, 120 de saída |
| **as duas, sequenciais** | **1.316 ms** | — |
| **sobra do teto de 10 s** | **8.684 ms** | — |

**O desenho cabe com folga.** Sobram quase 9 segundos para as consultas e o resto da rota. A estimativa de
~3 s por chamada estava errada por um fator de 4 — provavelmente ela media a **rota inteira** (autenticação,
banco, montagem), não a chamada ao modelo.

**O que continua valendo para quem implementar:**
1. **Medir o tempo de ponta a ponta da rota depois de pronta** — a sonda mediu as chamadas, não a rota com
   as duas dentro. O teto é 10 s, e a soma real importa.
2. O `TIMEOUT_MS = 10_000` por chamada **continua maior que o teto da função**: uma chamada que pendure
   sozinha estoura o limite do Hobby antes do próprio timeout disparar. Isso **já é verdade hoje**, com uma
   chamada só, e não é regressão deste desenho — mas o grafo acrescenta uma segunda chance de acontecer.
3. Não confundir com o problema da **importação do catálogo** (26 s), que é de outra natureza: lá o tempo é
   de trabalho de banco em lote, não de chamadas ao modelo.

## A tensão do prompt, herdada do projeto anterior

Com 5 especialistas, o prompt do coordenador volta a ser uma lista curta (5 itens), o que é **melhor** que
os 12 de uma lista única. Mas cada especialista terá a própria lista, e o total de texto de prompt no
sistema cresce. O guarda de payload (`LIMITE_PAYLOAD_BYTES = 4096`) e a asserção de `logica.test.ts`
(prompt < 2048) valem **por prompt**, e cada um precisa ser medido.

## O que NÃO entra (YAGNI)

- **Coordenador redigindo a resposta.** Decidido: não. Reabrir exige spec nova.
- **O agente escrever no sistema** (dar baixa, registrar, fechar caixa). O documento de design do próprio
  Lucas diz *"Somente leitura"* para o assistente, e escrita é outro subsistema: confirmação humana,
  papel, trilha de auditoria.
- **As 7 perguntas de leitura aprovadas antes desta conversa.** Elas são exatamente o conteúdo de três dos
  cinco especialistas — implementá-las planas e depois reconstruir como grafo seria **trabalho dobrado**.
  Ficam **substituídas** por este desenho.
- **Memória entre perguntas, histórico de conversa, streaming.** Nada disso foi pedido.

## Verificação

- **O tempo de ponta a ponta, medido**, é o primeiro teste — não o último.
- Casos unitários por especialista: a classificação dentro do domínio, o texto montado em código, a
  recusa de papel, e a **recusa local antes do gasto**.
- Um teste provando que **o coordenador só roteia** — nenhum caminho deixa o modelo redigir número.
- O orçamento: reserva de `N × RESERVA_MICROS` e reconciliação da **soma**, com teste de que uma falha no
  meio do grafo libera ou mantém a reserva conforme a fronteira pré-envio/ambígua que já existe.
- Aceite real contra o banco, nas mesmas condições do aceite do agente de margem.

## Riscos declarados

1. **O limite de 10 s do Hobby** — o mais provável de matar o desenho. Medir primeiro.
2. **Duas chamadas dobram o custo** (de 144 para ~300–500 microdólares por pergunta) e o teto de US$ 5/mês
   cai de ~3.600 para ~1.000–1.600 perguntas. É aceitável, mas o dono precisa saber.
3. **Cinco especialistas, cinco prompts, cinco regras de papel** — a superfície para divergência cresce, e
   a etapa anterior provou (três vezes) que divergência entre partes que deviam concordar é o defeito mais
   comum deste projeto.
4. **Compras e reposição começa do zero**, e sugerir compra é a única parte que **recomenda** algo em vez
   de relatar. Se ela errar, o dono compra errado. Merece tratamento próprio.
