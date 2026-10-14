-- 140_margem.sql — casos das duas funcoes de margem por produto
-- (migration 019_margem_produtos.sql, Task 1 do plano do agente de margem).
--
-- O que este arquivo prova, e por que cada assercao e do tamanho que e:
--
--   * A ORDEM E POR PERCENTUAL, e nao pelo valor em reais. Os TRES produtos que
--     entram no ranking tem percentuais DISTINTOS, e a ordem por percentual e
--     DIFERENTE da ordem pelo valor em reais dois a dois:
--       PRODUTO A     receita  900, custo 300 -> margem 600 = 66,7%  (pior %)
--       PRODUTO MISTO receita 1200, custo 300 -> margem 900 = 75,0%  (pior R$)
--       PRODUTO B     receita 1000, custo 200 -> margem 800 = 80,0%  (melhor %)
--     A ordem correta e A, MISTO, B. A primeira linha e o A e a SEGUNDA e o MISTO
--     (que tem a MAIOR margem em reais) — se a ordenacao fosse pelo valor em reais,
--     o MISTO viria primeiro e as duas assercoes ficariam vermelhas. Foi o achado que
--     mudou o cenario do brief, que pedia "tres produtos": com tres, escolher o pior
--     era obvio e qualquer `order by` passaria.
--     (Os precos de venda sao os de TABELA: `registrar_venda` grava
--     `produtos.preco_venda` no item, e nunca um preco vindo do carrinho.)
--   * O DIA DA VENDA E FIXO NO CASO (nao e `now()`): as vendas deste arquivo sao
--     datadas dentro de uma janela no FUTURO, porque o banco e o de PRODUCAO. O
--     primeiro run mediu `margem_produtos(hoje - 30, hoje, 10)` e voltou com uma
--     venda REAL da farmacia ("CR PENT SEDA FROZEN BRILHO ENCANTA 300ML") dentro
--     da janela; o segundo usou uma janela de 10 dias atras e tambem achou venda
--     real. Com dado real dentro do periodo, `count(*)` mede a farmacia e nao a
--     funcao (~15 vendas/dia no periodo medido). A janela e no futuro e o caso 0
--     PROVA que ela esta vazia; a janela continua RELATIVA a hoje porque o caso 5
--     precisa exercitar o TETO sobre o parametro que o agente manda.
--   * PRODUTO SEM CUSTO fica FORA do ranking e e contado a parte
--     (`margem_sem_custo`). `preco_custo = 0` e "nao sei o custo", nao "custo
--     zero": entrar no ranking daria percentual 100% (o MELHOR lugar) para o
--     produto que a farmacia nem sabe quanto pagou. O produto sem custo e vendido
--     de proposito, senao a exclusao poderia estar so escondendo um produto que
--     nao vendeu.
--   * CUSTO MISTO e decidido por PRODUTO, e nao item a item (ruling R4): o
--     PRODUTO MISTO vende uma vez antes e uma depois de o custo ser cadastrado, e
--     tem de aparecer NO RANKING (com os itens que tem custo) e NAO na contagem.
--     Contar `i.preco_custo = 0` de um lado e `> 0` do outro fazia esse produto
--     aparecer nos DOIS, e o numero narrado ao dono superestimava.
--   * RECEITA ZERO (brinde, desconto de 100%) nao pode entrar no ranking: e o caso
--     em que `margem / receita` DIVIDE POR ZERO. E quem fica de fora por causa
--     disso NAO some da resposta: entra na contagem de `margem_sem_custo` (ruling
--     R7), porque com custo 300 e receita 0 ele tem margem -300 e e o PIOR caso que
--     existe — deixa-lo fora das duas respostas faria o agente dizer "nenhum
--     produto com margem ruim" com ele na tela. A venda do brinde e inserida
--     DIRETO nas tabelas, junto de um item pago, para o total da venda ficar
--     positivo e a constraint `vendas_total_positivo` NUNCA ser tocada (ruling R6:
--     teste nao derruba constraint em tabela de producao — ver o cenario).
--   * PERIODO TORTO E RECUSADO, e nao devolvido como zero. Esta e a divergencia
--     DELIBERADA da funcao irma: `relatorio_lucro` (016) devolve zeros para
--     periodo nulo/invertido/torto. Para o agente isso seria pior que nao
--     responder — "nenhum produto perdeu margem" e uma resposta FALSA, nao uma
--     recusa. As mensagens de recusa sao as do plano ("Textos fixados"), comparadas
--     AQUI SEM ACENTO: o transporte ate o endpoint de SQL nao preserva acentuacao
--     (foi o que quebrou o caso 030 em 14/10/2026), entao um literal acentuado
--     casaria por acidente com mensagem corrompida no banco.
--   * SO O DONO LE A MARGEM, e a barreira e a checagem DENTRO da funcao. As duas
--     funcoes sao `security definer` (ruling R2 do ledger): a checagem de papel
--     deixa de ser redundante e passa a ser a UNICA barreira, porque `definer`
--     ignora a RLS. O atendente e provado chamando a funcao DIRETO, sem tela.
--
-- Tudo roda na transacao do caso e morre no ROLLBACK.

