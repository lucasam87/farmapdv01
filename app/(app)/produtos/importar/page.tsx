import { perfilAtual } from '@/lib/auth/perfil'
import { FormularioImportacao } from './formulario'

// A tela de importacao e a UNICA que devolve dados em vez de redirecionar
// (useActionState), porque a conferencia acontece antes de gravar: as somas
// ficam na tela ao lado das linhas validas. Importar e ato de dono (spec 5).
export default async function ImportarPage() {
  const perfil = await perfilAtual()

  if (!perfil || perfil.papel !== 'dono') {
    return (
      <p className="mx-auto max-w-2xl rounded-2xl bg-white p-8 text-lg text-slate-800 shadow-sm">
        Só o dono pode importar produtos.
      </p>
    )
  }

  return <FormularioImportacao />
}
