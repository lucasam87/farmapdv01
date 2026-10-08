-- 014_receber_pagamento.sql
-- receber_pagamento: baixa (total ou parcial) da divida do crediario no balcao.
--
-- Decisoes que a assinatura nao decide:
--
--   * O saldo e compra - pagamento, a MESMA conta de registrar_venda e do
--     cancelamento: `case when tipo = 'compra' then valor else -valor end`. O
--     estorno do cancelamento entra como pagamento (003_cancelar_venda.sql), e
--     por isso ele abate a divida aqui sem nenhum caso especial.
--   * `for update` no cliente ANTES de ler o saldo, igual ao limite de credito
--     de registrar_venda. Sem ele, dois recebimentos simultaneos do mesmo
--     cliente leem o mesmo saldo devedor, os dois passam pelo teto e o cliente
--     termina com saldo credor — exatamente o que a spec 8.4 proibe.
--   * A sessao de caixa e a mais recente aberta, a mesma que registrar_venda
--     escolhe. Sem sessao aberta a recusa usa a MESMA mensagem da venda.
--   * Nunca gerar credito: pagamento acima do saldo devedor (inclusive com o
--     saldo ja zerado) e recusado, formatado por centavos_em_reais.

create or replace function receber_pagamento(
  p_cliente_id uuid,
  p_valor integer,
  p_forma text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario  uuid := auth.uid();
  v_perfil   perfis%rowtype;
  v_cliente  clientes%rowtype;
  v_caixa_id uuid;
  v_saldo    integer;
  v_valor    integer;
begin
  -- ---- 0. usuario logado, com perfil e ativo (spec 8.5) ----
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  select * into v_perfil from perfis where id = v_usuario;
  if not found then
    raise exception 'Usuário sem perfil cadastrado. Fale com o responsável.';
  end if;
  if not v_perfil.ativo then
    raise exception 'Usuário desativado. Fale com o responsável.';
  end if;
  -- Dono e atendente recebem (spec 5). Qualquer outro papel cai aqui.
  if v_perfil.papel not in ('dono', 'atendente') then
    raise exception 'Só o dono ou o atendente podem receber pagamentos.';
  end if;

  -- ---- 1. valor: inteiro positivo. Sem o teto de digitos, um valor enorme
  -- viraria "integer out of range" na cara do atendente. ----
  v_valor := p_valor;
  if v_valor is null or v_valor <= 0 then
    raise exception 'O valor do recebimento precisa ser maior que zero.';
  end if;

  -- ---- 2. forma: crediario nao e forma de RECEBER (so de comprar) ----
  if p_forma is null or p_forma not in ('dinheiro', 'pix', 'debito', 'credito') then
    raise exception 'Forma de recebimento inválida: %.', coalesce(p_forma, '(vazia)');
  end if;

  -- ---- 3. caixa aberto: a mesma sessao e a mesma mensagem da venda ----
  select id into v_caixa_id
  from caixa_sessoes
  where status = 'aberto'
  order by aberto_em desc
  limit 1;
  if v_caixa_id is null then
    raise exception 'Abra o caixa para começar a vender.';
  end if;

  -- ---- 4. cliente travado, e so depois o saldo (spec 8.4) ----
  select * into v_cliente from clientes where id = p_cliente_id for update;
  if not found then
    raise exception 'Cliente não encontrado.';
  end if;

  select coalesce(sum(case when tipo = 'compra' then valor else -valor end), 0)
    into v_saldo
  from crediario_lancamentos
  where cliente_id = p_cliente_id;

  -- Nunca gerar saldo credor: um centavo a mais que a divida e recusado, e a
  -- divida ja zerada nao pode virar credito.
  if v_valor > v_saldo then
    raise exception 'O valor é maior que a dívida (%).', centavos_em_reais(v_saldo);
  end if;

  -- ---- 5. grava o pagamento no crediario ----
  -- venda_id fica nulo de proposito: este pagamento nao pertence a uma venda
  -- especifica. E por isso que cancelar_venda so bloqueia venda com pagamento
  -- POSTERIOR (a coluna venda_id do estorno aponta para a venda cancelada).
  insert into crediario_lancamentos (cliente_id, venda_id, tipo, valor,
                                     forma_pagamento, usuario_id)
  values (p_cliente_id, null, 'pagamento', v_valor, p_forma, v_usuario);

  -- ---- 6. o dinheiro entra no caixa; crediario/cartao nao entram em
  -- esperado_dinheiro (spec 6/8.3 filtram por forma = 'dinheiro') ----
  insert into caixa_movimentos (sessao_id, tipo, forma, valor, usuario_id)
  values (v_caixa_id, 'recebimento_crediario', p_forma, v_valor, v_usuario);

  return jsonb_build_object(
    'cliente_id', p_cliente_id,
    'valor', v_valor,
    'saldo_apos', v_saldo - v_valor);
end $$;

-- `from anon` e obrigatorio: no Supabase o EXECUTE chega a anon por DEFAULT
-- PRIVILEGES (grant direto no papel), e revogar so de PUBLIC nao tira nada.
-- (Provado por has_function_privilege em tests/sql/casos/050_permissoes.sql.)
revoke all on function receber_pagamento(uuid, integer, text) from public, anon;
grant execute on function receber_pagamento(uuid, integer, text) to authenticated, service_role;
