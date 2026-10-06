# PLANO: Sistema de Gestão para Farmácia (substituto do Nex)

> **Como usar este arquivo:** coloque na raiz do projeto no Antigravity e diga ao DeepSeek:
> "Leia o arquivo PLANO-SISTEMA-FARMACIA.md. Execute SOMENTE a ETAPA X. Ao terminar, pare e me diga o que fez."
> Nunca peça várias etapas de uma vez. Uma etapa por vez, testando antes de seguir.

---

## 0. REGRAS PARA A IA (leia antes de qualquer etapa)

1. Execute **uma etapa por vez**. Ao terminar, pare e liste: arquivos criados, como testar, o que falta.
2. Não invente funcionalidades fora da etapa pedida.
3. Código simples e legível. Nada de abstrações desnecessárias. Comentários curtos em português.
4. Textos da interface em **português do Brasil**. Valores em **R$** (formato `1.234,56`), datas `dd/mm/aaaa`.
5. Dinheiro sempre em **centavos (inteiro)** no banco. Converta só na tela. Nunca use float para dinheiro.
6. Nunca coloque chaves secretas no código. Use `.env.local` e deixe `.env.example` documentado.
7. Toda tabela com **RLS ativado** no Supabase. Nunca desative RLS para "fazer funcionar".
8. Se uma decisão técnica puder travar o projeto mais adiante, **avise antes de seguir**.
9. Interface **simples, limpa, pouca informação por tela** (o usuário tem TDAH): poucos botões, cores calmas, fontes grandes, sem tabelas lotadas. Nada de painéis cheios.
10. Se algo der erro, mostre o erro completo, explique a causa em 1-2 frases e corrija. Não reescreva o projeto inteiro.

---

## 1. VISÃO GERAL

**Objetivo:** substituir o Nex (PDV) na farmácia do Lucas.

**Módulos da v1:**
- Vendas (PDV + histórico)
- Produtos e estoque
- Clientes e crediário
- Relatórios
- Agente de IA para consultar/controlar vendas e estoque

**Fora da v1 (não implementar):**
- Nota fiscal (NFC-e/NF-e)
- SNGPC / medicamentos controlados
- Catálogo online
- Multi-loja

> ATENÇÃO: sem nota fiscal e SNGPC, o sistema só substitui o Nex se a farmácia não depender deles. Usar os dois sistemas em paralelo por 1-2 semanas antes de abandonar o Nex.

---

## 2. STACK

| Camada | Tecnologia |
|---|---|
| Front + back | Next.js (App Router) + TypeScript |
| Estilo | Tailwind CSS + shadcn/ui |
| Banco + login | Supabase (Postgres + Auth) |
| Hospedagem | Vercel |
| Agente de IA | API do DeepSeek (compatível com OpenAI) |
| Gerenciador | npm |

**Projeto Supabase:** criar um projeto **novo** só para a farmácia (região `sa-east-1`, São Paulo). Não misturar com outros projetos.

---

## 3. ESTRUTURA DE PASTAS

```
/app
  /(auth)/login
  /(app)/layout.tsx          menu lateral
  /(app)/vendas              histórico
  /(app)/vendas/nova         PDV
  /(app)/produtos
  /(app)/estoque
  /(app)/clientes
  /(app)/crediario
  /(app)/relatorios
  /(app)/agente
  /api/agente/route.ts
/lib
  /supabase                  client.ts, server.ts
  /format.ts                 moeda e datas
/components
/supabase/migrations         arquivos .sql
```

---

## 4. ETAPAS

### ETAPA 1: Projeto base e login

