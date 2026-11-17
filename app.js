const rows = [
  "2 / 1","4 / 2","9 / 3","12 / 4","15 / 5","18 / 6",
  "1º TOTAL","BÔNUS (+30 se ≥ 60)","2º TOTAL",
  "20 Q","30 F","35 S-","40 S+","X MIN","X MAX","50 YAM",
  "3º TOTAL",
  "2º + 3º TOTAL"
];
const COLUNAS = 4;

// Classes de cada linha (cor da seção e linha grossa no fim de cada bloco).
const CLASSES_LINHA = {
  5: "numeros fim-secao",
  6: "total",
  7: "total",
  8: "total fim-secao",
  15: "combos fim-secao",
  16: "total",
  17: "total-forte"
};

function classesDaLinha(i) {
  if (CLASSES_LINHA[i]) return CLASSES_LINHA[i];
  return i < 6 ? "numeros" : "combos";
}

// Explicação de cada linha e coluna, mostrada ao tocar no nome.
const LEGENDA_LINHAS = [
  ["Uns (1)", "Some os dados que caíram 1. Referência: 2 pontos."],
  ["Dois (2)", "Some os dados que caíram 2. Referência: 4 pontos."],
  ["Três (3)", "Some os dados que caíram 3. Referência: 9 pontos."],
  ["Quatros (4)", "Some os dados que caíram 4. Referência: 12 pontos."],
  ["Cincos (5)", "Some os dados que caíram 5. Referência: 15 pontos."],
  ["Seis (6)", "Some os dados que caíram 6. Referência: 18 pontos."],
  ["1º total", "Soma das seis linhas de cima. As referências somam 60, o necessário para o bônus."],
  ["Bônus", "Ganha 30 pontos se o 1º total for 60 ou mais. Embaixo do valor aparece quanto ainda falta, ou \"sem bônus\" quando não dá mais para chegar a 60 nem fazendo o máximo nas casas que sobraram."],
  ["2º total", "1º total + bônus."],
  ["Q – Quadra", "Exatamente quatro dados iguais (com os cinco iguais é YAM). Vale 20 + a soma dos quatro (ex.: quatro 5 = 40)."],
  ["F – Full", "Uma trinca e um par (ex.: 3-3-3-5-5). Vale 30 + a soma dos dados."],
  ["S- – Sequência menor", "1-2-3-4-5. Vale 35 + 15 = 50."],
  ["S+ – Sequência maior", "2-3-4-5-6. Vale 40 + 20 = 60."],
  ["MIN – Mínimo", "Soma dos cinco dados, tentando fazer o menor valor. Precisa ser menor que o MAX da coluna."],
  ["MAX – Máximo", "Soma dos cinco dados, tentando fazer o maior valor. Precisa ser maior que o MIN da coluna."],
  ["YAM", "Os cinco dados iguais. Vale 50 + a soma dos dados (ex.: cinco 6 = 80)."],
  ["3º total", "Soma das linhas de Quadra até YAM."],
  ["2º + 3º total", "Total da coluna."]
];

const LEGENDA_COLUNAS = {
  "MPB": ["MPB", "Nome de cada jogada. Toque em uma linha para ver o que ela significa."],
  "↓": ["↓ – Descida", "Preencha de cima para baixo, na ordem. A casa da vez fica destacada. Para riscar, digite 0 (aparece —): pode em qualquer casa; nas casas fora da vez, use o botão “Riscar esta casa”."],
  "↑": ["↑ – Subida", "Começa depois de terminar a descida, de baixo para cima, na ordem. Para riscar, digite 0 (aparece —): pode em qualquer casa."],
  "D": ["D – Desordem", "Preencha em qualquer ordem."],
  "S": ["S – Seca", "Vale só o que sair na primeira jogada dos dados."]
};

let timerLegenda = null;
let ultimoAviso = 0;

// tipo: "" (legenda), "aviso" (casa fora da vez) ou "erro" (valor recusado).
// acao (opcional): { texto, fazer } mostra um botão dentro da caixa.
function mostrarLegenda([titulo, texto], tipo = "", acao = null) {
  const caixa = document.getElementById("legenda");
  caixa.querySelector("strong").textContent = titulo;
  caixa.querySelector("span").textContent = texto;
  const botao = caixa.querySelector("button");
  botao.hidden = !acao;
  botao.onclick = acao ? () => { caixa.hidden = true; acao.fazer(); } : null;
  if (acao) botao.textContent = acao.texto;
  caixa.classList.toggle("erro", tipo === "erro");
  caixa.classList.toggle("aviso", tipo === "aviso");
  caixa.hidden = false;
  clearTimeout(timerLegenda);
  timerLegenda = setTimeout(() => { caixa.hidden = true; }, tipo ? 7000 : 5000);
}

// ---------- valores possíveis ----------

const intervalo = (de, ate) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);
const FACES = intervalo(1, 6);

// Full: trinca de um valor + par de outro, 30 + soma dos cinco dados.
const SOMAS_FULL = [...new Set(
  FACES.flatMap(a => FACES.filter(b => b !== a).map(b => 30 + 3 * a + 2 * b))
)].sort((x, y) => x - y);

// Lista de valores aceitos em cada linha (0 = riscado).
function valoresPossiveis(linha) {
  if (linha <= 5) {
    const face = linha + 1;
    return intervalo(0, 5).map(qtd => qtd * face);
  }
  switch (linha) {
    case 9:  return [0, ...FACES.map(f => 20 + 4 * f)];  // Quadra
    case 10: return [0, ...SOMAS_FULL];                  // Full
    case 11: return [0, 50];                             // Sequência menor
    case 12: return [0, 60];                             // Sequência maior
    case 13:                                             // X MIN
    case 14: return [0, ...intervalo(5, 30)];            // X MAX
    case 15: return [0, ...FACES.map(f => 50 + 5 * f)];  // YAM
  }
  return null;
}

function descreverValores(lista) {
  return lista.length > 12
    ? `${lista[0]}, ou de ${lista[1]} a ${lista[lista.length - 1]}`
    : lista.join(", ");
}

// ---------- ordem da descida (↓) e da subida (↑) ----------

// Linhas em que se marca ponto, de cima para baixo (sem os totais).
const LINHAS_JOGO = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 15];
const COL_DESCIDA = 0;
const COL_SUBIDA = 1;

const preenchida = (linha, col) => (state[`${linha}-${col}`] ?? "") !== "";

// Próxima casa a jogar numa coluna com ordem, ou null se a coluna acabou.
function proximaCasa(col) {
  if (col === COL_DESCIDA) {
    return LINHAS_JOGO.find(l => !preenchida(l, COL_DESCIDA)) ?? null;
  }
  if (col === COL_SUBIDA) {
    if (proximaCasa(COL_DESCIDA) !== null) return null; // descida ainda não acabou
    return [...LINHAS_JOGO].reverse().find(l => !preenchida(l, COL_SUBIDA)) ?? null;
  }
  return null;
}

// Se marcar ponto (diferente de 0) nesta casa quebra a ordem, diz o motivo e
// qual é a casa certa ({ motivo, certa: "linha-coluna" }); senão null.
// Riscar (0) pode em qualquer casa, a qualquer hora.
function problemaDeOrdem(linha, col) {
  if (col === COL_DESCIDA) {
    const anterior = LINHAS_JOGO.slice(0, LINHAS_JOGO.indexOf(linha)).find(l => !preenchida(l, col));
    if (anterior !== undefined) {
      return {
        motivo: `A descida (↓) é preenchida de cima para baixo, e ainda falta ${siglaDaCasa(anterior)}.`,
        certa: `${anterior}-${COL_DESCIDA}`
      };
    }
  }
  if (col === COL_SUBIDA) {
    const faltaDescida = proximaCasa(COL_DESCIDA);
    if (faltaDescida !== null) {
      return {
        motivo: `A subida (↑) só começa depois que a descida (↓) termina, e na descida ainda falta ${siglaDaCasa(faltaDescida)}.`,
        certa: `${faltaDescida}-${COL_DESCIDA}`
      };
    }
    const abaixo = LINHAS_JOGO.slice(LINHAS_JOGO.indexOf(linha) + 1).reverse().find(l => !preenchida(l, col));
    if (abaixo !== undefined) {
      return {
        motivo: `A subida (↑) é preenchida de baixo para cima, e ainda falta ${siglaDaCasa(abaixo)}.`,
        certa: `${abaixo}-${COL_SUBIDA}`
      };
    }
  }
  return null;
}

function nomeDaCasa(key) {
  const [linha, col] = key.split("-").map(Number);
  return `${siglaDaCasa(linha)} na ${col === COL_DESCIDA ? "descida (↓)" : "subida (↑)"}`;
}

// Mensagem de casa fora da vez. `aoTocar`: a pessoa só tocou na casa (ainda
// pode riscar); senão, tentou marcar ponto e o valor foi recusado.
function mensagemDeOrdem(problema, aoTocar) {
  const fim = aoTocar
    ? "Aqui você só pode riscar."
    : "Para pular uma casa, risque com 0.";
  return ["Não é a vez desta casa", `${problema.motivo} Preencha em ${nomeDaCasa(problema.certa)}. ${fim}`, problema.certa];
}

// Faz a casa certa piscar e, se estiver fora da tela, rola até ela.
function piscarCasa(key) {
  const td = body.querySelector(`[data-key="${key}"]`);
  if (!td) return;
  td.classList.remove("piscar");
  void td.offsetWidth; // reinicia a animação
  td.classList.add("piscar");
  td.scrollIntoView({ block: "nearest", behavior: "smooth" });
  setTimeout(() => td.classList.remove("piscar"), 1600);
}

