import { perfilAtual } from '@/lib/auth/perfil'
import { FormularioImportacaoClientes } from './formulario'

// A tela de importacao e uma das duas que devolvem dados em vez de redirecionar
// (useActionState), porque a conferencia acontece antes de gravar: as somas ficam
// na tela ao lado das linhas validas. Importar e ato de dono (spec 5) — e esta
// tela mexe em DINHEIRO (lanca saldo devedor), entao a checagem aqui e a RPC
// (015:250) sao as duas portas.
export default async function ImportarClientesPage() {
  const perfil = await perfilAtual()

  if (!perfil || perfil.papel !== 'dono') {
    return (
      <p className="mx-auto max-w-2xl rounded-2xl bg-white p-8 text-lg text-slate-800 shadow-sm">
        Só o dono pode importar clientes.
      </p>
    )
  }

  return <FormularioImportacaoClientes />
}
