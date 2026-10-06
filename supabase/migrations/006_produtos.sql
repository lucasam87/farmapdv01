-- 006_produtos.sql
-- produto_salvar: a UNICA porta de cadastro e edicao de produto.
--
-- Esta funcao NAO TEM parametro de estoque, de proposito. Quem move estoque e
-- produto_entrada e produto_ajuste (007), que gravam no livro-razao
-- estoque_movimentos. Assim o saldo tem um dono so e sempre existe um movimento
-- explicando como ele chegou naquele numero: se esta funcao pudesse escrever
-- estoque_atual, o livro-razao deixaria de explicar o estoque (spec 8.6).
--
-- Cadastro novo com estoque inicial e, portanto, DOIS passos: produto_salvar e
-- depois produto_entrada com o motivo 'Estoque inicial'.
--
-- p_produto_id nulo cria; nao nulo edita. Devolve o uuid do produto.

create or replace function produto_salvar(
  p_produto_id uuid,
  p_codigo_barras text,
  p_nome text,
  p_categoria text,
  p_unidade text,
  p_preco_custo integer,
  p_preco_venda integer,
  p_estoque_minimo integer,
  p_ativo boolean
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario  uuid := auth.uid();
  v_perfil   perfis%rowtype;
  v_id       uuid;
  v_codigo   text;
  v_dono     produtos%rowtype;
  v_custo    integer;
  v_venda    integer;
  v_minimo   integer;
  v_unidade  text;
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

  -- ---- normalizacao e validacao dos campos ----
  -- '' e '   ' viram null: a coluna e `unique`, e o Postgres aceita varios nulls
  -- mas nao varias strings vazias. Sem isso, o segundo produto sem codigo de
  -- barras brigaria com o indice unico.
  v_codigo := nullif(btrim(coalesce(p_codigo_barras, '')), '');

  if p_nome is null or btrim(p_nome) = '' then
    raise exception 'Informe o nome do produto.';
  end if;

  v_custo  := coalesce(p_preco_custo, 0);
  v_venda  := coalesce(p_preco_venda, 0);
  v_minimo := coalesce(p_estoque_minimo, 0);

  if v_custo < 0 or v_venda < 0 then
    raise exception 'O preço não pode ser negativo.';
  end if;
  if v_minimo < 0 then
    raise exception 'O estoque mínimo não pode ser negativo.';
  end if;

  v_unidade := nullif(btrim(coalesce(p_unidade, '')), '');
  if v_unidade is null then
    v_unidade := 'un';
  end if;

  -- ---- codigo de barras ja usado por outro produto ----
  -- A checagem existe para a recusa ser em portugues, e nao a violacao crua do
  -- indice unico na cara do balcao.
  if v_codigo is not null then
    select * into v_dono
    from produtos
    where codigo_barras = v_codigo
      and (p_produto_id is null or id <> p_produto_id);
    if found then
      raise exception 'Já existe um produto com o código de barras % (%).', v_codigo, v_dono.nome;
    end if;
  end if;

  if p_produto_id is null then
    insert into produtos (codigo_barras, nome, categoria, unidade, preco_custo,
                          preco_venda, estoque_minimo, ativo)
    values (v_codigo, btrim(p_nome), nullif(btrim(coalesce(p_categoria, '')), ''),
            v_unidade, v_custo, v_venda, v_minimo, coalesce(p_ativo, true))
    returning id into v_id;
  else
    -- for update: duas edicoes do mesmo produto nao podem se atropelar.
    select * into v_dono from produtos where id = p_produto_id for update;
    if not found then
      raise exception 'Produto não encontrado.';
    end if;

    -- estoque_atual NAO aparece neste update — e o ponto da funcao.
    update produtos
       set codigo_barras  = v_codigo,
           nome           = btrim(p_nome),
           categoria      = nullif(btrim(coalesce(p_categoria, '')), ''),
           unidade        = v_unidade,
           preco_custo    = v_custo,
           preco_venda    = v_venda,
           estoque_minimo = v_minimo,
           ativo          = coalesce(p_ativo, true),
           atualizado_em  = now()
     where id = p_produto_id;

    v_id := p_produto_id;
  end if;

  return v_id;
end $$;

-- `from anon` e obrigatorio: no Supabase o EXECUTE chega a anon por DEFAULT
-- PRIVILEGES (grant direto no papel), e revogar so de PUBLIC nao tira nada.
revoke all on function produto_salvar(uuid, text, text, text, text, integer, integer, integer, boolean)
  from public, anon;
grant execute on function produto_salvar(uuid, text, text, text, text, integer, integer, integer, boolean)
  to authenticated, service_role;
