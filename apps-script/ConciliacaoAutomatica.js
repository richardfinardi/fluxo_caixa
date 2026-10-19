// V5.17 - Conciliacao conservadora de antecipacoes e correcao de datas.
// Nao cria lancamentos novos e nao inventa correspondencias em casos ambiguos.

function descricaoForteBancoV517_(mov, lanc) {
  var banco = normalizarTextoConciliacao_([mov.descricao, mov.descricaoOriginal].join(" "));
  var fluxo = normalizarTextoConciliacao_(lanc.descricao);
  if (!banco || !fluxo) return false;

  // O titulo de agenda costuma conter informacoes adicionais entre parenteses.
  var nome = fluxo.replace(/^FATURAMENTO\s*:\s*/, "").split(" (")[0]
    .replace(/\s*-\s*PARCELA\s+\d+\s*\/\s*\d+.*/, "").trim();
  var genericos = {
    FATURAMENTO: 1, PAGAMENTO: 1, RECEBIMENTO: 1, REFERENTE: 1,
    VISITA: 1, VISITAS: 1, SERVICO: 1, SERVICOS: 1, PARCELA: 1,
    TRANSFERENCIA: 1, CARTAO: 1, TARIFA: 1, MENSALIDADE: 1,
    DEBITO: 1, CREDITO: 1, CLIENTE: 1, COMPRA: 1
  };
  var tokensBanco = tokensRelevantesConciliacaoV59_(banco)
    .filter(function(t) { return !genericos[t]; });
  var tokensFluxo = tokensRelevantesConciliacaoV59_(nome)
    .filter(function(t) { return !genericos[t]; });
  var mapa = {};
  tokensBanco.forEach(function(t) { mapa[t] = true; });
  var comuns = tokensFluxo.filter(function(t) { return mapa[t]; });

  // Nome inteiro identificavel ou dois termos significativos em comum.
  if (nome.length >= 5 && banco.indexOf(nome) !== -1) return true;
  return comuns.length >= 2;
}

function autoConciliarAntecipacoesV517_() {
  var movimentos = lerMovimentosBancoV59_();
  var lancamentos = lerLancamentosConciliacaoV59_();
  var transferencias = detectarTransferenciasInternasV59_(movimentos).paresPorId;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shLanc = ss.getSheetByName("Lancamentos");
  var ocupados = {};
  var propostas = [];
  var colisoes = {};
  var tratados = 0;
  var falhas = [];

  // Impede vincular o mesmo titulo a mais de uma transacao.
  if (shLanc && shLanc.getLastRow() > 1) {
    var linhas = shLanc.getRange(2, 1, shLanc.getLastRow() - 1, 18).getValues();
    linhas.forEach(function(r) {
      if (String(r[15] || "").trim() && r[7]) ocupados[String(r[7])] = true;
      if (normalizarTextoConciliacao_(r[5]) === "PAGO NO CARTAO" && r[7]) {
        ocupados[String(r[7])] = true;
      }
    });
  }
  var shItens = ss.getSheetByName("ConciliacaoBancoItens");
  if (shItens && shItens.getLastRow() > 1) {
    shItens.getRange(2, 1, shItens.getLastRow() - 1, 5).getValues().forEach(function(r) {
      if (normalizarTextoConciliacao_(r[1]) === "FLUXO" && r[2]) ocupados[String(r[2])] = true;
    });
  }

  movimentos.forEach(function(mov) {
    var id = String(mov.idPluggy || "");
    var valor = Math.abs(Number(mov.valor || 0));
    var situacao = normalizarTextoConciliacao_(mov.statusBanco);
    if (!id || !valor || transferencias[id] || parecePagamentoCartaoV513_(mov)) return;
    // Nunca consolidar movimentacao bancaria ainda pendente/falha.
    if (/PENDING|PROCESSING|SCHEDULED|CANCEL|FAILED|REJECT|PENDENTE/.test(situacao)) return;

    var tipo = Number(mov.valor || 0) < 0 ? "DESPESA" : "RECEITA";
    var candidatos = lancamentos.filter(function(lanc) {
      var idLanc = String(lanc.idLancamento || "");
      if (!idLanc || ocupados[idLanc]) return false;
      var status = normalizarTextoConciliacao_(lanc.status);
      if (status !== "PROJETADO" && status !== "EM ABERTO") return false;
      if (normalizarTextoConciliacao_(lanc.tipo) !== tipo) return false;
      if (Math.abs(Number(lanc.valor || 0) - valor) > 0.01) return false;
      if (!descricaoForteBancoV517_(mov, lanc)) return false;
      var dataMov = String(mov.data || "");
      var dataPrevista = String(lanc.data || "");
      if (!dataMov || !dataPrevista) return false;
      var dias = diferencaDiasConciliacaoV59_(dataMov, dataPrevista);
      // Admite antecipacao de ate 60 dias; atraso de ate 15 dias.
      if (dataPrevista > dataMov && dias > 60) return false;
      if (dataPrevista <= dataMov && dias > 15) return false;
      return true;
    });

    // Correspondencia exata e UNICA. N:N e repeticoes vao para revisao manual.
    if (candidatos.length !== 1) return;
    var lanc = candidatos[0];
    var idLancamento = String(lanc.idLancamento);
    propostas.push({ idPluggy: id, idLancamento: idLancamento });
    colisoes[idLancamento] = (colisoes[idLancamento] || 0) + 1;
  });

  propostas.forEach(function(p) {
    if (colisoes[p.idLancamento] !== 1) return;
    try {
      conciliarMovimentoBancoV510({
        idPluggy: p.idPluggy,
        idLancamento: p.idLancamento
      });
      ocupados[p.idLancamento] = true;
      tratados++;
      registrarLog_("BANCO_AUTO_CONCILIADO", p.idLancamento, "Pluggy=" + p.idPluggy);
    } catch (e) {
      falhas.push({
        idPluggy: p.idPluggy,
        erro: e && e.message ? e.message : String(e)
      });
    }
  });

  return { conciliados: tratados, pendentes: Math.max(0, movimentos.length - tratados), erros: falhas };
}