do $$
declare
  -- HOJE em Sao Paulo: a MESMA expressao de dia que 005_views.sql e 016 usam.
  hoje         date := (now() at time zone 'America/Sao_Paulo')::date;
  -- A JANELA DO CASO FICA NO FUTURO, e isto NAO e capricho: e a unica janela
  -- garantidamente VAZIA num banco de PRODUCAO em operacao. O primeiro run deste
  -- caso usou `hoje - 30, hoje` e voltou com vendas REAIS da farmacia dentro da
  -- janela (uma delas "CR PENT SEDA FROZEN BRILHO ENCANTA 300ML", ~15 vendas/dia
  -- no periodo medido): com dado real dentro, toda contagem mede a farmacia e nao
  -- a funcao. Janela no PASSADO nao serve sempre (a farmacia vende todo dia, e a
  -- janela de 10 dias atras tem venda real — foi o segundo run, vermelho tambem);
  -- dias no futuro nao podem ter venda registrada, e o caso 0 PROVA isso.
  -- A janela e relativa a HOJE (e nao uma data fixa) porque o caso 5 precisa
  -- exercitar o TETO sobre o parametro que o agente manda.
  v_dia_venda  date := hoje + 100;
  -- O intervalo e 30, e nao 31: o app conta DATAS INCLUSIVAS (31 datas = de 01/01 a
  -- 31/01 = `ate - de` de 30), entao 30 e o TETO, e a janela do caso e o proprio
  -- limite superior (ruling R5).
  v_de         date := v_dia_venda - 30;
  v_ate        date := v_dia_venda;
  v_dono       uuid;
  v_atendente  uuid;
  v_caixa      uuid;
  v_chave      uuid;
  -- produtos com custo (os que PODEM entrar no ranking)
  v_p_a        uuid;   -- o pior percentual
  v_p_b        uuid;   -- o melhor percentual
  -- produtos que NAO podem entrar no ranking
  v_p_brinde   uuid;   -- custo > 0 e receita ZERO: divide por zero
  v_p_semcusto uuid;   -- preco_custo = 0: some do ranking e vira contagem
  -- produto de CUSTO MISTO: entra no ranking e NAO entra na contagem (ruling R4)
  v_p_misto    uuid;
  v_venda_misto1 uuid; -- a venda dele ANTES de o custo ser cadastrado
  v_venda_misto2 uuid; -- e a venda DEPOIS
  -- o cenario ISOLADO que discrimina o criterio novo do antigo (ruling R9, ver o caso 3)
  v_p_isolado  uuid;
  v_dia_isolado date := v_dia_venda + 31;  -- FORA da janela principal, de proposito
  v_venda_isolada  uuid;
  v_venda_isolada2 uuid;
  v_venda_a    uuid;
  v_venda_b    uuid;
  v_venda_c    uuid;
  v_venda_brinde uuid;
