# Redesenho visual do PDV — desenho aprovado

Data: 13/10/2026
Status: desenho aprovado em conversa pelo Lucas (seções 1 a 4). **A spec ainda precisa da revisão
escrita dele antes de virar plano.**

## Objetivo

Deixar o sistema agradável de olhar e utilizável em telas menores, **sem alterar comportamento nem
regra de negócio**. É um trabalho de linguagem visual: hoje não existem tokens de design, a fonte
baixada não é usada e o casco não tem um único breakpoint.

## Público e uso (decidido pelo Lucas)

- **Desktop no balcão** é o uso principal: monitor fixo, operação por teclado.
- **Celular é para consulta**, não para operar o PDV. Responsivo aqui significa "não quebrar e dar
  para consultar", não "vender no celular".

## Direção (decidida pelo Lucas)

**Clínico e calmo, com uma cor de marca discreta.** A cor sinaliza, não decora.

## Escopo desta leva (decidido pelo Lucas)

1. **Tokens de design** e o conserto da fonte.
2. **O casco**: menu lateral no desktop, barra de topo com gaveta no celular, login e a tela de
   "sem perfil".

**Fora desta leva, por decisão:** as telas de consulta entram numa segunda leva e o **PDV por último**
— ele é operado por teclado e 15 dos 38 testes de E2E dependem dele.

**Declarado como escopo de v2** (vem do `DESIGN-PDV-FARMACIA.md` do Lucas, que é norte de princípios,
não lista de tarefas): controle de **lote e validade** (FEFO), **selos fiscais** de nota, **cartão de
margem** no painel e a lista "o que fazer hoje". Nada disso tem modelo no banco hoje — a
`001_base.sql:158` registra que `estoque_movimentos` foi desenhada para permitir lote/validade numa v2.

## Caminho técnico (decidido pelo Lucas)

**Caminho A — tokens no `@theme` do Tailwind 4, aplicados como classes utilitárias.** Sem biblioteca de
componentes nesta leva. Duas exceções, ambas justificadas:

- **`SeloEstado`** — o princípio 4 do documento do Lucas exige estado com cor + ícone + texto, e isso
  não se expressa só com utilitário.
- **A gaveta do menu no celular** — precisa de estado de abertura e foco; é o único `'use client'` novo.

O Caminho B (primitivos `BotaoPrincipal`, `MensagemErro`, `ConfirmarAcao`) fica para a leva das telas,
quando houver a segunda ocorrência real de cada um.

## Tokens — vocabulário do shadcn, contrastes medidos

Os nomes são o conjunto semântico do shadcn, o mesmo do projeto **members club** do Lucas, para os dois
projetos falarem a mesma língua. Os valores são deste sistema, e **cada contraste foi medido** com o
cálculo de luminância relativa da WCAG:

| Token | Valor | Contraste | Papel |
|---|---|---|---|
| `--primary` | `#15803D` | **5,02:1** | marca: item ativo, botão primário, foco |
| `--primary-foreground` | `#FFFFFF` | 5,02:1 | texto sobre a marca |
| `--background` | `#F8FAFC` | — | fundo da página |
| `--foreground` | `#0F172A` | **17,85:1** | texto principal |
| `--card` | `#FFFFFF` | — | cartões |
| `--muted` | `#F1F5F9` | — | faixa e cabeçalho de tabela |
| `--muted-foreground` | `#475569` | **7,58:1** | texto secundário |
| `--border` | `#E2E8F0` | 1,23:1 | **decorativo**: divisor, régua |
| `--input` | `#7C8CA0` | **3,43:1** | **borda de campo** (WCAG 1.4.11 exige 3:1) |
| `--ring` | `#15803D` | **4,79:1** | anel de foco |
| `--destructive` | `#DC2626` | **4,83:1** | erro |
| `--success` | `#15803D` | **5,02:1** | concluído — extensão: o shadcn não define |
| `--warning` | `#B45309` | **5,02:1** | pendente — extensão |
| `--info` | `#0369A1` | **5,93:1** | desconhecido — extensão |
| `--radius` | `0.5rem` | — | base, com escala derivada por `calc()` |

**Por que `--success` tem o mesmo valor do `--primary`:** é deliberado. "Marca" e "concluído" sendo o
mesmo verde reforça a leitura em vez de competir — o olho aprende um verde só, e ele significa "deu
certo". O que **não** pode acontecer é verde em superfície, e por isso não há.

**Por que `--border` e `--input` são tokens diferentes:** são coisas diferentes. `--border` é decorativo
e não carrega informação; `--input` **é** a informação que identifica o campo, e por isso precisa dos
3:1. O `#94A3B8` (slate-400), que é o valor que praticamente todo sistema usa para borda de campo, mede
**2,56:1 e reprova**. Esta é a mesma separação que o `members club` já faz entre `--landing-accent` e
`--landing-accent-text`, com o motivo escrito em comentário no CSS.

**Sem tinta verde nas superfícies.** O documento do Lucas sugere fundo `#F0FDF4` e borda `#BBF7D0`; foi
recusado porque verde precisa significar "estoque ok" — se o fundo já é verde, o sinal morre.

**Sem gradiente.** O próprio banco de design lista "AI purple/pink gradients" como anti-padrão, e num
PDV não tem lugar.

## Tipografia

**Conserto:** o `app/layout.tsx` baixa a Geist e a passa como variável, o `globals.css` mapeia
`--font-sans: var(--font-geist-sans)` — e a regra do `body` fixa `font-family: Arial, Helvetica,
sans-serif`, que vence. **A fonte é baixada em toda visita e nunca usada.** O `body` passa a usar a
variável do tema. Não há requisição nova nem custo: só deixa de ser desperdício.

