const rows = [
  "2 / 1","4 / 2","9 / 3","12 / 4","15 / 5","18 / 6",
  "1º TOTAL","BÔNUS +30","2º TOTAL",
  "20 Q","30 F","35 S-","40 S+","X MIN","X MAX","50 YAM",
  "3º TOTAL",
  "2º + 3º TOTAL"
];
const COLUNAS = 4;

// Versão do app: igual ao número do CACHE_NAME do service-worker.js (um teste confere).
const VERSAO = 57;

// Avisos da vez com o app fechado: servidor na Cloudflare (worker/avisos.mjs).
// Sem o endereço, a opção "Avisar a minha vez" não aparece.
const AVISOS_URL = "https://yam-avisos.jogo-yam.workers.dev";
const VAPID_PUBLICA = "BKjDTbSOlrqKGROPZ2HkxqcPXUbsumI8DfVP0UUX8HW4CW1ApDoFGLLLoe9ahWpei0TeakpD7x9puO8hOn9aspM"; // a mesma do worker/wrangler.toml

// Ícone desenhado (o mesmo em todo celular, ao contrário dos emojis).
function icone(nome, classe = "") {
  return `<svg class="icone${classe ? " " + classe : ""}" aria-hidden="true"><use href="#i-${nome}"/></svg>`;
}

// Dadinho desenhado com os pontos da face (barra de marcar).
function dadoMini(face, segurado = false) {
  const pontos = PONTOS_DO_DADO[face].map(p =>
    `<circle cx="${5.5 + (p % 3) * 6.5}" cy="${5.5 + Math.floor(p / 3) * 6.5}" r="2"/>`).join("");
  return `<svg class="dado-mini${segurado ? " segurado" : ""}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<rect x="1" y="1" width="22" height="22" rx="5"/>${pontos}</svg>`;
}

// Partidas antigas guardaram o título do pódio com o emoji 🏆 na frente.
const semTrofeu = texto => String(texto).replace(/^🏆\s*/u, "");

// Põe ícone + texto num botão (o texto entra como texto, nunca como HTML).
function rotular(botao, nome, texto) {
  botao.innerHTML = icone(nome);
  if (texto) botao.append(texto);
}

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
  "Jogada": ["Jogada", "Nome de cada jogada. Toque em uma linha para ver o que ela significa."],
  "↓": ["↓ – Descida", "Preencha de cima para baixo, na ordem. A casa da vez fica destacada. Para riscar, digite 0 (aparece —): pode em qualquer casa; nas casas fora da vez, use o botão “Riscar esta casa”."],
  "↑": ["↑ – Subida", "Começa depois de terminar a descida, de baixo para cima, na ordem. Para riscar, digite 0 (aparece —): pode em qualquer casa."],
  "D": ["D – Desordem", "Preencha em qualquer ordem."],
  "S": ["S – Seco", "Vale só o que sair na primeira jogada dos dados."]
};

let timerLegenda = null;
let ultimoAviso = 0;

