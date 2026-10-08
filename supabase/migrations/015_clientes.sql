-- 015_clientes.sql
-- cliente_salvar e importar_clientes: o cadastro de cliente com crediario.
--
-- Tres regras concentram o risco desta etapa, e as tres estao no BANCO, nao na
-- tela:
--
--   1. O LIMITE E DO DONO (spec 5, Review Focus 4). O atendente cadastra o
--      cliente — mas nasce com limite 0 — e edita nome, telefone e observacao.
--      Tentar liberar limite, bloquear ou lancar saldo devedor e recusado com a
--      mensagem da spec. Sem isso, liberar credito de graca e um UPDATE.
--
--   2. A MARCA DO SALDO IMPORTADO E O QUE IMPEDE A DIVIDA DE DOBRAR
--      (Review Focus 1). O saldo que veio do sistema antigo nao e uma coluna:
--      e um lancamento `compra` com `venda_id is null` e a observacao literal
--      'Saldo importado do sistema antigo'. Um cliente so pode ter UM lancamento
--      de saldo com essa marca; a partir do segundo, a RPC ignora (e conta em
--      `saldos_ignorados`, que a previa da Task 6 mostra ao dono). E a distancia
--      entre reimportar a planilha por engano e cobrar do cliente o dobro.
--      A tela da Task 4/Task 6 escreve e le ESTE texto: variacao aqui quebra a
--      guarda em silencio.
--
--   3. TUDO OU NADA na importacao, igual a `importar_produtos` (008): a funcao
--      tem uma passagem que so valida — e levanta excecao nomeando a linha — e
--      so depois disso grava. Linha sem CPF e invalida de proposito: sem chave,
--      reimportar criaria o cliente de novo em vez de casar (a spec manda casar
--      por CPF, que e o `unique` que ja existe).
--
-- O saldo devedor e SEMPRE a soma de crediario_lancamentos (a mesma conta de
-- receber_pagamento e de v_clientes_devedores); ninguem guarda saldo em coluna.

