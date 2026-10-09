-- 016_relatorios.sql — as quatro leituras do periodo escolhido (etapa 7).
--
-- POR QUE FUNCOES, E NAO VIEWS (ruling do plano): o relatorio soma um PERIODO
-- escolhido na tela (30 dias, 3 meses). Agregar em JS traria dezenas de milhares
-- de linhas para o navegador, e a regra do lucro e do dono precisa viver onde o
-- atendente nao possa contornar — no banco. As views de 005 continuam sendo o
-- recorte por dia/lista; o recorte por periodo passa a ser estas funcoes.
--
-- REGRAS QUE VALEM NAS QUATRO:
--   * `v.status = 'concluida'` em toda agregacao: venda cancelada nao entra em
--     numero nenhum (spec 6, A7).
--   * O dia de cada venda e `(criado_em at time zone 'America/Sao_Paulo')::date`
--     — a MESMA expressao de v_vendas_dia (005_views.sql:16).
--   * Intervalo INCLUSIVO nas duas pontas: `>= p_de and <= p_ate`.
--   * `p_de`/`p_ate` nulos ou invertidos devolvem zeros (e lista vazia), nunca
--     erro: quem valida o periodo torto e a tela; o banco nao pode estourar.
--
-- SEGURANCA — `security invoker` (o default; NAO ha `security definer` aqui):
-- a funcao roda com os direitos de QUEM CHAMA, entao a RLS das tabelas de base
-- continua valendo. E o mesmo espirito da migration 013, que pos
-- `security_invoker` nas views: uma funcao `security definer` rodaria como o dono
-- do banco (superusuario), a RLS simplesmente nao seria aplicada e a chave
-- publica leria o relatorio sem login. Por isso toda tabela e referenciada
-- QUALIFICADA (`public.vendas`, `public.perfis`) e o EXECUTE e concedido so a
-- `authenticated` (revogado de `public` E de `anon`, que no Supabase recebe
-- EXECUTE por DEFAULT PRIVILEGES direto no papel).
--
-- DRIFT CONHECIDO E DECLARADO (ruling do plano, nao acidental): a spec 6 descreve
-- `v_mais_vendidos` como "Ranking por periodo" e `v_formas_pagamento` como
-- "Totais por forma no periodo" — mas as duas views de 005 agregam TUDO (nao tem
-- coluna `dia` e nao recebem periodo). Nesta etapa elas NAO foram alteradas (a
-- tela de historico e a de caixa dependem delas como estao): quem le "no periodo"
-- sao `relatorio_formas_pagamento` e `relatorio_mais_vendidos`. O drift fica
-- registrado aqui e no PROGRESSO.md da etapa.

-- ============================================================
-- relatorio_resumo — faturamento, quantidade de vendas e ticket medio do periodo.
--
-- TICKET MEDIO = faturamento / vendas no PERIODO, e NUNCA a media das medias
-- diarias de v_vendas_dia: com dias de volume diferente as duas contas dao
-- numeros diferentes, e a media das medias e a resposta errada (o caso 1 de
-- 110_relatorios.sql foi montado para separar as duas). `round` devolve numeric;
-- o cast para bigint mantem o retorno inteiro em centavos.
-- ============================================================
create or replace function public.relatorio_resumo(p_de date, p_ate date)
returns table (faturamento bigint, vendas bigint, ticket_medio bigint)
language sql
stable
as $$
  select coalesce(sum(v.total), 0)::bigint                                  as faturamento,
         count(*)::bigint                                                    as vendas,
         case when count(*) = 0
              then 0
              else round(coalesce(sum(v.total), 0)::numeric / count(*))::bigint
         end                                                                 as ticket_medio
  from public.vendas v
  where v.status = 'concluida'
    and p_de is not null
    and p_ate is not null
    and p_de <= p_ate
    and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate;
$$;

comment on function public.relatorio_resumo(date, date) is
  'Faturamento, quantidade de vendas e ticket medio (total/quantidade) das vendas concluidas do periodo, no fuso de Sao Paulo. Periodo nulo ou invertido devolve zeros.';