**Escala de sete degraus**, nenhum abaixo de 12 px:

| Degrau | Tamanho | Onde |
|---|---|---|
| `text-xs` | 12 px | rodapé de tabela, legenda |
| `text-sm` | 14 px | texto secundário, linha densa |
| `text-base` | 16 px | corpo e **todo campo de formulário** |
| `text-lg` | 18 px | título de cartão |
| `text-xl` | 20 px | título de seção |
| `text-2xl` | 24 px | título de página |
| `text-4xl` | 36 px | número grande (total do PDV) |

Os 16 px em campo não são estética: abaixo disso o iOS dá zoom sozinho no foco.

**Números tabulares** (`font-variant-numeric: tabular-nums`) em tabela, dinheiro e quantidade. Sem
isso, dígitos de larguras diferentes deixam a coluna serrilhada e a conferência de relance exige ler
linha por linha.

**Peso:** 400 no corpo, 500 em rótulo e item de menu, 600 em título. Sem 700 espalhado.

## Espaço, raio e sombra

- **Espaço, base 4:** `4 · 8 · 12 · 16 · 24 · 32 · 48`. Os valores de hoje já caem nessa grade; o que
  muda é passarem a ser escolha.
- **Alvo de 44 px é obrigatório** em todo elemento interativo. Isso **fecha a porta da opção "densa"**:
  item de menu com `py-2` e texto de 16 px dá cerca de 40 px e reprova.
- **Raio:** `--radius: 0.5rem` com a escala derivada por `calc()`, como no `members club`. Hoje
  convivem `rounded-lg` (8) e `rounded-2xl` (16) sem critério declarado. **Exceção:** o `SeloEstado` é
  pílula (`border-radius: 999px`), porque um selo com canto de cartão lê como cartão.
- **Sombra, dois níveis e nada além:** `0 1px 2px` para cartão, `0 8px 24px` para o que flutua sobre a
  tela (a gaveta do celular). O estilo escolhido — Minimalismo / Swiss — pede "sharp shadows if any".

## O casco

**Hoje:** `aside` fixo de 224 px, `main` com `p-8`, **zero breakpoint**. Num celular de 390 px o menu
come 224 e sobram 166.

**O título de página continua no conteúdo, não no casco.** As 32 ocorrências de
`<h1 className="text-2xl font-semibold text-slate-800">` mostram que cada tela já anuncia a si mesma;
o casco não acrescenta cabeçalho de título. As 32 strings idênticas viram um padrão documentado, e a
inconsistência entre `text-lg` e `text-xl` nos `<h2>` é normalizada.

- **Desktop (≥1024 px):** menu lateral de 240 px com os tokens. O item ativo ganha **três sinais** —
  cor de marca, barra de 3 px à esquerda e peso médio —, porque "estou em Produtos" não pode depender
  de enxergar verde (princípio 4 aplicado à navegação). `main` com `p-8`.
- **Abaixo de 1024 px:** o menu vira **barra de topo** com a marca e um botão de 44×44 que abre uma
  **gaveta** com as mesmas 9 entradas. Foco: ao abrir, entra na gaveta; `Esc` fecha; o foco volta para
  o botão; `aria-expanded` e `aria-controls` no botão. `main` com `p-4`.
- **Login e "sem perfil":** mesmos tokens. O botão "Sair" passa a respeitar os 44 px (hoje ~40).

## Princípios adotados do `DESIGN-PDV-FARMACIA.md`

Adotados como **critério de revisão**: 1 (uma ação principal), 2 (teclado primeiro, atalhos visíveis),
3 (pouco por tela), 4 (**estado com cor + ícone + texto**), 5 (**todo erro diz o que fazer**), 6
(confirmar o irreversível), 7 (números grandes) e 8 (contraste AA, foco visível, alvo de 44 px, zoom de
150%).

**Princípio 9 fica parcial:** "claro por padrão, escuro opcional" → **só claro**, porque o projeto já
decidiu isso por um bug real de contraste em que o texto digitado sumia no login.

## O que não pode quebrar (a rede de segurança)

A mudança é de classe e de CSS, mas o casco é compartilhado por todas as telas:

- **427 testes de unidade** e **38 de E2E** passam hoje. Eles são a rede.
- Os **`data-testid` não mudam** — a spec de E2E depende deles.
- **A gaveta não pode autofocar nada ao carregar.** O E2E exige que, depois de escolher o cliente no
  PDV, o foco vá para `Buscar produto`; uma gaveta que rouba foco quebra esse teste.
- O anti-padrão do tema: `color-scheme: light` no `:root` **permanece** — é ele que impede o navegador
  de pintar campo de formulário em escuro.

## Verificação

- `npm test` (427), `npm run lint`, `npx tsc --noEmit`, `npm run build`.
- `npm run test:e2e` (38) com o servidor **quente** — a primeira rodada com cache frio dá falso
  vermelho por estouro de timeout, como já aconteceu em 13/10/2026.
- Medição de contraste dos tokens pelo cálculo da WCAG (feita, é a tabela acima).
- Conferência de alvo de 44 px nos elementos interativos do casco.
- **Lacuna declarada:** não há teste de unidade para CSS nem jsdom no projeto. O comportamento visual
  fica coberto pelo E2E e pela conferência por olho humano — que é justamente a lacuna que deixou
  passar o bug de contraste da Etapa 1.
