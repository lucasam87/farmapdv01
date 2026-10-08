'use server'

import { revalidatePath } from 'next/cache'
import { criarClienteServidor } from '@/lib/supabase/server'
import { perfilAtual } from '@/lib/auth/perfil'
// Caminho relativo (e nao `@/app/(app)/...`) para seguir o que as outras telas
// fazem: `validacao.ts` e um modulo puro da tela de clientes, compartilhado aqui.
import { validarRecebimento } from '../clientes/validacao'

// Recebimento do crediario no balcao. Nasce aqui (Task 4) porque o DETALHE do
// cliente ja recebe pagamento; a Task 5 so embute o `<Receber>` na lista de
// devedores.
//
// O TETO DA DIVIDA E DO BANCO
// ---------------------------
// `validarRecebimento` roda aqui com o saldo que veio num campo escondido (a view
// `v_clientes_devedores`, a mesma que a tela mostra) so para dar a mensagem antes
// da ida ao banco. Quem trava o cliente com `for update` e compara com o saldo
// real e `receber_pagamento` (014:74-89) — o campo escondido o operador consegue
// mexer pelo navegador, e por isso ele nao pode ser a unica checagem.

export type Resultado = { ok: true; mensagem: string } | { ok: false; mensagem: string }

const SEM_PERFIL = 'Usuário sem perfil cadastrado. Fale com o responsável.'

export async function receberDoCliente(
  _anterior: Resultado | null,
  formData: FormData,
): Promise<Resultado> {
  const perfil = await perfilAtual()
  if (!perfil) return { ok: false, mensagem: SEM_PERFIL }

  const clienteId = String(formData.get('cliente_id') ?? '').trim()

  // Campo escondido adulterado/ausente nao pode derrubar um recebimento legitimo
  // (nem `Number(null)` = 0, que recusaria tudo como "divida zerada"): sem um
  // saldo confiavel a checagem da tela e pulada (`Infinity`) e quem decide e o
  // banco, que continua recusando o que passar da divida. Um `0` DE VERDADE, que
  // o campo escondido manda quando o cliente nao deve mais nada, nao cai aqui.
  const bruto = String(formData.get('saldo') ?? '').trim()
  const doCampo = Number(bruto)
  const divida = bruto === '' || !Number.isFinite(doCampo) ? Number.POSITIVE_INFINITY : doCampo

  const validado = validarRecebimento(String(formData.get('valor') ?? ''), divida)
  if (!validado.ok) return { ok: false, mensagem: validado.mensagem }

  const supabase = await criarClienteServidor()
  const { error } = await supabase.rpc('receber_pagamento', {
    p_cliente_id: clienteId,
    p_valor: validado.centavos,
    p_forma: String(formData.get('forma') ?? 'dinheiro'),
  })
  // Mensagem crua: 'Abra o caixa para começar a vender.', 'O valor é maior que a
  // dívida (R$ X).' e 'Forma de recebimento inválida' ja sao o recado que o
  // operador precisa ler (spec 9).
  if (error) return { ok: false, mensagem: error.message }

  // O crediario tem duas portas (a lista da Task 5 e o detalhe daqui): as duas
  // precisam enxergar o novo saldo, e a tela de clientes tambem.
  revalidatePath('/crediario')
  revalidatePath('/clientes')
  revalidatePath(`/clientes/${clienteId}`)
  return { ok: true, mensagem: 'Recebimento registrado.' }
}
