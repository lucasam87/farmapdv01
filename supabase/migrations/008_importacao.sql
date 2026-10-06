-- 008_importacao.sql
-- importar_produtos: a importacao de catalogo, tudo ou nada.
--
-- A regra central (spec 8.7 e caso 13 da secao 12): NADA e gravado ate todas as
-- linhas passarem. Por isso a funcao tem duas passagens — a primeira so valida,
-- e levanta excecao na primeira linha invalida; a segunda grava. Como a funcao
-- roda dentro de UMA transacao do chamador, qualquer excecao da primeira
-- passagem desfaz o que a segunda ja tivesse gravado; mas a ordem importa porque
-- uma importacao parcial nunca deve chegar a existir.
--
-- Casamento por codigo de barras. Linha sem codigo de barras NUNCA casa: sempre
-- cria (nao ha como saber que e "o mesmo produto").
--
-- A diferenca entre a chave AUSENTE e a chave com valor zero e o coracao da
-- reimportacao segura: `estoque_inicial` ausente nao toca no estoque; presente
-- com 0 zera; presente com N grava o delta.

create or replace function importar_produtos(
  p_linhas jsonb,
  p_atualizar_existentes boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario     uuid := auth.uid();
  v_perfil      perfis%rowtype;
  v_registros   jsonb := '[]'::jsonb;
  v_linha       jsonb;
  v_ordem       integer;
  v_nome        text;
  v_codigo      text;
  v_codigo_repetido text;
  v_chave       text;
  v_produto     uuid;
  v_criados     integer := 0;
  v_atualizados integer := 0;
  v_ignorados   integer := 0;
  v_qtd         integer;
  v_delta       integer;
  v_saldo_atual integer;
  v_existe      boolean;
begin
  -- ---- quem esta chamando: so o dono importa (spec 5) ----
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
  if v_perfil.papel <> 'dono' then
    raise exception 'Só o dono pode importar produtos.';
  end if;

  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'Nenhuma linha para importar.';
  end if;

  -- ============================================================
  -- PASSAGEM 1: validar TODAS as linhas e normalizar
  -- ============================================================
  for v_linha, v_ordem in
    select t.linha, t.ordem
      from jsonb_array_elements(p_linhas) with ordinality as t(linha, ordem)
  loop
    if jsonb_typeof(v_linha) <> 'object' then
      raise exception 'Linha %: linha inválida na planilha.', v_ordem;
    end if;

    -- nome obrigatorio
    v_nome := nullif(btrim(coalesce(v_linha->>'nome', '')), '');
    if v_nome is null then
      raise exception 'Linha %: informe o nome do produto.', v_ordem;
    end if;

    -- numeros: precisam ser inteiros nao negativos. O cast direto de um texto
    -- qualquer daria erro tecnico do Postgres na cara do operador.
    foreach v_chave in array array['preco_custo', 'preco_venda', 'estoque_minimo', 'estoque_inicial'] loop
      if v_linha ? v_chave and jsonb_typeof(v_linha->v_chave) <> 'null' then
        if jsonb_typeof(v_linha->v_chave) <> 'number'
           or (v_linha->>v_chave) !~ '^-?\d+$' then
          raise exception 'Linha %: o campo % precisa ser um número inteiro.', v_ordem, v_chave;
        end if;
        if (v_linha->>v_chave)::integer < 0 then
          raise exception 'Linha %: o campo % não pode ser negativo.', v_ordem, v_chave;
        end if;
      end if;
    end loop;

    v_registros := v_registros || jsonb_build_object(
      'codigo',          nullif(btrim(coalesce(v_linha->>'codigo_barras', '')), ''),
      'nome',            v_nome,
      'categoria',       nullif(btrim(coalesce(v_linha->>'categoria', '')), ''),
      'unidade',         coalesce(nullif(btrim(coalesce(v_linha->>'unidade', '')), ''), 'un'),
      'preco_custo',     coalesce((v_linha->>'preco_custo')::integer, 0),
      'preco_venda',     coalesce((v_linha->>'preco_venda')::integer, 0),
      'estoque_minimo',  coalesce((v_linha->>'estoque_minimo')::integer, 0),
      'tem_estoque',     (v_linha ? 'estoque_inicial' and jsonb_typeof(v_linha->'estoque_inicial') <> 'null'),
      'estoque_inicial', coalesce((v_linha->>'estoque_inicial')::integer, 0)
    );
  end loop;

  -- Codigo de barras repetido DENTRO do arquivo: sem isso a segunda linha
  -- sobrescreveria a primeira em silencio.
  select r.registro->>'codigo'
    into v_codigo_repetido
    from jsonb_array_elements(v_registros) as r(registro)
   where r.registro->>'codigo' is not null
   group by r.registro->>'codigo'
  having count(*) > 1
   limit 1;
  if v_codigo_repetido is not null then
    raise exception 'O código de barras % aparece mais de uma vez na planilha.', v_codigo_repetido;
  end if;

  -- ============================================================
  -- PASSAGEM 2: gravar (nada aqui pode falhar por validacao)
  -- ============================================================
  for v_linha in select r.registro from jsonb_array_elements(v_registros) as r(registro)
  loop
    v_codigo := v_linha->>'codigo';

    v_existe := false;
    v_produto := null;
    if v_codigo is not null then
      select p.id into v_produto from produtos p where p.codigo_barras = v_codigo;
      v_existe := v_produto is not null;
    end if;

    if v_existe and not coalesce(p_atualizar_existentes, false) then
      -- Existe e o dono pediu para nao atualizar: nao toca em nada.
      v_ignorados := v_ignorados + 1;
      continue;
    end if;

    if v_existe then
      update produtos
         set nome           = v_linha->>'nome',
             categoria      = v_linha->>'categoria',
             unidade        = v_linha->>'unidade',
             preco_custo    = (v_linha->>'preco_custo')::integer,
             preco_venda    = (v_linha->>'preco_venda')::integer,
             estoque_minimo = (v_linha->>'estoque_minimo')::integer,
             atualizado_em  = now()
       where id = v_produto;

      -- Estoque so quando a chave veio. Ausente = "nao sei o estoque, nao mexe".
      -- O movimento e gravado DIRETO como 'entrada' com o delta, e nao pelas
      -- funcoes 007: o brief fixa tipo 'entrada' para toda linha de planilha
      -- (motivo 'Estoque inicial'), enquanto produto_ajuste gravaria 'ajuste', e
      -- produto_entrada recusaria delta negativo. O saldo e o saldo_apos sao os
      -- mesmos que as funcoes produziriam; muda so o rotulo do movimento.
      if (v_linha->>'tem_estoque')::boolean then
        select estoque_atual into v_saldo_atual from produtos where id = v_produto for update;
        v_qtd := (v_linha->>'estoque_inicial')::integer;
        v_delta := v_qtd - v_saldo_atual;

        if v_delta <> 0 then
          update produtos
             set estoque_atual = v_qtd,
                 atualizado_em = now()
           where id = v_produto;

          insert into estoque_movimentos (produto_id, tipo, quantidade, saldo_apos, motivo, usuario_id)
          values (v_produto, 'entrada', v_delta, v_qtd, 'Estoque inicial', v_usuario);
        end if;
      end if;

      v_atualizados := v_atualizados + 1;
    else
      insert into produtos (codigo_barras, nome, categoria, unidade, preco_custo,
                            preco_venda, estoque_minimo, ativo)
      values (v_codigo, v_linha->>'nome', v_linha->>'categoria', v_linha->>'unidade',
              (v_linha->>'preco_custo')::integer, (v_linha->>'preco_venda')::integer,
              (v_linha->>'estoque_minimo')::integer, true)
      returning id into v_produto;

      if (v_linha->>'tem_estoque')::boolean then
        v_qtd := (v_linha->>'estoque_inicial')::integer;
        if v_qtd <> 0 then
          perform produto_entrada(v_produto, v_qtd, null, 'Estoque inicial');
        end if;
      end if;

      v_criados := v_criados + 1;
    end if;
  end loop;

  return jsonb_build_object('criados', v_criados,
                            'atualizados', v_atualizados,
                            'ignorados', v_ignorados);
end $$;

-- `from anon` e obrigatorio: no Supabase o EXECUTE chega a anon por DEFAULT
-- PRIVILEGES (grant direto no papel), e revogar so de PUBLIC nao tira nada.
revoke all on function importar_produtos(jsonb, boolean) from public, anon;
grant execute on function importar_produtos(jsonb, boolean) to authenticated, service_role;