// Destaca a próxima casa da descida e da subida, e põe ✓ na coluna terminada.
function marcarProximas() {
  body.querySelectorAll("td.proxima").forEach(td => td.classList.remove("proxima"));
  const cabecalhos = document.querySelectorAll("#tela-jogo thead th");
  const descidaAcabou = proximaCasa(COL_DESCIDA) === null;

  for (const col of [COL_DESCIDA, COL_SUBIDA]) {
    const linha = proximaCasa(col);
    if (linha !== null) body.querySelector(`[data-key="${linha}-${col}"]`).classList.add("proxima");
    const completa = linha === null && (col === COL_DESCIDA || descidaAcabou);
    cabecalhos[col + 1].classList.toggle("completa", completa);

    // Casa vazia fora da vez: só-leitura, para o teclado não abrir ao tocar.
    for (const l of LINHAS_JOGO) {
      const input = body.querySelector(`[data-key="${l}-${col}"] input`);
      if (input) input.readOnly = !preenchida(l, col) && problemaDeOrdem(l, col) !== null;
    }
  }
}

// O número digitado já está completo? (nenhum valor aceito nesta linha
// começa com ele e é mais longo). Ex.: na linha do 4, "2" espera o "20".
function numeroCompleto(linha, texto) {
  if (texto === "") return false;
  return !valoresPossiveis(linha).map(String).some(v => v.length > texto.length && v.startsWith(texto));
}

const RISCO = "—";

// Texto mostrado na casa: vazio, o número, ou "—" quando riscada (valor 0).
function exibir(valor) {
  if (valor === undefined || valor === null || valor === "") return "";
  return Number(valor) === 0 ? RISCO : String(Number(valor));
}

// Marca as casas riscadas (valor 0) para ficarem com visual próprio.
function marcarRiscados(tbody, valores) {
  tbody.querySelectorAll("td[data-key]").forEach(td => {
    const v = valores[td.dataset.key];
    td.classList.toggle("riscado", v !== undefined && v !== "" && Number(v) === 0);
  });
}

// Devolve a mensagem de erro, ou null se o valor pode ficar.
function validar(key, texto) {
  if (texto === "") return null;

  const [linha, col] = key.split("-").map(Number);
  const nome = siglaDaCasa(linha);
  const valor = Number(texto);
  const possiveis = valoresPossiveis(linha);

  if (!Number.isInteger(valor) || !possiveis.includes(valor)) {
    let msg = `Valores possíveis: ${descreverValores(possiveis)}.`;
    if (linha === 10) msg = `Valores possíveis: 0 ou um destes: ${SOMAS_FULL.join(", ")}.`;
    return [`${valor} não vale em ${nome}`, msg];
  }

  if (valor !== 0) {
    const problema = problemaDeOrdem(linha, col);
    if (problema) return mensagemDeOrdem(problema, false);
  }

  if ((linha === 13 || linha === 14) && valor !== 0) {
    const outraLinha = linha === 13 ? 14 : 13;
    const outro = Number(state[`${outraLinha}-${col}`]) || 0;
    if (outro !== 0) {
      const min = linha === 13 ? valor : outro;
      const max = linha === 14 ? valor : outro;
      if (max <= min) {
        return [`${valor} não vale em ${nome}`, `Nesta coluna o MAX precisa ser maior que o MIN (MIN = ${min}, MAX = ${max}).`];
      }
    }
  }

  return null;
}

document.addEventListener("click", evento => {
  const alvo = evento.target;
  const linha = alvo.closest("tbody td.mpb");
  const coluna = alvo.closest("thead th");

  if (linha) {
    mostrarLegenda(LEGENDA_LINHAS[Number(linha.dataset.linha)]);
  } else if (coluna) {
    const legenda = LEGENDA_COLUNAS[coluna.textContent.trim()];
    if (legenda) mostrarLegenda(legenda);
  } else if (!alvo.closest("#legenda") && Date.now() - ultimoAviso > 600) {
    // (um toque fora da casa dispara o aviso de erro; não fecha esse mesmo aviso)
    document.getElementById("legenda").hidden = true;
  }
});

const CHAVE_JOGO = "yam";
const CHAVE_HISTORICO = "yam-historico";

let state = ler(CHAVE_JOGO, {});
let historico = ler(CHAVE_HISTORICO, []);
let partidaAberta = null;

// ---------- armazenamento ----------

function ler(chave, padrao) {
  try {
    return JSON.parse(localStorage.getItem(chave)) || padrao;
  } catch {
    return padrao;
  }
}

function salvar() {
  localStorage.setItem(CHAVE_JOGO, JSON.stringify(state));
}

function salvarHistorico() {
  localStorage.setItem(CHAVE_HISTORICO, JSON.stringify(historico));
}

// ---------- cálculo ----------

function ehLinhaCalculada(label) {
  return label.includes("TOTAL") || label.includes("BÔNUS");
}

function somaColuna(valores, col, inicio, fim) {
  let total = 0;
  for (let i = inicio; i <= fim; i++) {
    total += Number(valores[`${i}-${col}`]) || 0;
  }
  return total;
}

// Devolve os valores das linhas calculadas ({ "6-0": 45, ... }) e o total geral.
function calcularTotais(valores) {
  const calculados = {};
  let geral = 0;

  for (let col = 0; col < COLUNAS; col++) {
    const total1 = somaColuna(valores, col, 0, 5);
    const bonus = total1 >= 60 ? 30 : 0;
    const total2 = total1 + bonus;
    const total3 = somaColuna(valores, col, 9, 15);
    const total23 = total2 + total3;

    calculados[`6-${col}`] = total1;
    calculados[`7-${col}`] = bonus;
    calculados[`8-${col}`] = total2;
    calculados[`16-${col}`] = total3;
    calculados[`17-${col}`] = total23;
    geral += total23;
  }

  return { calculados, geral };
}

function partidaTemValores(valores) {
  return Object.values(valores).some(v => v !== "" && v != null);
}

// ---------- tabela ----------