-- ============================================================
-- cliente_salvar — cadastro e edicao pelo balcao (dono e atendente)
-- ============================================================
create or replace function cliente_salvar(
  p_id uuid,
  p_nome text,
  p_telefone text,
  p_cpf text,
  p_limite_credito integer,
  p_bloqueado boolean,
  p_observacao text,
  p_saldo_inicial integer
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_usuario  uuid := auth.uid();
  v_perfil   perfis%rowtype;
  v_cliente  clientes%rowtype;
  v_criando  boolean;
  v_nome     text;
  v_telefone text;
  v_cpf      text;
  v_limite   integer;
  v_bloqueado boolean;
  v_saldo    integer;
  v_id       uuid;
begin
  -- ---- quem esta chamando (spec 8.5) ----
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
  -- Dono e atendente cadastram (spec 5). Quem decide O QUE cada um pode mudar e
  -- o bloco de guardas logo abaixo, nao o papel sozinho.
  if v_perfil.papel not in ('dono', 'atendente') then
    raise exception 'Só o dono ou o atendente podem cadastrar clientes.';
  end if;

  v_criando := p_id is null;

  v_nome := nullif(btrim(coalesce(p_nome, '')), '');
  if v_nome is null then
    raise exception 'Escreva o nome do cliente.';
  end if;

  -- CPF e telefone viram digito puro ou nulo: " " nao pode virar chave, e o
  -- `unique` do CPF nao pode ser driblado com espaco em volta.
  v_cpf := nullif(regexp_replace(btrim(coalesce(p_cpf, '')), '\D', '', 'g'), '');
  v_telefone := nullif(regexp_replace(btrim(coalesce(p_telefone, '')), '\D', '', 'g'), '');

  if v_criando then
    -- Ausente vale zero: a tela da Task 4 nao oferece limite ao atendente.
    v_limite := coalesce(p_limite_credito, 0);
    v_bloqueado := coalesce(p_bloqueado, false);
    v_saldo := coalesce(p_saldo_inicial, 0);
  else
    select * into v_cliente from clientes where id = p_id for update;
    if not found then
      raise exception 'Cliente não encontrado.';
    end if;
    -- Ausente na edicao = "nao mexe" (mesma ideia da chave ausente em
    -- importar_produtos): a tela do atendente nao manda limite nenhum, e mandar
    -- nulo nao pode virar "zera o limite que o dono liberou".
    v_limite := coalesce(p_limite_credito, v_cliente.limite_credito);
    v_bloqueado := coalesce(p_bloqueado, v_cliente.bloqueado);
    v_saldo := coalesce(p_saldo_inicial, 0);
  end if;

  if v_limite < 0 then
    raise exception 'O limite de crédito não pode ser negativo.';
  end if;

  -- ---- as guardas de papel: limite, bloqueio e saldo sao do dono (spec 5) ----
  -- A comparacao e com o valor GRAVADO, e nao com o que veio: para o atendente,
  -- reenviar o mesmo limite ou o mesmo bloqueado e uma edicao normal de
  -- nome/telefone. So a DIFERENCA recusa.
  if v_perfil.papel <> 'dono' then
    if v_limite <> coalesce(v_cliente.limite_credito, 0) then
      raise exception 'Só o dono pode mudar o limite de crédito.';
    end if;
    if v_bloqueado <> coalesce(v_cliente.bloqueado, false) then
      raise exception 'Só o dono pode bloquear um cliente.';
    end if;
    if v_saldo <> 0 then
      raise exception 'Só o dono pode lançar saldo devedor.';
    end if;
  end if;

  -- ---- CPF repetido: a mensagem e da RPC, nao o nome do indice (spec 9) ----
  if v_cpf is not null then
    if exists (select 1 from clientes c where c.cpf = v_cpf and c.id is distinct from p_id) then
      raise exception 'Já existe um cliente com este CPF.';
    end if;
  end if;

  if v_criando then
    begin
      insert into clientes (nome, telefone, cpf, limite_credito, bloqueado, observacao)
      values (v_nome, v_telefone, v_cpf, v_limite, v_bloqueado,
              nullif(btrim(coalesce(p_observacao, '')), ''))
      returning id into v_id;
    exception when unique_violation then
      -- Corrida entre a checagem acima e o insert: a mensagem tem de ser a mesma.
      raise exception 'Já existe um cliente com este CPF.';
    end;
  else
    update clientes
       set nome           = v_nome,
           telefone       = v_telefone,
           cpf            = v_cpf,
           limite_credito = v_limite,
           bloqueado      = v_bloqueado,
           observacao     = nullif(btrim(coalesce(p_observacao, '')), '')
     where id = p_id;
    v_id := p_id;
  end if;

  -- ---- o saldo inicial do dono nasce como lancamento MARCADO ----
  -- Nao ha coluna de saldo: e este lancamento com a marca que a guarda da
  -- importacao vai reconhecer (e que a tela mostra como "saldo importado").
  if v_saldo > 0 then
    insert into crediario_lancamentos (cliente_id, venda_id, tipo, valor,
                                       observacao, usuario_id)
    values (v_id, null, 'compra', v_saldo,
            'Saldo importado do sistema antigo', v_usuario);
  end if;

  return v_id;
end $$;

-- ============================================================
-- importar_clientes — a planilha dos saldos devedores (so dono)
-- ============================================================
create or replace function importar_clientes(
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
  v_texto       text;
  v_nome        text;
  v_cpf         text;
  v_cpf_repetido text;
  v_cliente     uuid;
  v_criados     integer := 0;
  v_atualizados integer := 0;
  v_ignorados   integer := 0;
  v_lancados    integer := 0;
  v_saldos_ignorados integer := 0;
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
    raise exception 'Só o dono pode importar clientes.';
  end if;

  if p_linhas is null or jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) = 0 then
    raise exception 'Nenhuma linha para importar.';
  end if;

  -- ============================================================
  -- PASSAGEM 1: validar TODAS as linhas e normalizar. Nada e gravado aqui.
  -- ============================================================
  for v_linha, v_ordem in
    select t.linha, t.ordem
      from jsonb_array_elements(p_linhas) with ordinality as t(linha, ordem)
  loop
    if jsonb_typeof(v_linha) <> 'object' then
      raise exception 'Linha %: linha inválida na planilha.', v_ordem;
    end if;

    v_nome := nullif(btrim(coalesce(v_linha->>'nome', '')), '');
    if v_nome is null then
      raise exception 'Linha %: informe o nome do cliente.', v_ordem;
    end if;

    -- SEM CPF nao ha chave: a reimportacao criaria o cliente de novo em vez de
    -- casar, e o saldo dele dobraria. E recusa, e a previa da Task 6 conta essas
    -- linhas para o dono.
    v_cpf := nullif(regexp_replace(coalesce(v_linha->>'cpf', ''), '\D', '', 'g'), '');
    if v_cpf is null then
      raise exception 'Linha %: informe o CPF do cliente.', v_ordem;
    end if;

    -- Os numeros precisam ser inteiros nao negativos. O cast direto de um texto
    -- qualquer daria erro tecnico do Postgres na cara do operador.
    foreach v_texto in array array['limite_credito', 'saldo'] loop
      if v_linha ? v_texto and jsonb_typeof(v_linha->v_texto) <> 'null' then
        if jsonb_typeof(v_linha->v_texto) <> 'number' or (v_linha->>v_texto) !~ '^-?\d+$' then
          raise exception 'Linha %: o campo % precisa ser um número inteiro.', v_ordem, v_texto;
        end if;
        if (v_linha->>v_texto)::integer < 0 then
          raise exception 'Linha %: o campo % não pode ser negativo.', v_ordem, v_texto;
        end if;
      end if;
    end loop;

    v_registros := v_registros || jsonb_build_object(
      'nome',           v_nome,
      'telefone',       nullif(regexp_replace(coalesce(v_linha->>'telefone', ''), '\D', '', 'g'), ''),
      'cpf',            v_cpf,
      'limite_credito', coalesce((v_linha->>'limite_credito')::integer, 0),
      'saldo',          coalesce((v_linha->>'saldo')::integer, 0)
    );
  end loop;

  -- O mesmo CPF duas vezes no arquivo: a segunda linha sobrescreveria a primeira
  -- em silencio (mesma guarda do codigo de barras em importar_produtos).
  select r.registro->>'cpf'
    into v_cpf_repetido
    from jsonb_array_elements(v_registros) as r(registro)
   group by r.registro->>'cpf'
  having count(*) > 1
   limit 1;
  if v_cpf_repetido is not null then
    raise exception 'O CPF % aparece mais de uma vez na planilha.', v_cpf_repetido;
  end if;

  -- ============================================================
  -- PASSAGEM 2: gravar (nada aqui pode falhar por validacao)
  -- ============================================================
  for v_linha in select r.registro from jsonb_array_elements(v_registros) as r(registro)
  loop
    v_cliente := null;
    select c.id into v_cliente from clientes c where c.cpf = v_linha->>'cpf';

    if v_cliente is not null and not coalesce(p_atualizar_existentes, false) then
      -- Existe e o dono nao pediu para atualizar: nao toca em nada. O SALDO
      -- abaixo continua valendo: um cliente cadastrado no balcao pode ainda nao
      -- ter o saldo lancado.
      v_ignorados := v_ignorados + 1;
    elsif v_cliente is not null then
      update clientes
         set nome           = v_linha->>'nome',
             telefone       = nullif(v_linha->>'telefone', ''),
             limite_credito = (v_linha->>'limite_credito')::integer
       where id = v_cliente;
      v_atualizados := v_atualizados + 1;
    else
      insert into clientes (nome, telefone, cpf, limite_credito, bloqueado)
      values (v_linha->>'nome', nullif(v_linha->>'telefone', ''), v_linha->>'cpf',
              (v_linha->>'limite_credito')::integer, false)
      returning id into v_cliente;
      v_criados := v_criados + 1;
    end if;

    -- ---- A GUARDA ----
    -- O cliente recebe o saldo da planilha UMA vez. Se ele ja tem um lancamento
    -- `compra`, `venda_id is null` com a marca — vindo de uma importacao
    -- anterior OU lancado pela tela do dono — o saldo e IGNORADO, nunca somado.
    -- Sem esta guarda, reimportar o mesmo arquivo cobraria do cliente o dobro.
    if (v_linha->>'saldo')::integer > 0 then
      if exists (select 1 from crediario_lancamentos l
                  where l.cliente_id = v_cliente
                    and l.tipo = 'compra'
                    and l.venda_id is null
                    and l.observacao = 'Saldo importado do sistema antigo') then
        v_saldos_ignorados := v_saldos_ignorados + 1;
      else
        insert into crediario_lancamentos (cliente_id, venda_id, tipo, valor,
                                           observacao, usuario_id)
        values (v_cliente, null, 'compra', (v_linha->>'saldo')::integer,
                'Saldo importado do sistema antigo', v_usuario);
        v_lancados := v_lancados + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'criados',           v_criados,
    'atualizados',       v_atualizados,
    'ignorados',         v_ignorados,
    'saldos_lancados',   v_lancados,
    'saldos_ignorados',  v_saldos_ignorados);
end $$;

-- `from anon` e obrigatorio: no Supabase o EXECUTE chega a anon por DEFAULT
-- PRIVILEGES (grant direto no papel), e revogar so de PUBLIC nao tira nada.
-- (Provado por has_function_privilege em tests/sql/casos/050_permissoes.sql.)
revoke all on function cliente_salvar(uuid, text, text, text, integer, boolean, text, integer)
  from public, anon;
grant execute on function cliente_salvar(uuid, text, text, text, integer, boolean, text, integer)
  to authenticated, service_role;

revoke all on function importar_clientes(jsonb, boolean) from public, anon;
grant execute on function importar_clientes(jsonb, boolean) to authenticated, service_role;