**Fazer:**
1. Criar projeto Next.js com TypeScript, Tailwind e App Router.
2. Instalar `@supabase/supabase-js`, `@supabase/ssr`, shadcn/ui.
3. Criar `.env.example` com `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `DEEPSEEK_API_KEY`.
4. Criar clients Supabase (browser e server) em `/lib/supabase`.
5. Tela de login (email + senha) com Supabase Auth.
6. Middleware que redireciona quem não está logado para `/login`.
7. Layout com menu lateral: Vendas, Produtos, Estoque, Clientes, Crediário, Relatórios, Agente.
8. Criar `/lib/format.ts` com `formatarMoeda(centavos)` e `formatarData(iso)`.

**Pronto quando:** consigo logar, ver o menu, e sem login sou mandado para `/login`.

---

### ETAPA 2: Banco de dados

Criar migration em `/supabase/migrations/001_base.sql` com o SQL abaixo e aplicar no Supabase.

```sql
-- PRODUTOS
create table produtos (
  id uuid primary key default gen_random_uuid(),
  codigo_barras text unique,
  nome text not null,
  categoria text,
  preco_custo integer not null default 0,   -- centavos
  preco_venda integer not null default 0,   -- centavos
  estoque_atual integer not null default 0,
  estoque_minimo integer not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);
create index on produtos using gin (to_tsvector('portuguese', nome));
create index on produtos (nome);

-- CLIENTES
create table clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text,
  cpf text,
  limite_credito integer not null default 0,  -- centavos
  bloqueado boolean not null default false,
  criado_em timestamptz not null default now()
);

-- VENDAS
create table vendas (
  id uuid primary key default gen_random_uuid(),
  numero bigint generated always as identity,
  cliente_id uuid references clientes(id),
  subtotal integer not null,
  desconto integer not null default 0,
  total integer not null,
  forma_pagamento text not null check (forma_pagamento in ('dinheiro','pix','debito','credito','crediario')),
  valor_pago integer not null default 0,
  troco integer not null default 0,
  status text not null default 'concluida' check (status in ('concluida','cancelada')),
  criado_em timestamptz not null default now()
);
create index on vendas (criado_em desc);

-- ITENS DA VENDA
create table venda_itens (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references vendas(id) on delete cascade,
  produto_id uuid not null references produtos(id),
  nome_produto text not null,          -- guarda o nome na hora da venda
  quantidade integer not null check (quantidade > 0),
  preco_unitario integer not null,
  preco_custo integer not null default 0,
  total integer not null
);

-- MOVIMENTAÇÃO DE ESTOQUE (histórico de tudo que entra e sai)
create table estoque_movimentos (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references produtos(id),
  tipo text not null check (tipo in ('entrada','venda','ajuste','cancelamento')),
  quantidade integer not null,         -- positivo entra, negativo sai
  motivo text,
  venda_id uuid references vendas(id),
  criado_em timestamptz not null default now()
);

-- CREDIÁRIO (lançamentos de dívida e pagamentos)
create table crediario_lancamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references clientes(id),
  venda_id uuid references vendas(id),
  tipo text not null check (tipo in ('compra','pagamento')),
  valor integer not null,              -- sempre positivo; o tipo define o sinal
  observacao text,
  criado_em timestamptz not null default now()
);

-- RLS
alter table produtos enable row level security;
alter table clientes enable row level security;
alter table vendas enable row level security;
alter table venda_itens enable row level security;
alter table estoque_movimentos enable row level security;
alter table crediario_lancamentos enable row level security;