function corrigirDatasAntecipadasV517_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shBanco = ss.getSheetByName("MovimentosBanco");
  var shLanc = ss.getSheetByName("Lancamentos");
  if (!shBanco || shBanco.getLastRow() < 2 || !shLanc || shLanc.getLastRow() < 2) {
    return { corrigidos: 0 };
  }

  var datasPorId = {};
  var datasPorGrupo = {};
  shBanco.getRange(2, 1, shBanco.getLastRow() - 1, 14).getValues().forEach(function(r) {
    var id = String(r[0] || "").trim();
    var data = r[2] ? isoData_(r[2]) : "";
    var grupo = String(r[13] || "").trim();
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return;
    datasPorId[id] = data;
    // Para N:N com movimentos em dias diferentes, total liquidado na ultima data.
    if (grupo && (!datasPorGrupo[grupo] || datasPorGrupo[grupo] < data)) {
      datasPorGrupo[grupo] = data;
    }
  });

  var linhas = shLanc.getRange(2, 1, shLanc.getLastRow() - 1, 18).getValues();
  var corrigidos = 0;
  linhas.forEach(function(r, i) {
    if (normalizarTextoConciliacao_(r[5]) !== "CONSOLIDADO") return;
    var idMov = String(r[15] || "").trim();
    if (!idMov) return;
    var efetiva = idMov.indexOf("GRUPO:") === 0
      ? datasPorGrupo[idMov.substring(6)]
      : datasPorId[idMov];
    if (!efetiva || !/^\d{4}-\d{2}-\d{2}$/.test(efetiva)) return;

    var dataAtual = r[0] ? isoData_(r[0]) : "";
    if (dataAtual === efetiva) return;
    var linha = i + 2;

    // Grava referencia ANTES da mudanca; processo idempotente.
    if (!r[17] && dataAtual) shLanc.getRange(linha, 18).setValue(dataAtual);
    shLanc.getRange(linha, 1).setValue(new Date(efetiva + "T12:00:00"));
    corrigidos++;
  });

  if (corrigidos) {
    registrarLog_("BANCO_DATAS_REALIZADAS", "", corrigidos + " lancamento(s) alinhados com a data bancaria");
  }
  return { corrigidos: corrigidos };
}