// Monta a tabela dentro de `tbody`. Se `editavel`, as casas viram campos de digitação.
function montarTabela(tbody, valores, editavel) {
  tbody.innerHTML = "";

  rows.forEach((label, rowIndex) => {
    const tr = document.createElement("tr");
    const calculada = ehLinhaCalculada(label);
    tr.className = classesDaLinha(rowIndex);

    const tdLabel = document.createElement("td");
    tdLabel.className = "mpb";
    tdLabel.dataset.linha = rowIndex;
    tdLabel.textContent = label;
    tr.appendChild(tdLabel);

    for (let col = 0; col < COLUNAS; col++) {
      const key = `${rowIndex}-${col}`;
      const td = document.createElement("td");
      td.dataset.key = key;

      if (!calculada && editavel) {
        // Campo de texto com teclado numérico: permite mostrar o risco como "—"
        // e limitar a 2 dígitos (o maior valor possível é 80).
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "numeric";
        input.maxLength = 2;
        input.autocomplete = "off";
        input.value = exibir(valores[key]);

        // Ao tocar, seleciona o conteúdo: digitar já substitui o valor ou o risco.
        // Se não é a vez desta casa (↓ ou ↑), já avisa o motivo e mostra a certa.
        // valor da casa antes desta edição (para o "Desfazer")
        let antes = "";

        input.addEventListener("focus", () => {
          antes = state[key] ?? "";
          input.select();
          const [linha, col] = key.split("-").map(Number);
          const problema = input.value === "" ? problemaDeOrdem(linha, col) : null;
          if (!problema) {
            // tocou numa casa permitida: tira o aviso de ordem que estiver aberto
            const caixa = document.getElementById("legenda");
            if (caixa.classList.contains("aviso")) caixa.hidden = true;
            return;
          }
          input.blur(); // fecha o teclado
          ultimoAviso = Date.now();
          mostrarLegenda(mensagemDeOrdem(problema, true), "aviso", {
            texto: "Riscar esta casa",
            fazer: () => {
              registrarJogada(key, "", "0");
              input.value = exibir("0");
              update(key, "0");
              avisarSala();
              verificarFimDeJogo();
            }
          });
          piscarCasa(problema.certa);
        });

        input.addEventListener("input", () => {
          const limpo = input.value.replace(/\D/g, "");
          if (limpo !== input.value) input.value = limpo;
          update(key, limpo);
          if (numeroCompleto(Number(key.split("-")[0]), limpo)) input.blur();
        });

        // Ao terminar de digitar (sair da casa): apaga se for impossível;
        // senão guarda o número sem zeros à esquerda e mostra 0 como "—".
        input.addEventListener("change", () => {
          const erro = validar(key, input.value);
          if (erro) {
            registrarJogada(key, antes);
            input.value = "";
            update(key, "");
            avisarSala();
            ultimoAviso = Date.now();
            mostrarLegenda(erro, "erro");
            if (erro[2]) piscarCasa(erro[2]);
            return;
          }
          if (input.value === "") {
            registrarJogada(key, antes);
            avisarSala();
            return;
          }
          const numero = String(Number(input.value));
          registrarJogada(key, antes, numero);
          input.value = exibir(numero);
          update(key, numero);
          avisarSala();
          verificarFimDeJogo();
        });
        td.appendChild(input);
      } else if (!calculada) {
        td.textContent = exibir(valores[key]);
      }

      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  });
}

function atualizarTotais(tbody, totalCell, valores) {
  const { calculados, geral } = calcularTotais(valores);
  for (const [key, valor] of Object.entries(calculados)) {
    tbody.querySelector(`[data-key="${key}"]`).textContent = valor;
  }
  totalCell.textContent = geral;
  marcarRiscados(tbody, valores);
  mostrarFaltaBonus(tbody, valores);
}

// ---------- quanto falta para o bônus ----------

const META_BONUS = 60;

// Texto curto para a casa do bônus de uma coluna: "falta 12", "sem bônus"
// (nem com o máximo nas casas que sobraram dá para chegar a 60) ou null
// quando o bônus já foi conquistado.
function situacaoBonus(valores, col) {
  const total1 = somaColuna(valores, col, 0, 5);
  if (total1 >= META_BONUS) return null;

  const maximoQueFalta = [0, 1, 2, 3, 4, 5]
    .filter(l => (valores[`${l}-${col}`] ?? "") === "")
    .reduce((soma, l) => soma + 5 * (l + 1), 0);

  if (total1 + maximoQueFalta < META_BONUS) return { texto: "sem bônus", perdido: true };
  return { texto: `falta ${META_BONUS - total1}`, perdido: false };
}

function mostrarFaltaBonus(tbody, valores) {
  for (let col = 0; col < COLUNAS; col++) {
    const td = tbody.querySelector(`[data-key="7-${col}"]`);
    const situacao = situacaoBonus(valores, col);
    td.classList.toggle("bonus-ok", situacao === null);
    if (!situacao) continue;
    const dica = document.createElement("small");
    dica.className = situacao.perdido ? "dica-bonus perdido" : "dica-bonus";
    dica.textContent = situacao.texto;
    td.appendChild(dica);
  }
}

// ---------- jogo atual ----------

const body = document.getElementById("tableBody");
const totalGeral = document.getElementById("total-geral-final");

function buildTable() {
  montarTabela(body, state, true);
  calcular();
}

function calcular() {
  atualizarTotais(body, totalGeral, state);
  marcarProximas();
}

// Toda a tabela tem só valores possíveis? (usado antes de avisar a sala)
function tabelaValida(valores) {
  return Object.entries(valores).every(([key, v]) => {
    if (v === "" || v == null) return true;
    const possiveis = valoresPossiveis(Number(key.split("-")[0]));
    return !possiveis || possiveis.includes(Number(v));
  });
}

// Chamado só depois que uma casa é confirmada (valor aceito, apagado, riscado ou desfeito).
function avisarSala() {
  if (window.familia) familia.sincronizar();
}

// ---------- avisos e perguntas (janelas do app) ----------
// Substituem alert/confirm do navegador. Devolvem uma Promise:
// avisar() resolve quando a pessoa toca em OK; confirmar() resolve true/false.

let respostaPendente = null;

function perguntar({ titulo = "", texto = "", sim = "OK", nao = null, perigo = false }) {
  if (respostaPendente) respostaPendente(false); // só uma pergunta por vez
  document.getElementById("pergunta-titulo").textContent = titulo;
  document.getElementById("pergunta-titulo").hidden = !titulo;
  document.getElementById("pergunta-texto").textContent = texto;
  const botaoSim = document.getElementById("pergunta-sim");
  botaoSim.textContent = sim;
  botaoSim.className = perigo ? "perigo" : "principal";
  const botaoNao = document.getElementById("pergunta-nao");
  botaoNao.textContent = nao || "";
  botaoNao.hidden = !nao;
  document.getElementById("janela-pergunta").hidden = false;
  botaoSim.focus();
  return new Promise(resolve => {
    respostaPendente = valor => {
      respostaPendente = null;
      document.getElementById("janela-pergunta").hidden = true;
      resolve(valor);
    };
  });
}

function responder(valor) {
  if (respostaPendente) respostaPendente(valor);
}

const avisar = (texto, titulo = "") => perguntar({ titulo, texto });
const confirmar = (titulo, texto, sim = "Sim", perigo = false) =>
  perguntar({ titulo, texto, sim, nao: "Cancelar", perigo });

// Botão "Jogar em família" (funciona só com internet).
function abrirFamilia(modo) {
  if (window.familia) familia.abrir(modo);
  else avisar("Verifique a conexão e tente de novo.", "A sala precisa de internet");
}

function update(key, value) {
  state[key] = value;
  salvar();
  calcular();
}

// Id da entrada do histórico que corresponde à partida atual (quando ela
// já foi salva automaticamente ao terminar). Evita salvar duas vezes.
const CHAVE_PARTIDA_SALVA = "yam-partida-salva";
let partidaSalvaId = ler(CHAVE_PARTIDA_SALVA, null);

function guardarPartidaSalvaId(id) {
  partidaSalvaId = id;
  if (id === null) localStorage.removeItem(CHAVE_PARTIDA_SALVA);
  else localStorage.setItem(CHAVE_PARTIDA_SALVA, JSON.stringify(id));
}

function entradaDaPartidaAtual() {
  return historico.find(p => p.id === partidaSalvaId) || null;
}

// Salva a partida atual no histórico; se ela já estava salva, só atualiza.
function salvarPartidaAtual() {
  const total = calcularTotais(state).geral;
  const existente = entradaDaPartidaAtual();
  if (existente) {
    existente.total = total;
    existente.valores = { ...state };
  } else {
    const id = Date.now();
    historico.unshift({ id, data: new Date().toISOString(), total, valores: { ...state }, nome: nomeJogador || undefined });
    guardarPartidaSalvaId(id);
  }
  salvarHistorico();
}

const partidaCompleta = () =>
  LINHAS_JOGO.every(l => [0, 1, 2, 3].every(col => preenchida(l, col)));

// Chamado depois de cada valor aceito: se a última casa foi preenchida,
// salva a partida e mostra o resultado.
function verificarFimDeJogo() {
  if (!partidaCompleta()) return;

  // em sala: salva e espera os outros. O resultado pessoal só aparece
  // depois do pódio (ao fechar o pódio, ver aposPodio).
  if (window.familia && familia.ativa()) {
    salvarPartidaAtual();
    if (!familia.revelada()) familia.aoTerminar();
    else familia.registrarResultado();
    return;
  }

  const recordeAnterior = recordeSemAPartidaAtual();
  salvarPartidaAtual();
  mostrarFimDeJogo(recordeAnterior);
}

function recordeSemAPartidaAtual() {
  const outras = historico.filter(p => p.id !== partidaSalvaId).map(p => p.total);
  return outras.length ? Math.max(...outras) : null;
}

// Ao fechar o pódio da sala: mostra o resultado pessoal (se este jogador terminou).
function aposPodio() {
  if (!partidaCompleta() || !entradaDaPartidaAtual()) return;
  mostrarFimDeJogo(recordeSemAPartidaAtual());
}

// ---------- pódio ----------
// O mesmo pódio serve para a sala ao vivo (familia.js) e para uma partida em
// sala aberta no histórico (fica guardado na partida e funciona sem internet).

let podioNaTela = null;       // { titulo, terminaram, naoTerminaram } do pódio aberto
let podioDoHistorico = null;  // partida do histórico cujo pódio está aberto (null = sala ao vivo)

function tituloDoPodio(vencedores) {
  return vencedores.length === 0 ? "Partida encerrada"
    : vencedores.length === 1 ? `🏆 ${vencedores[0]} venceu!`
    : `🏆 Empate: ${vencedores.join(" e ")}!`;
}

// p.terminaram: [{ nome, total, posicao, eu?, valores? }] do 1º ao último;
// p.naoTerminaram: [{ nome, eu? }]. verTabela(j) diz o que fazer ao tocar num nome.
function desenharPodio(p, verTabela, partidaDoHistorico = null) {
  const el = id => document.getElementById(id);
  podioNaTela = p;
  podioDoHistorico = partidaDoHistorico;
  const nomeCom = j => j.eu ? `${j.nome} (você)` : j.nome;
  const podeVer = j => j.valores && typeof j.valores === "object";

  el("podio-titulo").textContent = p.titulo;
  el("podio-data").textContent = partidaDoHistorico ? formatarData(partidaDoHistorico.data) : "";
  el("podio-data").hidden = !partidaDoHistorico;

  // degraus: 2º à esquerda, 1º no meio, 3º à direita
  const degraus = el("podio-degraus");
  degraus.innerHTML = "";
  const medalhas = { 1: "🥇", 2: "🥈", 3: "🥉" };
  [1, 0, 2].forEach(i => {
    const j = p.terminaram[i];
    const coluna = document.createElement("div");
    coluna.className = `degrau degrau-${i + 1}`;
    if (j) {
      const medalha = document.createElement("div");
      medalha.className = "medalha";
      medalha.textContent = medalhas[j.posicao] || `${j.posicao}º`;
      const nome = document.createElement(podeVer(j) ? "button" : "div");
      nome.className = "podio-nome";
      nome.textContent = nomeCom(j);
      if (podeVer(j)) nome.onclick = verTabela(j);
      const pontos = document.createElement("div");
      pontos.className = "podio-pontos";
      pontos.textContent = `${j.total} pts`;
      const bloco = document.createElement("div");
      bloco.className = "bloco-degrau";
      bloco.textContent = `${j.posicao}º`;
      coluna.append(medalha, nome, pontos, bloco);
      coluna.classList.add(`pos-${Math.min(j.posicao, 3)}`); // altura do degrau segue a colocação (empate = mesma altura)
      if (j.eu) coluna.classList.add("eu");
    } else {
      coluna.classList.add("vazio");
    }
    degraus.appendChild(coluna);
  });

  // do 4º em diante, e quem não terminou
  const lista = el("podio-lista");
  lista.innerHTML = "";
  const linha = (j, pos, pts, classe) => {
    const li = document.createElement("li");
    if (classe) li.className = classe;
    if (j.eu) li.classList.add("eu");
    [["pos", pos], ["nome", nomeCom(j)], ["pts", pts]].forEach(([c, texto]) => {
      const span = document.createElement("span");
      span.className = c;
      span.textContent = texto;
      li.appendChild(span);
    });
    lista.appendChild(li);
    return li;
  };
  p.terminaram.slice(3).forEach(j => {
    const li = linha(j, `${j.posicao}º`, `${j.total} pts`);
    if (podeVer(j)) {
      li.classList.add("clicavel");
      li.onclick = verTabela(j);
    }
  });
  p.naoTerminaram.forEach(j => linha(j, "–", "não terminou", "nao-terminou"));
  lista.hidden = lista.children.length === 0;
  el("podio-dica").hidden = !p.terminaram.some(podeVer);

  // revanche só na sala ao vivo
  el("podio-revanche").hidden = !!partidaDoHistorico;
  if (partidaDoHistorico) el("podio-revanche-info").hidden = true;
  el("podio-fechar").className = partidaDoHistorico ? "principal" : "";
}

// Pódio de uma partida em sala, aberto no histórico.
function abrirPodioDaPartida() {
  const partida = partidaAberta;
  if (!partida || !partida.sala || !partida.sala.podio) return;
  desenharPodio(partida.sala.podio, j => () => {
    document.getElementById("podio").hidden = true;
    abrirTabelaJogador(j.nome, j.valores, j.total, () => {
      abrirPartida(partida.id);
      abrirPodioDaPartida();
    });
  }, partida);
  document.getElementById("podio").hidden = false;
}

function fecharPodioDaTela() {
  if (podioDoHistorico) {
    podioDoHistorico = null;
    document.getElementById("podio").hidden = true;
  } else if (window.familia) {
    familia.fecharPodio();
  }
}

async function compartilharPodioDaTela() {
  if (!podioNaTela) return;
  const dataIso = podioDoHistorico ? podioDoHistorico.data : new Date().toISOString();
  await compartilharImagem(await gerarImagemPodio(podioNaTela, dataIso), dataIso);
}

// Corta o texto com "…" para caber na largura.
function caber(ctx, texto, largura) {
  if (ctx.measureText(texto).width <= largura) return texto;
  while (texto.length > 1 && ctx.measureText(texto + "…").width > largura) texto = texto.slice(0, -1);
  return texto + "…";
}

// Imagem do pódio (1080 x 1350), no mesmo estilo do cartão de resultado.
function gerarImagemPodio(p, dataIso) {
  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const fonte = (peso, tam) => `${peso} ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  const NAVY = "#1f3a5f", FUNDO = "#f3f3f0", TEXTO = "#1d1d1f", SUAVE = "#66666a", OURO = "#c98a00";
  const data = new Date(dataIso).toLocaleDateString("pt-BR");

  ctx.fillStyle = FUNDO;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // faixa do topo
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, 230);
  ctx.fillStyle = "#ffffff";
  ctx.font = fonte(800, 100);
  ctx.fillText("YAM", W / 2, 100);
  ctx.font = fonte(500, 40);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(data, W / 2, 185);

  // lista de quem ficou do 4º em diante e de quem não terminou
  const linhas = [
    ...p.terminaram.slice(3).map(j => [`${j.posicao}º`, j.nome, `${j.total} pts`]),
    ...p.naoTerminaram.map(j => ["–", j.nome, "não terminou"])
  ];
  const cabem = linhas.length > 5 ? 4 : 5;
  const alturaLista = (Math.min(linhas.length, cabem) + (linhas.length > cabem ? 1 : 0)) * 54;
  // com lista curta (ou nenhuma), desce título e pódio para não sobrar espaço embaixo
  const desce = Math.round((5 * 54 - alturaLista) / 2);

  // quem venceu
  ctx.fillStyle = TEXTO;
  ctx.font = fonte(800, 64);
  ctx.fillText(caber(ctx, p.titulo, W - 100), W / 2, 330 + desce);

  // degraus: 2º à esquerda, 1º no meio, 3º à direita
  const alturas = { 1: 360, 2: 260, 3: 190 };
  const medalhas = { 1: "🥇", 2: "🥈", 3: "🥉" };
  const larg = 300, gap = 30, x0 = (W - (3 * larg + 2 * gap)) / 2, base = 1010 + desce;
  [1, 0, 2].forEach((i, coluna) => {
    const j = p.terminaram[i];
    if (!j) return;
    const h = alturas[Math.min(j.posicao, 3)];
    const x = x0 + coluna * (larg + gap), topo = base - h;
    ctx.fillStyle = j.posicao === 1 ? OURO : NAVY;
    retanguloArredondado(ctx, x, topo, larg, h + 20, 22);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = fonte(800, 84);
    ctx.fillText(`${j.posicao}º`, x + larg / 2, topo + 75);
    ctx.font = fonte(400, 84);
    ctx.fillText(medalhas[j.posicao] || "", x + larg / 2, topo - 190);
    ctx.fillStyle = TEXTO;
    ctx.font = fonte(700, 46);
    ctx.fillText(caber(ctx, j.nome, larg - 10), x + larg / 2, topo - 100);
    ctx.fillStyle = SUAVE;
    ctx.font = fonte(500, 40);
    ctx.fillText(`${j.total} pts`, x + larg / 2, topo - 45);
  });
  // chão do pódio
  ctx.fillStyle = FUNDO;
  ctx.fillRect(0, base, W, H - base);
  ctx.fillStyle = "#c8c8c4";
  ctx.fillRect(x0 - 20, base, 3 * larg + 2 * gap + 40, 6);

  // do 4º em diante e quem não terminou
  linhas.slice(0, cabem).forEach(([pos, nome, pts], k) => {
    const y = base + 55 + k * 54;
    ctx.textAlign = "left";
    ctx.fillStyle = SUAVE;
    ctx.font = fonte(700, 38);
    ctx.fillText(pos, 140, y);
    ctx.fillStyle = TEXTO;
    ctx.font = fonte(600, 38);
    ctx.fillText(caber(ctx, nome, 520), 230, y);
    ctx.textAlign = "right";
    ctx.fillStyle = pts === "não terminou" ? SUAVE : TEXTO;
    ctx.font = fonte(pts === "não terminou" ? 500 : 700, 38);
    ctx.fillText(pts, W - 140, y);
  });
  if (linhas.length > cabem) {
    ctx.textAlign = "center";
    ctx.fillStyle = SUAVE;
    ctx.font = fonte(500, 36);
    ctx.fillText(`e mais ${linhas.length - cabem}`, W / 2, base + 55 + cabem * 54);
  }

  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

// Guarda na partida do histórico como foi o resultado da sala.
function registrarResultadoSala(sala) {
  const entrada = entradaDaPartidaAtual();
  if (!entrada || entrada.total !== sala.total) return;
  delete sala.total;
  entrada.sala = sala;
  salvarHistorico();
}

// "🏆 Você venceu (sala de 4)" / "🏆 Maria venceu · você ficou em 2º"
function textoDaSala(sala) {
  if (!sala) return "";
  const outros = sala.vencedores.filter(n => n !== sala.meuNome);
  if (sala.posicao === 1) {
    return outros.length
      ? `🏆 Empate em 1º com ${outros.join(" e ")}`
      : `🏆 Você venceu (sala de ${sala.jogadores})`;
  }
  return `🏆 ${sala.vencedores.join(" e ")} venceu · você ficou em ${sala.posicao}º`;
}

function mostrarFimDeJogo(recordeAnterior) {
  const { calculados, geral } = calcularTotais(state);
  const primeira = recordeAnterior === null;
  const novoRecorde = !primeira && geral > recordeAnterior;

  document.getElementById("fim-titulo").textContent = nomeJogador ? `Fim de jogo, ${nomeJogador}!` : "Fim de jogo!";
  document.getElementById("fim-total").textContent = geral;
  document.getElementById("fim-recorde").textContent =
    primeira ? "Sua primeira partida salva! 🎉"
    : novoRecorde ? `🏆 Novo recorde! (o anterior era ${recordeAnterior})`
    : geral === recordeAnterior ? `Igualou seu recorde de ${recordeAnterior}!`
    : `Seu recorde é ${recordeAnterior}.`;
  document.getElementById("fim-colunas").textContent =
    ["↓", "↑", "D", "S"].map((c, col) => `${c} ${calculados[`17-${col}`]}`).join("  ·  ");

  ultimoResultado = { valores: { ...state }, total: geral, data: new Date().toISOString(), novoRecorde };

  const caixa = document.getElementById("fim-de-jogo");
  caixa.classList.toggle("recorde", novoRecorde);
  caixa.hidden = false;
  document.getElementById("legenda").hidden = true;
  if (novoRecorde) soltarConfete();
}

// ---------- compartilhar resultado (imagem) ----------

let ultimoResultado = null;
const ENDERECO_APP = new URL(".", location.href).href;

function retanguloArredondado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Desenha o cartão do resultado (1080 x 1350, bom para WhatsApp) e devolve um PNG.
function gerarImagemResultado(valores, total, dataIso, selo, nome = "") {
  const { calculados } = calcularTotais(valores);
  const bonus = [0, 1, 2, 3].filter(col => calculados[`7-${col}`] > 0).length;
  const yams = [0, 1, 2, 3].filter(col => Number(valores[`15-${col}`]) > 0).length;
  const data = new Date(dataIso).toLocaleDateString("pt-BR");

  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const fonte = (peso, tam) => `${peso} ${tam}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
  const NAVY = "#1f3a5f", FUNDO = "#f3f3f0", TEXTO = "#1d1d1f", SUAVE = "#66666a", AMBAR = "#f2b134";

  ctx.fillStyle = FUNDO;
  ctx.fillRect(0, 0, W, H);

  // faixa do topo com o dado e o nome
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, W, 330);
  const dado = 120, dx = W / 2 - 190, dy = 85;
  ctx.fillStyle = "#ffffff";
  retanguloArredondado(ctx, dx, dy, dado, dado, 24);
  ctx.fill();
  ctx.fillStyle = NAVY;
  const o = dado * 0.27, r = dado * 0.085;
  for (const [px, py] of [[-o, -o], [o, -o], [0, 0], [-o, o], [o, o]]) {
    ctx.beginPath();
    ctx.arc(dx + dado / 2 + px, dy + dado / 2 + py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = fonte(800, 120);
  ctx.fillText("YAM", dx + dado + 40, dy + dado / 2 + 6);
  ctx.textAlign = "center";
  ctx.font = fonte(500, 40);
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(nome ? `${nome}  ·  ${data}` : data, W / 2, 275);

  // total
  ctx.fillStyle = selo ? "#c98a00" : NAVY;
  ctx.font = fonte(800, 250);
  ctx.fillText(String(total), W / 2, 540);
  ctx.fillStyle = SUAVE;
  ctx.font = fonte(500, 52);
  ctx.fillText("pontos", W / 2, 680);

  // selo de recorde
  if (selo) {
    ctx.font = fonte(700, 46);
    const largura = ctx.measureText(selo).width + 80;
    ctx.fillStyle = AMBAR;
    retanguloArredondado(ctx, (W - largura) / 2, 735, largura, 84, 42);
    ctx.fill();
    ctx.fillStyle = TEXTO;
    ctx.fillText(selo, W / 2, 779);
  }

  // total de cada coluna
  const rotulos = ["↓", "↑", "D", "S"];
  const caixa = 210, gap = 30, x0 = (W - (4 * caixa + 3 * gap)) / 2, y0 = 880;
  rotulos.forEach((rotulo, col) => {
    const x = x0 + col * (caixa + gap);
    ctx.fillStyle = "#ffffff";
    retanguloArredondado(ctx, x, y0, caixa, 210, 28);
    ctx.fill();
    ctx.strokeStyle = "#c8c8c4";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = SUAVE;
    ctx.font = fonte(700, 52);
    ctx.fillText(rotulo, x + caixa / 2, y0 + 60);
    ctx.fillStyle = NAVY;
    ctx.font = fonte(800, 78);
    ctx.fillText(String(calculados[`17-${col}`]), x + caixa / 2, y0 + 145);
  });

  // resumo
  ctx.fillStyle = TEXTO;
  ctx.font = fonte(600, 46);
  ctx.fillText(`Bônus em ${bonus} de 4 colunas  ·  ${yams} YAM${yams === 1 ? "" : "s"}`, W / 2, 1200);

  return new Promise(resolve => canvas.toBlob(resolve, "image/png"));
}

// Compartilha a imagem (WhatsApp, etc.); se o celular não deixar, baixa o arquivo.
async function compartilharImagem(blob, dataIso) {
  const nome = `yam-${new Date(dataIso).toISOString().slice(0, 10)}.png`;
  const arquivo = new File([blob], nome, { type: "image/png" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo] });
      return;
    }
  } catch (erro) {
    if (erro && erro.name === "AbortError") return; // cancelou
  }
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function compartilharFimDeJogo() {
  if (!ultimoResultado) return;
  const r = ultimoResultado;
  const blob = await gerarImagemResultado(r.valores, r.total, r.data, r.novoRecorde ? "🏆 Novo recorde!" : "", nomeJogador);
  await compartilharImagem(blob, r.data);
}