-- Política simples (v1: loja única, todo usuário logado acessa tudo)
do $$
declare t text;
begin
  foreach t in array array['produtos','clientes','vendas','venda_itens','estoque_movimentos','crediario_lancamentos']
  loop
    execute format('create policy "logado_tudo" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
```

**Função crítica: registrar venda de forma atômica** (tudo ou nada: venda + itens + baixa de estoque + crediário). Criar em `/supabase/migrations/002_registrar_venda.sql`:

```sql
create or replace function registrar_venda(
  p_cliente_id uuid,
  p_desconto integer,
  p_forma_pagamento text,
  p_valor_pago integer,
  p_itens jsonb   -- [{"produto_id":"...","quantidade":2}]
) returns uuid
language plpgsql
as $$
declare
  v_venda_id uuid;
  v_subtotal integer := 0;
  v_total integer;
  v_item jsonb;
  v_prod produtos%rowtype;
  v_qtd integer;
  v_limite integer;
  v_divida integer;
begin
  -- calcula subtotal usando SEMPRE o preço do banco (nunca confiar no front)
  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_prod from produtos where id = (v_item->>'produto_id')::uuid for update;
    if not found then raise exception 'Produto não encontrado'; end if;
    v_qtd := (v_item->>'quantidade')::integer;
    if v_prod.estoque_atual < v_qtd then
      raise exception 'Estoque insuficiente para %', v_prod.nome;
    end if;
    v_subtotal := v_subtotal + v_prod.preco_venda * v_qtd;
  end loop;

  v_total := v_subtotal - coalesce(p_desconto,0);
  if v_total < 0 then raise exception 'Desconto maior que o subtotal'; end if;

  -- regra do crediário
  if p_forma_pagamento = 'crediario' then
    if p_cliente_id is null then raise exception 'Crediário exige cliente'; end if;
    select limite_credito into v_limite from clientes where id = p_cliente_id and bloqueado = false;
    if not found then raise exception 'Cliente bloqueado ou inexistente'; end if;
    select coalesce(sum(case when tipo='compra' then valor else -valor end),0)
      into v_divida from crediario_lancamentos where cliente_id = p_cliente_id;
    if v_divida + v_total > v_limite then raise exception 'Limite de crédito excedido'; end if;
  end if;

  insert into vendas (cliente_id, subtotal, desconto, total, forma_pagamento, valor_pago, troco)
  values (p_cliente_id, v_subtotal, coalesce(p_desconto,0), v_total, p_forma_pagamento,
          p_valor_pago, greatest(p_valor_pago - v_total, 0))
  returning id into v_venda_id;

  for v_item in select * from jsonb_array_elements(p_itens) loop
    select * into v_prod from produtos where id = (v_item->>'produto_id')::uuid;
    v_qtd := (v_item->>'quantidade')::integer;
    insert into venda_itens (venda_id, produto_id, nome_produto, quantidade, preco_unitario, preco_custo, total)
    values (v_venda_id, v_prod.id, v_prod.nome, v_qtd, v_prod.preco_venda, v_prod.preco_custo, v_prod.preco_venda * v_qtd);
    update produtos set estoque_atual = estoque_atual - v_qtd where id = v_prod.id;
    insert into estoque_movimentos (produto_id, tipo, quantidade, venda_id)
    values (v_prod.id, 'venda', -v_qtd, v_venda_id);
  end loop;

  if p_forma_pagamento = 'crediario' then
    insert into crediario_lancamentos (cliente_id, venda_id, tipo, valor)
    values (p_cliente_id, v_venda_id, 'compra', v_total);
  end if;

  return v_venda_id;
end $$;
```

E a função `cancelar_venda(p_venda_id uuid)`: marca como cancelada, devolve estoque (movimento `cancelamento`) e estorna o lançamento do crediário se houver.

**Pronto quando:** tabelas existem, RLS ativo, e um teste manual de `registrar_venda` baixa o estoque.

---

### ETAPA 3: Produtos e estoque

**Fazer:**
1. Página `/produtos`: lista simples com busca por nome ou código de barras. Mostrar só: nome, preço, estoque. Botão "Novo produto".
2. Formulário de produto (nome, código de barras, categoria, custo, preço de venda, estoque mínimo). Inputs de preço em reais, salvos em centavos.
3. Página `/estoque`: foco em 2 listas simples: **"Acabando"** (estoque <= mínimo) e **"Zerados"**.
4. Botão "Dar entrada" (compra de reposição): soma ao estoque e grava em `estoque_movimentos` como `entrada`.
5. Botão "Ajuste" (contagem física): define novo valor, grava movimento `ajuste` com motivo.
6. **Importação por CSV** (essencial para migrar do Nex): tela que recebe um CSV com colunas `nome, codigo_barras, preco_custo, preco_venda, estoque`, mostra prévia das 5 primeiras linhas e importa. Se o código de barras já existir, atualiza.

**Pronto quando:** importo uma planilha de produtos, busco um produto e dou entrada de estoque.

---

### ETAPA 4: PDV (Nova Venda)

Tela mais importante. Tem que ser **rápida** e usável só com teclado.

**Fazer:**
1. Rota `/vendas/nova`. Atalho **F3** em qualquer tela do app abre essa rota.
2. Campo de busca sempre focado. Digitar nome ou ler código de barras e apertar Enter adiciona o produto. Se a busca retornar vários, mostra lista curta para escolher com setas.
3. Lista de itens da venda (nome, quantidade, subtotal), com botões + / − e remover.
4. Total grande e em destaque.
5. Campo de desconto (R$).
6. Pagamento: dinheiro, pix, débito, crédito, crediário. Em dinheiro, campo "valor recebido" calcula o **troco** na hora.
7. Se for crediário: escolher cliente (busca por nome) e mostrar limite disponível. Bloquear se exceder.
8. Botão **Finalizar** chama a função `registrar_venda` via RPC. Em caso de erro (ex.: estoque insuficiente), mostrar mensagem clara em português.
9. Após finalizar: mensagem de sucesso, limpa a tela e volta o foco na busca.

**Regras:**
- Preços e totais finais são calculados **no banco** pela função. O front só exibe prévia.
- Nunca permitir finalizar com carrinho vazio.

**Pronto quando:** faço uma venda completa só com teclado e o estoque diminui.

---

### ETAPA 5: Histórico de vendas

**Fazer:**
1. Página `/vendas` com lista das vendas, mais recentes primeiro. Por linha: número, hora, resumo dos itens (ex.: "1x DIPIRONA, 2x TALCO"), forma de pagamento, total.
2. Filtro de período: **Hoje**, **7 dias**, **30 dias**, **Escolher datas**.
3. Busca por produto ou cliente.
4. Total do período no topo, com opção de **ocultar valores** (como no Nex).
5. Clicar em uma venda abre o detalhe com todos os itens e botão **Cancelar venda** (com confirmação; chama `cancelar_venda`).
6. Paginação (20 por vez).

**Pronto quando:** vejo as vendas do dia, abro uma e cancelo, e o estoque volta.

---

### ETAPA 6: Clientes e crediário

**Fazer:**
1. `/clientes`: lista com busca, cadastro (nome, telefone, CPF opcional, limite de crédito) e opção de bloquear.
2. Tela do cliente: **quanto deve hoje**, limite disponível, e histórico de compras e pagamentos.
3. Botão **Receber pagamento**: registra `pagamento` em `crediario_lancamentos` (valor parcial permitido).
4. `/crediario`: lista simples **só de quem deve**, ordenada por maior dívida. Cada linha: nome e valor.
5. Botão **Cobrar no WhatsApp**: abre `https://wa.me/55DDDNUMERO?text=...` com mensagem pronta e educada ("Olá, [nome]! Passando para lembrar do saldo de R$ X na farmácia. Qualquer dúvida estou à disposição."). Não enviar nada automaticamente, só abrir o link.
6. Saldo do cliente = soma de `compra` menos soma de `pagamento`.

**Pronto quando:** vendo no crediário, vejo a dívida, recebo pagamento parcial e o saldo atualiza.

---

### ETAPA 7: Relatórios

Poucos números, grandes e claros. Sem gráficos pesados.

**Fazer em `/relatorios`:**
1. **Resumo do dia:** total vendido, número de vendas, ticket médio.
2. **Por forma de pagamento** (hoje/semana/mês): lista curta.
3. **Mais vendidos** (top 10 do período).
4. **Lucro estimado** do período = soma de `(preco_unitario - preco_custo) * quantidade`.
5. **Estoque parado:** produtos com estoque e sem venda há 60 dias.
6. Seletor de período no topo (Hoje / 7 dias / 30 dias).
7. Botão **Exportar CSV** do período.

Usar views ou funções SQL para as somas. Não somar milhares de linhas no front.

**Pronto quando:** os números batem com o que vendi no PDV.

---

### ETAPA 8: Agente de IA (vendas e estoque)

Agente por chat que **responde perguntas** e **sugere** ações. Usa a API do DeepSeek com chamada de ferramentas (function calling).

**Fazer:**
1. Página `/agente` com chat simples (caixa de texto, histórico da conversa).
2. Rota `/app/api/agente/route.ts` (servidor). A chave `DEEPSEEK_API_KEY` **nunca** vai para o navegador.
3. Chamar `https://api.deepseek.com/chat/completions` (formato OpenAI) com `model: "deepseek-chat"` e a lista de `tools`.
4. Verificar se o usuário está logado antes de responder.

**Ferramentas do agente (v1 = SOMENTE LEITURA):**

| Ferramenta | O que faz |
|---|---|
| `vendas_do_periodo(inicio, fim)` | total, quantidade e forma de pagamento |
| `produtos_mais_vendidos(inicio, fim, limite)` | ranking |
| `estoque_baixo()` | produtos com estoque <= mínimo |
| `buscar_produto(texto)` | nome, preço e estoque |
| `clientes_devendo()` | lista de devedores e valores |
| `sugerir_pedido_reposicao()` | itens abaixo do mínimo com quantidade sugerida (com base nas vendas dos últimos 30 dias) |

**Regras de segurança:**
- O agente **não altera dados** na v1. Só consulta. Sugestão de pedido é texto/lista, não compra nada.
- Cada ferramenta usa consultas fixas e parametrizadas. **Nunca** deixar a IA escrever SQL livre.
- Limitar o tamanho das respostas das ferramentas (máx. 50 linhas).
- System prompt: "Você é o assistente da farmácia. Responda em português, curto e direto. Use só os dados das ferramentas. Se não tiver o dado, diga que não sabe. Valores em R$."
- Se a pergunta for sobre dose, interação ou orientação clínica de medicamento, o agente responde que não é função dele e orienta consultar o farmacêutico responsável.

**Exemplos para testar:** "quanto vendi hoje?", "o que está acabando?", "quem está devendo mais?", "monte o pedido de reposição".

**Pronto quando:** as 4 perguntas acima retornam respostas corretas.

---

### ETAPA 9: Publicar na Vercel

**Fazer:**
1. Subir o código no GitHub (sem `.env.local`).
2. Importar o repositório na Vercel.
3. Configurar as variáveis de ambiente (as 3 do `.env.example`) na Vercel.
4. No Supabase, em Authentication → URL Configuration, adicionar a URL da Vercel.
5. Criar o usuário da farmácia no Supabase (Authentication → Users). **Desativar cadastro público** (sign-ups) para ninguém entrar sozinho.
6. Testar login e uma venda em produção.
7. Ativar **backup** do banco (Supabase) e anotar como restaurar.

**Pronto quando:** abro o link no celular e no computador do balcão, logo, e faço uma venda.

---

### ETAPA 10: Migração e uso paralelo

1. Exportar produtos e clientes do Nex (Produtos → exportar/relatório em planilha) e importar pelo CSV da Etapa 3.
2. Fazer **contagem física** do estoque e ajustar.
3. Por 1-2 semanas: lançar cada venda nos dois sistemas e comparar o total do dia.
4. Só abandonar o Nex quando os totais baterem por vários dias seguidos.

---

## 5. CHECKLIST FINAL

- [ ] Login funciona e cadastro público está desativado
- [ ] RLS ativo em todas as tabelas
- [ ] Venda baixa estoque e cancelamento devolve
- [ ] Crediário respeita limite e bloqueio
- [ ] Troco calcula certo
- [ ] Relatórios batem com o PDV
- [ ] Agente só consulta e não escreve SQL livre
- [ ] Nenhuma chave secreta no GitHub
- [ ] Backup do banco ativo

## 6. PRÓXIMAS VERSÕES (depois da v1)

- Nota fiscal (NFC-e) via serviço fiscal terceirizado
- SNGPC / controlados
- Agente com ações (criar pedido de compra com aprovação humana)
- Leitor de código de barras e impressora de cupom não fiscal
- Catálogo online
- Importar notas de compra (XML) para dar entrada no estoque

---

*Observação: o DeepSeek costuma errar mais em tarefas grandes. Por isso, uma etapa por vez, teste sempre, e se ele se perder, volte e cole só a seção da etapa atual junto com a seção 0 (regras).*
