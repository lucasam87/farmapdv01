import { perfilAtual } from '@/lib/auth/perfil'
import { FormularioCliente } from '../formulario'

// O atendente cadastra cliente (spec 5) — mas o formulario so mostra limite,
// bloqueio e saldo inicial para o dono. Quem decide e o papel de quem esta
// logado, lido aqui no servidor: nao ha prop de cliente que possa mentir isso.
export default async function NovoClientePage() {
  const perfil = await perfilAtual()

  return <FormularioCliente cliente={null} ehDono={perfil?.papel === 'dono'} />
}
