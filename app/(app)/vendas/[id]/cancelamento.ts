// Validação do motivo do cancelamento — PURA: sem Supabase, sem React.
//
// O banco recusa sozinho o que é de regra (quem não é dono, caixa já fechado,
// venda já cancelada — matriz da spec §8.2). O motivo é diferente: o Postgres
// aceita string vazia, e `motivo_cancelamento` vazio no histórico não conta a
// história para ninguém. Por isso a checagem vive aqui, antes da RPC.

export type MotivoValidado = { ok: true; motivo: string } | { ok: false; mensagem: string }

const MINIMO = 3
const MAXIMO = 200

export function validarMotivo(texto: string): MotivoValidado {
  // `trim()` de propósito: quem digita "  cliente desistiu " quis dizer o mesmo
  // que "cliente desistiu", e é o texto sem as pontas que vai para o banco.
  const motivo = texto.trim()

  if (motivo === '') return { ok: false, mensagem: 'Escreva o motivo do cancelamento.' }
  if (motivo.length < MINIMO) {
    return { ok: false, mensagem: 'Motivo muito curto: escreva pelo menos 3 letras.' }
  }
  if (motivo.length > MAXIMO) {
    return { ok: false, mensagem: 'Motivo muito longo: no máximo 200 letras.' }
  }

  return { ok: true, motivo }
}
