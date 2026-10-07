import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // O PADRAO E 1 MB, e a importacao do catalogo nao cabe nele.
      //
      // A tela de importacao faz DUAS viagens: a primeira le o arquivo, e a
      // segunda manda para a RPC o JSON ja validado, num campo oculto (o arquivo
      // nao volta ao cliente). No catalogo real do sistema antigo esse JSON tem
      // ~856 KB, e o Server Action recusou com "Body exceeded 1 MB limit" — o
      // dono clicava em Confirmar e via uma tela de erro do Next, sem nada
      // gravado.
      //
      // 4 MB da folga para um catalogo ~4x maior que o de hoje (~150 bytes por
      // linha, entao ~26 mil produtos). O limite existe para nao gastar recurso
      // parseando corpo gigante, entao nao vale abrir demais: 4 MB resolve o
      // problema real sem virar porta aberta.
      //
      // ATENCAO: o limite vale para o corpo HTTP CRU, incluindo o overhead do
      // multipart (10-20 KB) — a doc desta versao avisa.
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
