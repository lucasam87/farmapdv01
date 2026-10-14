-- 018_fechamento_atendente.sql — o ATENDENTE também fecha o caixa.
--
-- A REGRA QUE ESTAVA ERRADA (004:122): `if v_perfil.papel <> 'dono' then raise`.
-- Combinada com `abrir_caixa`, que NAO checa papel nenhum (so exige perfil), ela
-- deixava a operacao sem saida:
--
--   * o atendente ABRE o caixa e trabalha o dia inteiro;
--   * no fim do dia NAO consegue fechar;
--   * com o dono ausente, o caixa fica aberto e o dia seguinte trava em
--     'Ja existe um caixa aberto.' (004:46).
--
-- Ou seja: a farmacia para no dia seguinte, e nao por falta de dinheiro — por uma
-- regra de papel assimetrica. Achado pelo Lucas em 14/10/2026, tentando fechar o
-- caixa logado como atendente.
--
-- A REGRA NOVA e a LISTA EXPLICITA dos dois papeis. Continua sendo lista fechada:
-- papel que nao exista hoje (ou que venha a existir) cai na recusa, e nao no
-- "qualquer coisa serve".
--
-- O CORPO E COPIA LITERAL DA 004, com uma linha mudada. Nao ha formula alterada:
-- a conta do esperado (spec 8.3), a exigencia de observacao quando ha diferenca e
-- o travamento da linha (`for update`) continuam identicos.
--
-- LACUNA CONHECIDA, NAO CORRIGIDA AQUI: `fechar_caixa` nao confere `perfis.ativo`
-- (nem antes nem agora). Quem tem sessao aberta e foi DESATIVADO ainda consegue
-- fechar chamando a RPC direto. Pela tela nao passa, porque `perfilAtual()` filtra
-- `ativo = true`. Fica registrado para decisao, e nao foi mudado nesta migration
-- para nao misturar duas coisas.

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
  -- A UNICA LINHA QUE MUDA em relacao a 004: era `<> 'dono'`.
  if v_perfil.papel not in ('dono', 'atendente') then
    raise exception 'Só o dono ou o atendente podem fechar o caixa.';
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

-- `from anon` e obrigatorio: no Supabase o EXECUTE chega a anon por DEFAULT
-- PRIVILEGES (grant direto no papel), e revogar so de PUBLIC nao tira nada.
revoke all on function fechar_caixa(integer, text) from public, anon;
grant execute on function fechar_caixa(integer, text) to authenticated, service_role;
