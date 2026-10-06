-- 003_cancelar_venda.sql
-- Cancelamento seguindo a matriz de decisao da spec secao 8.2, nesta ordem:
--   1. venda ja cancelada        -> recusa com data e hora
--   2. quem nao e dono           -> recusa
--   3. caixa da venda ja fechado -> bloqueia (mensagem ensina o estorno do dia)
--   4. cliente pagou depois      -> bloqueia
--   5. cancela: estoque de volta, estorno no caixa (se tinha dinheiro) e
--      estorno no crediario
--
-- Bloquear e melhor que inventar: reescrever um fechamento assinado ou gerar
-- saldo credor por engano e pior que um telefonema.

create or replace function cancelar_venda(p_venda_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario     uuid := auth.uid();
  v_perfil      perfis%rowtype;
  v_venda       vendas%rowtype;
  v_sessao      caixa_sessoes%rowtype;
  v_item        venda_itens%rowtype;
  v_lanc        crediario_lancamentos%rowtype;
  v_saldo       integer;
  v_estorno     integer;
  v_pagou_depois boolean;
begin
  -- ---- 0. a venda existe? travada, para dois cancelamentos nao se cruzarem ----
  select * into v_venda from vendas where id = p_venda_id for update;
  if not found then
    raise exception 'Venda não encontrada.';
  end if;

  -- ---- 1. ja cancelada: recusa informando data e hora (spec 8.2) ----
  if v_venda.status = 'cancelada' then
    raise exception 'Esta venda já foi cancelada em %.',
      to_char(v_venda.cancelado_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI');
  end if;

  -- ---- 2. so o dono ----
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  select * into v_perfil from perfis where id = v_usuario;
  if not found then
    raise exception 'Usuário sem perfil cadastrado. Fale com o responsável.';
  end if;
  if v_perfil.papel <> 'dono' then
    raise exception 'Só o dono pode cancelar vendas.';
  end if;

  -- ---- 3. caixa da venda ja fechado: bloqueia ----
  select * into v_sessao from caixa_sessoes where id = v_venda.caixa_sessao_id;
  if v_sessao.status <> 'aberto' then
    raise exception 'Venda do dia % com caixa já fechado. Registre um estorno no caixa de hoje (sangria com motivo).',
      to_char(v_venda.criado_em at time zone 'America/Sao_Paulo', 'DD/MM');
  end if;

  -- ---- 4. o cliente pagou parte da divida depois desta venda: bloqueia ----
  if v_venda.cliente_id is not null then
    select exists (
      select 1
      from crediario_lancamentos
      where cliente_id = v_venda.cliente_id
        and tipo = 'pagamento'
        and criado_em > v_venda.criado_em
    ) into v_pagou_depois;

    if v_pagou_depois then
      raise exception 'O cliente já fez pagamento após esta venda. Estorne o pagamento antes.';
    end if;
  end if;

  -- ---- 5. cancela ----
  update vendas
     set status = 'cancelada',
         cancelado_em = now(),
         cancelado_por = v_usuario,
         motivo_cancelamento = p_motivo
   where id = v_venda.id;

  -- estoque de volta, com o livro-razao
  for v_item in select * from venda_itens where venda_id = v_venda.id loop
    update produtos
       set estoque_atual = estoque_atual + v_item.quantidade,
           atualizado_em = now()
     where id = v_item.produto_id
    returning estoque_atual into v_saldo;

    insert into estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, motivo, venda_id, usuario_id)
    values (v_item.produto_id, 'cancelamento', v_item.quantidade, v_saldo,
            coalesce(p_motivo, 'Cancelamento da venda ' || v_venda.numero),
            v_venda.id, v_usuario);
  end loop;

  -- estorno no caixa SO se a venda tinha dinheiro (spec 8.2). O valor entra
  -- negativo: o caixa perdeu o que a venda havia colocado.
  select coalesce(sum(valor), 0)
    into v_estorno
  from caixa_movimentos
  where venda_id = v_venda.id
    and tipo = 'venda'
    and forma = 'dinheiro';

  if v_estorno <> 0 then
    insert into caixa_movimentos (sessao_id, tipo, forma, valor, venda_id, motivo, usuario_id)
    values (v_venda.caixa_sessao_id, 'cancelamento', 'dinheiro', -v_estorno, v_venda.id,
            coalesce(p_motivo, 'Cancelamento da venda ' || v_venda.numero), v_usuario);
  end if;

  -- estorno no crediario: a compra vira um pagamento que aponta para o original
  -- (e o que a coluna estorna_lancamento_id existe para guardar). O saldo do
  -- cliente e sempre calculado por view como compra menos pagamento.
  for v_lanc in select *
                from crediario_lancamentos
                where venda_id = v_venda.id
                  and tipo = 'compra'
                  and estorna_lancamento_id is null
  loop
    insert into crediario_lancamentos (cliente_id, venda_id, tipo, valor, observacao,
                                       estorna_lancamento_id, usuario_id)
    values (v_lanc.cliente_id, v_venda.id, 'pagamento', v_lanc.valor,
            'Estorno do cancelamento da venda ' || v_venda.numero,
            v_lanc.id, v_usuario);
  end loop;
end $$;

revoke all on function cancelar_venda(uuid, text) from public;
grant execute on function cancelar_venda(uuid, text) to authenticated, service_role;
