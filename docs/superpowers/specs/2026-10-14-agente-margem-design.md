# Agente de margem — desenho aprovado em conversa

Data: 14/10/2026
Status: **desenho aprovado pelo Lucas em conversa.** Esta spec ainda precisa da revisão escrita dele
antes de virar plano.

## Objetivo

O agente passa a responder **onde a margem está ruim**, e não só quanto se lucrou. Hoje ele responde
quatro intenções (vendas do dia, mais vendidos, estoque baixo, estoque parado) e nenhuma delas olha
para custo.

**O que o Lucas pediu, nas palavras dele:** *"quero que ele observe onde dá para melhorar nas margens
de vendas, o que eu estou perdendo."* Perguntado sobre qual perda importava primeiro, escolheu
**margem** ("vendi barato demais ou abaixo do custo").

## Decisões (tomadas em conversa, 14/10/2026)

1. **O que a resposta entrega:** um **ranking dos 10 produtos de pior margem** no período, com receita,
   custo e margem de cada um.
2. **Caminho A:** fonte de dado nova por produto **e** fechar a leitura direta do custo histórico no
   mesmo trabalho. Construir análise de margem sobre um custo que qualquer usuário lê pela API seria
   incoerente.
3. **Período padrão: últimos 30 dias.** Período explícito continua aceito, com o teto de 31 dias que
   vendas já tem.
4. **Margem SOBRE RECEITA**: `(receita − custo) ÷ receita`. É o número que responde "quanto de cada
   real é lucro", que é o que se usa para decidir preço. (A alternativa — markup sobre custo — lê
   parecido e diz outra coisa; foi descartada nesta rodada.)
5. **Só o dono vê.** A regra já existe no sistema: `relatorio_lucro` recusa qualquer papel que não seja
   `dono` com *"Só o dono vê o lucro."*
6. **Produto sem custo cadastrado fica FORA do ranking**, e a resposta diz quantos ficaram de fora.
   Tratá-los como margem de 100% seria mentira numérica. Hoje são **766 de 5.689** produtos ativos.

## Correção do caminho A durante o desenho

A conversa falou em "view nova". Ao ler o padrão do projeto, **view não aceita período**: quem trata
período no sistema é **RPC**, e são quatro (`relatorio_resumo`, `relatorio_lucro`,
`relatorio_formas_pagamento`, `relatorio_mais_vendidos`, todas `(p_de date, p_ate date)` com
`returns table`, **sem `security definer`**, com a checagem de papel DENTRO da função).

Então a fonte nova é **função**, não view. O espírito do caminho A fica igual — fonte nova por produto
e o custo fechado — e o mecanismo passa a ser o que o projeto já usa.

## As duas funções

São **duas** porque o projeto já separa uma função por pergunta (`relatorio_resumo`, `relatorio_lucro`,
`relatorio_formas_pagamento` e `relatorio_mais_vendidos` são quatro funções, não uma com parâmetro de
modo). Uma devolve o ranking; a outra, a contagem do que ficou de fora.

### `public.margem_produtos(p_de date, p_ate date, p_limite integer default 10)`

```sql
returns table (produto_id uuid, nome text, quantidade bigint, receita bigint, custo bigint, margem bigint)
```

- Considera apenas vendas com `status = 'concluida'` e o dia em São Paulo, como o resto do sistema.
- `receita = Σ preco_unitario × quantidade`; `custo = Σ preco_custo × quantidade`;
  `margem = receita − custo`.
- **Exclui** item cujo `preco_custo` seja 0 (sem custo cadastrado).
- **Ordena pelo PERCENTUAL de margem crescente** — `margem ÷ receita` —, com desempate pelo valor em
  reais. Decidido aqui, e não deixado para depois: ordenar pelo valor em reais colocaria um produto de
  R$ 2 com margem de R$ 1 acima de um de R$ 200 com margem de R$ 10, e o pior percentual é o que
  responde "onde eu marco errado". A resposta mostra **os dois números**, para o dono ver o caso
  pequeno e o caso grande sem precisar de duas perguntas.
