# Gera a fixture de PDF usada pelos testes de lib/pdf.ts.
#
# NAO e dependencia do app e nao roda no build: existe para a fixture ser
# reproduzivel. O PDF e escrito A MAO, byte a byte, so com a stdlib — reportlab
# e fpdf nao estao instalados e nao entram no projeto. E o mesmo principio do
# lib/xlsx.ts: o caso e pequeno o bastante para o leitor ser nosso.
#
# Rodar com o Python empacotado do harness:
#   C:\Users\lucas\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe ^
#       scripts\gerar-fixture-pdf.py
#
# Gera tests/fixtures/produtos.pdf com o MESMO conteudo de produtos.xlsx
# (constante PRODUTOS de gerar-fixtures-xlsx.py + a linha "PRODUTO PRECO TEXTO"),
# em 8 colunas, mais uma linha de rodape TOTAL com a soma dos precos de venda.
#
# Duas coisas sao de proposito, porque o teste depende delas:
#
# 1. CADA CELULA E POSICIONADA com o seu proprio `Tm`. Um PDF que imprimisse a
#    linha inteira numa string unica nao provaria nada sobre coluna: o leitor
#    so reconstruiria a tabela porque o gerador ja entregou pronto.
# 2. Os valores saem na forma que o Excel GUARDA o numero (2.5, e nao 2.50),
#    a mesma que a constante PRODUTOS produz no .xlsx — assim o PDF e o XLSX
#    equivalentes tem que dar exatamente a MESMA Tabela depois de lidos.

import os
import zlib

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, "tests", "fixtures")
os.makedirs(DESTINO, exist_ok=True)

CABECALHO = [
    "codigo_barras", "nome", "categoria", "unidade",
    "preco_custo", "preco_venda", "estoque_atual", "estoque_minimo",
]

# (codigo, nome, categoria, unidade, custo, venda, estoque, minimo)
# O nome tem acento de proposito: prova que o WinAnsiEncoding com escape octal
# sai certo e que o leitor devolve UTF-8.
PRODUTOS = [
    ("0012345", "DIPIRONA 500mg ção", "Analgésico", "un", 2.50, 4.50, 10, 5),
    ("0098765", "PARACETAMOL 750mg", "Analgésico", "un", 3.10, 6.90, 0, 2),
    ("0055555", "DIPIRONA GOTAS 20ml", "Analgésico", "ml", 5.00, 9.99, 3, 1),
]

# Larguras em pontos, na ordem das 8 colunas. A largura so precisa acomodar o
# conteudo: o teste compara a Tabela, nao o layout.
LARGURAS = [70, 140, 80, 40, 60, 60, 60, 60]
MARGEM = 40
TOPO = 540
ALTURA_LINHA = 16


def textos():
    """As linhas do que vai impresso, ja como TEXTO (a celula vazia e '')."""
    linhas = [list(CABECALHO)]
    for codigo, nome, categoria, unidade, custo, venda, estoque, minimo in PRODUTOS:
        linhas.append([
            codigo, nome, categoria, unidade,
            f"{custo:g}", f"{venda:g}", str(estoque), str(minimo),
        ])

    # Linha extra com o preco como TEXTO ("4,50"): o exportador mistura os dois
    # formatos no mesmo arquivo.
    linhas.append(["0077777", "PRODUTO PRECO TEXTO", "Analgésico", "un", "2,00", "4,50", "1", "0"])

    # Rodape de total. Vai IMPRESSO aqui de proposito: e contra ele que o teste
    # confere a soma que o analisarTabela extraiu, e o teste le o valor do
    # arquivo, nao do codigo.
    #
    # A soma inclui a linha de preco em TEXTO, porque o `analisarTabela` NAO
    # descarta essa linha (ela e produto de verdade) e portanto soma o preco
    # dela em `somaGravada`. Se o total impresso deixasse essa linha de fora, o
    # criterio de aceite acusaria diferenca mesmo com a leitura perfeita — o
    # total tem que ser a soma do que o sistema vai gravar.
    total = sum(preco_de(l) for l in linhas[1:])
    rodape = [""] * len(CABECALHO)
    rodape[0] = "TOTAL"
    rodape[5] = f"{total:.2f}"
    linhas.append(rodape)

    return linhas


def preco_de(linha):
    """Preco de venda em reais, aceitando "4.5" e "4,50" como o leitor aceita."""
    return float(linha[5].replace(",", "."))


def x_das_colunas():
    """Mesmo x para a mesma coluna em TODAS as linhas (alinhamento a esquerda)."""
    xs = []
    atual = MARGEM
    for largura in LARGURAS:
        xs.append(atual)
        atual += largura
    return xs


def escape_pdf(texto):
    """Escapa para literal de string do PDF, com octal no que nao for ASCII.

    Sem o escape octal o acento viraria byte cru e o leitor teria que adivinhar
    a codificacao. Aqui o byte e declarado (WinAnsi).
    """
    saida = []
    for caractere in texto:
        codigo = ord(caractere)
        if caractere == "(":
            saida.append("\\(")
        elif caractere == ")":
            saida.append("\\)")
        elif caractere == "\\":
            saida.append("\\\\")
        elif 32 <= codigo < 127:
            saida.append(caractere)
        elif codigo <= 255:
            # Sempre 3 digitos: "\3470" seria lido como octal de 4 digitos.
            saida.append("\\%03o" % codigo)
        else:
            raise ValueError("caractere fora do WinAnsi: %r" % caractere)
    return "".join(saida)


def conteudo():
    """Stream de conteudo: um `BT` por linha e um `Tm` por celula."""
    partes = []
    xs = x_das_colunas()

    for indice, linha in enumerate(textos()):
        y = TOPO - indice * ALTURA_LINHA
        partes.append("BT\n")
        partes.append("/F1 9 Tf\n")
        for coluna, valor in enumerate(linha):
            if valor == "":
                continue
            partes.append("1 0 0 1 %d %d Tm\n" % (xs[coluna], y))
            partes.append("(%s) Tj\n" % escape_pdf(valor))
        partes.append("ET\n")

    return "".join(partes).encode("latin-1")


def montar_pdf(stream, largura=842, altura=595):
    """Objetos, xref e trailer escritos a mao. Devolve os bytes do arquivo."""
    objetos = {
        1: b"<< /Type /Catalog /Pages 2 0 R >>",
        2: b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        3: (
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
            "/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"
            % (largura, altura)
        ).encode("ascii"),
        4: (
            "<< /Length %d /Filter /FlateDecode >>\nstream\n" % len(stream)
        ).encode("ascii") + stream + b"\nendstream",
        5: b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    }

    saida = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    posicoes = {}
    for numero in sorted(objetos):
        posicoes[numero] = len(saida)
        saida += b"%d 0 obj\n" % numero + objetos[numero] + b"\nendobj\n"

    inicio_xref = len(saida)
    total = len(objetos) + 1
    saida += b"xref\n0 %d\n" % total
    saida += b"0000000000 65535 f \n"
    for numero in sorted(objetos):
        saida += b"%010d 00000 n \n" % posicoes[numero]

    saida += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        total, inicio_xref
    )
    return bytes(saida)


def gravar_produtos():
    pdf = montar_pdf(zlib.compress(conteudo(), 9))
    caminho = os.path.join(DESTINO, "produtos.pdf")
    with open(caminho, "wb") as arquivo:
        arquivo.write(pdf)
    return caminho


if __name__ == "__main__":
    caminho = gravar_produtos()
    print(f"gerado: {os.path.relpath(caminho, RAIZ)} ({os.path.getsize(caminho)} bytes)")