async function compartilharPartidaAberta() {
  if (!partidaAberta) return;
  const p = partidaAberta;
  const ehRecorde = historico.length > 1 && p.total === Math.max(...historico.map(h => h.total));
  const blob = await gerarImagemResultado(p.valores, p.total, p.data, ehRecorde ? "🏆 Meu recorde!" : "", p.nome || nomeJogador);
  await compartilharImagem(blob, p.data);
}

// Convite para novos jogadores: só o link do app.
// O link do convite abre direto em "Como jogar" (para quem nunca jogou).
const LINK_CONVITE = `${ENDERECO_APP}#como-jogar`;

async function convidarJogadores() {
  const texto = "Vem jogar YAM com a gente! As regras e a tabela de pontos estão aqui:";
  try {
    if (navigator.share) {
      await navigator.share({ title: "YAM", text: texto, url: LINK_CONVITE });
      return;
    }
  } catch (erro) {
    if (erro && erro.name === "AbortError") return;
  }
  try {
    await navigator.clipboard.writeText(`${texto} ${LINK_CONVITE}`);
    ultimoAviso = Date.now();
    mostrarLegenda(["Link copiado", "Agora é só colar no WhatsApp."]);
  } catch {
    avisar(LINK_CONVITE, "Copie o link do app");
  }
}