- Corta em `p_limite`.
- **Recusa qualquer papel que não seja `dono`** com a mensagem que já existe: *"Só o dono vê o lucro."*
- Recusa período nulo, invertido ou maior que 31 dias, com a mesma validação que `relatorio_lucro` usa.
- Permissões: `revoke all ... from public, anon` + `grant execute ... to authenticated, service_role`,
  como as quatro funções irmãs.

### `public.margem_sem_custo(p_de date, p_ate date)`

```sql
returns table (sem_custo bigint)
```

Conta os produtos **vendidos no período** que ficaram de fora por não ter custo. Mesma checagem de
papel e mesmas permissões.

## Fechar a exposição do custo — escopo exato

O levantamento mostrou que "custo" são **três coisas diferentes**, e só duas podem ser fechadas:

| onde | quem lê hoje | ação |
|---|---|---|
| `produtos.preco_custo` | a tela do produto (`app/(app)/produtos/[id]/page.tsx:52`) e o formulário de edição | **NÃO MEXER** — é leitura legítima e o atendente usa essa tela |
| `venda_itens.preco_custo` | **nenhuma tela** — só relatório por RPC | **fechar** a leitura direta para `authenticated` |
| `v_lucro_periodo` | relatório pela RPC `relatorio_lucro` | **conferir** se alguma tela a lê direto antes de fechar |

Esta é a dívida que o `PROGRESSO.md` já registrava: *"custo/lucro acessíveis via PostgREST direto para
`authenticated` por `venda_itens.preco_custo` e `v_lucro_periodo` (policy `using (true)` da v1)"*.

## A intenção no agente

- O prompt de classificação ganha a quinta intenção. O modelo **só classifica** — o texto da resposta
  continua sendo montado **em código**, que é a propriedade que impede o modelo de inventar número.
- A pergunta de margem vinda de **atendente é recusada antes de qualquer envio ao provedor** — mesmo
  tratamento da pergunta clínica e da com PII: recusa local, em português, sem reserva de orçamento.
- O período padrão é 30 dias; período explícito passa pela validação que vendas já usa.

## A resposta na tela

O ranking, uma linha por produto, com receita, custo e margem — e, quando houver, a linha
*"N produtos ficaram de fora por não ter custo cadastrado."*

## O que NÃO entra nesta rodada (YAGNI)

- Ruptura ("faltou o produto e perdi a venda") e dinheiro parado: o Lucas escolheu **margem** primeiro.
  Ficam registrados como próximos, não como escopo.
- Comparar preço praticado com o de tabela (desconto no balcão): é outra análise, com outro dado.
- Gráfico, exportação, agendamento de relatório: nada disso foi pedido.

## Verificação

- **Casos SQL** novos para as duas funções: ordenação pela pior margem, corte do `p_limite`, exclusão
  do item sem custo, contagem do `margem_sem_custo`, recusa de papel não-dono, período nulo/invertido e
  o teto de 31 dias. Nascem **vermelhos** contra a migration anterior, como o caso `130` fez.
- **Testes unitários** para o prompt (a intenção nova) e para o montador da resposta (ranking, margem
  sobre receita, a linha dos sem-custo, e a recusa local).
- **Aceite real** contra o banco, que hoje tem vendas com custo gravado.
- **`npm test`**, `tsc`, lint, build e a suíte SQL inteira.

## Riscos declarados

1. **Mudar permissão pode quebrar tela.** Mitigado pelo levantamento acima: só `venda_itens` é fechada
   de imediato, e `v_lucro_periodo` só depois de conferir quem lê.
2. **766 produtos sem custo** (13% do catálogo) não aparecem em análise de margem. É limitação do dado,
   não do desenho — e a resposta diz o número em vez de escondê-lo.
3. **O ranking ordena pelo percentual, e isso é uma escolha com consequência.** Um produto de R$ 2 com
   margem de R$ 1 (50%) fica acima de um de R$ 200 com margem de R$ 10 (5%) — e é o segundo que tira
   dinheiro da farmácia em volume. Por isso a resposta mostra **os dois números** (reais e percentual) e
   não só o critério de ordem. Se a ordenação por valor em reais for a desejada, é uma linha da função.
