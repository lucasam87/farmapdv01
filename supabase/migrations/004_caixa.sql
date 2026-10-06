-- 004_caixa.sql
-- abrir_caixa, caixa_movimento (sangria/suprimento) e fechar_caixa.
--
-- A conta do fechamento e a da spec secao 8.3:
--   esperado_dinheiro = valor_inicial
--                     + vendas em dinheiro (liquidas de troco)
--                     + recebimentos de crediario em dinheiro
--                     + suprimentos
--                     - sangrias
--                     - cancelamentos em dinheiro
--   diferenca = valor_contado - esperado_dinheiro
--
-- O crediario nunca entra em esperado_dinheiro (spec 6): por isso o filtro
-- forma = 'dinheiro'. Diferenca diferente de zero nao bloqueia o fechamento,
-- mas exige observacao. Sessao fechada e imutavel.

create or replace function abrir_caixa(p_valor_inicial integer)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_perfil  perfis%rowtype;
  v_id      uuid;
begin
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

  if p_valor_inicial is null or p_valor_inicial < 0 then
    raise exception 'O valor inicial não pode ser negativo.';
  end if;

  -- Em v1 a loja tem um terminal so: uma sessao aberta por vez. A checagem
  -- existe para a recusa ser em portugues, e nao o erro do indice unico.
  if exists (select 1 from caixa_sessoes where status = 'aberto') then
    raise exception 'Já existe um caixa aberto.';
  end if;

  insert into caixa_sessoes (aberto_por, status, valor_inicial)
  values (v_usuario, 'aberto', p_valor_inicial)
  returning id into v_id;

  return v_id;
end $$;

create or replace function caixa_movimento(p_tipo text, p_valor integer, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_perfil  perfis%rowtype;
  v_sessao  caixa_sessoes%rowtype;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  select * into v_perfil from perfis where id = v_usuario;
  if not found then
    raise exception 'Usuário sem perfil cadastrado. Fale com o responsável.';
  end if;

  if p_tipo is null or p_tipo not in ('sangria', 'suprimento') then
    raise exception 'Movimento de caixa inválido: %.', coalesce(p_tipo, '(vazio)');
  end if;
  if p_valor is null or p_valor <= 0 then
    raise exception 'O valor do movimento precisa ser maior que zero.';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo do movimento.';
  end if;

  select * into v_sessao
  from caixa_sessoes
  where status = 'aberto'
  order by aberto_em desc
  limit 1;
  if not found then
    raise exception 'Abra o caixa para começar a vender.';
  end if;

  -- sangria sai do caixa (negativa), suprimento entra (positiva)
  insert into caixa_movimentos (sessao_id, tipo, valor, motivo, usuario_id)
  values (v_sessao.id, p_tipo,
          case when p_tipo = 'sangria' then -p_valor else p_valor end,
          btrim(p_motivo), v_usuario);
end $$;

create or replace function fechar_caixa(p_valor_contado integer, p_observacao text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario    uuid := auth.uid();
  v_perfil     perfis%rowtype;
  v_sessao     caixa_sessoes%rowtype;
  v_movimentos integer;
  v_esperado   integer;
  v_diferenca  integer;
begin
  if v_usuario is null then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  select * into v_perfil from perfis where id = v_usuario;
  if not found then
    raise exception 'Usuário sem perfil cadastrado. Fale com o responsável.';
  end if;
  if v_perfil.papel <> 'dono' then
    raise exception 'Só o dono pode fechar o caixa.';
  end if;
  if p_valor_contado is null or p_valor_contado < 0 then
    raise exception 'O valor contado não pode ser negativo.';
  end if;

  select * into v_sessao
  from caixa_sessoes
  where status = 'aberto'
  order by aberto_em desc
  limit 1
  for update;
  if not found then
    raise exception 'Não há caixa aberto.';
  end if;

  -- A formula da spec 8.3. O sinal gravado nao decide nada aqui: sangria e
  -- cancelamento sao subtraidos com -abs() de proposito.
  select coalesce(sum(
           case
             when tipo in ('venda', 'recebimento_crediario') and forma = 'dinheiro' then valor
             when tipo = 'cancelamento' and forma = 'dinheiro' then -abs(valor)
             when tipo = 'sangria' then -abs(valor)
             when tipo = 'suprimento' then abs(valor)
             else 0
           end), 0)
    into v_movimentos
  from caixa_movimentos
  where sessao_id = v_sessao.id;

  v_esperado := v_sessao.valor_inicial + v_movimentos;
  v_diferenca := p_valor_contado - v_esperado;

  if v_diferenca <> 0 and (p_observacao is null or btrim(p_observacao) = '') then
    raise exception 'A diferença de % precisa de observação.', centavos_em_reais(abs(v_diferenca));
  end if;

  update caixa_sessoes
     set status = 'fechado',
         fechado_por = v_usuario,
         fechado_em = now(),
         valor_contado = p_valor_contado,
         esperado_dinheiro = v_esperado,
         diferenca = v_diferenca,
         observacao = nullif(btrim(coalesce(p_observacao, '')), '')
   where id = v_sessao.id;

  return jsonb_build_object('esperado_dinheiro', v_esperado, 'diferenca', v_diferenca);
end $$;

revoke all on function abrir_caixa(integer) from public;
revoke all on function caixa_movimento(text, integer, text) from public;
revoke all on function fechar_caixa(integer, text) from public;
grant execute on function abrir_caixa(integer) to authenticated, service_role;
grant execute on function caixa_movimento(text, integer, text) to authenticated, service_role;
grant execute on function fechar_caixa(integer, text) to authenticated, service_role;
