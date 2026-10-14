-- 019_margem_produtos.sql — as duas leituras de MARGEM por produto (Task 1 do
-- plano do agente de margem).
--
-- POR QUE DUAS FUNCOES, e nao uma com um "modo": as duas respondem perguntas
-- diferentes do mesmo periodo. `margem_produtos` responde "quais produtos estao
-- perdendo margem" (ranking, com corte) e `margem_sem_custo` responde "quantos
-- produtos vendidos ficaram FORA do ranking" (um numero) — fora por falta de custo
-- cadastrado OU por falta de receita (brinde). A contagem NAO pode ser uma linha do
-- ranking: o produto sem custo nao tem percentual (o custo que o formaria e
-- desconhecido) e o de receita zero dividiria por zero; o agente precisa dizer em
-- portugues que N produtos ficaram de fora — e nao inventar um percentual para eles.
--
-- REGRAS QUE VALEM NAS DUAS (as mesmas das quatro de 016_relatorios.sql):
--   * `v.status = 'concluida'` em toda agregacao: venda cancelada nao entra.
--   * O dia de cada venda e `(criado_em at time zone 'America/Sao_Paulo')::date`
--     — a MESMA expressao de 005_views.sql:16 e de 016.
--   * Intervalo INCLUSIVO nas duas pontas: `between p_de and p_ate`.
--   * Toda tabela referenciada QUALIFICADA (`public.vendas`, `public.venda_itens`).
--
-- DIVERGENCIA DELIBERADA DA IRMA (ruling do plano): `relatorio_lucro` NAO levanta
-- excecao para periodo torto — ela devolve zeros. Aqui o periodo torto e RECUSADO.
-- O motivo e o consumidor: quem le o lucro e uma tela, que ja validou o periodo
-- antes; quem le a margem e um AGENTE, e para ele "nenhum produto perdeu margem"
-- (zeros) e uma resposta FALSA sobre a farmacia, e nao uma recusa. Recusar e a
-- unica resposta honesta quando o periodo pedido nao faz sentido.
--
-- SEGURANCA — `security definer` AQUI, ao contrario das quatro de 016 (ruling R2
-- do ledger, e a divergencia mais importante deste arquivo):
--
--   As funcoes de 016 sao `security invoker` e leem `venda_itens.preco_custo`
--   porque QUEM CHAMA tambem le: a leitura direta do custo esta aberta a
--   `authenticated` hoje (medido em 14/10/2026). A Task 2 fecha essa leitura — e
--   ao fechar, uma funcao `invoker` deixaria de enxergar o custo e a margem (e o
--   proprio relatorio de lucro) sairiam zerados em silencio. `security definer`
--   e o que permite fechar a porta lateral SEM fechar a funcao.
--
--   O PRECO DISSO, escrito para nao ser esquecido: `security definer` roda como o
--   dono do banco e a RLS simplesmente NAO e aplicada. Por isso a checagem de
--   papel dentro da funcao (`if v_papel is distinct from 'dono' then raise`) deixa
--   de ser redundante com a RLS e passa a ser a UNICA barreira entre o atendente e
--   o custo. O caso 7 de 140_margem.sql prova a recusa chamando a funcao DIRETO,
--   sem passar pela tela — e o caso 0 do mesmo arquivo prova que ela nao e `invoker`.
--   `set search_path = public, pg_temp` e obrigatorio em definer (mesma regra das
--   fixtures e da 002): sem ele, um schema no caminho do chamador poderia
--   sequestrar a funcao.
--
-- O RANKING NAO DEVOLVE `percentual` (ruling R1): `numeric` do Postgres chega pelo
-- PostgREST como STRING em JSON, e o percentual viraria `NaN` justamente no numero
-- que ordena a resposta. A funcao devolve SO INTEIROS (receita, custo, margem) e
-- ORDENA por percentual internamente; quem monta o texto calcula o percentual em
-- codigo puro, a partir destes inteiros.

