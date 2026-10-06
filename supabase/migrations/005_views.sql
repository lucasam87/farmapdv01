-- 005_views.sql — as 10 views de leitura da spec secao 6.
--
-- Regra que nao pode escapar em nenhuma delas: `status = 'concluida'` e o fuso
-- `America/Sao_Paulo`. Ninguem precisa lembrar dessas duas coisas ao escrever
-- tela.
--
-- O crediario nunca entra em esperado_dinheiro (nota da spec 6): por isso os
-- filtros de `forma = 'dinheiro'`.

-- ============================================================
-- VENDAS
-- ============================================================

-- Vendas por dia (fuso SP): quantidade de vendas, total e ticket medio.
create or replace view v_vendas_dia as
select (v.criado_em at time zone 'America/Sao_Paulo')::date as dia,
       count(*)                                            as quantidade,
       sum(v.total)                                        as total,
       round(avg(v.total))                                 as ticket_medio
from vendas v
where v.status = 'concluida'
group by 1;

-- Historico com resumo dos itens e das formas de pagamento. A paginacao fica
-- com quem consulta.
create or replace view v_vendas_lista as
select v.id                                                     as venda_id,
       v.numero,
       (v.criado_em at time zone 'America/Sao_Paulo')           as criado_em,
       v.cliente_id,
       c.nome                                                   as cliente_nome,
       v.subtotal,
       v.desconto,
       v.total,
       v.troco,
       (select string_agg(i.quantidade || 'x ' || i.nome_produto, ', ' order by i.nome_produto)
          from venda_itens i where i.venda_id = v.id)           as itens,
       (select string_agg(distinct p.forma, ', ')
          from venda_pagamentos p where p.venda_id = v.id)      as formas
from vendas v
left join clientes c on c.id = v.cliente_id
where v.status = 'concluida'
order by v.criado_em desc;

-- Lucro por dia: (preco_unitario - preco_custo) x quantidade.
create or replace view v_lucro_periodo as
select (v.criado_em at time zone 'America/Sao_Paulo')::date      as dia,
       sum(i.quantidade)                                         as quantidade,
       sum(i.preco_unitario * i.quantidade)                      as receita,
       sum(i.preco_custo * i.quantidade)                         as custo,
       sum((i.preco_unitario - i.preco_custo) * i.quantidade)    as lucro
from venda_itens i
join vendas v on v.id = i.venda_id
where v.status = 'concluida'
group by 1;

-- Totais por forma de pagamento, a partir de venda_pagamentos (composicao do
-- pagamento; a divida em si vive em crediario_lancamentos).
create or replace view v_formas_pagamento as
select p.forma,
       count(*)     as quantidade,
       sum(p.valor) as total
from venda_pagamentos p
join vendas v on v.id = p.venda_id
where v.status = 'concluida'
group by p.forma
order by sum(p.valor) desc;

-- Ranking por periodo (tudo que ja foi vendido).
create or replace view v_mais_vendidos as
select i.produto_id,
       i.nome_produto            as nome,
       sum(i.quantidade)         as quantidade,
       sum(i.total)              as total
from venda_itens i
join vendas v on v.id = i.venda_id
where v.status = 'concluida'
group by i.produto_id, i.nome_produto
order by sum(i.quantidade) desc, sum(i.total) desc;

-- ============================================================
-- ESTOQUE
-- ============================================================

create or replace view v_estoque_baixo as
select id            as produto_id,
       nome,
       estoque_atual,
       estoque_minimo
from produtos
where ativo
  and estoque_atual <= estoque_minimo
order by estoque_atual, nome;

create or replace view v_estoque_zerado as
select id            as produto_id,
       nome,
       estoque_atual
from produtos
where ativo
  and estoque_atual = 0
order by nome;

-- Ativos, com estoque e sem venda ha 60 dias ou mais. Produto que nunca foi
-- vendido conta a partir da data de cadastro — senao todo produto novo
-- apareceria como parado.
create or replace view v_estoque_parado as
select p.id                                                          as produto_id,
       p.nome,
       p.estoque_atual,
       max((v.criado_em at time zone 'America/Sao_Paulo')::date)     as ultima_venda,
       coalesce(max((v.criado_em at time zone 'America/Sao_Paulo')::date),
                (p.criado_em at time zone 'America/Sao_Paulo')::date) as referencia
from produtos p
left join venda_itens i on i.produto_id = p.id
left join vendas v on v.id = i.venda_id and v.status = 'concluida'
where p.ativo
  and p.estoque_atual > 0
group by p.id, p.nome, p.estoque_atual, p.criado_em
having coalesce(max((v.criado_em at time zone 'America/Sao_Paulo')::date),
                (p.criado_em at time zone 'America/Sao_Paulo')::date)
       < ((now() at time zone 'America/Sao_Paulo')::date - 60)
order by p.nome;

-- ============================================================
-- CLIENTES E CAIXA
-- ============================================================

-- Saldo = compra - pagamento, sempre por view, so de quem deve, maior primeiro.
create or replace view v_clientes_devedores as
select c.id           as cliente_id,
       c.nome,
       c.telefone,
       c.limite_credito,
       coalesce(sum(case when l.tipo = 'compra' then l.valor else -l.valor end), 0) as saldo
from clientes c
join crediario_lancamentos l on l.cliente_id = c.id
group by c.id, c.nome, c.telefone, c.limite_credito
having coalesce(sum(case when l.tipo = 'compra' then l.valor else -l.valor end), 0) > 0
order by saldo desc;

-- Sessao aberta com o esperado ate agora, pela formula da spec 8.3.
create or replace view v_caixa_atual as
select s.id              as sessao_id,
       s.terminal,
       s.aberto_em,
       s.aberto_por,
       s.valor_inicial,
       coalesce(sum(case when m.tipo = 'venda' and m.forma = 'dinheiro'
                         then m.valor else 0 end), 0)                as vendas_dinheiro,
       coalesce(sum(case when m.tipo = 'recebimento_crediario' and m.forma = 'dinheiro'
                         then m.valor else 0 end), 0)                as recebimentos_dinheiro,
       coalesce(sum(case when m.tipo = 'suprimento' then abs(m.valor) else 0 end), 0) as suprimentos,
       coalesce(sum(case when m.tipo = 'sangria' then abs(m.valor) else 0 end), 0)    as sangrias,
       coalesce(sum(case when m.tipo = 'cancelamento' and m.forma = 'dinheiro'
                         then abs(m.valor) else 0 end), 0)           as cancelamentos,
       s.valor_inicial + coalesce(sum(
         case
           when m.tipo in ('venda', 'recebimento_crediario') and m.forma = 'dinheiro' then m.valor
           when m.tipo = 'cancelamento' and m.forma = 'dinheiro' then -abs(m.valor)
           when m.tipo = 'sangria' then -abs(m.valor)
           when m.tipo = 'suprimento' then abs(m.valor)
           else 0
         end), 0)                                                    as esperado_dinheiro
from caixa_sessoes s
left join caixa_movimentos m on m.sessao_id = s.id
where s.status = 'aberto'
group by s.id, s.terminal, s.aberto_em, s.aberto_por, s.valor_inicial;
