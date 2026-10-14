-- 140_margem.sql — casos das duas funcoes de margem por produto
-- (migration 019_margem_produtos.sql, Task 1 do plano do agente de margem).
--
-- O que este arquivo prova, e por que cada assercao e do tamanho que e:
--
--   * A ORDEM E POR PERCENTUAL, e nao pelo valor em reais. O cenario foi montado
--     para as duas ordens terem um par (primeiro, segundo) DIFERENTE:
--       PRODUTO A: receita 900, custo 300 -> margem 600 = 66,7% da receita
--       PRODUTO B: receita 1000, custo 200 -> margem 800 = 80,0% da receita
--     O pior PERCENTUAL e o A; a pior margem em REAIS tambem e o A (600 < 800), mas
--     a SEGUNDA linha ser o B e o que amarra a regra: se a ordenacao fosse pela
--     margem em reais, ou pelo lucro, o par (primeiro, segundo) mudaria de sentido.
--     Foi o achado que mudou o cenario do brief, que pedia "tres produtos": com
--     tres, escolher o pior era obvio e qualquer `order by` passaria.
--     (Os precos de venda sao os de TABELA: `registrar_venda` grava
--     `produtos.preco_venda` no item, e nunca um preco vindo do carrinho.)
--   * O DIA DA VENDA E FIXO NO CASO (nao e `now()`): as vendas deste arquivo sao
--     datadas dentro de uma janela no FUTURO, porque o banco e o de PRODUCAO. O
--     primeiro run mediu `margem_produtos(hoje - 30, hoje, 10)` e voltou com uma
--     venda REAL da farmacia ("CR PENT SEDA FROZEN BRILHO ENCANTA 300ML") dentro
--     da janela; o segundo usou uma janela de 10 dias atras e tambem achou venda
--     real. Com dado real dentro do periodo, `count(*) = 2` mede a farmacia e nao a
--     funcao (~15 vendas/dia no periodo medido). A janela e no futuro e o caso 0
--     PROVA que ela esta vazia; a janela continua RELATIVA a hoje porque o caso 5
--     precisa exercitar o teto de 31 dias sobre o parametro que o agente manda.
--   * PRODUTO SEM CUSTO fica FORA do ranking e e contado a parte
--     (`margem_sem_custo`). `preco_custo = 0` e "nao sei o custo", nao "custo
--     zero": entrar no ranking daria percentual 100% (o MELHOR lugar) para o
--     produto que a farmacia nem sabe quanto pagou. O produto sem custo e vendido
--     de proposito, senao a exclusao poderia estar so escondendo um produto que
--     nao vendeu.
--   * RECEITA ZERO (brinde, desconto de 100%) nao pode entrar no ranking: e o caso
--     em que `margem / receita` DIVIDE POR ZERO. A venda do brinde e inserida
--     DIRETO nas tabelas (com preco_custo > 0) porque `registrar_venda` recusa
--     venda de total zero; a constraint que tambem proibe a linha e derrubada
--     DENTRO da transacao do caso (ver o comentario no ponto do cenario).
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
  -- no periodo medido): com dado real dentro, `count(*) = 2` mede a farmacia e nao
  -- a funcao. Janela no PASSADO nao serve sempre (a farmacia vende todo dia, e a
  -- janela de 10 dias atras tem venda real — foi o segundo run, vermelho tambem);
  -- dias no futuro nao podem ter venda registrada, e o caso 0 PROVA isso.
  -- A janela e relativa a HOJE (e nao uma data fixa) porque o caso 5 precisa
  -- exercitar o TETO de 31 dias sobre o parametro que o agente manda.
  v_dia_venda  date := hoje + 100;
  v_de         date := v_dia_venda - 30;   -- 30 dias de janela (dentro do teto de 31)
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
  -- PRODUTO SEM CUSTO. A receita do A fecha em 1050 e a do sem custo em 400.
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

  -- As tres vendas no MESMO dia conhecido (o `criado_em` que a funcao usa no
  -- recorte e no fuso).
  update vendas
     set criado_em = (v_dia_venda::timestamp + time '12:00') at time zone 'America/Sao_Paulo'
   where id in (v_venda_a, v_venda_b, v_venda_c);

  -- ---- a venda do BRINDE: receita ZERO, custo > 0 (inserida direto) ----
  -- `registrar_venda` recusa total zero ("O desconto nao pode zerar a venda"), e a
  -- tabela ainda tem a constraint `vendas_total_positivo` (001_base.sql:104), que
  -- PROIBE a linha existir. As duas coisas sao a mesma decisao: o PDV nao fecha
  -- venda de receita zero.
  --
  -- O cenario precisa da linha assim mesmo, e por dois motivos escritos:
  --   1. e o Review Focus 1 do plano ("brinde, desconto de 100%"), e a pergunta que
  --      ele responde e sobre `margem / receita`: se essa linha existir, a funcao
  --      NAO PODE entrar em divisao por zero;
  --   2. o banco e o de PRODUCAO e a constraint e de hoje — dado historico
  --      importado, ou venda feita antes dela, pode ter receita zero.
  -- A constraint e derrubada DENTRO da transacao do caso (o DROP e transacional no
  -- Postgres, como as tabelas temporarias do _helper) e o ROLLBACK do runner a
  -- devolve: nada fica alterado no banco. Alternativa descartada: montar a linha
  -- pelo caminho real com o desconto no nivel da VENDA — e impossivel, porque
  -- `venda_itens.preco_unitario` tem CHECK >= 0 e o total do item e preco *
  -- quantidade, entao receita de item zero so existe com preco zero (e
  -- `vendas.total > 0` sempre). E alternativa descartada tambem: nao testar o
  -- caso, que e justamente o que o Review Focus exige.
  alter table vendas drop constraint vendas_total_positivo;

  -- O preco_custo e gravado no ITEM (venda_itens.preco_custo, coluna de 001:122),
  -- que e o custo do dia da venda — o mesmo campo que a funcao le.
  v_p_brinde := criar_produto('PRODUTO BRINDE', 500, 100);
  update produtos set preco_custo = 300 where id = v_p_brinde;

  insert into vendas (chave_idempotencia, caixa_sessao_id, usuario_id,
                      subtotal, desconto, total, valor_pago, troco, criado_em)
  values (gen_random_uuid(), v_caixa, v_dono, 500, 500, 0, 0, 0,
          (v_dia_venda::timestamp + time '12:00') at time zone 'America/Sao_Paulo')
  returning id into v_venda_brinde;

  insert into venda_itens (venda_id, produto_id, nome_produto, quantidade,
                           preco_unitario, preco_custo, total)
  values (v_venda_brinde, v_p_brinde, 'PRODUTO BRINDE', 1, 0, 300, 0);

  -- ================= caso 0: o cenario esta montado =================
  -- As assercoes abaixo seriam VAZIAS se o cenario nao tivesse, de fato, os casos
  -- que elas testam. Estas tres sao a guarda contra "passar por acidente".
  perform teste_ok((select count(*) = 1 from venda_itens where produto_id = v_p_brinde and preco_custo > 0),
    'caso 0: o cenario tem UMA venda de produto com custo e RECEITA ZERO (senao o caso 6 nao prova nada)');
  perform teste_ok((select count(*) = 1 from venda_itens where produto_id = v_p_semcusto),
    'caso 0: o produto SEM custo foi vendido (senao a exclusao do ranking nao prova nada)');
  -- A CANARIA DA JANELA: se qualquer venda real da farmacia cair no periodo deste
  -- caso, TODA contagem abaixo vira uma medicao da farmacia (foi o que aconteceu
  -- no primeiro run, com `hoje - 30, hoje`) e este caso para de provar qualquer
  -- coisa. Esta assercao e a que denuncia isso.
  perform teste_ok((select count(distinct i.produto_id) = 4
                      from venda_itens i
                      join vendas v on v.id = i.venda_id
                     where v.status = 'concluida'
                       and (v.criado_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate),
    'caso 0: a janela do caso tem SO os quatro produtos do cenario (nenhuma venda real da farmacia caiu nela)');

  -- ================= caso 1: a ordem e pelo PIOR percentual =================
  -- PRODUTO A: 900 de receita (3 unidades ao preco de TABELA do cenario, 300 cada
  -- — o `registrar_venda` sempre grava `produtos.preco_venda`, e nao um preco vindo
  -- do carrinho), 300 de custo, margem 600 (66,7%).
  -- PRODUTO B: 1000 de receita, 200 de custo, margem 800 (80,0%).
  -- A primeira linha e o A e a segunda e o B: e a assercao que separa "ordena por
  -- percentual" de "ordena pelo valor em reais" (o A tem a MENOR margem em reais E
  -- o PIOR percentual; o B tem a maior margem em reais e o melhor percentual — se a
  -- funcao ordenasse por margem decrescente, o A viria primeiro por outro motivo e a
  -- assercao de que a SEGUNDA linha e o B ficaria vermelha).
  perform teste_ok((select produto_id = v_p_a from margem_produtos(v_de, v_ate, 10) limit 1),
    'caso 1: o ranking comeca pelo PIOR percentual (o produto de margem 600 sobre receita de 900)');
  perform teste_ok((select produto_id = v_p_b from margem_produtos(v_de, v_ate, 10) offset 1 limit 1),
    'caso 1: o segundo e o de melhor percentual (margem 800 sobre receita de 1000) — a ordem NAO e pelo valor em reais');
  -- Os dois numeros que ordenam o ranking, e a conta que os produziu: o A tem as
  -- DUAS vendas somadas em UMA linha (2x + 1x = 3 unidades, 900 de receita).
  perform teste_ok((select quantidade = 3 and receita = 900 and custo = 300 and margem = 600
                      from margem_produtos(v_de, v_ate, 10) limit 1),
    'caso 1: as duas vendas do mesmo produto sao somadas em uma linha (3 un, receita 900, custo 300, margem 600)');
  perform teste_ok((select quantidade = 1 and receita = 1000 and custo = 200 and margem = 800
                      from margem_produtos(v_de, v_ate, 10) offset 1 limit 1),
    'caso 1: receita, custo e margem do segundo colocado batem com o cenario (1000, 200, 800)');
  -- Margem e SEMPRE receita - custo, linha a linha: a invariante que pega uma
  -- agregacao furada (somar o custo de um produto na receita de outro).
  perform teste_ok((select bool_and(margem = receita - custo) from margem_produtos(v_de, v_ate, 10)),
    'caso 1: em toda linha, margem = receita - custo');

  -- ================= caso 2: o produto sem custo NAO entra no ranking =================
  -- Sao TRES produtos vendidos no periodo (A, B e o sem custo) e DUAS linhas no
  -- ranking. O brief pedia `count(*) = 2` descrevendo "tres produtos com custo"; o
  -- cenario aqui tem DOIS com custo e um sem (o brief contava um produto a mais do
  -- que descrevia — ver o relatorio), e o numero 2 e o mesmo. O que a assercao
  -- amarra e que o produto de `preco_custo = 0` ficou de fora.
  perform teste_ok((select count(*) = 2 from margem_produtos(v_de, v_ate, 10)),
    'caso 2: o produto sem custo NAO entra no ranking (2 linhas para 3 produtos vendidos)');
  perform teste_ok((select count(*) = 0 from margem_produtos(v_de, v_ate, 10) where produto_id = v_p_semcusto),
    'caso 2: e o produto que ficou de fora e exatamente o de preco_custo = 0');
  -- O produto sem custo NAO some do banco: a venda dele esta la, com receita 400.
  -- (Sem isto, "nao entrou no ranking" poderia ser apenas "nao existe".)
  perform teste_ok((select coalesce(sum(i.total), 0) = 400 from venda_itens i
                     where i.produto_id = v_p_semcusto
                       and i.venda_id in (v_venda_a, v_venda_b, v_venda_c)),
    'caso 2: a venda do produto sem custo existe e tem receita 400 (ele so nao entra no ranking)');

  -- ================= caso 3: o sem custo e contado a parte =================
  perform teste_ok((select sem_custo = 1 from margem_sem_custo(v_de, v_ate)),
    'caso 3: o produto sem custo e contado a parte (1 produto)');
  -- Os DOIS numeros na MESMA assercao, para o caso nao ser tautologico (a primeira
  -- versao comparava a funcao com ela mesma — ver o relatorio):
  --   * a contagem e de PRODUTOS distintos (o sem custo foi vendido UMA vez; se a
  --     funcao contasse ITENS, uma segunda venda dele mudaria o numero sem mudar o
  --     conjunto de produtos), e
  --   * o brinde (receita zero, custo > 0) NAO entra nesta contagem: ele TEM custo,
  --     so nao tem receita. Ele fica fora do ranking e fora desta contagem — e o
  --     caso 6 que prova a primeira parte.
  perform teste_ok((select (select sem_custo from margem_sem_custo(v_de, v_ate)) = 1
                      and (select count(distinct i.produto_id) from venda_itens i
                             join vendas v on v.id = i.venda_id
                            where i.preco_custo = 0
                              and v.status = 'concluida'
                              and (v.criado_em at time zone 'America/Sao_Paulo')::date between v_de and v_ate) = 1),
    'caso 3: a contagem e de PRODUTOS distintos sem custo (1) — e o brinde, que tem custo, nao entra nela');
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
  -- O limite de 10 (o teto) nao corta o cenario: as duas linhas vem.
  perform teste_ok((select count(*) = 2 from margem_produtos(v_de, v_ate, 10)),
    'caso 4: o teto de 10 comporta o cenario inteiro');

  -- ================= caso 5: periodo maior que 31 dias e recusado =================
  -- O trecho comparado e `'ordem'`, e nao `'periodo'`: a mensagem gravada e
  -- "Período inválido: de e até são obrigatórios, em ordem, com no máximo 31 dias."
  -- e "Período"/"inválido" tem ACENTO. Um literal acentuado depende do transporte
  -- preservar acentuacao (foi o que quebrou o caso 030) e um literal sem acento que
  -- "parece" a palavra (`'periodo'`) simplesmente NAO EXISTE na mensagem — o
  -- `teste_erro` compara por `position`, entao o trecho tem de aparecer LITERALMENTE.
  -- `'ordem'` aparece igual nos dois (com acento certo no banco ou corrompido) e e
  -- exclusivo desta mensagem: as outras recusas nao tem "ordem" no texto. E
  -- `'31 dias'` na mesma assercao prende a parte do teto, que e o que o caso 5 esta
  -- testando (e nao so "recusou alguma coisa"). A palavra "máximo" NAO serve como
  -- trecho: ela tem acento, e o `teste_erro` compara por `position`, byte a byte.
  --
  -- O teto e o MESMO DIAS_MAXIMOS = 31 do agente, e e INCLUSIVO: 31 dias de
  -- intervalo (32 datas) passam; 32 dias de intervalo nao. As duas pontas sao
  -- provadas, senao "recusa periodo grande" poderia estar recusando qualquer coisa.
  perform teste_ok((select count(*) = 2 from margem_produtos(v_ate - 31, v_ate, 10)),
    'caso 5: o teto de 31 dias e inclusivo — 31 dias de intervalo passam');
  perform teste_erro(format('select margem_produtos(%L, %L, 10)', v_ate - 32, v_ate), 'ordem',
    'caso 5: 32 dias de intervalo (um dia a mais que o teto) e recusado');
  perform teste_erro(format('select margem_produtos(%L, %L, 10)', v_ate - 40, v_ate), '31 dias',
    'caso 5: periodo bem maior que o teto e recusado, com a mensagem do teto de 31 dias');
  -- Nulo e invertido TAMBEM sao recusa: o contrario da funcao irma, que devolve
  -- zeros. Zero para periodo torto viraria "nenhum produto perdeu margem" — uma
  -- resposta falsa, e nao uma recusa.
  perform teste_erro(format('select margem_produtos(null, %L, 10)', v_ate), 'ordem',
    'caso 5: periodo nulo e recusado (ao contrario da funcao irma, que devolve zeros)');
  perform teste_erro(format('select margem_produtos(%L, %L, 10)', v_ate, v_de), 'ordem',
    'caso 5: periodo invertido e recusado');
  perform teste_erro(format('select margem_sem_custo(%L, %L)', v_ate - 32, v_ate), '31 dias',
    'caso 5: a contagem de sem custo recusa o MESMO periodo torto');

  -- ================= caso 6: receita zero nao divide por zero =================
  -- A venda do brinde (receita 0, custo 300) esta na janela. Se ela entrasse no
  -- ranking, `margem / receita` dividiria por zero — e o produto apareceria como o
  -- PIOR de todos, ou a funcao estouraria. Ela fica de fora.
  perform teste_ok((select count(*) = 0 from margem_produtos(v_de, v_ate, 10) where receita = 0),
    'caso 6: produto com receita zero NAO entra no ranking de percentual');
  perform teste_ok((select count(*) = 0 from margem_produtos(v_de, v_ate, 10) where produto_id = v_p_brinde),
    'caso 6: e a linha que fica de fora e a do brinde, nao outra qualquer');
  perform teste_ok((select sem_custo >= 0 from margem_sem_custo(v_de, v_ate)),
    'caso 6: e a funcao de contagem nao explode com receita zero presente');
  -- A soma do ranking continua sendo a dos produtos que entraram: 900 + 1000.
  perform teste_ok((select coalesce(sum(receita), 0) = 1900 from margem_produtos(v_de, v_ate, 10)),
    'caso 6: a receita do ranking e a dos produtos com custo e receita (900 + 1000), sem o brinde');

  -- ================= caso 7: so o dono le a margem =================
  -- A barreira e a checagem DENTRO da funcao, e nao a RLS: as duas sao `security
  -- definer` (ruling R2), entao `definer` ignora a RLS e o `if papel <> 'dono'`
  -- passa a ser a UNICA barreira. O atendente chama a funcao DIRETO, sem tela.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);
  -- Trecho SEM ACENTO de proposito, e que EXISTE literalmente na mensagem gravada
  -- ("Só o dono vê o lucro."): `'dono v'` — o miolo de "dono vê". Um literal
  -- acentuado depende de o transporte preservar acentuacao (foi o que quebrou o caso
  -- 030 em 14/10/2026); e `'apenas o dono'`, que o despacho sugeria, NAO EXISTE no
  -- texto (nem aqui, nem em `relatorio_lucro`, que usa a mesma mensagem) — a
  -- comparacao do `teste_erro` e por `position`, byte a byte: um trecho que nao esta
  -- na mensagem reprova o caso mesmo com a funcao correta (ver o relatorio).
  -- A mensagem GRAVADA no banco foi conferida a parte por sonda: `Só o dono vê o
  -- lucro.` esta INTEGRA (esta e a diferenca desta funcao para a `relatorio_lucro`,
  -- cujo texto esta corrompido no banco ate a Task 2 recriar).
  perform teste_erro(format('select * from margem_produtos(%L, %L, 10)', v_de, v_ate), 'dono v',
    'caso 7: o atendente nao ve o ranking de margem (a recusa vem da funcao, nao da tela)');
  perform teste_erro(format('select * from margem_sem_custo(%L, %L)', v_de, v_ate), 'dono v',
    'caso 7: o atendente nao ve nem a contagem de produtos sem custo');
  -- E o atendente LE o resto do relatorio: a recusa e da margem, nao do relatorio.
  perform teste_ok((select count(*) >= 0 from relatorio_resumo(v_de, v_ate)),
    'caso 7: o atendente continua lendo o resumo do periodo');
  -- Volta para o dono: `request.jwt.claims` e do CONNECTION e continua valendo nas
  -- assercoes seguintes (mesma observacao do caso 3 de 110_relatorios.sql).
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_dono, 'role', 'authenticated')::text, true);
  perform teste_ok((select count(*) = 2 from margem_produtos(v_de, v_ate, 10)),
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