function fecharFimDeJogo() {
  document.getElementById("fim-de-jogo").hidden = true;
}

function comecarNovaPartida() {
  state = {};
  salvar();
  limparJogadas();
  guardarPartidaSalvaId(null);
  buildTable();
  fecharFimDeJogo();
}

// Confete simples de comemoração do recorde.
function soltarConfete() {
  const cores = ["#f2b134", "#3d6ea8", "#ffffff", "#e8604c", "#5cb85c"];
  const area = document.getElementById("confete");
  area.innerHTML = "";
  for (let i = 0; i < 60; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "%";
    p.style.background = cores[i % cores.length];
    p.style.animationDelay = Math.random() * 0.6 + "s";
    p.style.animationDuration = 1.8 + Math.random() * 1.2 + "s";
    area.appendChild(p);
  }
  setTimeout(() => { area.innerHTML = ""; }, 3800);
}

async function novoJogo() {
  const jaSalva = entradaDaPartidaAtual() !== null;
  const temValores = partidaTemValores(state);

  if (window.familia && familia.ativa() && !familia.revelada()) {
    if (!await confirmar("Sair da sala?",
      "Você está numa sala. Para começar um novo jogo, você sai dela." +
      (temValores && !jaSalva ? " Esta partida vai para o histórico." : ""), "Sair e começar")) return;
    familia.sair();
  } else if (!await confirmar("Novo jogo",
    jaSalva || !temValores
      ? "Começar um novo jogo?"
      : "Esta partida vai para o histórico e a tabela fica zerada.", "Começar")) {
    return;
  }

  if (temValores) salvarPartidaAtual();
  comecarNovaPartida();
}

// ---------- telas ----------

const telas = ["tela-jogo", "tela-historico", "tela-partida", "tela-estatisticas", "tela-regras"];

function abrirRegras() {
  mostrarTela("tela-regras");
  document.querySelector("#tela-regras .regras").scrollTop = 0;
}

function mostrarTela(id) {
  telas.forEach(t => { document.getElementById(t).hidden = t !== id; });
  window.scrollTo(0, 0);
}

function formatarData(iso) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// ---------- histórico ----------

function abrirHistorico() {
  mostrarUltimoBackup();
  const lista = document.getElementById("lista-historico");
  const resumo = document.getElementById("resumo-historico");
  lista.innerHTML = "";

  if (historico.length === 0) {
    resumo.hidden = true;
    const vazio = document.createElement("li");
    vazio.className = "vazio";
    vazio.textContent = "Nenhuma partida salva ainda. Ao tocar em \"Novo Jogo\", a partida atual é guardada aqui.";
    lista.appendChild(vazio);
  } else {
    const totais = historico.map(p => p.total);
    const recorde = Math.max(...totais);
    const media = Math.round(totais.reduce((a, b) => a + b, 0) / totais.length);

    resumo.hidden = false;
    document.getElementById("qtd-partidas").textContent = historico.length;
    document.getElementById("recorde").textContent = recorde;
    document.getElementById("media").textContent = media;

    historico.forEach(partida => {
      const li = document.createElement("li");
      const botao = document.createElement("button");
      botao.className = "item-historico";

      const data = document.createElement("span");
      data.textContent = formatarData(partida.data);
      const total = document.createElement("strong");
      total.textContent = `${partida.total} pts`;
      if (partida.total === recorde) total.textContent += " ⭐";

      const esquerda = elemento("span", "item-info");
      esquerda.appendChild(data);
      if (partida.sala) {
        esquerda.appendChild(elemento("small", partida.sala.posicao === 1 ? "sala-info venceu" : "sala-info", textoDaSala(partida.sala)));
      }
      botao.append(esquerda, total);
      botao.addEventListener("click", () => abrirPartida(partida.id));
      li.appendChild(botao);
      lista.appendChild(li);
    });
  }

  mostrarTela("tela-historico");
}

// A tela da partida mostra uma partida do histórico ou, no pódio, a tabela
// de outro jogador da sala (sem compartilhar/excluir; "Voltar" volta ao pódio).
let voltarPara = null;

function voltarDaPartida() {
  if (voltarPara) {
    const voltar = voltarPara;
    voltarPara = null;
    voltar();
  } else {
    abrirHistorico();
  }
}

function abrirTabelaJogador(nome, valores, total, aoVoltar) {
  voltarPara = aoVoltar;
  partidaAberta = null;
  document.getElementById("titulo-partida").textContent = `Tabela de ${nome}`;
  const info = document.getElementById("sala-partida");
  info.textContent = `${total} pontos`;
  info.hidden = false;
  document.getElementById("acoes-partida").hidden = true;
  const tbody = document.getElementById("tableBody-partida");
  montarTabela(tbody, valores, false);
  atualizarTotais(tbody, document.getElementById("total-geral-partida"), valores);
  mostrarTela("tela-partida");
}

function abrirPartida(id) {
  partidaAberta = historico.find(p => p.id === id);
  if (!partidaAberta) return;
  voltarPara = null;
  document.getElementById("acoes-partida").hidden = false;

  document.getElementById("titulo-partida").textContent = formatarData(partidaAberta.data);
  const infoSala = document.getElementById("sala-partida");
  infoSala.textContent = textoDaSala(partidaAberta.sala);
  infoSala.hidden = !partidaAberta.sala;
  document.getElementById("ver-podio-partida").hidden = !(partidaAberta.sala && partidaAberta.sala.podio);
  const tbody = document.getElementById("tableBody-partida");
  montarTabela(tbody, partidaAberta.valores, false);
  atualizarTotais(tbody, document.getElementById("total-geral-partida"), partidaAberta.valores);

  mostrarTela("tela-partida");
}