// tipo: "" (legenda), "aviso" (casa fora da vez) ou "erro" (valor recusado).
// acao (opcional): { texto, fazer } mostra um botão dentro da caixa.
function mostrarLegenda([titulo, texto], tipo = "", acao = null) {
  const caixa = document.getElementById("legenda");
  if (tipo === "festa") rotular(caixa.querySelector("strong"), "festa", titulo);
  else caixa.querySelector("strong").textContent = titulo;
  caixa.querySelector("span").textContent = texto;
  const botao = caixa.querySelector("button");
  botao.hidden = !acao;
  botao.onclick = acao ? () => { caixa.hidden = true; acao.fazer(); } : null;
  if (acao) botao.textContent = acao.texto;
  caixa.classList.toggle("erro", tipo === "erro");
  caixa.classList.toggle("aviso", tipo === "aviso");
  caixa.classList.toggle("festa", tipo === "festa");
  caixa.hidden = false;
  clearTimeout(timerLegenda);
  timerLegenda = setTimeout(() => { caixa.hidden = true; }, tipo === "festa" ? 4000 : (tipo || acao) ? 7000 : 5000);
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
        // sala com vez: só digita quem está na vez (conferido ao tocar e ao digitar,
        // caso a casa já estivesse selecionada quando a vez mudou)
        let liberado = false;

        input.addEventListener("focus", () => {
          antes = state[key] ?? "";
          liberado = podeJogarAgora() && podeDigitarNaCasa(antes);
          if (!liberado) { input.blur(); return; }
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

        input.addEventListener("blur", () => { liberado = false; });

        input.addEventListener("input", () => {
          if (!liberado && !(liberado = podeJogarAgora() && podeDigitarNaCasa(state[key] ?? ""))) {
            input.value = exibir(state[key] ?? "");
            input.blur();
            return;
          }
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
          if (numero !== antes) {
            vibrar(15);
            tocar("marcar");
            comemorarJogada(key, antes, numero);
          }
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

// Linhas que cada total soma: enquanto nenhuma delas tem jogada, o total
// aparece apagado ("–") em vez de um monte de zeros.
const ORIGEM_DO_TOTAL = {
  6: [0, 5], 7: [0, 5], 8: [0, 5], 16: [9, 15], 17: [0, 15]
};

function totalSemJogada(valores, linha, col) {
  const [inicio, fim] = ORIGEM_DO_TOTAL[linha];
  for (let l = inicio; l <= fim; l++) {
    if (!ehLinhaCalculada(rows[l]) && (valores[`${l}-${col}`] ?? "") !== "") return false;
  }
  return true;
}

function atualizarTotais(tbody, totalCell, valores) {
  const { calculados, geral } = calcularTotais(valores);
  for (const [key, valor] of Object.entries(calculados)) {
    const [linha, col] = key.split("-").map(Number);
    const td = tbody.querySelector(`[data-key="${key}"]`);
    const vazio = totalSemJogada(valores, linha, col);
    td.classList.toggle("total-vazio", vazio);
    td.textContent = vazio ? "–" : valor;
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
    const comecou = [0, 1, 2, 3, 4, 5].some(l => (valores[`${l}-${col}`] ?? "") !== "");
    if (!situacao || !comecou) continue;
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
  if (typeof sairDoModoMarcar === "function") sairDoModoMarcar();
  montarTabela(body, state, true);
  calcular();
}

function calcular() {
  atualizarTotais(body, totalGeral, state);
  marcarProximas();
  atualizarBotaoNovoJogo();
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

// Botão "Jogar em sala": pergunta se a pessoa quer criar ou entrar numa sala.
function escolherSala(modo) {
  if (!modo) {
    document.getElementById("janela-sala").hidden = false;
    return;
  }
  fecharEscolhaSala();
  abrirFamilia(modo);
}

function fecharEscolhaSala() {
  document.getElementById("janela-sala").hidden = true;
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
    : vencedores.length === 1 ? `${vencedores[0]} venceu!`
    : `Empate: ${vencedores.join(" e ")}!`;
}

// p.terminaram: [{ nome, total, posicao, eu?, valores? }] do 1º ao último;
// p.naoTerminaram: [{ nome, eu? }]. verTabela(j) diz o que fazer ao tocar num nome.
function desenharPodio(p, verTabela, partidaDoHistorico = null) {
  const el = id => document.getElementById(id);
  podioNaTela = p;
  podioDoHistorico = partidaDoHistorico;
  const nomeCom = j => j.eu ? `${j.nome} (você)` : j.nome;
  const podeVer = j => j.valores && typeof j.valores === "object";

  const titulo = semTrofeu(p.titulo);
  if (titulo === "Partida encerrada") el("podio-titulo").textContent = titulo;
  else rotular(el("podio-titulo"), "trofeu", titulo);
  el("podio-data").textContent = partidaDoHistorico ? formatarData(partidaDoHistorico.data) : "";
  el("podio-data").hidden = !partidaDoHistorico;

  // degraus: 2º à esquerda, 1º no meio, 3º à direita
  const degraus = el("podio-degraus");
  degraus.innerHTML = "";
  const medalhas = { 1: "ouro", 2: "prata", 3: "bronze" };
  [1, 0, 2].forEach(i => {
    const j = p.terminaram[i];
    const coluna = document.createElement("div");
    coluna.className = `degrau degrau-${i + 1}`;
    if (j) {
      const medalha = document.createElement("div");
      medalha.className = `medalha ${medalhas[j.posicao] || ""}`;
      medalha.textContent = j.posicao;
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
async function gerarImagemPodio(p, dataIso) {
  await fonteCarregada();
  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const fonte = (peso, tam) => `${peso} ${tam}px "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
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
  ctx.fillText(caber(ctx, semTrofeu(p.titulo), W - 100), W / 2, 330 + desce);

  // degraus: 2º à esquerda, 1º no meio, 3º à direita
  const alturas = { 1: 360, 2: 260, 3: 190 };
  const CORES_MEDALHA = { 1: "#e0a800", 2: "#9aa4ad", 3: "#c27a3a" };
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
    if (CORES_MEDALHA[j.posicao]) {
      ctx.fillStyle = CORES_MEDALHA[j.posicao];
      ctx.beginPath();
      ctx.arc(x + larg / 2, topo - 190, 44, 0, 2 * Math.PI);
      ctx.fill();
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.beginPath();
      ctx.arc(x + larg / 2, topo - 190, 34, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = fonte(800, 48);
      ctx.fillText(String(j.posicao), x + larg / 2, topo - 188);
    }
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

// "Você venceu (sala de 4)" / "Maria venceu · você ficou em 2º" (com o troféu na frente)
function textoDaSala(sala) {
  if (!sala) return "";
  const outros = sala.vencedores.filter(n => n !== sala.meuNome);
  if (sala.posicao === 1) {
    return outros.length
      ? `Empate em 1º com ${outros.join(" e ")}`
      : `Você venceu (sala de ${sala.jogadores})`;
  }
  return `${sala.vencedores.join(" e ")} venceu · você ficou em ${sala.posicao}º`;
}

function mostrarTextoDaSala(el, sala) {
  el.textContent = textoDaSala(sala);
  if (sala) el.insertAdjacentHTML("afterbegin", icone("trofeu"));
}

function mostrarFimDeJogo(recordeAnterior) {
  const { calculados, geral } = calcularTotais(state);
  const primeira = recordeAnterior === null;
  const novoRecorde = !primeira && geral > recordeAnterior;

  document.getElementById("fim-titulo").textContent = nomeJogador ? `Fim de jogo, ${nomeJogador}!` : "Fim de jogo!";
  document.getElementById("fim-total").textContent = geral;
  const textoRecorde = document.getElementById("fim-recorde");
  textoRecorde.textContent =
    primeira ? "Sua primeira partida salva!"
    : novoRecorde ? `Novo recorde! (o anterior era ${recordeAnterior})`
    : geral === recordeAnterior ? `Igualou seu recorde de ${recordeAnterior}!`
    : `Seu recorde é ${recordeAnterior}.`;
  document.getElementById("fim-colunas").textContent =
    ["↓", "↑", "D", "S"].map((c, col) => `${c} ${calculados[`17-${col}`]}`).join("  ·  ");

  if (primeira) textoRecorde.insertAdjacentHTML("afterbegin", icone("festa"));
  if (novoRecorde) textoRecorde.insertAdjacentHTML("afterbegin", icone("trofeu"));

  ultimoResultado = { valores: { ...state }, total: geral, data: new Date().toISOString(), novoRecorde };

  const caixa = document.getElementById("fim-de-jogo");
  caixa.classList.toggle("recorde", novoRecorde);
  caixa.hidden = false;
  document.getElementById("legenda").hidden = true;
  if (novoRecorde) {
    soltarConfete();
    tocar("podio");
  }
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
async function gerarImagemResultado(valores, total, dataIso, selo, nome = "") {
  await fonteCarregada();
  const { calculados } = calcularTotais(valores);
  const bonus = [0, 1, 2, 3].filter(col => calculados[`7-${col}`] > 0).length;
  const yams = [0, 1, 2, 3].filter(col => Number(valores[`15-${col}`]) > 0).length;
  const data = new Date(dataIso).toLocaleDateString("pt-BR");

  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  const fonte = (peso, tam) => `${peso} ${tam}px "Nunito", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
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
  const blob = await gerarImagemResultado(r.valores, r.total, r.data, r.novoRecorde ? "Novo recorde!" : "", nomeJogador);
  await compartilharImagem(blob, r.data);
}

async function compartilharPartidaAberta() {
  if (!partidaAberta) return;
  const p = partidaAberta;
  const ehRecorde = historico.length > 1 && p.total === Math.max(...historico.map(h => h.total));
  const blob = await gerarImagemResultado(p.valores, p.total, p.data, ehRecorde ? "Meu recorde!" : "", p.nome || nomeJogador);
  await compartilharImagem(blob, p.data);
}

// Convite para novos jogadores: só o link do app.
// O link do convite abre direto em "Como jogar" (para quem nunca jogou).
const LINK_CONVITE = `${ENDERECO_APP}#bem-vindo`;

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
  novaVez(); // dados de uma partida não passam para a outra
  buildTable();
  fecharFimDeJogo();
}

// Confete simples de comemoração do recorde.
// As imagens compartilhadas usam a fonte do app (espera ela carregar, no máximo 1,5 s).
async function fonteCarregada() {
  try {
    await Promise.race([
      Promise.all([document.fonts.load("800 64px Nunito"), document.fonts.load("400 40px Nunito")]),
      new Promise(r => setTimeout(r, 1500))
    ]);
  } catch {}
}

// Confete caindo pela tela toda (recorde, pódio, YAM, bônus).
let timerConfete = null;
function soltarConfete(quantos = 60) {
  const cores = ["#f2b134", "#3d6ea8", "#ffffff", "#e8604c", "#5cb85c"];
  const area = document.getElementById("confete");
  area.innerHTML = "";
  for (let i = 0; i < quantos; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "%";
    p.style.background = cores[i % cores.length];
    p.style.animationDelay = Math.random() * 0.7 + "s";
    p.style.animationDuration = 1.8 + Math.random() * 1.4 + "s";
    area.appendChild(p);
  }
  clearTimeout(timerConfete);
  timerConfete = setTimeout(() => { area.innerHTML = ""; }, 4200);
}

// Vibração curta (só no Android; o iPhone não deixa sites vibrarem).
function vibrar(padrao) {
  try { if (navigator.vibrate) navigator.vibrate(padrao); } catch {}
}

// Depois de anotar uma casa: comemora um YAM ou a coluna que acabou de
// garantir o bônus de +30.
function comemorarJogada(key, antes, depois) {
  const [linha, col] = key.split("-").map(Number);
  if (!(Number(depois) > 0)) return;
  if (linha === 15) {
    festa(`YAM! +${Number(depois)}`, `Na ${NOMES_COLUNAS[col]}.`);
  } else if (linha <= 5) {
    const tinha = somaColuna({ ...state, [key]: antes }, col, 0, 5);
    if (tinha < META_BONUS && somaColuna(state, col, 0, 5) >= META_BONUS) {
      festa("Bônus +30 garantido!", `Na ${NOMES_COLUNAS[col]}.`);
    }
  }
}

function festa(titulo, texto) {
  mostrarLegenda([titulo, texto], "festa");
  soltarConfete(45);
  vibrar([40, 60, 40, 60, 80]);
  tocar("festa");
}

// Botão de baixo, conforme a situação: numa sala "Sair da sala"; com a partida
// em andamento "Encerrar"; com a tabela vazia ou terminada "Novo jogo".
function situacaoDoJogo() {
  if (window.familia && familia.ativa() && !familia.revelada()) return "sala";
  if (partidaTemValores(state) && !partidaCompleta()) return "andamento";
  return partidaTemValores(state) ? "terminada" : "vazia";
}

function atualizarBotaoNovoJogo() {
  const botao = document.getElementById("botao-novo-jogo");
  const situacao = situacaoDoJogo();
  botao.textContent = { sala: "Sair da sala", andamento: "Encerrar", terminada: "Novo jogo", vazia: "Novo jogo" }[situacao];
  botao.disabled = situacao === "vazia";
}

async function novoJogo() {
  const jaSalva = entradaDaPartidaAtual() !== null;
  const temValores = partidaTemValores(state);
  const situacao = situacaoDoJogo();

  if (situacao === "sala") {
    if (!await confirmar("Sair da sala?",
      "Você sai da sala e fica fora do resultado dela." +
      (temValores && !jaSalva ? " Sua partida vai para o histórico como está e a tabela fica zerada." : ""), "Sair")) return;
    familia.sair();
  } else if (situacao === "andamento") {
    if (!await confirmar("Encerrar a partida?",
      "Ela vai para o histórico como está (incompleta) e a tabela fica zerada.", "Encerrar")) return;
  } else if (situacao === "terminada") {
    if (!await confirmar("Novo jogo", "Começar um novo jogo com a tabela zerada?", "Começar")) return;
  } else {
    return; // tabela vazia: nada para encerrar
  }

  if (temValores) salvarPartidaAtual(); // se já estava salva, só atualiza
  comecarNovaPartida();
}

// ---------- telas ----------

const telas = ["tela-jogo", "tela-historico", "tela-partida", "tela-estatisticas", "tela-regras", "tela-mais"];

// "Como jogar" abre do jogo ou do Mais; o Voltar leva de volta para lá.
let voltarDasRegrasPara = "tela-jogo";

function abrirRegras() {
  const atual = telas.find(id => !document.getElementById(id).hidden);
  voltarDasRegrasPara = atual && atual !== "tela-regras" ? atual : "tela-jogo";
  mostrarTela("tela-regras");
  document.querySelector("#tela-regras .regras").scrollTop = 0;
}

function voltarDasRegras() {
  mostrarTela(voltarDasRegrasPara);
}

// Tela "Mais": nome, tema, como jogar, convidar e backup.
function abrirMais() {
  mostrarUltimoBackup();
  mostrarTela("tela-mais");
  document.querySelector("#tela-mais .mais").scrollTop = 0;
}

function mostrarTela(id) {
  if (id !== "tela-jogo") sairDoModoMarcar();
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
    const vazio = elemento("li", "item-vazio");
    vazio.appendChild(estadoVazio("Nenhuma partida ainda",
      "Quando uma partida termina, ou você toca em Novo Jogo, ela fica guardada aqui."));
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
      if (partida.total === recorde) total.insertAdjacentHTML("beforeend", icone("estrela", "estrela-recorde"));

      const esquerda = elemento("span", "item-info");
      esquerda.appendChild(data);
      if (partida.sala) {
        const infoSala = elemento("small", partida.sala.posicao === 1 ? "sala-info venceu" : "sala-info");
        mostrarTextoDaSala(infoSala, partida.sala);
        esquerda.appendChild(infoSala);
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
  mostrarTextoDaSala(infoSala, partidaAberta.sala);
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

// Tela vazia (Histórico, Estatísticas): dado apagado, título, texto e um atalho para jogar.
function estadoVazio(titulo, texto) {
  const caixa = elemento("div", "estado-vazio");
  caixa.innerHTML = document.querySelector(".logo-dado").outerHTML;
  caixa.appendChild(elemento("h3", "", titulo));
  caixa.appendChild(elemento("p", "", texto));
  const botao = elemento("button", "principal", "Começar a jogar");
  botao.onclick = () => mostrarTela("tela-jogo");
  caixa.appendChild(botao);
  return caixa;
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
    area.appendChild(estadoVazio("Sem estatísticas ainda", "Termine uma partida para ver médias, recordes e destaques."));
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
    area.appendChild(estadoVazio("Falta uma partida completa",
      "As estatísticas usam só partidas terminadas. Termine uma para ver médias, recordes e destaques."));
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
  porColuna.appendChild(barras(["↓ Descida", "↑ Subida", "D Desordem", "S Seco"], mediasCol));
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
    itens.push(["trofeu", `${vitorias} vitória${vitorias === 1 ? "" : "s"} em sala`,
      `em ${emSala.length} partida${emSala.length === 1 ? "" : "s"} em sala · ${podios} pódio${podios === 1 ? "" : "s"}`]);
  }
  itens.push(
    ["alvo", `Bônus em ${pct(comBonus, colunasTotal)}% das colunas`, `${comBonus} de ${colunasTotal}`],
    ["dado", `${yams} YAM${yams === 1 ? "" : "s"} feitos`, `em ${partidasComYam} de ${completas.length} partidas`],
  );

  // jogadas mais riscadas
  const riscos = LINHAS_JOGO.map(l => ({
    linha: l,
    vezes: completas.reduce((s, p) => s + [0, 1, 2, 3].filter(col => Number(p.valores[`${l}-${col}`]) === 0).length, 0)
  })).sort((a, b) => b.vezes - a.vezes).filter(r => r.vezes > 0).slice(0, 3);
  if (riscos.length) {
    itens.push(["riscar", "Mais riscadas", riscos.map(r => `${siglaDaCasa(r.linha)} (${pct(r.vezes, colunasTotal)}%)`).join(" · ")]);
  }

  itens.forEach(([nomeIcone, titulo, detalhe]) => {
    const li = elemento("li");
    const simbolo = elemento("span", "destaque-icone");
    simbolo.innerHTML = icone(nomeIcone);
    li.appendChild(simbolo);
    const texto = elemento("div");
    texto.appendChild(elemento("strong", "", titulo));
    texto.appendChild(elemento("small", "", detalhe));
    li.appendChild(texto);
    lista.appendChild(li);
  });
  destaques.appendChild(lista);
  area.appendChild(destaques);

  const contra = blocoConfrontos(historico);
  if (contra) area.appendChild(contra);

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
  rotulo.textContent = `Recorde ${recorde}`;

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
  guardarMesa();
  atualizarBotaoDesfazer();
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
  let bloqueado = false;
  try { bloqueado = !podeDesfazerNaSala(); } catch {} // no começo do app a sala ainda não carregou
  document.getElementById("botao-desfazer").disabled = jogadas.length === 0 || bloqueado;
}

const NOMES_COLUNAS = ["descida (↓)", "subida (↑)", "coluna D", "coluna S"];

function desfazer() {
  if (!podeDesfazerNaSala()) {
    ultimoAviso = Date.now();
    mostrarLegenda(["Não dá para desfazer", familia.podeDesfazer() && !dadosParaNovaVez
      ? "Na sala, só dá para desfazer a última jogada, antes de rolar os dados de novo."
      : "A vez já passou para o próximo jogador."]);
    return;
  }
  const jogada = jogadas.pop();
  if (!jogada) return;
  localStorage.setItem(CHAVE_JOGADAS, JSON.stringify(jogadas));
  if (dadosParaNovaVez) {
    dadosParaNovaVez = false; // os dados daquela vez voltam (não dá para rolar de novo)
    guardarMesa();
  }

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
  rotular(botao, "pessoa", nomeJogador || "Seu nome");
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
  document.getElementById("nome-erro").textContent = "";
  document.getElementById("nome-explica").textContent = lerUsuario()
    ? "É o seu nome de usuário (único). Trocar libera o nome antigo; o código continua o mesmo."
    : "Use seu nome de verdade (ou o apelido que a família e os amigos conhecem): assim todo mundo sabe quem é quem no pódio.";
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

async function salvarNome(evento) {
  evento.preventDefault();
  const digitado = document.getElementById("campo-nome").value.trim().replace(/\s+/g, " ").slice(0, TAMANHO_MAX_NOME);
  const erro = document.getElementById("nome-erro");

  // com nome de usuário: trocar o nome troca o registro (precisa de internet)
  if (lerUsuario()) {
    if (!digitado) { erro.textContent = "Digite o novo nome."; return; }
    if (digitado === lerUsuario().nome) { fecharJanelaNome(); return; }
    if (!window.familia) { erro.textContent = "Precisa de internet para trocar o nome de usuário."; return; }
    erro.textContent = "Trocando o nome…";
    try {
      await familia.trocarNome(digitado);
      fecharJanelaNome();
      ultimoAviso = Date.now();
      mostrarLegenda(["Nome trocado", `Agora seu nome de usuário é ${digitado}. O código de recuperação continua o mesmo.`]);
    } catch (e) {
      erro.textContent = e.message;
    }
    return;
  }

  nomeJogador = digitado;
  if (nomeJogador) localStorage.setItem(CHAVE_NOME, JSON.stringify(nomeJogador));
  else localStorage.removeItem(CHAVE_NOME);
  mostrarNome();
  fecharJanelaNome();
}

// ---------- nome de usuário ----------
// Para jogar em sala, o nome é único: fica registrado no Firebase como deste
// celular. O código de recuperação leva o nome para outro celular (também vai
// no backup). A parte que fala com o Firebase está no familia.js.

const CHAVE_USUARIO = "yam-usuario"; // { nome, chave, codigo }
const lerUsuario = () => ler(CHAVE_USUARIO, null);

function guardarUsuario(u) {
  if (u) {
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(u));
    definirNome(u.nome);
  } else {
    localStorage.removeItem(CHAVE_USUARIO);
  }
  mostrarUsuario();
}

function mostrarUsuario() {
  const u = lerUsuario();
  document.getElementById("codigo-recuperacao").hidden = !u;
  document.getElementById("explica-codigo").hidden = !u;
  document.getElementById("link-recuperar").hidden = !!u;
  if (u) document.getElementById("codigo-valor").textContent = u.codigo;
}

async function copiarCodigo() {
  const u = lerUsuario();
  if (!u) return;
  const texto = `YAM · nome de usuário: ${u.nome} · código de recuperação: ${u.codigo}`;
  try {
    await navigator.clipboard.writeText(texto);
    ultimoAviso = Date.now();
    mostrarLegenda(["Código copiado", "Guarde num lugar seguro, por exemplo mandando para você mesmo no WhatsApp."]);
  } catch {
    avisar(texto, "Anote seu código");
  }
}

function abrirRecuperar(nome = "") {
  document.getElementById("janela-familia").hidden = true;
  document.getElementById("recuperar-nome").value = String(nome || "").trim();
  document.getElementById("recuperar-codigo").value = "";
  document.getElementById("recuperar-erro").textContent = "";
  document.getElementById("janela-recuperar").hidden = false;
  document.getElementById(nome ? "recuperar-codigo" : "recuperar-nome").focus();
}

function fecharRecuperar() {
  document.getElementById("janela-recuperar").hidden = true;
}

async function recuperarNome(evento) {
  evento.preventDefault();
  const nome = document.getElementById("recuperar-nome").value.trim().replace(/\s+/g, " ").slice(0, TAMANHO_MAX_NOME);
  const codigo = document.getElementById("recuperar-codigo").value.replace(/\D/g, "");
  const erro = document.getElementById("recuperar-erro");
  if (!nome) { erro.textContent = "Digite seu nome de usuário."; return; }
  if (codigo.length !== 8) { erro.textContent = "O código tem 8 números (0000-0000)."; return; }
  if (!window.familia) { erro.textContent = "Precisa de internet para recuperar o nome."; return; }
  erro.textContent = "Recuperando…";
  const botao = document.getElementById("recuperar-confirmar");
  botao.disabled = true;
  try {
    await familia.recuperar(nome, codigo);
    fecharRecuperar();
    avisar(`Agora você é ${lerUsuario().nome} neste celular.`, "Nome recuperado!");
  } catch (e) {
    erro.textContent = e.message;
  } finally {
    botao.disabled = false;
  }
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
    meta.content = escuro ? "#121212" : "#f3f3f0";
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
    partidaAtual: state,
    usuario: lerUsuario() // nome de usuário e código de recuperação
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

  // num celular novo, o nome de usuário volta junto (vale na próxima sala)
  const doBackup = dados && dados.usuario;
  if (!lerUsuario() && doBackup && typeof doBackup.nome === "string" && typeof doBackup.chave === "string" &&
      /^\d{4}-\d{4}$/.test(doBackup.codigo)) {
    guardarUsuario({ nome: doBackup.nome, chave: doBackup.chave, codigo: doBackup.codigo });
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

// Link de convite: abre nas boas-vindas (também se o app já estava aberto).
// "#como-jogar" é o endereço dos convites mandados antes; vai para o mesmo lugar.
function verificarLinkConvite() {
  if (location.hash !== "#bem-vindo" && location.hash !== "#como-jogar") return;
  history.replaceState(null, "", location.pathname + location.search);
  abrirBoasVindas();
}
window.addEventListener("hashchange", verificarLinkConvite);
setTimeout(verificarLinkConvite, 0);

// ---------- dados virtuais ----------
// 5 dados, até 3 jogadas por vez; entre as jogadas, toque num dado para segurá-lo.

const mesa = { valores: [1, 2, 3, 4, 5], segurados: [false, false, false, false, false], jogada: 0 };
let dadosParaNovaVez = false;

// A mesa fica guardada: fechar os dados, recarregar ou fechar o app não dá
// dados novos. Uma vez nova só começa depois de anotar na tabela.
const CHAVE_MESA = "yam-mesa";

function guardarMesa() {
  try {
    localStorage.setItem(CHAVE_MESA, JSON.stringify({ ...mesa, novaVez: dadosParaNovaVez }));
  } catch {}
}

(() => {
  const salva = ler(CHAVE_MESA, null);
  if (!salva || !Array.isArray(salva.valores) || salva.valores.length !== 5) return;
  if (!salva.valores.every(f => Number.isInteger(f) && f >= 1 && f <= 6)) return;
  mesa.valores = salva.valores;
  mesa.segurados = Array.isArray(salva.segurados) && salva.segurados.length === 5
    ? salva.segurados.map(Boolean) : [false, false, false, false, false];
  mesa.jogada = Math.min(3, Math.max(0, Number(salva.jogada) || 0));
  dadosParaNovaVez = salva.novaVez === true;
})();
let rolandoDados = false;
const PONTOS_DO_DADO = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function sortearFace() {
  const n = new Uint32Array(1);
  crypto.getRandomValues(n);
  return 1 + (n[0] % 6);
}

function abrirDados() {
  if (!podeJogarAgora()) return;
  sairDoModoMarcar();
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
  guardarMesa();
  atualizarBotaoDesfazer();
  desenharDados();
  avisarMesa();
}

function segurarDado(i) {
  if (rolandoDados || mesa.jogada === 0) return; // depois da 3ª também (não muda nada, mas fica à vontade)
  mesa.segurados[i] = !mesa.segurados[i];
  guardarMesa();
  desenharDados();
  avisarMesa();
}

// Sala com vez: os outros veem os dados de quem está jogando.
function avisarMesa() {
  if (window.familia) familia.mesaMudou();
}

function rolarDados() {
  if (rolandoDados || mesa.jogada >= 3) return;
  const soltos = [0, 1, 2, 3, 4].filter(i => !mesa.segurados[i]);
  if (soltos.length === 0) return;
  rolandoDados = true;
  dadosParaNovaVez = false;
  mesa.jogada++;
  // o resultado sai já no começo e fica guardado (recarregar no meio não rola de novo)
  const resultado = mesa.valores.map((f, i) => (soltos.includes(i) ? sortearFace() : f));
  try {
    localStorage.setItem(CHAVE_MESA, JSON.stringify({ ...mesa, valores: resultado, novaVez: false }));
  } catch {}
  soltos.forEach(i => { mesa.valores[i] = sortearFace(); });
  desenharDados(soltos); // começa a animação (giro e pulo de cada dado)
  vibrar([12, 50, 12, 50, 12]);
  tocar("rolar");
  let passos = 0;
  const animar = setInterval(() => {
    soltos.forEach(i => { mesa.valores[i] = sortearFace(); });
    trocarFaces(soltos);
    if (++passos >= 8) {
      clearInterval(animar);
      rolandoDados = false;
      mesa.valores = resultado;
      guardarMesa();
      desenharDados([], soltos);
      vibrar(30);
      avisarMesa();
    }
  }, 60);
}

// Durante a rolagem só troca os pontos, sem refazer o dado (a animação segue).
function trocarFaces(indices) {
  const dados = document.getElementById("dados-mesa").children;
  indices.forEach(i => {
    if (!dados[i]) return;
    Array.from(dados[i].children).forEach((ponto, p) => {
      ponto.className = PONTOS_DO_DADO[mesa.valores[i]].includes(p) ? "on" : "";
    });
  });
}

// Quanto os dados valem numa linha da tabela (mesmas regras de valoresPossiveis);
// null quando não valem nada ali (aí só riscando).
function valorDaJogada(linha, dados) {
  const qtd = [0, 0, 0, 0, 0, 0, 0];
  dados.forEach(f => qtd[f]++);
  const soma = dados.reduce((a, b) => a + b, 0);
  const iguais = n => qtd.findIndex((q, f) => f > 0 && q === n);
  const ordenados = [...dados].sort().join("");
  if (linha <= 5) return qtd[linha + 1] ? (linha + 1) * qtd[linha + 1] : null;
  switch (linha) {
    case 9:  return iguais(4) > 0 ? 20 + 4 * iguais(4) : null; // Quadra: exatamente 4 iguais
    case 10: return qtd.includes(3) && qtd.includes(2) ? 30 + soma : null;
    case 11: return ordenados === "12345" ? 50 : null;
    case 12: return ordenados === "23456" ? 60 : null;
    case 13:
    case 14: return soma;
    case 15: return iguais(5) > 0 ? 50 + 5 * iguais(5) : null;
  }
  return null;
}

// Casas onde dá para marcar estes dados agora: { "linha-coluna": valor }.
function casasParaMarcar(dados) {
  const casas = {};
  for (const linha of LINHAS_JOGO) {
    const valor = valorDaJogada(linha, dados);
    if (valor === null) continue;
    for (const col of colunasLivres(linha, valor)) casas[`${linha}-${col}`] = valor;
  }
  return casas;
}

// O que a jogada atual vale (mesmas regras de valoresPossiveis):
// 1) as combinações que dá para marcar agora na sua tabela; se não der nenhuma,
//    o número com menor risco de perder o bônus e onde marcar;
// 2) a soma (para o MIN e o MAX).
function oQueValem(v) {
  const soma = v.reduce((a, b) => a + b, 0);
  const qtd = [0, 0, 0, 0, 0, 0, 0];
  v.forEach(f => qtd[f]++);
  const linhas = [];
  const marcaveis = combinacoesMarcaveis(v);
  if (marcaveis.length) {
    linhas.push(marcaveis.map(([nome, , valor, col]) => `${nome} ${valor}, na ${NOMES_COLUNAS[col]}`).join(" · "));
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

// Ordem de preferência das colunas nas sugestões: primeiro o Seco (só vale na
// 1ª jogada), depois descida e subida, e por último a Desordem (que aceita
// qualquer ordem e por isso fica para quando nada mais servir).
const PRIORIDADE_COLUNA = [1, 1, 2, 0]; // ↓ ↑ D S

function melhorColuna(linha, valor) {
  return colunasLivres(linha, valor)
    .sort((a, b) => PRIORIDADE_COLUNA[a] - PRIORIDADE_COLUNA[b] || a - b)[0];
}

// Combinações do 2º total que estes dados fazem e têm casa livre:
// [nome, linha, valor, coluna sugerida]. Com os 5 iguais vale YAM, número ou MIN/MAX (não Quadra).
function combinacoesMarcaveis(dados) {
  return [["YAM", 15], ["Q", 9], ["F", 10], ["S-", 11], ["S+", 12]]
    .map(([nome, linha]) => {
      const valor = valorDaJogada(linha, dados);
      return [nome, linha, valor, valor === null ? undefined : melhorColuna(linha, valor)];
    })
    .filter(([, , valor, col]) => valor !== null && col !== undefined)
    .sort((a, b) => PRIORIDADE_COLUNA[a[3]] - PRIORIDADE_COLUNA[b[3]]);
}

// ---------- marcar pelos dados ----------
// "Marcar" fecha os dados e destaca na tabela as casas onde a jogada pode ir,
// já com o valor de cada uma. Um toque na casa marca (como se tivesse digitado).
// "— Riscar" troca os destaques pelas casas vazias: um toque risca (0, aparece —).
// Se a jogada não cabe em lugar nenhum, já abre riscando.

let casasMarcaveis = null; // { "linha-coluna": valor } enquanto a pessoa escolhe
let riscandoPelosDados = false;

// Casas vazias que dá para riscar (riscar pode em qualquer casa, a qualquer hora).
function casasParaRiscar() {
  const casas = {};
  for (const linha of LINHAS_JOGO) {
    for (let col = 0; col < COLUNAS; col++) if (!preenchida(linha, col)) casas[`${linha}-${col}`] = 0;
  }
  return casas;
}

function marcarPelosDados(riscar = false) {
  const valores = casasParaMarcar(mesa.valores);
  const temValores = Object.keys(valores).length > 0;
  riscar = riscar || !temValores;
  const casas = riscar ? casasParaRiscar() : valores;
  if (!Object.keys(casas).length) return; // tabela cheia
  fecharDados();
  casasMarcaveis = casas;
  riscandoPelosDados = riscar;

  // sem combinação para marcar: a casa sugerida (menor risco para o bônus) fica mais forte
  let sugerida = null;
  const combinacoes = riscar ? [] : combinacoesMarcaveis(mesa.valores);
  if (combinacoes.length) {
    sugerida = `${combinacoes[0][1]}-${combinacoes[0][3]}`;
  } else if (!riscar) {
    const qtd = [0, 0, 0, 0, 0, 0, 0];
    mesa.valores.forEach(f => qtd[f]++);
    const s = sugestaoDeNumero(qtd);
    if (s) sugerida = `${s.face - 1}-${s.col}`;
  }
  destacarCasasMarcaveis(sugerida);

  const dadosNaBarra = document.getElementById("marcar-dados");
  dadosNaBarra.innerHTML = mesa.valores.map(f => dadoMini(f)).join("");
  dadosNaBarra.setAttribute("aria-label", `Dados: ${mesa.valores.join(", ")}`);
  document.getElementById("marcar-texto").textContent = riscar ? "Riscar qual?" : "Onde marcar?";
  const trocar = document.getElementById("marcar-trocar");
  rotular(trocar, riscar ? "lapis" : "riscar", riscar ? "Valores" : "Riscar");
  trocar.hidden = riscar && !temValores; // nada para marcar: só dá para riscar
  const barra = document.getElementById("barra-marcar");
  barra.classList.toggle("riscando", riscar);
  barra.hidden = false;
  const alvo = body.querySelector(sugerida ? `[data-key="${sugerida}"]` : "td.pode-marcar");
  if (alvo) alvo.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// Botão da barra: alterna entre marcar valores e riscar.
function trocarMarcarRiscar() {
  marcarPelosDados(!riscandoPelosDados);
}

function destacarCasasMarcaveis(sugerida = null) {
  body.classList.toggle("modo-marcar", !!casasMarcaveis);
  body.querySelectorAll("td[data-key]").forEach(td => {
    const valor = casasMarcaveis ? casasMarcaveis[td.dataset.key] : undefined;
    td.classList.toggle("pode-marcar", valor !== undefined);
    td.classList.toggle("riscar", valor !== undefined && riscandoPelosDados);
    td.classList.toggle("sugerida", valor !== undefined && td.dataset.key === sugerida);
    const input = td.querySelector("input");
    if (input) input.placeholder = valor === undefined ? "" : exibir(String(valor));
  });
}

function sairDoModoMarcar() {
  if (!casasMarcaveis) return;
  casasMarcaveis = null;
  riscandoPelosDados = false;
  destacarCasasMarcaveis();
  document.getElementById("barra-marcar").hidden = true;
}

function marcarCasa(key, valor) {
  const numero = String(valor);
  const antes = state[key] ?? "";
  sairDoModoMarcar();
  registrarJogada(key, antes, numero);
  update(key, numero);
  const input = body.querySelector(`[data-key="${key}"] input`);
  if (input) input.value = exibir(numero);
  piscarCasa(key);
  vibrar(15);
  tocar("marcar");
  comemorarJogada(key, antes, numero);
  avisarSala();
  verificarFimDeJogo();
}

body.addEventListener("click", evento => {
  if (!casasMarcaveis) return;
  const td = evento.target.closest("td[data-key]");
  if (td && td.dataset.key in casasMarcaveis) marcarCasa(td.dataset.key, casasMarcaveis[td.dataset.key]);
});

// Colunas onde dá para marcar `valor` na linha agora: casa vazia, na ordem da
// descida/subida, MIN < MAX, e o Seco (S) só na 1ª jogada.
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

// Melhor lugar para os números desta jogada: nunca onde perde o bônus; se
// alguma casa garante o bônus, ela; senão a coluna preferida (Seco, descida
// e subida, Desordem); depois o menor risco para o bônus, o que fica mais
// perto da referência da linha e mais pontos.
function sugestaoDeNumero(qtd) {
  let melhor = null;
  for (let face = 1; face <= 6; face++) {
    if (!qtd[face]) continue;
    const linha = face - 1;
    const valor = face * qtd[face];
    for (const col of colunasLivres(linha, valor)) {
      const { nivel, folga } = riscoParaOBonus(linha, col, valor);
      const nota = [nivel === 3 ? 1 : 0, nivel === -1 ? 0 : 1, PRIORIDADE_COLUNA[col], // menor é melhor
        nivel, -folga, REFERENCIA_BONUS[linha] - valor, -valor];
      const menor = melhor && nota.findIndex((n, i) => n !== melhor.nota[i]);
      if (!melhor || (menor >= 0 && nota[menor] < melhor.nota[menor])) {
        melhor = { face, valor, col, nota, garante: nivel === -1 };
      }
    }
  }
  return melhor;
}

function desenharDados(rolando = [], assentaram = []) {
  const area = document.getElementById("dados-mesa");
  area.innerHTML = "";
  mesa.valores.forEach((valor, i) => {
    const dado = document.createElement("button");
    dado.className = "dado";
    if (mesa.segurados[i]) dado.classList.add("segurado");
    if (rolando.includes(i)) {
      dado.classList.add("rolando");
      // cada dado gira para um lado e um tanto (sempre volta reto)
      const voltas = (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 360 : 720);
      dado.style.setProperty("--giro", `${voltas}deg`);
      dado.style.animationDelay = `${Math.floor(Math.random() * 40)}ms`;
    }
    if (assentaram.includes(i)) dado.classList.add("assentou");
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
    rotular(botao, "dado", "Rolar");
    valem.textContent = "";
  } else {
    status.textContent = mesa.jogada === 1
      ? "1ª jogada (vale para a coluna S – Seco). Toque nos dados que quer segurar."
      : mesa.jogada < 3
        ? `${mesa.jogada}ª jogada de 3. Toque nos dados que quer segurar.`
        : "3ª jogada: agora é anotar na tabela.";
    if (mesa.jogada < 3) rotular(botao, "dado", `Rolar (${mesa.jogada + 1}ª)`);
    else botao.textContent = "Fim da vez";
    valem.textContent = rolando.length ? "" : oQueValem(mesa.valores);
  }
  botao.disabled = mesa.jogada >= 3 || rolandoDados || mesa.segurados.every(Boolean);

  // Marcar: depois de rolar (se a jogada não cabe em lugar nenhum, vira
  // "— Riscar"); vira o botão principal quando não dá mais para rolar (3ª jogada)
  const marcar = document.getElementById("dados-marcar");
  marcar.hidden = mesa.jogada === 0 || rolando.length > 0 || !Object.keys(casasParaRiscar()).length;
  if (!marcar.hidden) {
    if (Object.keys(casasParaMarcar(mesa.valores)).length) rotular(marcar, "lapis", "Marcar");
    else rotular(marcar, "riscar", "Riscar");
  }
  const fim = mesa.jogada >= 3;
  marcar.className = fim ? "principal" : "";
  botao.className = fim ? "" : "principal";
  botao.hidden = fim && !marcar.hidden;
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

// ---------- versão nova ----------
// Com o app aberto (ou deixado em segundo plano), confere se saiu versão nova
// ao voltar para ele e a cada 30 min; se saiu, oferece atualizar com um toque.
async function conferirVersaoNova() {
  if (navigator.onLine === false) return;
  try {
    const resposta = await fetch(`service-worker.js?v=${Date.now()}`, { cache: "no-store" });
    const nova = Number((String(await resposta.text()).match(/yam-cache-v(\d+)/) || [])[1]);
    if (nova > VERSAO) document.getElementById("aviso-versao").hidden = false;
  } catch {}
}

// Ao voltar para o app, confere na hora e de novo uns segundos depois (logo ao
// voltar, a internet do celular às vezes ainda não está pronta).
function conferirAoVoltar() {
  conferirVersaoNova();
  setTimeout(conferirVersaoNova, 5000);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") conferirAoVoltar();
});
window.addEventListener("pageshow", evento => { if (evento.persisted) conferirAoVoltar(); });
window.addEventListener("online", conferirVersaoNova);
const timerVersao = setInterval(conferirVersaoNova, 10 * 60 * 1000);

// "Atualizar": busca a versão nova do service worker e abre o app num endereço
// novo. Os arquivos têm a versão no endereço (app.js?v=57), então a página nova
// nunca usa uma cópia velha guardada no celular.
async function atualizarApp() {
  const botao = document.getElementById("botao-atualizar");
  botao.disabled = true;
  rotular(botao, "atualizar", "Atualizando…");
  try {
    const registro = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (registro) await Promise.race([registro.update(), new Promise(r => setTimeout(r, 4000))]);
  } catch {}
  location.replace(`${location.pathname}?atualizado=${Date.now()}`);
}

// voltou de "Atualizar": limpa o endereço
try {
  if (new URLSearchParams(location.search).has("atualizado")) history.replaceState(null, "", location.pathname);
} catch {}
if (timerVersao && timerVersao.unref) timerVersao.unref();
document.getElementById("versao-app").textContent = VERSAO;

// ---------- instalar o app ----------
// Android/Chrome: o navegador avisa que dá para instalar e o botão chama a
// instalação. iPhone: não tem esse aviso, então o botão explica o caminho.

let pedidoDeInstalar = null;

function appInstalado() {
  try {
    return matchMedia("(display-mode: standalone)").matches === true || navigator.standalone === true;
  } catch { return false; }
}

function ehIphone() {
  try {
    const ua = String(navigator.userAgent || "");
    return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch { return false; }
}

function mostrarBotaoInstalar() {
  document.getElementById("botao-instalar").hidden = appInstalado() || !(pedidoDeInstalar || ehIphone());
}

window.addEventListener("beforeinstallprompt", evento => {
  evento.preventDefault();
  pedidoDeInstalar = evento;
  mostrarBotaoInstalar();
  // sugere uma vez só (depois fica no Mais)
  try {
    if (localStorage.getItem("yam-sugeriu-instalar")) return;
    localStorage.setItem("yam-sugeriu-instalar", "1");
  } catch { return; }
  mostrarLegenda(["Instale o YAM", "Fica com ícone na tela inicial e abre como app, até sem internet."], "",
    { texto: "Instalar", fazer: instalarApp });
});

window.addEventListener("appinstalled", () => {
  pedidoDeInstalar = null;
  mostrarBotaoInstalar();
});

async function instalarApp() {
  if (pedidoDeInstalar) {
    const pedido = pedidoDeInstalar;
    pedidoDeInstalar = null;
    pedido.prompt();
    try { await pedido.userChoice; } catch {}
    mostrarBotaoInstalar();
    return;
  }
  avisar("No Safari, toque em Compartilhar (o quadrado com a seta para cima) e depois em " +
    "\"Adicionar à Tela de Início\".", "Instalar no iPhone");
}

mostrarBotaoInstalar();

// ---------- sons ----------
// Feitos na hora (sem arquivos de áudio). No iPhone respeitam a chave do
// silencioso e não param a música que estiver tocando.

const CHAVE_SOM = "yam-som";
let somLigado = true;
try { somLigado = localStorage.getItem(CHAVE_SOM) !== "0"; } catch {}
let audio = null;

function contextoDeAudio() {
  if (!somLigado) return null;
  try {
    if (!audio) {
      const Contexto = window.AudioContext || window.webkitAudioContext;
      if (typeof Contexto !== "function") return null;
      if (navigator.audioSession) navigator.audioSession.type = "ambient";
      audio = new Contexto();
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  } catch { return null; }
}

function nota(ctx, freq, inicio, duracao, { tipo = "triangle", volume = 0.16 } = {}) {
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  const t = ctx.currentTime + inicio;
  osc.type = tipo;
  osc.frequency.value = freq;
  ganho.gain.setValueAtTime(0.0001, t);
  ganho.gain.exponentialRampToValueAtTime(volume, t + 0.012);
  ganho.gain.exponentialRampToValueAtTime(0.0001, t + duracao);
  osc.connect(ganho).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duracao + 0.03);
}

// batidinha de dado: um estalo curto de ruído, em tom aleatório
function estalo(ctx, inicio, volume) {
  const n = Math.floor(ctx.sampleRate * 0.035);
  const buffer = ctx.createBuffer(1, n, ctx.sampleRate);
  const dados = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) dados[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
  const fonte = ctx.createBufferSource();
  fonte.buffer = buffer;
  const filtro = ctx.createBiquadFilter();
  filtro.type = "bandpass";
  filtro.frequency.value = 1400 + Math.random() * 1800;
  filtro.Q.value = 1.3;
  const ganho = ctx.createGain();
  ganho.gain.value = volume;
  fonte.connect(filtro).connect(ganho).connect(ctx.destination);
  fonte.start(ctx.currentTime + inicio);
}

const SONS = {
  rolar(ctx) {
    for (let i = 0; i < 9; i++) estalo(ctx, i * 0.045 + Math.random() * 0.02, 0.35 + Math.random() * 0.3);
  },
  marcar(ctx) {
    nota(ctx, 660, 0, 0.09, { tipo: "sine", volume: 0.14 });
    nota(ctx, 990, 0.06, 0.13, { tipo: "sine", volume: 0.11 });
  },
  festa(ctx) {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => nota(ctx, f, i * 0.09, 0.3));
  },
  suaVez(ctx) {
    nota(ctx, 784, 0, 0.16, { tipo: "sine", volume: 0.16 });
    nota(ctx, 1175, 0.14, 0.3, { tipo: "sine", volume: 0.14 });
  },
  podio(ctx) {
    [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => nota(ctx, f, i * 0.1, 0.35, { volume: 0.14 }));
    nota(ctx, 1046.5, 0.55, 0.7, { volume: 0.12 });
    nota(ctx, 1318.5, 0.55, 0.7, { volume: 0.09 });
  }
};

function tocar(nome) {
  const ctx = contextoDeAudio();
  if (!ctx || !SONS[nome]) return;
  try { SONS[nome](ctx); } catch {}
}

// ---------- letra maior ----------

const CHAVE_LETRA = "yam-letra";

function atualizarBotaoLetra() {
  document.getElementById("botao-letra")
    .setAttribute("aria-checked", document.documentElement.dataset.letra === "grande");
}

function alternarLetra() {
  const grande = document.documentElement.dataset.letra !== "grande";
  if (grande) document.documentElement.dataset.letra = "grande";
  else delete document.documentElement.dataset.letra;
  try { localStorage.setItem(CHAVE_LETRA, grande ? "grande" : "normal"); } catch {}
  atualizarBotaoLetra();
}

function atualizarBotaoSom() {
  document.getElementById("botao-som").setAttribute("aria-checked", somLigado);
}

function alternarSom() {
  somLigado = !somLigado;
  try { localStorage.setItem(CHAVE_SOM, somLigado ? "1" : "0"); } catch {}
  atualizarBotaoSom();
  tocar("marcar"); // amostra ao ligar
}

atualizarBotaoSom();
atualizarBotaoLetra();
mostrarUsuario();

// ---------- a tabela cabe na tela ----------
// As linhas têm 30px no mínimo. Se faltarem só alguns pixels para a tabela
// caber (iPhone no navegador, celular baixinho), elas encolhem até 25px em vez
// de a tabela dar uma roladinha à toa. Se nem assim couber, rola normalmente.

const LINHA_NORMAL = 30, LINHA_APERTADA = 25;

// Mede de verdade (a altura mínima de cada linha muda com o celular e a letra):
// tenta 30px, 29px, ... até 25px e fica com a primeira que cabe.
function caberNaTela(moldura) {
  if (!moldura || !moldura.clientHeight) return;
  for (let linha = LINHA_NORMAL; linha >= LINHA_APERTADA; linha--) {
    moldura.style.setProperty("--linha", `${linha}px`);
    if (moldura.scrollHeight <= moldura.clientHeight) return;
  }
  moldura.style.setProperty("--linha", `${LINHA_NORMAL}px`); // não cabe nem apertando: rola
}

if (typeof ResizeObserver === "function") {
  const observador = new ResizeObserver(mudancas => {
    new Set(mudancas.map(m => m.target.closest(".tabela"))).forEach(caberNaTela);
  });
  document.querySelectorAll(".tabela").forEach(moldura => {
    observador.observe(moldura);
    observador.observe(moldura.querySelector("table"));
  });
}

// ---------- boas-vindas (primeiro uso) ----------

const CHAVE_BOAS_VINDAS = "yam-boas-vindas";
let slideAtual = 0;

// Só para quem nunca usou: sem partidas, sem nome e sem jogo em andamento.
function deveMostrarBoasVindas() {
  try { if (localStorage.getItem(CHAVE_BOAS_VINDAS)) return false; } catch { return false; }
  return historico.length === 0 && !nomeJogador && !partidaTemValores(state);
}

function mostrarSlide(n) {
  const slides = [...document.querySelectorAll(".bv-slide")];
  slideAtual = Math.max(0, Math.min(n, slides.length - 1));
  slides.forEach((s, i) => s.classList.toggle("atual", i === slideAtual));
  document.querySelectorAll("#bv-pontos i").forEach((p, i) => p.classList.toggle("atual", i === slideAtual));
  const ultimo = slideAtual === slides.length - 1;
  document.getElementById("bv-proximo").textContent = ultimo ? "Começar" : "Próximo";
  document.getElementById("bv-pular").hidden = ultimo;
}

function abrirBoasVindas() {
  document.getElementById("bv-nome").value = nomeJogador || "";
  mostrarSlide(0);
  document.getElementById("boas-vindas").hidden = false;
}

function proximaBoasVindas() {
  if (slideAtual < document.querySelectorAll(".bv-slide").length - 1) {
    mostrarSlide(slideAtual + 1);
    return;
  }
  const nome = document.getElementById("bv-nome").value.trim().replace(/\s+/g, " ").slice(0, TAMANHO_MAX_NOME);
  if (nome) definirNome(nome);
  fecharBoasVindas();
}

function fecharBoasVindas() {
  try { localStorage.setItem(CHAVE_BOAS_VINDAS, "1"); } catch {}
  document.getElementById("bv-nome").blur();
  document.getElementById("boas-vindas").hidden = true;
}

// arrastar para o lado troca de tela; Enter no nome começa
(() => {
  let inicioX = null;
  const area = document.getElementById("bv-slides");
  area.addEventListener("touchstart", e => { inicioX = e.touches[0].clientX; }, { passive: true });
  area.addEventListener("touchend", e => {
    if (inicioX === null) return;
    const dx = e.changedTouches[0].clientX - inicioX;
    inicioX = null;
    if (Math.abs(dx) > 50) mostrarSlide(slideAtual + (dx < 0 ? 1 : -1));
  }, { passive: true });
  document.getElementById("bv-nome").addEventListener("keydown", e => {
    if (e.key === "Enter") proximaBoasVindas();
  });
})();

try { if (deveMostrarBoasVindas()) abrirBoasVindas(); } catch {}

// ---------- sala "cada um na sua vez" ----------

// De quem é a vez: de quem, na ordem de entrada (quem criou começa), jogou
// menos vezes. Vezes = casas marcadas + "base" (quem entrou no meio começa na
// rodada atual) + vezes que o criador pulou. Quem terminou sai da roda.
function vezDaSala(jogadores, pulos = {}) {
  const naRoda = jogadores.filter(j => !j.terminou)
    .sort((a, b) => (a.entrouEm || 0) - (b.entrouEm || 0) || String(a.uid).localeCompare(String(b.uid)));
  if (!naRoda.length) return null;
  const vezes = j => (j.casas || 0) + (j.base || 0) + ((pulos || {})[j.uid] || 0);
  const menor = Math.min(...naRoda.map(vezes));
  return naRoda.find(j => vezes(j) === menor).uid;
}

// Casas da tabela já marcadas (com número ou riscadas).
const casasMarcadas = (valores = state) =>
  LINHAS_JOGO.reduce((n, l) => n + [0, 1, 2, 3].filter(c => (valores[`${l}-${c}`] ?? "") !== "").length, 0);

// A última casa marcada (para os outros verem o que você fez).
function ultimaJogadaFeita() {
  for (let i = jogadas.length - 1; i >= 0; i--) {
    const valor = state[jogadas[i].key] ?? "";
    if (valor !== "") return { key: jogadas[i].key, valor: Number(valor) };
  }
  return null;
}

// "Maria marcou 18 no 6 na descida (↓)" / "Maria riscou o F na coluna D"
function textoDaJogada(nome, key, valor) {
  const [linha, col] = key.split("-").map(Number);
  const casa = linha <= 5 ? String(linha + 1) : siglaDaCasa(linha);
  return Number(valor) === 0
    ? `${nome} riscou o ${casa} na ${NOMES_COLUNAS[col]}`
    : `${nome} marcou ${valor} no ${casa} na ${NOMES_COLUNAS[col]}`;
}

// Anti-trapaça na sala: com "só os dados do app" ninguém digita pontos; e uma
// casa já marcada não muda (errou agora? Desfazer, só a última jogada).
function podeDigitarNaCasa(valorAtual) {
  if (!window.familia || !familia.ativa() || familia.revelada()) return true;
  ultimoAviso = Date.now();
  if (familia.soDadosDoApp()) {
    mostrarLegenda(["Nesta sala, só pelos dados do app",
      "Toque no dado lá embaixo, role e use Marcar (ou Riscar)."]);
    return false;
  }
  if (valorAtual !== "") {
    mostrarLegenda(["Casa já marcada", "Na sala, uma casa marcada não muda. Errou agora? Use Desfazer."]);
    return false;
  }
  return true;
}

// Desfazer na sala: só a última jogada e antes de rolar os dados de novo.
function podeDesfazerNaSala() {
  if (!window.familia || !familia.ativa() || familia.revelada()) return true;
  return dadosParaNovaVez && familia.podeDesfazer();
}

// Tabela e dados só na sua vez (fora de sala, ou sala livre, sempre pode).
function podeJogarAgora() {
  if (!window.familia || !familia.ativa() || familia.podeJogar()) return true;
  ultimoAviso = Date.now();
  mostrarLegenda(familia.porQueNaoPode());
  return false;
}

// ---------- você contra cada um ----------
// Nas partidas em sala guardadas neste celular (cada celular só tem as salas em
// que jogou), quantas vezes você ficou na frente de cada pessoa.

const normalizarNome = nome => String(nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().trim().replace(/\s+/g, " ");

function confrontos(partidas) {
  const porPessoa = new Map();
  for (const p of partidas) {
    const podio = p.sala && p.sala.podio;
    if (!podio || !Array.isArray(podio.terminaram)) continue;
    const eu = podio.terminaram.find(j => j.eu);
    if (!eu) continue;
    for (const outro of podio.terminaram) {
      if (outro.eu) continue;
      const chave = normalizarNome(outro.nome);
      const c = porPessoa.get(chave) ||
        { nome: outro.nome, partidas: 0, vitorias: 0, derrotas: 0, empates: 0, meus: 0, deles: 0, data: "" };
      c.partidas++;
      c.meus += eu.total;
      c.deles += outro.total;
      if (eu.total > outro.total) c.vitorias++;
      else if (eu.total < outro.total) c.derrotas++;
      else c.empates++;
      if ((p.data || "") >= c.data) { c.nome = outro.nome; c.data = p.data || ""; } // nome mais recente
      porPessoa.set(chave, c);
    }
  }
  return [...porPessoa.values()].sort((a, b) => b.partidas - a.partidas || a.nome.localeCompare(b.nome));
}

function blocoConfrontos(partidas) {
  const lista = confrontos(partidas);
  if (!lista.length) return null;
  const caixa = elemento("div", "bloco confrontos"); // div: "section" no app é uma tela inteira
  caixa.appendChild(elemento("h2", "", "Você contra cada um"));
  caixa.appendChild(elemento("p", "subtitulo", "Nas partidas em sala deste celular. Placar: você × a pessoa."));
  const ul = elemento("ul", "lista-confrontos");
  for (const c of lista) {
    const li = elemento("li");
    const info = elemento("div", "confronto-info");
    info.appendChild(elemento("strong", "", c.nome));
    const media = n => Math.round(n / c.partidas);
    info.appendChild(elemento("small", "",
      `${c.partidas} partida${c.partidas === 1 ? "" : "s"}${c.empates ? ` · ${c.empates} empate${c.empates === 1 ? "" : "s"}` : ""}` +
      ` · média ${media(c.meus)} × ${media(c.deles)}`));
    li.appendChild(info);
    const placar = elemento("span", "placar" + (c.vitorias > c.derrotas ? " ganhando" : c.vitorias < c.derrotas ? " perdendo" : ""));
    placar.appendChild(elemento("b", "", String(c.vitorias)));
    placar.appendChild(elemento("span", "", " × "));
    placar.appendChild(elemento("b", "", String(c.derrotas)));
    placar.setAttribute("aria-label", `Você ${c.vitorias}, ${c.nome} ${c.derrotas}`);
    li.appendChild(placar);
    ul.appendChild(li);
  }
  caixa.appendChild(ul);
  return caixa;
}

// ---------- lembrete de backup ----------
// Com 3 partidas ou mais e sem backup há mais de 30 dias, lembra (no máximo a
// cada 14 dias) que as partidas ficam só neste celular.

const CHAVE_LEMBRETE_BACKUP = "yam-lembrete-backup";

function precisaLembrarBackup(agora = Date.now()) {
  if (historico.length < 3) return false;
  const dias = iso => (iso ? (agora - new Date(iso).getTime()) / (24 * 60 * 60 * 1000) : Infinity);
  return dias(ler(CHAVE_ULTIMO_BACKUP, null)) > 30 && dias(ler(CHAVE_LEMBRETE_BACKUP, null)) > 14;
}

const timerBackup = setTimeout(() => {
  try {
    if (!precisaLembrarBackup() || !document.getElementById("boas-vindas").hidden) return;
    localStorage.setItem(CHAVE_LEMBRETE_BACKUP, JSON.stringify(new Date().toISOString()));
    ultimoAviso = Date.now();
    mostrarLegenda(["Que tal um backup?",
      "Suas partidas ficam só neste celular. Um arquivo de backup evita perder o histórico se trocar de aparelho."],
      "", { texto: "Fazer backup", fazer: exportarHistorico });
  } catch {}
}, 4000);
if (timerBackup && timerBackup.unref) timerBackup.unref();

// ---------- avisos da vez (notificação com o app fechado) ----------
// Na sala "cada um na sua vez", quem passa a vez pede ao servidor de avisos
// que mande uma notificação para o próximo (só se ele ligou os avisos e não
// está com o app aberto). No iPhone, só com o app instalado na tela inicial.

const CHAVE_AVISOS = "yam-avisos"; // "1" ligado, "0" desligado

function avisosSuportados() {
  try {
    return !!AVISOS_URL && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  } catch { return false; }
}

function avisosLigados() {
  try {
    return avisosSuportados() && localStorage.getItem(CHAVE_AVISOS) === "1" && Notification.permission === "granted";
  } catch { return false; }
}

function bytesDeB64url(texto) {
  const s = atob(texto.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((texto.length + 3) % 4));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

// Inscrição deste celular no push ({ endpoint, p256dh, auth }).
async function inscricaoPush() {
  const reg = await navigator.serviceWorker.ready;
  const chave = bytesDeB64url(VAPID_PUBLICA);
  let inscricao = await reg.pushManager.getSubscription();
  // inscrição feita com outra chave (o servidor trocou de chave): refaz
  if (inscricao && inscricao.options && inscricao.options.applicationServerKey) {
    const atual = new Uint8Array(inscricao.options.applicationServerKey);
    if (atual.length !== chave.length || atual.some((b, i) => b !== chave[i])) {
      await inscricao.unsubscribe();
      inscricao = null;
    }
  }
  if (!inscricao) inscricao = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
  const j = inscricao.toJSON();
  return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
}

function atualizarBotaoAvisos() {
  document.getElementById("bloco-avisos").hidden = !AVISOS_URL;
  if (!AVISOS_URL) return;
  const suportado = avisosSuportados();
  const botao = document.getElementById("botao-avisos");
  botao.disabled = !suportado;
  botao.setAttribute("aria-checked", String(avisosLigados()));
  let permissao = "default";
  try { permissao = Notification.permission; } catch {}
  document.getElementById("avisos-dica").textContent =
    !suportado ? (ehIphone() && !appInstalado()
      ? "No iPhone, os avisos só funcionam com o app instalado na tela inicial (Mais opções → Instalar)."
      : "Este navegador não recebe avisos.")
    : permissao === "denied" ? "Os avisos estão bloqueados nos ajustes do celular para este app."
    : "Na sala \u201ccada um na sua vez\u201d, chega uma notificação quando for a sua vez, mesmo com o app fechado.";
}

// Precisa vir de um toque (o celular só pergunta depois de um toque).
async function ligarAvisos() {
  if (!avisosSuportados()) { atualizarBotaoAvisos(); return false; }
  const permissao = await Notification.requestPermission();
  if (permissao !== "granted") {
    localStorage.setItem(CHAVE_AVISOS, "0");
    atualizarBotaoAvisos();
    ultimoAviso = Date.now();
    mostrarLegenda(["Avisos desligados", "Sem permissão para notificações. Dá para liberar nos ajustes do celular."]);
    return false;
  }
  try {
    await inscricaoPush();
  } catch {
    ultimoAviso = Date.now();
    mostrarLegenda(["Não deu para ligar os avisos", "Confira a internet e tente de novo."], "erro");
    return false;
  }
  localStorage.setItem(CHAVE_AVISOS, "1");
  atualizarBotaoAvisos();
  if (window.familia) familia.avisosMudaram();
  ultimoAviso = Date.now();
  mostrarLegenda(["Avisos ligados", "Quando for a sua vez numa sala, chega uma notificação."]);
  return true;
}

function desligarAvisos() {
  localStorage.setItem(CHAVE_AVISOS, "0");
  atualizarBotaoAvisos();
  if (window.familia) familia.avisosMudaram();
}

async function alternarAvisos() {
  if (avisosLigados()) desligarAvisos();
  else await ligarAvisos();
}

atualizarBotaoAvisos();

// ---------- link de convite para a sala (?sala=12345) ----------
// Abre "Entrar em sala" já com o código. No iPhone, um link sempre abre no
// navegador (nunca no app da tela inicial), onde o nome e as partidas da pessoa
// não estão: aí o app avisa que dá para abrir o app instalado e usar o código.

function abrirEntrarNaSala(codigo, tentativas = 0) {
  if (!window.familia) {
    if (tentativas < 40) setTimeout(() => abrirEntrarNaSala(codigo, tentativas + 1), 250);
    return;
  }
  if (familia.ativa()) return; // já está numa sala
  familia.abrir("entrar");
  document.getElementById("familia-codigo").value = codigo;
}

async function verificarLinkDaSala() {
  let codigo = null;
  try { codigo = new URLSearchParams(location.search).get("sala"); } catch {}
  if (!codigo || !/^\d{5}$/.test(codigo)) return;
  history.replaceState(null, "", location.pathname);
  document.getElementById("boas-vindas").hidden = true; // quem veio pelo link vai direto para a sala
  if (appInstalado()) { abrirEntrarNaSala(codigo); return; }
  const aqui = await perguntar({
    titulo: `Convite para a sala ${codigo}`,
    texto: `Já tem o YAM instalado na tela inicial? Abra o app e toque em Jogar em sala → Entrar em sala, ` +
      `com o código ${codigo}: lá estão seu nome e suas partidas. Se não tem, dá para jogar aqui no navegador.`,
    sim: "Jogar aqui no navegador", nao: "Vou abrir o app"
  });
  if (aqui) abrirEntrarNaSala(codigo);
}

setTimeout(verificarLinkDaSala, 0);

// Atalhos do ícone (segurar o ícone do app): ?abrir=dados ou ?abrir=historico
try {
  const atalho = new URLSearchParams(location.search).get("abrir");
  if (atalho === "dados") abrirDados();
  else if (atalho === "historico") abrirHistorico();
  if (atalho) history.replaceState(null, "", location.pathname);
} catch {}