-- ============================================================
-- margem_produtos — o ranking dos produtos que PIOR convertem receita em margem.
--
-- A ORDEM e por percentual (`margem / receita`) CRESCENTE, com desempate pelo
-- valor em reais (`margem` crescente) e depois pelo nome (para a ordem nao
-- depender do plano de execucao). Ordenar pelo valor em reais daria outra lista:
-- o produto que vende pouco e caro com margem ruim em percentual fica invisivel
-- quando a conta e em reais, e e exatamente esse que "esta perdendo margem".
--
-- DUAS EXCLUSOES, e as duas sao regra de negocio e nao detalhe de SQL:
--
--   1. `preco_custo > 0` — "sem custo cadastrado" NAO e "custo zero". O produto
--      com `preco_custo = 0` daria percentual 100% (o MELHOR lugar do ranking)
--      para o produto cujo custo a farmacia desconhece: o ranking mentiria na
--      direcao mais perigosa. Ele sai do ranking e entra na contagem de
--      `margem_sem_custo`. ATENCAO ao escopo do filtro: ele e por ITEM, entao um
--      produto com itens de custo MISTO no periodo entra no ranking COM os itens que
--      tem custo (e nao entra na contagem) — o par ranking/contagem e decidido por
--      PRODUTO, e nao item a item (ruling R4).
--   2. `receita > 0` — brinde ou desconto de 100%. `margem / receita` DIVIDE POR
--      ZERO nesta linha; ela nao pode entrar no ranking de percentual. E o caso
--      que o Review Focus 1 do plano exige. Quem fica de fora por este motivo
--      TAMBEM e contado por `margem_sem_custo` (ruling R7): com custo 300 e receita
--      zero o produto tem margem -300, e deixa-lo fora das duas respostas faria o
--      agente dizer "nenhum produto com margem ruim" com ele na tela.
--
-- `p_limite` FORA DE 1..10 E RECUSA (ao contrario de `relatorio_mais_vendidos`,
-- que corta em zero e devolve lista vazia): o limite aqui vem do agente, e um
-- pedido de 0 resultados nao tem leitura util — e melhor recusar que devolver
-- vazio, que o agente narraria como "nenhum produto com problema".
--
-- A BUSCA DE NOME usa `max(i.nome_produto)` pelo mesmo achado M6 da revisao da
-- Task 1 de 016: `venda_itens.nome_produto` e uma COPIA do nome do dia da venda,
-- entao agrupar por (produto_id, nome_produto) partiria o produto em DUAS linhas
-- se ele fosse renomeado no meio do periodo — e o `limit` poderia cortar uma delas
-- em silencio.
-- ============================================================
create or replace function public.margem_produtos(p_de date, p_ate date, p_limite integer default 10)
returns table (produto_id uuid, nome text, quantidade bigint, receita bigint, custo bigint, margem bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_papel text;
begin
  -- ---- 1. periodo ANTES de tudo (mesma ordem de relatorio_lucro) ----
  -- O teto e o DIAS_MAXIMOS da tela do agente, e o app conta DATAS INCLUSIVAS: ele
  -- recusa `> 31` em `logica.ts`, isto e, aceita no maximo 31 datas (de 01/01 a
  -- 31/01), que e `ate - de <= 30`. O banco tem de recusar o MESMO conjunto, senao
  -- sobra um periodo que o app manda e a funcao recusa — por isso `> 30`, e nao
  -- `> 31` (ruling R5 da revisao). A mensagem diz "31 dias" (a contagem de datas do
  -- app) e "30 dias de intervalo" (a conta que o banco faz): as duas leituras do
  -- mesmo teto cabem no texto, e o caso 5 prende as duas.
  if p_de is null or p_ate is null or p_de > p_ate or (p_ate - p_de) > 30 then
    raise exception 'Período inválido: de e até são obrigatórios, em ordem, com no máximo 31 dias (30 dias de intervalo).';
  end if;

  -- ---- 2. limite fora de 1..10 ----
  if p_limite is null or p_limite < 1 or p_limite > 10 then
    raise exception 'Limite inválido: informe um valor entre 1 e 10.';
  end if;

  -- ---- 3. A UNICA barreira: a funcao e `security definer`, entao a RLS nao
  -- vale aqui dentro e nenhum privilegio de tabela segura o custo por nos. ----
  select p.papel into v_papel from public.perfis p where p.id = auth.uid();
  if v_papel is distinct from 'dono' then
    raise exception 'Só o dono vê o lucro.';
  end if;

  return query
    with agregado as (
      select i.produto_id,
             max(i.nome_produto)                      as nome,
             sum(i.quantidade)::bigint                as quantidade,
             sum(i.total)::bigint                     as receita,
             sum(i.preco_custo * i.quantidade)::bigint as custo
      from public.venda_itens i
      join public.vendas v on v.id = i.venda_id
      where v.status = 'concluida'
        and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
        and i.preco_custo > 0
      group by i.produto_id
      having sum(i.total) > 0
    )
    select a.produto_id,
           a.nome,
           a.quantidade,
           a.receita,
           a.custo,
           (a.receita - a.custo)::bigint as margem
    from agregado a
    order by (a.receita - a.custo)::numeric / a.receita asc,
             (a.receita - a.custo) asc,
             a.nome
    limit p_limite;
end $$;

comment on function public.margem_produtos(date, date, integer) is
  'Ranking dos produtos com PIOR margem sobre a receita do periodo (fuso de Sao Paulo), pior percentual primeiro. Exclui produto sem custo cadastrado (nenhum item com preco_custo > 0 no periodo) e produto sem receita (brinde), que ficam na contagem de margem_sem_custo. SO O DONO. Devolve so inteiros: o percentual e calculado em codigo, a partir de receita/custo/margem.';

-- ============================================================
-- margem_sem_custo — quantos PRODUTOS vendidos no periodo ficaram fora do ranking.
--
-- E o numero que o agente precisa para nao mentir por omissao: o ranking pode vir
-- vazio (ou curto) porque a farmacia nao cadastrou custo, e nao porque a margem
-- esta boa. Sem esta contagem, "nenhum produto com margem ruim" seria uma
-- conclusao falsa a partir de um dado ausente.
--
-- A CONTAGEM E POR PRODUTO, e nao por item (ruling R4 da revisao). A primeira
-- versao contava `i.preco_custo = 0`, e o ranking seleciona `i.preco_custo > 0`;
-- um produto com itens de CUSTO MISTO no periodo — venda antes e depois de a
-- importacao de precos preencher `produtos.preco_custo`, que e exatamente como o
-- dado real chega — aparecia nos DOIS lados. O comentario "ficou fora do ranking"
-- virava falso e o numero narrado ao dono SUPERESTIMAVA os produtos sem custo.
-- Agora um produto entra nesta contagem quando NAO TEM NENHUM item que o ranking
-- aceitaria; quem tem pelo menos um item com custo E receita esta no ranking, e so
-- nele.
--
-- A CONDICAO E O COMPLEMENTO EXATO DO RANKING (correcao R7): o ranking aceita o item
-- de `preco_custo > 0` E `total > 0`, entao esta contagem pega todo produto que nao
-- tem nenhum item assim. Sao DUAS categorias, e o `not bool_or(...)` cobre as duas
-- de uma vez, sem lista de casos:
--   1. sem custo cadastrado (nenhum item com `preco_custo > 0`); e
--   2. com custo e SEM RECEITA (brinde, desconto de 100%) — `margem / receita`
--      dividiria por zero, entao o ranking nao pode te-lo. Sem isto, o PIOR caso de
--      margem que existe (custo 300 e receita 0, margem -300) nao apareceria em
--      resposta nenhuma, e o agente diria "nenhum produto com margem ruim" com ele
--      na tela. Comparar o par (ranking, contagem) e o que garante que os dois
--      NUNCA discordem: e o defeito que originou o R4, e um `having` que enumerasse
--      casos (como o `max(i.preco_custo) = 0` da versao anterior) voltaria a
--      divergir na proxima regra nova.
--
-- CONTA PRODUTOS, e nao itens: o mesmo produto sem custo vendido cinco vezes e UM
-- produto sem custo. O `count(*)` do corpo conta as LINHAS do subselect, e o
-- subselect ja tem uma linha por produto (o `group by i.produto_id`) — por isso o
-- `count(*)` responde pela contagem de produtos. (A primeira versao do comentario
-- dizia `count(distinct produto_id)`, que era o texto de uma versao anterior do
-- corpo e nao existe mais: `distinct` aqui seria redundante, e redundancia que
-- mente e pior que redundancia.) Conta pelo custo gravado no ITEM
-- (`venda_itens.preco_custo`, o mesmo campo que o ranking usa), e nao pelo cadastro
-- de hoje — o preco do dia da venda e o que a margem daquela venda usaria.
-- ============================================================
create or replace function public.margem_sem_custo(p_de date, p_ate date)
returns table (sem_custo bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_papel text;
begin
  -- O MESMO periodo e a MESMA mensagem de margem_produtos: as duas funcoes sao
  -- chamadas com o periodo que o agente classificou, e recusar em uma e aceitar na
  -- outra daria uma resposta incoerente (a contagem de um periodo que o ranking
  -- recusou). O teto e `> 30` pelo motivo escrito na primeira funcao (ruling R5).
  if p_de is null or p_ate is null or p_de > p_ate or (p_ate - p_de) > 30 then
    raise exception 'Período inválido: de e até são obrigatórios, em ordem, com no máximo 31 dias (30 dias de intervalo).';
  end if;

  select p.papel into v_papel from public.perfis p where p.id = auth.uid();
  if v_papel is distinct from 'dono' then
    raise exception 'Só o dono vê o lucro.';
  end if;

  return query
    select count(*)::bigint
    from (
      select i.produto_id
      from public.venda_itens i
      join public.vendas v on v.id = i.venda_id
      where v.status = 'concluida'
        and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
      group by i.produto_id
      -- "fora do ranking" = o produto NAO TEM NENHUM item que o ranking aceitaria,
      -- e o ranking aceita o item de `preco_custo > 0` E `total > 0`. A condicao e o
      -- complemento exato do `where`/`having` de `margem_produtos`, e nao uma lista
      -- de casos: qualquer produto que o ranking deixe de fora cai aqui, hoje e em
      -- qualquer regra futura (o par tem de ficar sempre coerente — ver a nota no
      -- topo do arquivo).
      -- A primeira versao testava SO `max(i.preco_custo) = 0`: ela pegava o produto
      -- sem custo, mas deixava o brinde de fora desta contagem — justamente o pior
      -- caso de margem (custo 300 e receita 0 = margem -300), que nao aparecia em
      -- resposta nenhuma (ruling R7).
      having not coalesce(bool_or(i.preco_custo > 0 and i.total > 0), false)
    ) fora_do_ranking;
end $$;

comment on function public.margem_sem_custo(date, date) is
  'Quantidade de PRODUTOS distintos vendidos no periodo (fuso de Sao Paulo) que ficaram FORA do ranking de margem: sem nenhum item com custo cadastrado (preco_custo > 0) ou sem nenhum item com receita (brinde). A contagem e por produto, entao um produto com itens de custo misto no periodo entra no ranking e nao entra aqui. A condicao e o complemento exato do que margem_produtos aceita. SO O DONO.';

-- ============================================================
-- Permissoes: quem chama e o usuario logado (authenticated).
--
-- `from anon` e obrigatorio e nao decoracao: no Supabase o EXECUTE chega a anon
-- por DEFAULT PRIVILEGES, direto no papel — revogar so de PUBLIC nao tira nada
-- (mesmo achado de 002_registrar_venda.sql e 016_relatorios.sql, que
-- 050_permissoes.sql prova por has_function_privilege). E `service_role` fica com
-- o EXECUTE porque e o papel do servidor: sem ele, a leitura da margem no Next
-- pararia de funcionar depois da Task 2 (a RLS nao socorre um `definer`).
-- ============================================================
revoke all on function public.margem_produtos(date, date, integer) from public, anon;
revoke all on function public.margem_sem_custo(date, date) from public, anon;

grant execute on function public.margem_produtos(date, date, integer) to authenticated, service_role;
grant execute on function public.margem_sem_custo(date, date) to authenticated, service_role;