begin
  -- ================= cenario =================
  -- Dono e atendente: o segundo existe para provar que a margem e do dono.
  v_dono := criar_usuario_teste(gen_random_uuid(), 'margem@farmacia.local');
  v_atendente := criar_usuario_teste(gen_random_uuid(), 'margem-atendente@farmacia.local', 'atendente');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);

  -- O caixa e criado direto pela fixture (sem abrir_caixa): registrar_venda exige
  -- um caixa aberto. ATENCAO ao TERMINAL: os casos irmaos usam o padrao 'balcao',
  -- mas o indice unico parcial `caixa_um_aberto_por_terminal` faz a fixture
  -- estourar quando a FARMACIA ESTA OPERANDO (o caixa real esta aberto) — foi o
  -- que aconteceu no primeiro run deste caso: "duplicate key value violates
  -- unique constraint caixa_um_aberto_por_terminal". O terminal proprio (com
  -- uuid) deixa o caso rodavel com a farmacia aberta, que e a unica condicao em
  -- que este banco existe; nada mais le esse terminal, porque a fixture nao passa
  -- por `abrir_caixa`. `registrar_venda` pega o caixa aberto mais recente, e o que
  -- ele grava em `vendas.caixa_sessao_id` nao entra em conta nenhuma destas duas
  -- funcoes de margem.
  v_caixa := criar_caixa_aberto(v_dono, 'teste-margem-' || gen_random_uuid()::text);

  -- Precos e custos conhecidos — e deles que saem TODOS os numeros esperados.
  -- O PRODUTO A vende 2 unidades de uma vez e 1 em outra venda, sempre ao preco de
  -- tabela 300: receita 900. O custo dele e 100 a unidade, entao custo 300 e margem
  -- 600 (66,7%). O PRODUTO B vende 1 a 1000, custo 200: margem 800 (80,0%) — MELHOR
  -- percentual que o A, mesmo com margem em reais maior. E este par que separa as
  -- duas ordens.
  v_p_a := criar_produto('PRODUTO MARGEM PIOR', 300, 100);
  update produtos set preco_custo = 100 where id = v_p_a;

  v_p_b := criar_produto('PRODUTO MARGEM MELHOR', 1000, 100);
  update produtos set preco_custo = 200 where id = v_p_b;

  -- O produto SEM custo: vendido de proposito (se nao fosse, a exclusao do
  -- ranking poderia estar apenas escondendo um produto que nunca vendeu).
  v_p_semcusto := criar_produto('PRODUTO SEM CUSTO', 400, 100);
  update produtos set preco_custo = 0 where id = v_p_semcusto;

  -- A venda A: 2x PRODUTO A, no dia do caso (dentro da janela futura).
  v_chave := gen_random_uuid();
  v_venda_a := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_a, 'quantidade', 2)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 600)),
    0)->>'id')::uuid;

  -- A venda B: 1x PRODUTO A (para ele ter DUAS vendas somadas em UMA linha) e 1x
  -- PRODUTO SEM CUSTO. A receita do A fecha em 900 e a do sem custo comeca em 400
  -- (que vira 1400 com a linha paga de 1000 na venda do brinde, mais abaixo).
  v_chave := gen_random_uuid();
  v_venda_b := (registrar_venda(v_chave, null,
    jsonb_build_array(
      jsonb_build_object('produto_id', v_p_a, 'quantidade', 1),
      jsonb_build_object('produto_id', v_p_semcusto, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 700)),
    0)->>'id')::uuid;

  -- A venda C: 1x PRODUTO B. Venda propria porque a venda B acima e o par que
  -- prova a soma de duas vendas do MESMO produto em uma linha do ranking; misturar
  -- o B ali esconderia qual dos dois fatos quebrou quando a assercao falhasse.
  -- (O valor do pagamento tem de ser o total dos itens da venda: o `registrar_venda`
  -- recusa pagamento menor que o total, e um valor maior vira troco.)
  v_chave := gen_random_uuid();
  v_venda_c := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_b, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1000)),
    0)->>'id')::uuid;

  -- ---- o PRODUTO MISTO: custo cadastrado NO MEIO do periodo (ruling R4) ----
  -- Duas vendas do MESMO produto, com o custo cadastrado ENTRE elas: a primeira
  -- grava `venda_itens.preco_custo = 0` (o custo ainda nao existia no cadastro) e a
  -- segunda grava o custo novo. E este par que faz o produto ter itens de CUSTO
  -- MISTO no periodo — vender so depois do cadastro nao provaria nada, e vender so
  -- antes daria o mesmo que o PRODUTO SEM CUSTO.
  --
  -- O que ele prova: a decisao "esta no ranking ou na contagem" e por PRODUTO. Um
  -- produto com QUALQUER item de custo > 0 esta no ranking (somando so os itens com
  -- custo, porque o de custo zero somaria receita sem custo e inflaria a margem) e
  -- NAO pode aparecer na contagem. A primeira versao da funcao contava
  -- `i.preco_custo = 0` na contagem e `> 0` no ranking: este produto aparecia nos
  -- DOIS lados, o comentario "ficaram fora do ranking" ficava falso e o numero
  -- narrado ao dono superestimava. E o cenario e realista: `produtos.preco_custo` e
  -- preenchido DEPOIS pela importacao de precos.
  --
  -- Os numeros dele foram escolhidos para o ranking nao virar um caso ambiguo:
  -- 2 unidades a 1200 (receita 1200, porque so o item COM custo entra na soma) e
  -- custo 300 dao margem 900 — a MAIOR margem em reais do cenario e o SEGUNDO pior
  -- percentual (75,0%, entre o A de 66,7% e o B de 80,0%).
  v_p_misto := criar_produto('PRODUTO MISTO', 1200, 100);
  update produtos set preco_custo = 0 where id = v_p_misto;

  -- Antes do cadastro do custo: 1 unidade a 1200, custo 0 no item.
  v_chave := gen_random_uuid();
  v_venda_misto1 := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_misto, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1200)),
    0)->>'id')::uuid;

  -- A importacao de precos chega e cadastra o custo.
  update produtos set preco_custo = 300 where id = v_p_misto;

  -- Depois do cadastro: 1 unidade a 1200, custo 300 no item.
  v_chave := gen_random_uuid();
  v_venda_misto2 := (registrar_venda(v_chave, null,
    jsonb_build_array(jsonb_build_object('produto_id', v_p_misto, 'quantidade', 1)),
    jsonb_build_array(jsonb_build_object('forma', 'dinheiro', 'valor', 1200)),
    0)->>'id')::uuid;

  -- As vendas do cenario no MESMO dia conhecido (o `criado_em` que a funcao usa no
  -- recorte e no fuso).
  update vendas
     set criado_em = (v_dia_venda::timestamp + time '12:00') at time zone 'America/Sao_Paulo'
   where id in (v_venda_a, v_venda_b, v_venda_c, v_venda_misto1, v_venda_misto2);

  -- ---- a venda do BRINDE: um item de receita ZERO com custo > 0 ----
  -- `registrar_venda` nao serve aqui: ele monta a linha do item com o preco de
  -- tabela do produto, e nao aceita item de receita zero. A venda e montada a mao
  -- (como os casos irmaos montam cenario), com DOIS itens:
  --   * o BRINDE, item de receita zero: `preco_unitario = 0`, `preco_custo = 300`;
  --   * um item PAGO (1x PRODUTO SEM CUSTO a 1000), cuja receita cobre o desconto
  --     de 100% aplicado ao brinde — o TOTAL da venda fica POSITIVO (subtotal 1000,
  --     desconto 500, total 500).
  --
  -- Este segundo item e o que evita derrubar a constraint `vendas_total_positivo`
  -- (001_base.sql:104), que PROIBE venda de total zero. A primeira versao deste
  -- caso fazia `alter table vendas drop constraint ...` para caber uma venda de
  -- total zero — e isso e INACEITAVEL num banco de PRODUCAO (ruling R6 da revisao):
  -- o DROP toma ACCESS EXCLUSIVE em `vendas` ate o ROLLBACK, e a farmacia esta
  -- VENDENDO agora; o caso bloquearia o PDV, e um retry do runner poderia prender
  -- atras de um lock. **Teste nao derruba constraint em tabela de producao**, ponto.
  -- O estado que o caso precisa (um item com custo e receita ZERO no periodo) e
  -- alcancavel sem DDL nenhum: o que estava errado era o desenho do cenario, nao a
  -- constraint. O `vendas_desconto_ok` (desconto <= subtotal) e o `vendas_total_ok`
  -- (total = subtotal - desconto) continuam valendo, e a venda passa pelos dois.
  --
  -- A linha paga e do PRODUTO SEM CUSTO de proposito, e nao de um produto novo: ele
  -- JA tem `preco_custo = 0`, entao a linha nao mexe em conta nenhuma do ranking
  -- (nao pode entrar nele por falta de custo) e serve de item pago sem poluir o
  -- cenario com um sexto produto. O efeito colateral esta preso pelo caso 2: a
  -- receita dele no periodo passa de 400 para 1400 (400 + os 1000 desta linha).
  v_p_brinde := criar_produto('PRODUTO BRINDE', 500, 100);
  update produtos set preco_custo = 300 where id = v_p_brinde;

  insert into vendas (chave_idempotencia, caixa_sessao_id, usuario_id,
                      subtotal, desconto, total, valor_pago, troco, criado_em)
  values (gen_random_uuid(), v_caixa, v_dono, 1000, 500, 500, 500, 0,
          (v_dia_venda::timestamp + time '12:00') at time zone 'America/Sao_Paulo')
  returning id into v_venda_brinde;

  -- O preco_custo e gravado no ITEM (venda_itens.preco_custo, coluna de 001:122),
  -- que e o custo do dia da venda — o mesmo campo que a funcao le.
  insert into venda_itens (venda_id, produto_id, nome_produto, quantidade,
                           preco_unitario, preco_custo, total)
  values (v_venda_brinde, v_p_brinde, 'PRODUTO BRINDE', 1, 0, 300, 0),
         (v_venda_brinde, v_p_semcusto, 'PRODUTO SEM CUSTO', 1, 1000, 0, 1000);

  -- ================= caso 0: o cenario esta montado =================
  -- As assercoes abaixo seriam VAZIAS se o cenario nao tivesse, de fato, os casos
  -- que elas testam. Estas quatro sao a guarda contra "passar por acidente".
  perform teste_ok((select count(*) = 1 from venda_itens where produto_id = v_p_brinde and preco_custo > 0),
    'caso 0: o cenario tem UMA venda de produto com custo e RECEITA ZERO (senao o caso 6 nao prova nada)');
  perform teste_ok((select count(*) >= 1 from venda_itens where produto_id = v_p_semcusto),
    'caso 0: o produto SEM custo foi vendido (senao a exclusao do ranking nao prova nada)');
  -- A guarda do PRODUTO MISTO: ele so prova o R4 se tiver, de fato, os DOIS tipos de
  -- item no periodo. Sem esta assercao, um cenario que perdesse a venda anterior ao
  -- cadastro do custo faria o "custo misto" nao existir — e a assercao do caso 3
  -- passaria por ausencia, nao por regra.
  perform teste_ok((select count(*) filter (where preco_custo = 0) = 1
                       and count(*) filter (where preco_custo > 0) = 1
                      from venda_itens where produto_id = v_p_misto),
    'caso 0: o PRODUTO MISTO tem UM item sem custo e UM com custo no periodo (senao o caso 3 nao prova o R4)');
  -- A CANARIA DA JANELA: se qualquer venda real da farmacia cair no periodo deste
  -- caso, TODA contagem abaixo vira uma medicao da farmacia (foi o que aconteceu
  -- no primeiro run, com `hoje - 30, hoje`) e este caso para de provar qualquer
  -- coisa. Esta assercao e a que denuncia isso.
  perform teste_ok((select count(distinct i.produto_id) = 5
                      from venda_itens i
                      join vendas v on v.id = i.venda_id
                     where v.status = 'concluida'
                       and (v.criado_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate),
    'caso 0: a janela do caso tem SO os cinco produtos do cenario (nenhuma venda real da farmacia caiu nela)');

  -- ---- O PRODUTO ISOLADO: o cenario que DISCRIMINA os dois criterios (R9) ----
  -- Este produto existe para uma unica assercao, e sem ele o caso nao consegue
  -- distinguir a contagem nova da antiga — foi a licao mais cara desta rodada.
  --
  -- O problema, MEDIDO: os cinco produtos de cima dao o MESMO numero nas duas versoes da
  -- funcao (2), e ate a aritmetica da particao bate nas duas por coincidencia:
  --   antiga: sem_custo {SEM CUSTO, MISTO}=2, ranking {A, MISTO, B}=3, 5-3=2
  --   nova:   sem_custo {SEM CUSTO, BRINDE}=2, ranking {A, MISTO, B}=3, 5-3=2
  -- Nenhuma contagem sobre ESTE cenario separa as versoes. O que separa e um produto que
  -- tenha os DOIS tipos de item DENTRO DA MESMA JANELA:
  --   criterio ANTIGO (por item: existe item com `preco_custo = 0`) -> CONTA o produto;
  --   criterio NOVO (por produto: nenhum item no ranking)            -> NAO conta.
  -- O PRODUTO ISOLADO tem exatamente isso no dia `v_dia_isolado`:
  --   * uma venda ANTES de o custo ser cadastrado: item PAGO com `preco_custo = 0`;
  --   * uma venda DEPOIS: item pago com `preco_custo = 400`.
  -- MEDIDO na janela de UM DIA desse produto: a funcao NOVA devolve 0 (o produto ESTA no
  -- ranking, pelo item com custo) e a funcao ANTIGA devolve 1 — numero medido pelo revisor
  -- contra a definicao real do commit `2972376`. (Eu havia escrito "2" aqui, supondo o
  -- valor do bug; estava errado. O que EU verifiquei foi a execucao: aplicando a definicao
  -- historica extraida daquele commit, a assercao abaixo fica vermelha — ou seja, a antiga
  -- devolve valor diferente de 0. O valor exato e a medicao do revisor.)
  -- Nao escreva aqui um numero do criterio antigo que voce nao mediu: foi exatamente
  -- supor esse valor que produziu a afirmacao falsa.
  v_p_isolado := criar_produto('PRODUTO ISOLADO', 1000, 100);
  update produtos set preco_custo = 400 where id = v_p_isolado;

  -- DUAS vendas no mesmo dia (`venda_itens` tem UNIQUE (venda_id, produto_id), entao os
  -- dois itens do mesmo produto nao cabem na mesma venda — mesmo tropeco que a venda do
  -- brinde acima contorna usando o produto sem custo como item pago):
  --   * a venda X, venda ANTES do cadastro do custo: 2 un a 1000 com `preco_custo = 0`
  --     (o custo do produto ainda nao existia) — receita positiva, custo zero;
  --   * a venda Y, venda DEPOIS do cadastro: 1 un a 1000 com `preco_custo = 400`.
  -- O item pago da venda Y e de um segundo produto pago (PRODUTO B) so para o total ficar
  -- positivo, o que e dispensavel mas mantem a venda Y com cara de venda real.
  --
  -- Na janela de UM DIA o PRODUTO ISOLADO tem, entao, os dois tipos de item que separam
  -- os criterios:
  --   `bool_or(preco_custo = 0)`             = TRUE  (a venda X) -> criterio ANTIGO CONTA;
  --   `bool_or(preco_custo > 0 and total > 0)` = TRUE  (a venda Y) -> criterio NOVO NAO CONTA.
  -- E este o par que faz o numero da funcao diferir entre as versoes (1 contra 0). A
  -- primeira versao deste cenario usava um BRINDE no lugar da venda X, e nao discriminava
  -- por um motivo que nao tem nada a ver com `total`: o criterio ANTIGO so olha
  -- `preco_custo = 0`, e o item de brinde usado ali tinha `preco_custo = 300` (o brinde
  -- tem CUSTO; o que ele nao tem e receita) — entao a antiga nao o via e as duas versoes
  -- davam 0. O cenario final usa a venda ANTES do cadastro, cujo item tem `preco_custo = 0`
  -- de verdade, que e o que a antiga conta.
  insert into vendas (chave_idempotencia, caixa_sessao_id, usuario_id,
                      subtotal, desconto, total, valor_pago, troco, criado_em)
  values (gen_random_uuid(), v_caixa, v_dono, 2000, 0, 2000, 2000, 0,
          (v_dia_isolado::timestamp + time '12:00') at time zone 'America/Sao_Paulo')
  returning id into v_venda_isolada;

  insert into venda_itens (venda_id, produto_id, nome_produto, quantidade,
                           preco_unitario, preco_custo, total)
  values (v_venda_isolada, v_p_isolado, 'PRODUTO ISOLADO', 2, 1000, 0, 2000);

  insert into vendas (chave_idempotencia, caixa_sessao_id, usuario_id,
                      subtotal, desconto, total, valor_pago, troco, criado_em)
  values (gen_random_uuid(), v_caixa, v_dono, 3000, 0, 3000, 3000, 0,
          (v_dia_isolado::timestamp + time '12:00') at time zone 'America/Sao_Paulo')
  returning id into v_venda_isolada2;

  insert into venda_itens (venda_id, produto_id, nome_produto, quantidade,
                           preco_unitario, preco_custo, total)
  values (v_venda_isolada2, v_p_isolado, 'PRODUTO ISOLADO', 1, 1000, 400, 1000),
         (v_venda_isolada2, v_p_b, 'PRODUTO MARGEM MELHOR', 2, 1000, 200, 2000);

  -- ================= caso 1: a ordem e pelo PIOR percentual =================
  -- PRODUTO A: 900 de receita (3 unidades ao preco de TABELA do cenario, 300 cada
  -- — o `registrar_venda` sempre grava `produtos.preco_venda`, e nao um preco vindo
  -- do carrinho), 300 de custo, margem 600 (66,7%) — o PIOR percentual.
  -- PRODUTO MISTO: 1200 de receita (so o item com custo entra na soma), 300 de custo,
  -- margem 900 (75,0%) — a MAIOR margem em reais e o SEGUNDO pior percentual.
  -- PRODUTO B: 1000 de receita, 200 de custo, margem 800 (80,0%) — o MELHOR percentual.
  -- A ordem certa e A, MISTO, B. As duas primeiras assercoes travam as duas primeiras
  -- posicoes: o MISTO tem a MAIOR margem em reais do cenario, entao uma ordenacao por
  -- valor em reais poria ele em PRIMEIRO (e o A em segundo) — as duas ficariam
  -- vermelhas. Sem a terceira linha, um `order by` por receita tambem passaria.
  perform teste_ok((select produto_id = v_p_a from margem_produtos(v_de, v_ate, 10) limit 1),
    'caso 1: o ranking comeca pelo PIOR percentual (o produto de margem 600 sobre receita de 900)');
  perform teste_ok((select produto_id = v_p_misto from margem_produtos(v_de, v_ate, 10) offset 1 limit 1),
    'caso 1: o segundo e o de MAIOR margem em reais e SEGUNDO pior percentual — a ordem NAO e pelo valor em reais');
  perform teste_ok((select produto_id = v_p_b from margem_produtos(v_de, v_ate, 10) offset 2 limit 1),
    'caso 1: o terceiro e o de MELHOR percentual — a ordem e por percentual crescente, nas tres posicoes');
  -- Os numeros de cada posicao, e a conta que os produziu: o A tem as DUAS vendas
  -- somadas em UMA linha (2x + 1x = 3 unidades, 900 de receita).
  perform teste_ok((select quantidade = 3 and receita = 900 and custo = 300 and margem = 600
                      from margem_produtos(v_de, v_ate, 10) limit 1),
    'caso 1: as duas vendas do mesmo produto sao somadas em uma linha (3 un, receita 900, custo 300, margem 600)');
  perform teste_ok((select quantidade = 1 and receita = 1200 and custo = 300 and margem = 900
                      from margem_produtos(v_de, v_ate, 10) offset 1 limit 1),
    'caso 1: o MISTO soma SO o item com custo (receita 1200, custo 300, margem 900) — a receita do item sem custo fica fora');
  perform teste_ok((select quantidade = 1 and receita = 1000 and custo = 200 and margem = 800
                      from margem_produtos(v_de, v_ate, 10) offset 2 limit 1),
    'caso 1: receita, custo e margem do terceiro colocado batem com o cenario (1000, 200, 800)');
  -- Margem e SEMPRE receita - custo, linha a linha: a invariante que pega uma
  -- agregacao furada (somar o custo de um produto na receita de outro).
  perform teste_ok((select bool_and(margem = receita - custo) from margem_produtos(v_de, v_ate, 10)),
    'caso 1: em toda linha, margem = receita - custo');

  -- ================= caso 2: quem nao tem custo NAO entra no ranking =================
  -- Sao CINCO produtos vendidos no periodo (A, B, o sem custo, o brinde e o misto) e
  -- TRES linhas no ranking: A, B e o misto. Ficam de fora o sem custo (nenhum item
  -- com custo) e o brinde (receita zero) — os dois contados no caso 3.
  -- O brief pedia `count(*) = 2` descrevendo "tres produtos com custo"; o cenario
  -- ganhou o PRODUTO MISTO depois da revisao (ruling R4), que entra no ranking, e o
  -- numero passou a 3 (ver o relatorio).
  perform teste_ok((select count(*) = 3 from margem_produtos(v_de, v_ate, 10)),
    'caso 2: o produto sem custo NAO entra no ranking (3 linhas para 5 produtos vendidos)');
  perform teste_ok((select count(*) = 0 from margem_produtos(v_de, v_ate, 10) where produto_id = v_p_semcusto),
    'caso 2: e o produto que ficou de fora e exatamente o de preco_custo = 0');
  -- O produto sem custo NAO some do banco: as vendas dele estao la, com receita
  -- (400 na venda B + 1000 na linha paga da venda do brinde). (Sem isto, "nao entrou
  -- no ranking" poderia ser apenas "nao existe".)
  perform teste_ok((select coalesce(sum(i.total), 0) = 1400 from venda_itens i
                     where i.produto_id = v_p_semcusto
                       and i.venda_id in (v_venda_a, v_venda_b, v_venda_c, v_venda_brinde)),
    'caso 2: as vendas do produto sem custo existem e somam 1400 (ele so nao entra no ranking)');

  -- ================= caso 3: quem ficou fora do ranking e contado a parte =================
  -- DOIS produtos ficaram fora do ranking (o SEM CUSTO e o BRINDE), e o PRODUTO MISTO
  -- NAO esta entre eles — ele tem um item sem custo, mas tem outro item COM custo, e
  -- quem decide e o PRODUTO (rulings R4 e R7).
  --
  -- POR QUE A CONTAGEM SOZINHA NAO PROVA NADA (ruling R9), e isto esta MEDIDO:
  --   funcao ANTIGA (`count(distinct produto_id) ... preco_custo = 0`): 2, {SEM CUSTO, MISTO}
  --   funcao NOVA (complemento do ranking):                              2, {SEM CUSTO, BRINDE}
  -- O mesmo numero, conjuntos diferentes: `sem_custo = 2` passa nas DUAS versoes. Neste
  -- cenario NENHUMA assercao de contagem discrimina — nem esta, nem a da PARTICAO logo
  -- abaixo (que tambem da 2 nas duas: ver a nota dela). Quem discrimina o R4/R7 neste
  -- arquivo e UMA assercao, a do dia isolado (`v_dia_isolado`), no fim do caso 3.
  perform teste_ok((select sem_custo = 2 from margem_sem_custo(v_de, v_ate)),
    'caso 3: dois produtos ficaram fora do ranking (o sem custo e o brinde)');
  -- ---- A PARTICAO: invariante de consistencia, NAO assercao que discrimina ----
  -- O cenario tem CINCO produtos, TRES no ranking (A, MISTO, B) e DOIS fora, entao
  -- `sem_custo` tem de ser o complemento exato do ranking (5 - 3 = 2). Vale a pena manter:
  -- e a invariante que pega uma linha contada duas vezes ou sumida (o defeito do R4 tinha
  -- essa cara).
  --
  -- MAS ELA NAO DISCRIMINA O BUG, e isto esta medido: com a funcao ANTIGA o conjunto de
  -- fora e {SEM CUSTO, MISTO} e o ranking continua {A, MISTO, B} — as DUAS listas ainda
  -- somam 5 (o MISTO aparece nos dois lados E o BRINDE em nenhum, e os dois erros se
  -- cancelam na conta), entao 5 - 3 = 2 e a particao fica VERDE com a funcao antiga. A
  -- rodada 1 escreveu aqui que ela ficaria vermelha; era falso, e era exatamente a crenca
  -- que o R9 derrubou. Invariante util e assercao discriminante sao coisas diferentes.
  perform teste_ok((
    (select sem_custo from margem_sem_custo(v_de, v_ate)) =
    (select count(distinct i.produto_id) from public.venda_itens i
       join public.vendas v on v.id = i.venda_id
      where v.status = 'concluida'
        and (v.criado_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate)
    - (select count(*) from margem_produtos(v_de, v_ate, 10))
  ), 'caso 3: INVARIANTE (nao discrimina o R4/R7): a contagem e os produtos no ranking particionam os 5 vendidos');
  -- O MISTO e o caso que separa os dois criterios: ele tem um item de custo zero, entao
  -- qualquer contagem que decida por ITEM o incluiria. Aqui ele TEM de estar no ranking
  -- (uma linha, e so com o item que tem custo). `bool_and(produto_id = v_p_misto)` e nao
  -- `min(produto_id)`: o Postgres NAO tem `min`/`max` para `uuid` (a primeira versao levava
  -- "function min(uuid) does not exist").
  perform teste_ok((select count(*) = 1 and bool_and(produto_id = v_p_misto)
                      from margem_produtos(v_de, v_ate, 10) where produto_id = v_p_misto),
    'caso 3: o PRODUTO MISTO (item sem custo + item com custo) esta no ranking, em UMA linha');
  perform teste_ok((select count(*) = 0 from margem_produtos(v_de, v_ate, 10)
                     where produto_id in (v_p_semcusto, v_p_brinde)),
    'caso 3: e os DOIS contados como fora do ranking NAO estao no ranking');

  -- ---- A UNICA ASSERCAO QUE DISCRIMINA O R4/R7 (ruling R9) ----
  -- Na janela de UM DIA do PRODUTO ISOLADO o criterio novo devolve 0 (o produto esta no
  -- ranking: tem item com custo e receita) e o criterio ANTIGO devolve 1 (existe item com
  -- `preco_custo = 0`, e a antiga nao olha `total`) — o 1 foi medido contra a definicao
  -- real do commit `2972376`. Este e o unico numero do caso que separa as duas versoes: os
  -- cinco produtos principais dao 2 nas duas, e ate a particao da 2 nas duas. Ver a prova
  -- por execucao no relatorio.
  perform teste_ok((select sem_custo = 0 from margem_sem_custo(v_dia_isolado, v_dia_isolado)),
    'caso 3: no dia do PRODUTO ISOLADO a contagem e 0 — ele tem item PAGO sem custo, mas TEM item no ranking');
  -- A contagem respeita o periodo: uma janela que nao alcanca a venda devolve zero,
  -- e nao erro nem o numero da janela larga.
  perform teste_ok((select sem_custo = 0 from margem_sem_custo(v_dia_venda - 1, v_dia_venda - 1)),
    'caso 3: janela sem venda devolve 0 em vez de erro (a contagem respeita o periodo)');

  -- ================= caso 4: limite fora de 1..10 e recusado =================
  -- Ao contrario de `relatorio_mais_vendidos`, que corta em zero e devolve lista
  -- vazia: aqui um limite torto e recusa, porque o limite vem do pedido do agente e
  -- "zero resultados" nao tem leitura util (o agente narraria "nenhum produto").
  --
  -- O SQL do `teste_erro` e MONTADO com `format` e `%L`, e nao escrito com as
  -- variaveis do bloco: `teste_erro` faz `execute p_sql`, que roda em outro escopo e
  -- NAO enxerga as variaveis plpgsql daqui ("column v_de does not exist" foi o erro
  -- da primeira versao — um vermelho que nao tinha nada a ver com o limite). `%L`
  -- cita o literal, entao a data entra como `'2026-12-23'` e nao como texto solto.
  perform teste_erro(format('select margem_produtos(%L, %L, 0)', v_de, v_ate), 'limite',
    'caso 4: limite fora de 1..10 e recusado (0)');
  perform teste_erro(format('select margem_produtos(%L, %L, 11)', v_de, v_ate), 'limite',
    'caso 4: limite fora de 1..10 e recusado (11)');
  perform teste_erro(format('select margem_produtos(%L, %L, null)', v_de, v_ate), 'limite',
    'caso 4: limite nulo e recusado (nao ha "sem limite" para o agente)');
  -- E o limite e USADO quando e valido: com 1 volta so o pior percentual. A
  -- comparacao e com a PRIMEIRA linha de uma chamada sem corte, e nao com um `min`
  -- (a primeira versao usava `min(produto_id) = v_p_a`, que comparava uuid e
  -- passaria por acidente com qualquer produto — `min` de uuid nao diz nada sobre
  -- ordem de ranking).
  perform teste_ok((select count(*) = 1
                      from margem_produtos(v_de, v_ate, 1))
                   and (select produto_id from margem_produtos(v_de, v_ate, 1) limit 1)
                     = (select produto_id from margem_produtos(v_de, v_ate, 10) limit 1),
    'caso 4: com limite 1 volta so a primeira linha — o parametro e usado de verdade');
  -- O limite de 10 (o teto) nao corta o cenario: as tres linhas vem.
  perform teste_ok((select count(*) = 3 from margem_produtos(v_de, v_ate, 10)),
    'caso 4: o teto de 10 comporta o cenario inteiro');

  -- ================= caso 5: periodo acima do teto e recusado =================
  -- O trecho comparado e `'ordem'`, e nao `'periodo'`: a mensagem gravada e
  -- "Período inválido: de e até são obrigatórios, em ordem, com no máximo 31 dias
  -- (30 dias de intervalo)." e "Período"/"inválido" tem ACENTO. Um literal acentuado
  -- depende do transporte preservar acentuacao (foi o que quebrou o caso 030) e um
  -- literal sem acento que "parece" a palavra (`'periodo'`) simplesmente NAO EXISTE
  -- na mensagem — o `teste_erro` compara por `position`, entao o trecho tem de
  -- aparecer LITERALMENTE. `'ordem'` aparece igual nos dois (com acento certo no
  -- banco ou corrompido) e e exclusivo desta mensagem: as outras recusas nao tem
  -- "ordem" no texto. E `'31 dias'` prende a parte do teto, que e o que o caso 5
  -- esta testando (e nao so "recusou alguma coisa"). A palavra "máximo" NAO serve
  -- como trecho: ela tem acento, e a comparacao e byte a byte.
  --
  -- O TETO E 30 DE INTERVALO, e nao 31 (ruling R5): o app conta DATAS INCLUSIVAS e
  -- recusa `> 31` datas, isto e, aceita no maximo 31 datas (de 01/01 a 31/01), que e
  -- `ate - de = 30`. A versao anterior deste caso aceitava 31 de intervalo (32
  -- datas) — um dia a mais que o app. As DUAS PONTAS sao provadas, senao "recusa
  -- periodo grande" poderia estar recusando qualquer coisa: a janela do caso (30 de
  -- intervalo) passa, e 31 de intervalo e o primeiro que nao passa.
  perform teste_ok((select count(*) = 3 from margem_produtos(v_ate - 30, v_ate, 10)),
    'caso 5: o teto de 31 DATAS (30 de intervalo) passa — a janela do caso e o proprio limite');
  perform teste_erro(format('select margem_produtos(%L, %L, 10)', v_ate - 31, v_ate), 'ordem',
    'caso 5: 31 de intervalo (32 datas, um dia a mais que o teto) e recusado');
  perform teste_erro(format('select margem_produtos(%L, %L, 10)', v_ate - 40, v_ate), '31 dias',
    'caso 5: periodo bem maior que o teto e recusado, com a mensagem do teto de 31 dias');
  -- Nulo e invertido TAMBEM sao recusa: o contrario da funcao irma, que devolve
  -- zeros. Zero para periodo torto viraria "nenhum produto perdeu margem" — uma
  -- resposta falsa, e nao uma recusa.
  perform teste_erro(format('select margem_produtos(null, %L, 10)', v_ate), 'ordem',
    'caso 5: periodo nulo e recusado (ao contrario da funcao irma, que devolve zeros)');
  perform teste_erro(format('select margem_produtos(%L, %L, 10)', v_ate, v_de), 'ordem',
    'caso 5: periodo invertido e recusado');
  perform teste_erro(format('select margem_sem_custo(%L, %L)', v_ate - 31, v_ate), '31 dias',
    'caso 5: a contagem de sem custo recusa o MESMO periodo acima do teto');

  -- ================= caso 6: receita zero nao divide por zero =================
  -- A venda do brinde (item de receita 0 com custo 300) esta na janela. Se ele
  -- entrasse no ranking, `margem / receita` dividiria por zero — e o produto
  -- apareceria como o PIOR de todos, ou a funcao estouraria. Ele fica de fora.
  perform teste_ok((select count(*) = 0 from margem_produtos(v_de, v_ate, 10) where receita = 0),
    'caso 6: produto com receita zero NAO entra no ranking de percentual');
  perform teste_ok((select count(*) = 0 from margem_produtos(v_de, v_ate, 10) where produto_id = v_p_brinde),
    'caso 6: e a linha que fica de fora e a do brinde, nao outra qualquer');
  -- R7: e ele NAO desaparece da resposta — entra na contagem de fora do ranking,
  -- porque com custo 300 e receita 0 ele tem margem -300, o PIOR caso de margem que
  -- existe. Antes desta correcao ele nao aparecia em NENHUMA das duas respostas, e o
  -- agente diria "nenhum produto com margem ruim" com ele na tela.
  perform teste_ok((select count(*) = 1 from margem_sem_custo(v_de, v_ate) where sem_custo = 2),
    'caso 6: o brinde nao entra no ranking MAS e contado fora dele (custo 300 e receita 0 = o pior caso)');
  perform teste_ok((select sem_custo >= 0 from margem_sem_custo(v_de, v_ate)),
    'caso 6: e a funcao de contagem nao explode com receita zero presente');
  -- A soma do ranking continua sendo a dos ITENS com custo: A 900 + MISTO 1200 +
  -- B 1000 (a receita do item sem custo do misto NAO entra na soma: somar receita sem
  -- o custo correspondente inflaria a margem do produto).
  perform teste_ok((select coalesce(sum(receita), 0) = 3100 from margem_produtos(v_de, v_ate, 10)),
    'caso 6: a receita do ranking e a dos itens com custo (900 + 1200 + 1000), sem o brinde e sem o item sem custo do misto');

  -- ================= caso 7: so o dono le a margem =================
  -- A barreira e a checagem DENTRO da funcao, e nao a RLS: as duas sao `security
  -- definer` (ruling R2), entao `definer` ignora a RLS e o `if papel <> 'dono'`
  -- passa a ser a UNICA barreira. O atendente chama a funcao DIRETO, sem tela.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  -- Trecho SEM ACENTO de proposito, e que EXISTE literalmente na mensagem gravada
  -- ("Só o dono vê o lucro."): `'o lucro.'` — o fim da frase, com o ponto. E sem
  -- acento, e e unico: nenhuma outra recusa desta funcao (nem a de periodo, nem a de
  -- limite) termina em "o lucro.". Um literal acentuado depende de o transporte
  -- preservar acentuacao (foi o que quebrou o caso 030 em 14/10/2026); trechos
  -- anteriores foram descartados por medição: `'apenas o dono'` NAO EXISTE no texto
  -- (nem aqui, nem em `relatorio_lucro`, que usa a mesma mensagem) e `'dono v'`
  -- funcionava mas nao incluia a pontuacao final — a comparacao do `teste_erro` e por
  -- `position`, byte a byte, entao um trecho que nao esta na mensagem reprova o caso
  -- mesmo com a funcao correta (ver o relatorio).
  -- A mensagem GRAVADA no banco foi conferida a parte por sonda: `Só o dono vê o
  -- lucro.` esta INTEGRA (esta e a diferenca desta funcao para a `relatorio_lucro`,
  -- cujo texto esta corrompido no banco ate a Task 2 recriar).
  perform teste_erro(format('select * from margem_produtos(%L, %L, 10)', v_de, v_ate), 'o lucro.',
    'caso 7: o atendente nao ve o ranking de margem (a recusa vem da funcao, nao da tela)');
  perform teste_erro(format('select * from margem_sem_custo(%L, %L)', v_de, v_ate), 'o lucro.',
    'caso 7: o atendente nao ve nem a contagem de produtos sem custo');
  -- E o atendente LE o resto do relatorio: a recusa e da margem, nao do relatorio.
  perform teste_ok((select count(*) >= 0 from relatorio_resumo(v_de, v_ate)),
    'caso 7: o atendente continua lendo o resumo do periodo');
  -- Volta para o dono: `request.jwt.claims` e do CONNECTION e continua valendo nas
  -- assercoes seguintes (mesma observacao do caso 3 de 110_relatorios.sql).
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  perform teste_ok((select count(*) = 3 from margem_produtos(v_de, v_ate, 10)),
    'caso 7: e o dono continua vendo o ranking normalmente');

  -- ================= permissoes (padrao das RPCs do projeto) =================
  -- A chave publica nao executa: mesma correcao de classe da migration 013/016.
  perform teste_ok(not has_function_privilege('anon', 'margem_produtos(date,date,integer)', 'execute'),
    'permissoes: anon NAO executa margem_produtos');
  perform teste_ok(not has_function_privilege('anon', 'margem_sem_custo(date,date)', 'execute'),
    'permissoes: anon NAO executa margem_sem_custo');
  perform teste_ok(has_function_privilege('authenticated', 'margem_produtos(date,date,integer)', 'execute')
                   and has_function_privilege('authenticated', 'margem_sem_custo(date,date)', 'execute'),
    'permissoes: authenticated executa as duas funcoes de margem');
  perform teste_ok(has_function_privilege('service_role', 'margem_produtos(date,date,integer)', 'execute')
                   and has_function_privilege('service_role', 'margem_sem_custo(date,date)', 'execute'),
    'permissoes: service_role executa as duas (o servidor consulta por elas)');

  -- As duas SAO `security definer` — o oposto das quatro de 016, e de proposito
  -- (ruling R2): sem isso a Task 2 fecharia a leitura direta do custo e quebraria
  -- o relatorio de lucro. Esta assercao existe para a inversao nao passar batido.
  perform teste_ok((select prosecdef from pg_proc where oid = 'margem_produtos(date,date,integer)'::regprocedure)
                   and (select prosecdef from pg_proc where oid = 'margem_sem_custo(date,date)'::regprocedure),
    'seguranca: as duas funcoes de margem SAO security definer (a checagem de papel dentro e a barreira)');
  -- `search_path` fixo e obrigatorio em security definer (mesma regra das fixtures
  -- e da 002): sem ele, um schema no caminho do chamador poderia sequestrar a funcao.
  perform teste_ok((select array_to_string(proconfig, ',') like '%search_path=%'
                      from pg_proc where oid = 'margem_produtos(date,date,integer)'::regprocedure)
                   and (select array_to_string(proconfig, ',') like '%search_path=%'
                          from pg_proc where oid = 'margem_sem_custo(date,date)'::regprocedure),
    'seguranca: as duas fixam search_path (obrigatorio em security definer)');

  -- ================= a chave publica nao LE a margem =================
  -- `has_function_privilege` olha o catalogo; isto TROCA DE ROLE e tenta ler de
  -- verdade, como 050_permissoes.sql faz. O bloco e escrito A MAO (e nao com
  -- teste_erro) porque o Postgres proibe `set role` dentro de funcao security
  -- definer — e teste_erro e definer.
  execute 'set local role anon';
  begin
    perform (select count(*) from margem_produtos(v_de, v_ate, 10));
    perform teste_ok(false, 'anon NAO le o ranking de margem (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'anon NAO le o ranking de margem (a recusa e de permissao, veio: ' || sqlerrm || ')');
  end;
  begin
    perform (select count(*) from margem_sem_custo(v_de, v_ate));
    perform teste_ok(false, 'anon NAO le a contagem de sem custo (nada foi recusado)');
  exception when others then
    perform teste_ok(position(lower('permission denied') in lower(sqlerrm)) > 0,
      'anon NAO le a contagem de sem custo (a recusa e de permissao, veio: ' || sqlerrm || ')');
  end;
  execute 'reset role';
end $$;
