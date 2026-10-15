import { describe, expect, it } from 'vitest'
import { ASSUNTOS, validarAssunto } from './logica'
import { LIMITE_PAYLOAD_BYTES } from './logica'
import { PROMPT_ASSUNTO, promptAssunto } from '@/lib/agente/deepseek'

// ============================================================
// COORDENADOR do agente em grafo.
//
// A regra do desenho (spec `2026-10-15-agente-grafo-design.md`): o coordenador
// SO ROTEIA. Ele escolhe um dos cinco especialistas e o texto final continua
// sendo montado em CODIGO pelo especialista. Nada aqui deixa o modelo escrever
// numero — estas funcoes so leem uma etiqueta.
// ============================================================

describe('validarAssunto — a etiqueta do coordenador', () => {
  it('aceita os cinco especialistas', () => {
    for (const assunto of ['estoque', 'financeiro', 'clientes', 'caixa', 'compras'] as const) {
      expect(validarAssunto({ assunto })).toBe(assunto)
    }
  })

  it('aceita fora_escopo — e ela e uma etiqueta legitima, nao um erro', () => {
    expect(validarAssunto({ assunto: 'fora_escopo' })).toBe('fora_escopo')
  })

  it('a lista de assuntos e fechada e tem exatamente seis', () => {
    expect(ASSUNTOS).toHaveLength(6)
    expect([...ASSUNTOS].sort()).toEqual(
      ['caixa', 'clientes', 'compras', 'estoque', 'financeiro', 'fora_escopo'].sort(),
    )
  })

  it('recusa assunto que nao existe', () => {
    expect(validarAssunto({ assunto: 'vendas' })).toBeNull()
    expect(validarAssunto({ assunto: 'estoque_baixo' })).toBeNull()
    expect(validarAssunto({ assunto: '' })).toBeNull()
  })

  it('recusa o formato do ESPECIALISTA — o coordenador nao aceita intencao', () => {
    // Um modelo que devolvesse o formato errado passaria adiante uma consulta que
    // o coordenador nao escolheu. A recusa e o que impede o grafo de pular um no.
    expect(validarAssunto({ intencao: 'margem_produto' })).toBeNull()
    expect(validarAssunto({ assunto: 'estoque', intencao: 'estoque_baixo' })).toBeNull()
  })

  it('recusa chave a mais — o contrato e exatamente {"assunto": "..."}', () => {
    expect(validarAssunto({ assunto: 'estoque', de: null })).toBeNull()
    expect(validarAssunto({ assunto: 'caixa', extra: 1 })).toBeNull()
  })

  it('recusa o que nao e objeto com a chave certa', () => {
    expect(validarAssunto(null)).toBeNull()
    expect(validarAssunto(undefined)).toBeNull()
    expect(validarAssunto('estoque')).toBeNull()
    expect(validarAssunto(42)).toBeNull()
    expect(validarAssunto([])).toBeNull()
    expect(validarAssunto(['estoque'])).toBeNull()
    expect(validarAssunto({})).toBeNull()
    expect(validarAssunto({ assunto: 1 })).toBeNull()
    expect(validarAssunto({ assunto: null })).toBeNull()
  })

  it('e imune a poluicao de prototipo — herdado nao conta como chave aceita', () => {
    const sujo = Object.create({ assunto: 'estoque' }) as unknown
    expect(validarAssunto(sujo)).toBeNull()
  })
})

describe('PROMPT_ASSUNTO — o prompt FIXO do coordenador', () => {
  it('a palavra json aparece — sem ela o modo JSON nao ativa', () => {
    expect(PROMPT_ASSUNTO.toLowerCase()).toContain('json')
  })

  it('traz um exemplo LITERAL do formato, como manda a doc do JSON Output', () => {
    expect(PROMPT_ASSUNTO).toContain('{"assunto"')
  })

  it('nomeia os cinco especialistas e o fora_escopo', () => {
    for (const palavra of ['estoque', 'financeiro', 'clientes', 'caixa', 'compras', 'fora_escopo']) {
      expect(PROMPT_ASSUNTO).toContain(palavra)
    }
  })

  it('NAO tem data propria: a data entra por parametro, de uma fonte so', () => {
    expect(PROMPT_ASSUNTO).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})

describe('promptAssunto — o prompt COM a data de hoje', () => {
  it('acrescenta a data recebida', () => {
    const prompt = promptAssunto('2026-10-15')
    expect(prompt).toContain('2026-10-15')
    expect(prompt.startsWith(PROMPT_ASSUNTO)).toBe(true)
  })

  it('cabe no teto — o guarda de payload vale POR PROMPT', () => {
    // A assercao do projeto e metade do teto de payload. O prompt do coordenador
    // e uma lista de CINCO itens (contra os seis do especialista unico), entao ele
    // tem que ser menor que o de classificacao — se um dia nao for, este teste
    // denuncia antes de o payload real estourar.
    expect(promptAssunto('2026-10-15').length).toBeLessThan(LIMITE_PAYLOAD_BYTES / 2)
  })

  it('duas datas diferentes produzem prompts diferentes', () => {
    expect(promptAssunto('2026-10-15')).not.toBe(promptAssunto('2026-10-16'))
  })
})
