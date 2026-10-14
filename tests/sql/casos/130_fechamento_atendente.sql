-- 130_fechamento_atendente.sql — o ATENDENTE também fecha o caixa (migration 018).
--
-- O DEFEITO QUE ESTE CASO TRAVA: a regra antiga (004:122, `papel <> 'dono'`)
-- recusava o fechamento para o atendente, enquanto `abrir_caixa` NÃO checa papel
-- nenhum (só exige perfil). O resultado era uma operação sem saída: o atendente
-- abre o caixa, trabalha o dia inteiro e não consegue fechar. Com o dono ausente,
-- o caixa fica aberto e o dia seguinte trava em 'Já existe um caixa aberto.'
-- (004:46) — a farmácia para, e não por falta de dinheiro.
--
-- Nasceu VERMELHO contra a 017, no caso 2, com a mensagem
-- 'Só o dono pode fechar o caixa.'

do $$
declare
  v_atendente uuid;
  v_dono      uuid;
  v_sessao    uuid;
  v_resultado jsonb;
begin
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'atendente-caixa@farmacia.local', 'atendente');
  v_dono      := criar_usuario_teste(gen_random_uuid(), 'dono-caixa@farmacia.local', 'dono');

  -- ===== caso 1: o atendente ABRE o caixa =====
  -- Já funcionava antes, e é justamente o que torna o defeito assimétrico.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  v_sessao := abrir_caixa(5000);
  perform teste_ok((select status = 'aberto' from caixa_sessoes where id = v_sessao),
    'caso 1: o atendente abre o caixa');

  -- ===== caso 2: o atendente FECHA — é o que a migration 018 muda =====
  v_resultado := fechar_caixa(5000, null);
  perform teste_ok((v_resultado->>'diferenca')::integer = 0,
    'caso 2: o atendente fecha o caixa, com diferença zero');
  perform teste_ok((select status = 'fechado' and fechado_por = v_atendente and valor_contado = 5000
                    from caixa_sessoes where id = v_sessao),
    'caso 2: a sessão fica fechada, com quem fechou e o valor contado');

  -- ===== caso 3: o dia seguinte abre — o motivo da mudança =====
  -- Sem o fechamento do caso 2, esta linha levantaria 'Já existe um caixa aberto.'
  v_sessao := abrir_caixa(7000);
  perform teste_ok((select status = 'aberto' from caixa_sessoes where id = v_sessao),
    'caso 3: com o caixa fechado, o dia seguinte abre');

  -- ===== caso 4: o caso real do balcão — o dono abre, o atendente fecha =====
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  perform fechar_caixa(7000, null);
  v_sessao := abrir_caixa(3000);
  perform teste_ok((select aberto_por = v_dono from caixa_sessoes where id = v_sessao),
    'caso 4: o dono abre a sessão');

  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  perform fechar_caixa(3000, null);
  perform teste_ok((select status = 'fechado' and fechado_por = v_atendente
                    from caixa_sessoes where id = v_sessao),
    'caso 4: o atendente fecha a sessão que o DONO abriu');

  -- ===== caso 5: a regra da diferença NÃO mudou (spec 8.3) =====
  -- O trecho comparado é SEM acento de propósito: 'observa' é único na mensagem e
  -- não depende de codificação nenhuma.
  --
  -- CORREÇÃO DA VERDADE (rodada 1 de 5 da revisão da Task 2 — o comentário anterior
  -- aqui era FALSO em dois pontos). Ele dizia que a mensagem "vem da 004" e que "o
  -- transporte do endpoint de SQL não preserva acento de forma confiável, então casar
  -- 'observação' com acento dava falso negativo". MEDIDO:
  --   * a mensagem NÃO vem da 004: `fechar_caixa` foi recriada pela
  --     `018_fechamento_atendente.sql:87` (a 004 é a versão anterior dela);
  --   * o TRANSPORTE preserva acento — um literal acentuado enviado pelo endpoint de
  --     SQL chega intacto ao banco (medido com `position()` DENTRO do banco). O que
  --     havia era outra coisa, e essa era real: o CORPO VIVO da `fechar_caixa` estava
  --     gravado com 10 caracteres U+FFFD, porque a 018 foi APLICADA por
  --     PowerShell/`Invoke-WebRequest` em 14/10/2026 (o arquivo do repositório sempre
  --     esteve certo). Com a mensagem corrompida no banco, 'observação' com acento
  --     casaria só por acidente; o 'observa' sem acento é o trecho robusto nos dois
  --     estados.
  --   * conserto (esta rodada): 018 reaplicada pelo caminho do projeto
  --     (`npm run migrar -- 018_fechamento_atendente.sql`) e remedida —
  --     `position(chr(65533) in prosrc) = 0` e os textos acentuados de volta no corpo
  --     vivo. `abrir_caixa` e `caixa_movimento` (004) nunca tiveram U+FFFD.
  v_sessao := abrir_caixa(1000);
  perform teste_erro('select fechar_caixa(900, null)', 'precisa de observa',
    'caso 5: diferença sem observação continua recusada');
  v_resultado := fechar_caixa(900, 'faltou troco');
  perform teste_ok((v_resultado->>'diferenca')::integer = -100,
    'caso 5: com observação, a diferença é registrada');

  -- ===== caso 6: sem perfil continua recusado =====
  -- A lista de papéis é fechada, mas a guarda de perfil vem antes e não mudou.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  perform teste_erro('select fechar_caixa(0, null)', 'sem perfil cadastrado',
    'caso 6: usuário sem perfil não fecha o caixa');
end $$;