-- ============================================================
-- relatorio_lucro — receita, custo e lucro do periodo. SO O DONO LE.
--
-- A checagem de papel vive DENTRO da funcao (spec 7.4: "a restricao de papel nao
-- fica so na RLS"). A RLS de `perfis` e `using (true)`, entao o atendente LE a
-- propria linha — o que ele nao pode e ver o lucro. Chamada direta a funcao (sem
-- passar pela tela) tambem e recusada: e isto que impede o numero de chegar ao
-- navegador do atendente.
--
-- Esta e a UNICA das quatro que nao e `language sql`: o `raise` da recusa precisa
-- de plpgsql, e um `case` que devolvesse zero no lugar da excecao seria pior que
-- nao ter guarda nenhuma (o atendente veria "lucro: R$ 0,00" e acharia que leu).
-- Continua `stable` e SEM `security definer`.
--
-- Receita e custo saem de venda_itens (o preco do dia da venda, gravado no item),
-- com join em vendas so para o status e para o fuso — a mesma conta de
-- v_lucro_periodo (005:46-55), agora por periodo escolhido. A ordem importa: o
-- periodo e validado ANTES da checagem de papel, para que um periodo torto nao
-- dependa de quem chamou (a tela valida antes; o banco nao pode estourar).
-- ============================================================
create or replace function public.relatorio_lucro(p_de date, p_ate date)
returns table (receita bigint, custo bigint, lucro bigint)
language plpgsql
stable
as $$
declare
  v_papel text;
begin
  if p_de is null or p_ate is null or p_de > p_ate then
    receita := 0;
    custo := 0;
    lucro := 0;
    return next;
    return;
  end if;

  select p.papel into v_papel from public.perfis p where p.id = auth.uid();
  if v_papel is distinct from 'dono' then
    raise exception 'Só o dono vê o lucro.';
  end if;

  return query
    select coalesce(sum(i.preco_unitario * i.quantidade), 0)::bigint,
           coalesce(sum(i.preco_custo * i.quantidade), 0)::bigint,
           coalesce(sum((i.preco_unitario - i.preco_custo) * i.quantidade), 0)::bigint
    from public.venda_itens i
    join public.vendas v on v.id = i.venda_id
    where v.status = 'concluida'
      and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate;
end $$;

comment on function public.relatorio_lucro(date, date) is
  'Receita, custo e lucro das vendas concluidas do periodo (fuso de Sao Paulo). SO O DONO: qualquer outro papel recebe "So o dono ve o lucro.".';

-- ============================================================
-- relatorio_formas_pagamento — quanto entrou por forma de pagamento no periodo.
--
-- De venda_pagamentos (a composicao do pagamento: uma venda pode ter duas formas),
-- nao do total da venda. Maior total primeiro, como v_formas_pagamento faz.
-- ============================================================
create or replace function public.relatorio_formas_pagamento(p_de date, p_ate date)
returns table (forma text, quantidade bigint, total bigint)
language sql
stable
as $$
  select p.forma,
         count(*)::bigint      as quantidade,
         sum(p.valor)::bigint  as total
  from public.venda_pagamentos p
  join public.vendas v on v.id = p.venda_id
  where v.status = 'concluida'
    and p_de is not null
    and p_ate is not null
    and p_de <= p_ate
    and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  group by p.forma
  order by sum(p.valor) desc, p.forma;
$$;

comment on function public.relatorio_formas_pagamento(date, date) is
  'Total e quantidade por forma de pagamento das vendas concluidas do periodo (fuso de Sao Paulo), maior total primeiro.';

-- ============================================================
-- relatorio_mais_vendidos — o ranking do periodo.
--
-- Agrega por produto somando TODOS os dias do periodo (e o que o caso 5 prova:
-- 2 no dia 15 + 1 no dia 16 = 3). Ordena por QUANTIDADE, e nao por total: e o
-- ranking de saida de mercadoria. O desempate por total existe para a ordem nao
-- depender do plano de execucao; `p_limite` nulo cai no padrao de 10.
--
-- O agrupamento e SO por `produto_id`, com `max(nome_produto)` no nome (achado M6
-- da revisao da Task 1): `venda_itens.nome_produto` e uma COPIA do nome que o
-- produto tinha na hora da venda, entao agrupar por (produto_id, nome_produto)
-- como a view 005 faz partia o produto em DUAS linhas quando o nome mudasse no
-- meio do periodo — e o `limit` podia cortar uma delas em silencio.
--
-- `greatest(coalesce(p_limite, 10), 0)` e a mesma regra das outras funcoes: valor
-- torto nao estoura. `limit -1` no Postgres e erro ("LIMIT must not be negative");
-- com o corte em zero vira lista vazia.
-- ============================================================
create or replace function public.relatorio_mais_vendidos(p_de date, p_ate date, p_limite integer default 10)
returns table (produto_id uuid, nome text, quantidade bigint, total bigint)
language sql
stable
as $$
  select i.produto_id,
         max(i.nome_produto)       as nome,
         sum(i.quantidade)::bigint as quantidade,
         sum(i.total)::bigint      as total
  from public.venda_itens i
  join public.vendas v on v.id = i.venda_id
  where v.status = 'concluida'
    and p_de is not null
    and p_ate is not null
    and p_de <= p_ate
    and (v.criado_em at time zone 'America/Sao_Paulo')::date between p_de and p_ate
  group by i.produto_id
  order by sum(i.quantidade) desc, sum(i.total) desc, max(i.nome_produto)
  limit greatest(coalesce(p_limite, 10), 0);
$$;

comment on function public.relatorio_mais_vendidos(date, date, integer) is
  'Ranking de produtos por quantidade vendida no periodo (fuso de Sao Paulo), maior quantidade primeiro; limite nulo usa 10.';

-- ============================================================
-- Permissoes: quem chama e o usuario logado (authenticated).
--
-- `from anon` e obrigatorio e nao decoracao: no Supabase o EXECUTE chega a anon
-- por DEFAULT PRIVILEGES, direto no papel — revogar so de PUBLIC nao tira nada
-- (mesmo achado que 002_registrar_venda.sql registra e que o 050_permissoes.sql
-- prova por has_function_privilege).
-- ============================================================
revoke all on function public.relatorio_resumo(date, date) from public, anon;
revoke all on function public.relatorio_lucro(date, date) from public, anon;
revoke all on function public.relatorio_formas_pagamento(date, date) from public, anon;
revoke all on function public.relatorio_mais_vendidos(date, date, integer) from public, anon;

grant execute on function public.relatorio_resumo(date, date) to authenticated, service_role;
grant execute on function public.relatorio_lucro(date, date) to authenticated, service_role;
grant execute on function public.relatorio_formas_pagamento(date, date) to authenticated, service_role;
grant execute on function public.relatorio_mais_vendidos(date, date, integer) to authenticated, service_role;