async function excluirPartida() {
  if (!partidaAberta) return;
  if (!await confirmar("Excluir partida?", "Ela sai do histórico e não dá para desfazer.", "Excluir", true)) return;

  historico = historico.filter(p => p.id !== partidaAberta.id);
  salvarHistorico();
  partidaAberta = null;
  abrirHistorico();
}

// ---------- estatísticas ----------

// Nome da casa em textos (mensagens e estatísticas): a sigla da tabela sem o
// número de pontos na frente ("50 YAM" -> "YAM", "40 S+" -> "S+") e sem o X
// ("X MIN" -> "MIN"; o X só aparece na tabela). O primeiro bloco fica como na
// tabela ("2 / 1", "4 / 2"...).
function siglaDaCasa(linha) {
  return linha <= 5 ? rows[linha] : rows[linha].replace(/^(\d+|X)\s+/, "");
}

const partidaEstaCompleta = valores =>
  LINHAS_JOGO.every(l => [0, 1, 2, 3].every(col => (valores[`${l}-${col}`] ?? "") !== ""));

function elemento(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function bloco(titulo, subtitulo) {
  const b = elemento("div", "bloco");
  b.appendChild(elemento("h2", "", titulo));
  if (subtitulo) b.appendChild(elemento("p", "subtitulo", subtitulo));
  return b;
}

function abrirEstatisticas() {
  const area = document.getElementById("estatisticas");
  area.innerHTML = "";

  if (historico.length === 0) {
    area.appendChild(elemento("p", "vazio", "Ainda não há partidas salvas. Termine uma partida para ver suas estatísticas aqui."));
    mostrarTela("tela-estatisticas");
    return;
  }

  // só partidas completas: as abandonadas no meio distorcem totais e médias
  const cronologico = [...historico].sort((a, b) => a.data.localeCompare(b.data));
  const completas = cronologico.filter(p => partidaEstaCompleta(p.valores));
  const fora = cronologico.length - completas.length;
  const aviso = fora === 0 ? "" :
    `Considerando as ${completas.length} partidas completas (${fora} incompleta${fora === 1 ? "" : "s"} não entra${fora === 1 ? "" : "m"}).`;

  if (completas.length === 0) {
    area.appendChild(elemento("p", "vazio", "As estatísticas aparecem quando houver uma partida completa salva."));
    mostrarTela("tela-estatisticas");
    return;
  }

  const totais = completas.map(p => p.total);
  const media = Math.round(totais.reduce((a, b) => a + b, 0) / totais.length);

  // números principais
  const numeros = elemento("div", "numeros-estat");
  [["partidas", totais.length], ["média", media], ["recorde", Math.max(...totais)], ["menor", Math.min(...totais)]]
    .forEach(([rotulo, valor]) => {
      const tile = elemento("div", "tile");
      tile.appendChild(elemento("span", "", String(valor)));
      tile.appendChild(elemento("small", "", rotulo));
      numeros.appendChild(tile);
    });
  area.appendChild(numeros);
  if (aviso) area.appendChild(elemento("p", "aviso-estat", aviso));

  // evolução
  const evolucao = bloco("Evolução dos pontos", "Total de cada partida, da mais antiga à mais recente. Toque num ponto para ver.");
  if (completas.length < 2) {
    evolucao.appendChild(elemento("p", "vazio", "Jogue mais uma partida para ver a evolução."));
  } else {
    evolucao.appendChild(graficoEvolucao(completas));
  }
  area.appendChild(evolucao);

  // média por coluna
  const porColuna = bloco("Média por coluna");
  const mediasCol = [0, 1, 2, 3].map(col =>
    Math.round(completas.reduce((s, p) => s + calcularTotais(p.valores).calculados[`17-${col}`], 0) / completas.length));
  porColuna.appendChild(barras(["↓ Descida", "↑ Subida", "D Desordem", "S Seca"], mediasCol));
  area.appendChild(porColuna);

  // destaques
  const destaques = bloco("Destaques");
  const lista = elemento("ul", "destaques");
  const colunasTotal = completas.length * 4;
  const comBonus = completas.reduce((s, p) => {
    const c = calcularTotais(p.valores).calculados;
    return s + [0, 1, 2, 3].filter(col => c[`7-${col}`] > 0).length;
  }, 0);
  const yams = completas.reduce((s, p) => s + [0, 1, 2, 3].filter(col => Number(p.valores[`15-${col}`]) > 0).length, 0);
  const partidasComYam = completas.filter(p => [0, 1, 2, 3].some(col => Number(p.valores[`15-${col}`]) > 0)).length;
  const pct = (a, b) => Math.round((100 * a) / b);

  const itens = [];
  const emSala = completas.filter(p => p.sala);
  if (emSala.length) {
    const vitorias = emSala.filter(p => p.sala.posicao === 1).length;
    const podios = emSala.filter(p => p.sala.posicao <= 3).length;
    itens.push(["🏆", `${vitorias} vitória${vitorias === 1 ? "" : "s"} em sala`,
      `em ${emSala.length} partida${emSala.length === 1 ? "" : "s"} em sala · ${podios} pódio${podios === 1 ? "" : "s"}`]);
  }
  itens.push(
    ["🎯", `Bônus em ${pct(comBonus, colunasTotal)}% das colunas`, `${comBonus} de ${colunasTotal}`],
    ["🎲", `${yams} YAM${yams === 1 ? "" : "s"} feitos`, `em ${partidasComYam} de ${completas.length} partidas`],
  );

  // jogadas mais riscadas
  const riscos = LINHAS_JOGO.map(l => ({
    linha: l,
    vezes: completas.reduce((s, p) => s + [0, 1, 2, 3].filter(col => Number(p.valores[`${l}-${col}`]) === 0).length, 0)
  })).sort((a, b) => b.vezes - a.vezes).filter(r => r.vezes > 0).slice(0, 3);
  if (riscos.length) {
    itens.push(["✖️", "Mais riscadas", riscos.map(r => `${siglaDaCasa(r.linha)} (${pct(r.vezes, colunasTotal)}%)`).join(" · ")]);
  }

  itens.forEach(([icone, titulo, detalhe]) => {
    const li = elemento("li");
    li.appendChild(elemento("span", "icone", icone));
    const texto = elemento("div");
    texto.appendChild(elemento("strong", "", titulo));
    texto.appendChild(elemento("small", "", detalhe));
    li.appendChild(texto);
    lista.appendChild(li);
  });
  destaques.appendChild(lista);
  area.appendChild(destaques);

  mostrarTela("tela-estatisticas");
}

// Gráfico de linha (uma série) em SVG, com marcador do recorde e toque para ver cada ponto.
function graficoEvolucao(partidas) {
  const NS = "http://www.w3.org/2000/svg";
  const W = 340, H = 190, M = { cima: 22, baixo: 22, esq: 38, dir: 14 };
  const totais = partidas.map(p => p.total);
  let min = Math.min(...totais), max = Math.max(...totais);
  if (min === max) { min -= 10; max += 10; }
  const folga = (max - min) * 0.1;
  min = Math.max(0, Math.floor((min - folga) / 10) * 10);
  max = Math.ceil((max + folga) / 10) * 10;

  const x = i => M.esq + (i * (W - M.esq - M.dir)) / (partidas.length - 1);
  const y = v => M.cima + ((max - v) * (H - M.cima - M.baixo)) / (max - min);

  const caixa = elemento("div", "grafico");
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Evolução dos pontos em ${partidas.length} partidas`);
  const novo = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.appendChild(el);
    return el;
  };

  // grade: 3 linhas com os valores
  for (let i = 0; i <= 2; i++) {
    const v = Math.round(min + ((max - min) * i) / 2);
    novo("line", { x1: M.esq, x2: W - M.dir, y1: y(v), y2: y(v), class: "grade" });
    const t = novo("text", { x: M.esq - 6, y: y(v) + 4, class: "eixo", "text-anchor": "end" });
    t.textContent = v;
  }

  // área suave + linha
  const pontos = partidas.map((p, i) => `${x(i)},${y(p.total)}`);
  novo("polygon", { points: `${M.esq},${y(min)} ${pontos.join(" ")} ${x(partidas.length - 1)},${y(min)}`, class: "area" });
  novo("polyline", { points: pontos.join(" "), class: "linha" });

  // pontos (o recorde em destaque, com rótulo)
  const recorde = Math.max(...totais);
  const iRecorde = totais.lastIndexOf(recorde);
  partidas.forEach((p, i) => {
    novo("circle", { cx: x(i), cy: y(p.total), r: i === iRecorde ? 6 : 4, class: i === iRecorde ? "ponto recorde" : "ponto" });
  });
  const rotulo = novo("text", {
    x: Math.min(Math.max(x(iRecorde), M.esq + 30), W - M.dir - 30), y: y(recorde) - 10,
    class: "rotulo-recorde", "text-anchor": "middle"
  });
  rotulo.textContent = `⭐ ${recorde}`;

  // dica ao tocar
  const dica = elemento("div", "dica-grafico");
  dica.hidden = true;
  partidas.forEach((p, i) => {
    const alvo = novo("circle", { cx: x(i), cy: y(p.total), r: 14, class: "alvo" });
    const mostrar = () => {
      dica.textContent = `${new Date(p.data).toLocaleDateString("pt-BR")} · ${p.total} pts`;
      dica.style.left = `${(100 * x(i)) / W}%`;
      dica.style.top = `${(100 * y(p.total)) / H}%`;
      dica.hidden = false;
    };
    alvo.addEventListener("pointerenter", mostrar);
    alvo.addEventListener("click", mostrar);
  });
  svg.addEventListener("pointerleave", () => { dica.hidden = true; });

  caixa.append(svg, dica);
  return caixa;
}

// Barras horizontais simples, com o valor no fim de cada uma.
function barras(rotulos, valores) {
  const maior = Math.max(...valores, 1);
  const lista = elemento("div", "barras");
  rotulos.forEach((rotulo, i) => {
    const linha = elemento("div", "barra-linha");
    linha.appendChild(elemento("span", "barra-rotulo", rotulo));
    const trilho = elemento("div", "barra-trilho");
    const barra = elemento("div", "barra-cheia");
    barra.style.width = `${(100 * valores[i]) / maior}%`;
    trilho.appendChild(barra);
    linha.appendChild(trilho);
    linha.appendChild(elemento("span", "barra-valor", String(valores[i])));
    lista.appendChild(linha);
  });
  return lista;
}

// ---------- desfazer ----------

const CHAVE_JOGADAS = "yam-jogadas";
const MAX_JOGADAS = 30;
let jogadas = ler(CHAVE_JOGADAS, []);  // [{ key, antes }], a última no fim

// Guarda o que a casa tinha antes da mudança. `depois` evita registrar
// quando nada mudou (ex.: tocou e saiu sem alterar).
function registrarJogada(key, antes, depois = "") {
  if ((antes ?? "") === (depois ?? "")) return;
  dadosParaNovaVez = true; // anotou na tabela: os dados começam uma vez nova
  jogadas.push({ key, antes: antes ?? "" });
  if (jogadas.length > MAX_JOGADAS) jogadas.shift();
  localStorage.setItem(CHAVE_JOGADAS, JSON.stringify(jogadas));
  atualizarBotaoDesfazer();
}

function limparJogadas() {
  jogadas = [];
  localStorage.removeItem(CHAVE_JOGADAS);
  atualizarBotaoDesfazer();
}

function atualizarBotaoDesfazer() {
  document.getElementById("botao-desfazer").disabled = jogadas.length === 0;
}

const NOMES_COLUNAS = ["descida (↓)", "subida (↑)", "coluna D", "coluna S"];

function desfazer() {
  const jogada = jogadas.pop();
  if (!jogada) return;
  localStorage.setItem(CHAVE_JOGADAS, JSON.stringify(jogadas));

  const desfeito = state[jogada.key] ?? "";
  if (jogada.antes === "") delete state[jogada.key];
  else state[jogada.key] = jogada.antes;
  salvar();
  buildTable();
  avisarSala();
  atualizarBotaoDesfazer();

  // se a partida já tinha sido salva ao terminar, mantém o histórico em dia
  if (entradaDaPartidaAtual() && partidaCompleta()) salvarPartidaAtual();

  const [linha, col] = jogada.key.split("-").map(Number);
  const de = exibir(desfeito) || "vazia";
  const para = exibir(jogada.antes) || "vazia";
  ultimoAviso = Date.now();
  mostrarLegenda(["Desfeito", `${siglaDaCasa(linha)} na ${NOMES_COLUNAS[col]}: ${de} → ${para}.`]);
  piscarCasa(jogada.key);
}

// ---------- nome do jogador ----------

const CHAVE_NOME = "yam-nome";
const TAMANHO_MAX_NOME = 20;
let nomeJogador = ler(CHAVE_NOME, "");

function mostrarNome() {
  const botao = document.getElementById("botao-nome");
  botao.textContent = nomeJogador ? `👤 ${nomeJogador}` : "👤 Seu nome";
  botao.classList.toggle("sem-nome", !nomeJogador);
}

// Abre a janelinha para digitar o nome.
function editarNome() {
  if (window.familia && familia.ativa()) {
    avisar("Para trocar o nome, saia da sala primeiro.", "Você está numa sala");
    return;
  }
  const campo = document.getElementById("campo-nome");
  campo.value = nomeJogador;
  document.getElementById("janela-nome").hidden = false;
  campo.focus();
  campo.select();
}

// Usado pela partida em família ao entrar com um nome.
function definirNome(nome) {
  nomeJogador = nome;
  localStorage.setItem(CHAVE_NOME, JSON.stringify(nomeJogador));
  mostrarNome();
}

function fecharJanelaNome() {
  document.getElementById("janela-nome").hidden = true;
}

function salvarNome(evento) {
  evento.preventDefault();
  const digitado = document.getElementById("campo-nome").value;
  nomeJogador = digitado.trim().replace(/\s+/g, " ").slice(0, TAMANHO_MAX_NOME);
  if (nomeJogador) localStorage.setItem(CHAVE_NOME, JSON.stringify(nomeJogador));
  else localStorage.removeItem(CHAVE_NOME);
  mostrarNome();
  fecharJanelaNome();
}

// ---------- tema claro / escuro ----------

const sistemaEscuro = window.matchMedia("(prefers-color-scheme: dark)");

function temaAtual() {
  const escolhido = document.documentElement.dataset.theme;
  if (escolhido === "light" || escolhido === "dark") return escolhido;
  return sistemaEscuro.matches ? "dark" : "light";
}

function atualizarBotaoTema() {
  const escuro = temaAtual() === "dark";
  document.getElementById("botao-tema").setAttribute("aria-checked", escuro);
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.content = escuro ? "#121212" : "#1f3a5f";
  });
}

function alternarTema() {
  const novo = temaAtual() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = novo;
  try { localStorage.setItem("yam-tema", novo); } catch {}
  atualizarBotaoTema();
}

sistemaEscuro.addEventListener("change", atualizarBotaoTema);
atualizarBotaoTema();
atualizarBotaoDesfazer();
mostrarNome();

// O total guardado de cada partida é sempre refeito a partir da tabela dela,
// para nunca ficar diferente do TOTAL GERAL mostrado ao abrir a partida.
function recalcularTotaisHistorico() {
  let mudou = false;
  for (const p of historico) {
    const total = calcularTotais(p.valores || {}).geral;
    if (p.total !== total) { p.total = total; mudou = true; }
  }
  if (mudou) salvarHistorico();
}
recalcularTotaisHistorico();

// ---------- backup do histórico ----------

const CHAVE_ULTIMO_BACKUP = "yam-ultimo-backup";

function mostrarUltimoBackup() {
  const quando = ler(CHAVE_ULTIMO_BACKUP, null);
  document.getElementById("ultimo-backup").textContent =
    quando ? `Último backup exportado: ${formatarData(quando)}` : "Nenhum backup exportado ainda.";
}

// Gera o arquivo de backup (histórico + partida em andamento) e oferece para
// compartilhar (WhatsApp, e-mail, Arquivos...) ou baixar.
async function exportarHistorico() {
  const agora = new Date();
  const dados = {
    app: "yam",
    versao: 1,
    exportadoEm: agora.toISOString(),
    historico,
    partidaAtual: state
  };
  const nome = `yam-backup-${agora.toISOString().slice(0, 10)}.json`;
  const arquivo = new File([JSON.stringify(dados, null, 2)], nome, { type: "application/json" });

  try {
    if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
      await navigator.share({ files: [arquivo], title: "Backup do YAM" });
    } else {
      const url = URL.createObjectURL(arquivo);
      const link = document.createElement("a");
      link.href = url;
      link.download = nome;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (erro) {
    if (erro && erro.name === "AbortError") return; // a pessoa cancelou o compartilhamento
    avisar("Não foi possível exportar o backup. Tente de novo.");
    return;
  }

  localStorage.setItem(CHAVE_ULTIMO_BACKUP, JSON.stringify(agora.toISOString()));
  mostrarUltimoBackup();
}

function partidaValida(p) {
  return p && typeof p.id === "number" && typeof p.data === "string" &&
    typeof p.total === "number" && p.valores && typeof p.valores === "object";
}

// Lê um arquivo de backup e junta as partidas com as que já estão aqui
// (não apaga nem duplica nada).
async function importarHistorico(campo) {
  const arquivo = campo.files[0];
  campo.value = "";
  if (!arquivo) return;

  let dados;
  try {
    dados = JSON.parse(await arquivo.text());
  } catch {
    avisar("Escolha o arquivo .json exportado pelo botão Exportar.", "Esse arquivo não é um backup do YAM");
    return;
  }

  const lista = Array.isArray(dados) ? dados : dados && dados.historico;
  if (!Array.isArray(lista) || !lista.every(partidaValida)) {
    avisar("Escolha o arquivo .json exportado pelo botão Exportar.", "Esse arquivo não é um backup do YAM");
    return;
  }

  const ids = new Set(historico.map(p => p.id));
  const novas = lista.filter(p => !ids.has(p.id));
  const quando = dados.exportadoEm ? ` de ${formatarData(dados.exportadoEm)}` : "";

  if (novas.length === 0) {
    avisar(`Todas as ${lista.length} partidas desse backup${quando} já estão neste celular.`, "Nada novo para importar");
    return;
  }
  if (!await confirmar("Importar backup?",
    `${novas.length} partida${novas.length === 1 ? "" : "s"} do backup${quando} entra${novas.length === 1 ? "" : "m"} no histórico. As que já estão aqui continuam.`,
    "Importar")) return;

  historico = [...historico, ...novas].sort((a, b) => b.data.localeCompare(a.data));
  recalcularTotaisHistorico();
  salvarHistorico();
  abrirHistorico();
  avisar(`${novas.length} partida${novas.length === 1 ? "" : "s"} importada${novas.length === 1 ? "" : "s"}.`, "Pronto!");
}

// Link de convite: abre em "Como jogar" (também se o app já estava aberto)
function verificarLinkRegras() {
  if (location.hash !== "#como-jogar") return;
  history.replaceState(null, "", location.pathname);
  abrirRegras();
}
window.addEventListener("hashchange", verificarLinkRegras);
setTimeout(verificarLinkRegras, 0);

// ---------- dados virtuais ----------
// 5 dados, até 3 jogadas por vez; entre as jogadas, toque num dado para segurá-lo.

const mesa = { valores: [1, 2, 3, 4, 5], segurados: [false, false, false, false, false], jogada: 0 };
let dadosParaNovaVez = false;
let rolandoDados = false;
const PONTOS_DO_DADO = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function sortearFace() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return 1 + (n[0] % 6);
}

function abrirDados() {
  if (dadosParaNovaVez) novaVez();
  desenharDados();
  document.getElementById("janela-dados").hidden = false;
}

function fecharDados() {
  document.getElementById("janela-dados").hidden = true;
}

function novaVez() {
  mesa.jogada = 0;
  mesa.segurados = [false, false, false, false, false];
  dadosParaNovaVez = false;
  desenharDados();
}

function segurarDado(i) {
  if (rolandoDados || mesa.jogada === 0 || mesa.jogada >= 3) return;
  mesa.segurados[i] = !mesa.segurados[i];
  desenharDados();
}

function rolarDados() {
  if (rolandoDados || mesa.jogada >= 3) return;
  const soltos = [0, 1, 2, 3, 4].filter(i => !mesa.segurados[i]);
  if (soltos.length === 0) return;
  rolandoDados = true;
  dadosParaNovaVez = false;
  mesa.jogada++;
  let passos = 0;
  const animar = setInterval(() => {
    soltos.forEach(i => { mesa.valores[i] = sortearFace(); });
    desenharDados(soltos);
    if (++passos >= 8) {
      clearInterval(animar);
      rolandoDados = false;
      desenharDados();
      if (navigator.vibrate) navigator.vibrate(30);
    }
  }, 60);
}

// O que a jogada atual vale (mesmas regras de valoresPossiveis):
// 1) as combinações que dá para marcar agora na sua tabela; se não der nenhuma,
//    o número com menor risco de perder o bônus e onde marcar;
// 2) a soma (para o MIN e o MAX).
function oQueValem(v) {
  const soma = v.reduce((a, b) => a + b, 0);
  const qtd = [0, 0, 0, 0, 0, 0, 0];
  v.forEach(f => qtd[f]++);
  const combinacoes = []; // [nome, linha, valor]
  const face = n => qtd.findIndex((q, f) => f > 0 && q >= n);
  if (face(5) > 0) combinacoes.push(["YAM", 15, 50 + 5 * face(5)]);
  // Quadra são exatamente 4 iguais: com os 5 iguais vale YAM, número ou MIN/MAX (não Quadra)
  const quadra = qtd.findIndex((q, f) => f > 0 && q === 4);
  if (quadra > 0) combinacoes.push(["Q", 9, 20 + 4 * quadra]);
  if (qtd.includes(3) && qtd.includes(2)) combinacoes.push(["F", 10, 30 + soma]);
  const ordenados = [...v].sort().join("");
  if (ordenados === "12345") combinacoes.push(["S-", 11, 50]);
  if (ordenados === "23456") combinacoes.push(["S+", 12, 60]);

  const linhas = [];
  const marcaveis = combinacoes.filter(([, linha, valor]) => colunasLivres(linha, valor).length > 0);
  if (marcaveis.length) {
    linhas.push(marcaveis.map(([nome, , valor]) => `${nome} ${valor}`).join(" · "));
  } else {
    const s = sugestaoDeNumero(qtd);
    if (s) {
      linhas.push(`${["", "Um", "Dois", "Três", "Quatro", "Cinco"][qtd[s.face]]} ${s.face} → ${s.valor}, na ${NOMES_COLUNAS[s.col]}` +
        (s.garante ? " (garante o bônus)" : ""));
    }
  }
  linhas.push(`Soma dos dados: ${soma}`);
  return linhas.join("\n");
}

// Colunas onde dá para marcar `valor` na linha agora: casa vazia, na ordem da
// descida/subida, MIN < MAX, e a Seca (S) só na 1ª jogada.
function colunasLivres(linha, valor) {
  return [0, 1, 2, 3].filter(col =>
    !preenchida(linha, col) &&
    (col !== 3 || mesa.jogada === 1) &&
    validar(`${linha}-${col}`, String(valor)) === null);
}

// Referência de cada número (soma 60): com ela em todas as linhas, o bônus sai certinho.
const REFERENCIA_BONUS = [2, 4, 9, 12, 15, 18];

// Quanto marcar `valor` na linha (1 a 6) da coluna arrisca o bônus de +30.
// nivel: -1 garante o bônus, 0 nada a perder (já garantido ou já perdido),
// 1 continua em dia com a referência, 2 fica atrás dela, 3 perde o bônus.
// folga: quanto fica acima (+) ou abaixo (-) da referência.
function riscoParaOBonus(linha, col, valor) {
  const total1 = somaColuna(state, col, 0, 5);
  const outras = [0, 1, 2, 3, 4, 5].filter(l => l !== linha && !preenchida(l, col));
  const maximo = outras.reduce((s, l) => s + 5 * (l + 1), 0);
  if (total1 >= META_BONUS || total1 + maximo + 5 * (linha + 1) < META_BONUS) return { nivel: 0, folga: 0 };
  const depois = total1 + valor;
  if (depois >= META_BONUS) return { nivel: -1, folga: 0 };
  if (depois + maximo < META_BONUS) return { nivel: 3, folga: depois + maximo - META_BONUS };
  const folga = depois + outras.reduce((s, l) => s + REFERENCIA_BONUS[l], 0) - META_BONUS;
  return { nivel: folga >= 0 ? 1 : 2, folga };
}

// Melhor lugar para os números desta jogada: menor risco para o bônus; no
// empate, o que fica mais perto da referência da linha, e depois mais pontos.
function sugestaoDeNumero(qtd) {
  let melhor = null;
  for (let face = 1; face <= 6; face++) {
    if (!qtd[face]) continue;
    const linha = face - 1;
    const valor = face * qtd[face];
    for (const col of colunasLivres(linha, valor)) {
      const { nivel, folga } = riscoParaOBonus(linha, col, valor);
      const nota = [nivel, -folga, REFERENCIA_BONUS[linha] - valor, -valor]; // menor é melhor
      const menor = melhor && nota.findIndex((n, i) => n !== melhor.nota[i]);
      if (!melhor || (menor >= 0 && nota[menor] < melhor.nota[menor])) {
        melhor = { face, valor, col, nota, garante: nivel === -1 };
      }
    }
  }
  return melhor;
}

function desenharDados(rolando = []) {
  const area = document.getElementById("dados-mesa");
  area.innerHTML = "";
  mesa.valores.forEach((valor, i) => {
    const dado = document.createElement("button");
    dado.className = "dado";
    if (mesa.segurados[i]) dado.classList.add("segurado");
    if (rolando.includes(i)) dado.classList.add("rolando");
    if (mesa.jogada === 0) dado.classList.add("parado");
    dado.setAttribute("aria-label", `Dado ${valor}${mesa.segurados[i] ? ", segurado" : ""}`);
    for (let p = 0; p < 9; p++) {
      const ponto = document.createElement("i");
      if (PONTOS_DO_DADO[valor].includes(p)) ponto.className = "on";
      dado.appendChild(ponto);
    }
    dado.onclick = () => segurarDado(i);
    area.appendChild(dado);
  });

  const status = document.getElementById("dados-status");
  const botao = document.getElementById("dados-rolar");
  const valem = document.getElementById("dados-valem");
  if (mesa.jogada === 0) {
    status.textContent = "Toque em Rolar para começar a sua vez.";
    botao.textContent = "🎲 Rolar";
    valem.textContent = "";
  } else {
    status.textContent = mesa.jogada === 1
      ? "1ª jogada (vale para a S – Seca). Toque nos dados que quer segurar."
      : mesa.jogada < 3
        ? `${mesa.jogada}ª jogada de 3. Toque nos dados que quer segurar.`
        : "3ª jogada: agora é anotar na tabela.";
    botao.textContent = mesa.jogada < 3 ? `🎲 Rolar (${mesa.jogada + 1}ª)` : "Fim da vez";
    valem.textContent = rolando.length ? "" : oQueValem(mesa.valores);
  }
  botao.disabled = mesa.jogada >= 3 || rolandoDados || mesa.segurados.every(Boolean);
  document.getElementById("dados-nova-vez").hidden = mesa.jogada === 0;
}

// ---------- sem zoom no toque duplo ----------
// O CSS (touch-action) não basta em todo lugar, principalmente no iPhone: um
// 2º toque rápido no mesmo ponto ainda dava zoom. Aqui esse 2º toque vira um
// clique normal, sem zoom. Campos de digitar ficam de fora (não dão zoom: letra
// de 16px ou mais), e arrastar ou usar dois dedos (rolar, ampliar) não muda nada.
let ultimoToque = 0;
let inicioDoToque = null;

document.addEventListener("touchstart", evento => {
  const t = evento.touches;
  inicioDoToque = t.length === 1 ? { x: t[0].clientX, y: t[0].clientY } : null;
}, { passive: true });

document.addEventListener("touchend", evento => {
  const t = evento.changedTouches[0];
  const parado = inicioDoToque && t && evento.touches.length === 0 &&
    Math.hypot(t.clientX - inicioDoToque.x, t.clientY - inicioDoToque.y) < 10;
  const agora = Date.now();
  const segundoToque = parado && agora - ultimoToque < 350;
  ultimoToque = parado ? agora : 0;
  const alvo = evento.target;
  if (!segundoToque || !(alvo instanceof Element) || alvo.closest("input, textarea, select")) return;
  evento.preventDefault(); // sem zoom...
  if (typeof alvo.click === "function") alvo.click(); // ...mas o toque conta
  else alvo.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}, { passive: false });

// Pede ao navegador para não apagar os dados do app por falta de espaço ou de uso.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}

buildTable();
