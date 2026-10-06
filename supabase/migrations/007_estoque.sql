-- 007_estoque.sql
-- produto_entrada e produto_ajuste: as duas unicas portas que movem estoque.
--
-- A regra do projeto (spec 8.6, decisao D7): estoque_movimentos e a VERDADE, e
-- produtos.estoque_atual e o saldo corrente. Toda mudanca de saldo acontece
-- aqui, junto com o movimento que a explica — por isso produto_salvar (006) nao
-- tem parametro de estoque. Se o saldo pudesse mudar sem movimento, o
-- livro-razao deixaria de explicar o estoque e ninguem saberia onde ele errou.
--
--   produto_entrada: soma ao estoque (compra, devolucao de balcao).
--   produto_ajuste:  grava o DELTA entre o saldo contado e o do sistema
--                    (inventario), com motivo obrigatorio.
--
-- Ambas devolvem o novo saldo. O `for update` na linha do produto e obrigatorio:
-- sem ele, duas entradas simultaneas leem o mesmo saldo e uma sobrescreve a
-- outra (a suite de concorrencia da Etapa 2 ja provou esse tipo de perda do
-- lado da venda).

create or replace function produto_entrada(
  p_produto_id uuid,
  p_quantidade integer,
  p_custo integer,
  p_motivo text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_perfil  perfis%rowtype;
  v_produto produtos%rowtype;
  v_saldo   integer;
begin
  -- ---- quem esta chamando ----
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

  -- ---- validacoes ----
  -- A checagem de motivo vem ANTES de tocar no banco: uma entrada recusada nao
  -- pode deixar saldo nem movimento para tras.
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo da entrada.';
  end if;
  if p_quantidade is null or p_quantidade <= 0 then
    raise exception 'A quantidade precisa ser maior que zero.';
  end if;
  if p_custo is not null and p_custo < 0 then
    raise exception 'O custo não pode ser negativo.';
  end if;

  select * into v_produto from produtos where id = p_produto_id for update;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;

  v_saldo := v_produto.estoque_atual + p_quantidade;

  -- coalesce(p_custo, preco_custo): entrada sem custo informado NAO zera o
  -- custo que ja estava cadastrado (spec 8.6: "atualiza preco_custo quando
  -- informado").
  update produtos
     set estoque_atual = v_saldo,
         preco_custo   = coalesce(p_custo, v_produto.preco_custo),
         atualizado_em = now()
   where id = p_produto_id;

  insert into estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
  values (p_produto_id, 'entrada', p_quantidade, v_saldo, btrim(p_motivo), v_usuario);

  return v_saldo;
end $$;

create or replace function produto_ajuste(
  p_produto_id uuid,
  p_novo_saldo integer,
  p_motivo text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario uuid := auth.uid();
  v_perfil  perfis%rowtype;
  v_produto produtos%rowtype;
  v_delta   integer;
begin
  -- ---- quem esta chamando ----
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

  -- ---- validacoes ----
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'Informe o motivo do ajuste.';
  end if;
  if p_novo_saldo is null or p_novo_saldo < 0 then
    raise exception 'O saldo não pode ser negativo.';
  end if;

  select * into v_produto from produtos where id = p_produto_id for update;
  if not found then
    raise exception 'Produto não encontrado.';
  end if;

  v_delta := p_novo_saldo - v_produto.estoque_atual;

  -- A constraint estoque_movimentos_qtd_nao_zero proibiria o movimento zero de
  -- qualquer forma; a checagem existe para a recusa ser em portugues e dizer o
  -- saldo atual, em vez de estourar uma constraint na tela do balcao.
  if v_delta = 0 then
    raise exception 'Este produto já está em % unidade(s).', p_novo_saldo;
  end if;

  update produtos
     set estoque_atual = p_novo_saldo,
         atualizado_em = now()
   where id = p_produto_id;

  -- O movimento grava o DELTA, nao o saldo novo: e o delta que explica a
  -- diferenca do inventario.
  insert into estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
  values (p_produto_id, 'ajuste', v_delta, p_novo_saldo, btrim(p_motivo), v_usuario);

  return p_novo_saldo;
end $$;

-- `from anon` e obrigatorio: no Supabase o EXECUTE chega a anon por DEFAULT
-- PRIVILEGES (grant direto no papel), e revogar so de PUBLIC nao tira nada.
revoke all on function produto_entrada(uuid, integer, integer, text) from public, anon;
revoke all on function produto_ajuste(uuid, integer, text) from public, anon;
grant execute on function produto_entrada(uuid, integer, integer, text)
  to authenticated, service_role;
grant execute on function produto_ajuste(uuid, integer, text)
  to authenticated, service_role;
