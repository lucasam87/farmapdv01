-- 012_historico_vendas.sql
-- v_vendas_historico: o historico de vendas da tela da Etapa 5.
--
-- POR QUE UMA VIEW NOVA, em vez de mexer em v_vendas_lista:
--   1. A lista do dia precisa MOSTRAR a venda cancelada, marcada — quem cancelou,
--      quando e por que (spec 8.2). `v_vendas_lista` filtra `status = 'concluida'`
--      de proposito: ela e o contrato de FATURAMENTO da spec secao 6 (e o que a
--      Etapa 7 vai usar). Tirar aquele filtro mudaria os totais da tela de
--      faturamento — entao ele fica intacto e a historico nasce sem filtro.
--   2. O fuso. `dia` e a data de Sao Paulo (mesma expressao de v_vendas_dia) e e
--      por ela que a tela filtra; `criado_em` e `cancelado_em` saem como
--      `timestamp` SEM fuso, ja convertidos. A tela nunca refaz `at time zone`.
--
-- Sem indice novo: a tabela `vendas` de uma farmacia e pequena e um indice de
-- expressao sobre `criado_em at time zone ...` nao se paga.
--
-- ACOPLAMENTO: `itens` e `formas` sao o MESMO resumo de `v_vendas_lista`
-- (005_views.sql) — a tela mostra os dois no mesmo formato. Se um mudar, o
-- outro muda junto, na mesma migration.
--
-- `cancelado_por_nome` evita que a tela precise de um join com `perfis`.

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
