var VERSAO_SISTEMA = "5.10.4";
var ESTRUTURA_CACHE_EXECUCAO_ = false;
var COL_LANC_ID = 8;
var COL_LANC_ORIGEM = 9;
var COL_LANC_CHAVE = 10;
var COL_LANC_DATA_CALCULADA = 11;
var COL_LANC_OVERRIDE = 12;
var FERIADOS_CACHE_EXECUCAO_ = null;
var ULTIMO_ID_EXECUCAO_ = 0;

function doGet(e) {
  var dados = obterDadosIniciais();
  var output = ContentService.createTextOutput(JSON.stringify(dados));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function doPost(e) {
  var saida = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  var lock = null;
  try {
    var payloadRaw = e && e.postData ? e.postData.contents : "{}";
    var dadosRecebidos = JSON.parse(payloadRaw || "{}");
    var nomeFuncao = String(dadosRecebidos.funcao || "");
    var argumentos = dadosRecebidos.args;
    var retornarDados = dadosRecebidos.retornarDados === true;

    var permitidas = {
      obterDadosIniciais: true,
      atualizarDatasLoteBackend: true,
      excluirLinha: true,
      excluirLancamentoAvancado: true,
      atualizarClienteBackend: true,
      salvarRegra: true,
      atualizarLancamentoAvancado: true,
      atualizarLancamentoBackend: true,
      salvarLancamentoManual: true,
      salvarContasRecorrentesMaster: true,
      salvarCategoria: true,
      salvarCondicaoPagamento: true,
      sincronizarCalendarBackend: true,
      faturamentoImediatoFila: true,
      liquidarLancamentoBackend: true,
      marcarEmAbertoBackend: true,
      enviarAlertasFaturamentoSite: true,
      importarMovimentosBanco15Dias: true,
      obterConciliacaoBancoV59: true,
      conciliarMovimentoBancoV510: true,
      criarLancamentoBancoV510: true,
      ignorarMovimentoBancoV510: true,
      confirmarTransferenciaBancoV510: true,
      conciliarMovimentosBancoLoteV5101: true,
      processarMovimentosBancoLoteV5102: true
    };
    if (!permitidas[nomeFuncao]) throw new Error("Função não permitida: " + nomeFuncao);
    if (typeof this[nomeFuncao] !== "function") throw new Error("Função não encontrada: " + nomeFuncao);

    var somenteLeitura = nomeFuncao === "obterDadosIniciais" || nomeFuncao === "enviarAlertasFaturamentoSite" || nomeFuncao === "obterConciliacaoBancoV59";
    if (!somenteLeitura) {
      lock = LockService.getScriptLock();
      lock.waitLock(30000);
    }

    var resultado;
    if (Array.isArray(argumentos)) resultado = this[nomeFuncao].apply(null, argumentos);
    else if (argumentos !== null && argumentos !== undefined) resultado = this[nomeFuncao](argumentos);
    else resultado = this[nomeFuncao]();

    // V5.10.4: devolve o estado atualizado na MESMA chamada das gravações.
    // Isso elimina a segunda ida ao Apps Script que deixava a interface lenta após cada ação.
    if (retornarDados && !somenteLeitura) {
      resultado = { mensagem: resultado, dados: obterDadosIniciais() };
    }

    saida.setContent(JSON.stringify(resultado));
    return saida;
  } catch (erro) {
    saida.setContent(JSON.stringify({ erro: erro.toString(), detalhe: "Erro interno no doPost V5.10.4" }));
    return saida;
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (eLock) {}
    }
  }
}

function garantirCabecalhos_(sheet, cabecalhos) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalhos.length).setValues([cabecalhos]);
    return;
  }
  var atuais = sheet.getRange(1, 1, 1, cabecalhos.length).getValues()[0];
  var mudou = false;
  for (var c = 0; c < cabecalhos.length; c++) {
    if (!atuais[c]) { atuais[c] = cabecalhos[c]; mudou = true; }
  }
  if (mudou) sheet.getRange(1, 1, 1, cabecalhos.length).setValues([atuais]);
}

function gerarIdNumerico_() {
  var base = new Date().getTime() * 1000;
  ULTIMO_ID_EXECUCAO_ = Math.max(base, ULTIMO_ID_EXECUCAO_ + 1);
  return ULTIMO_ID_EXECUCAO_;
}

function isoData_(valor) {
  if (!valor) return "";
  var d = valor instanceof Date ? new Date(valor.getTime()) : new Date(String(valor).substring(0, 10) + "T12:00:00");
  if (isNaN(d.getTime())) return String(valor).substring(0, 10);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function normalizarValorTerminoRecorrencia_(tipoTermino, valor) {
  var tipo = String(tipoTermino || "nunca").toLowerCase().trim();
  if (!valor) return "";
  if (tipo === "data") {
    var iso = isoData_(valor);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error("Data de término inválida na recorrência: " + valor);
    return iso;
  }
  if (tipo === "ocorrencias") return String(Math.max(0, Number(valor) || 0));
  return "";
}

function normalizarChave_(texto) {
  return String(texto || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function chaveRecorrenciaPorData_(idSerie, dataIso, frequencia) {
  if (String(frequencia || "").toLowerCase() === "mensal") return "REC|" + idSerie + "|M|" + dataIso.substring(0, 7);
  return "REC|" + idSerie + "|W|" + dataIso;
}

function garantirEstruturaV58_() {
  if (ESTRUTURA_CACHE_EXECUCAO_) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lanc = ss.getSheetByName("Lancamentos") || ss.insertSheet("Lancamentos");
  var regras = ss.getSheetByName("RegrasClientes") || ss.insertSheet("RegrasClientes");
  var cats = ss.getSheetByName("Categorias") || ss.insertSheet("Categorias");
  var cond = ss.getSheetByName("CondicoesPagamento") || ss.insertSheet("CondicoesPagamento");
  var rec = ss.getSheetByName("RecorrenciasConfig") || ss.insertSheet("RecorrenciasConfig");
  var exc = ss.getSheetByName("RecorrenciasExcecoes") || ss.insertSheet("RecorrenciasExcecoes");
  var fer = ss.getSheetByName("Feriados") || ss.insertSheet("Feriados");
  var log = ss.getSheetByName("LOG") || ss.insertSheet("LOG");

  var props = PropertiesService.getScriptProperties();
  var versaoEstrutura = props.getProperty("FLUXO_CAIXA_ESTRUTURA");
  var precisaMigrar = versaoEstrutura !== "5.10";

  if (!precisaMigrar) {
    ESTRUTURA_CACHE_EXECUCAO_ = true;
    return;
  }

  garantirCabecalhos_(lanc, ["Data", "Descricao", "Valor", "Tipo", "Categoria", "Status", "RecorrenciaId", "IdLancamento", "Origem", "ChaveOrigem", "DataCalculada", "OverrideManual", "ValorPrevisto", "ValorRealizado", "DiferencaBanco", "IdMovimentoBanco", "DataConciliacao", "DataPrevistaOriginal"]);
  garantirCabecalhos_(regras, ["Cliente", "ValorVisita", "Condicao", "NovoValor", "DataVigor", "PorHora", "IdCliente"]);
  garantirCabecalhos_(cats, ["Nome", "IdCategoria"]);
  garantirCabecalhos_(cond, ["Nome", "Periodo", "DiaCorte", "MesDeslocamento", "DiaPagamento", "IdCondicao"]);
  garantirCabecalhos_(rec, ["IdSerie", "Descricao", "Valor", "Tipo", "Categoria", "Frequencia", "DiaAlvo", "DataInicio", "TipoTermino", "ValorTermino"]);
  garantirCabecalhos_(exc, ["IdSerie", "ChaveOcorrencia", "DataOcorrencia", "Motivo", "CriadoEm"]);
  garantirCabecalhos_(fer, ["Data", "Descricao", "Ativo"]);
  garantirCabecalhos_(log, ["DataHora", "Acao", "Registro", "Detalhes"]);

  if (fer.getLastRow() === 1) {
    fer.getRange(2, 1, 8, 3).setValues([
      ["2026-02-16", "Carnaval", "SIM"],
      ["2026-02-17", "Carnaval", "SIM"],
      ["2026-04-03", "Sexta-feira Santa", "SIM"],
      ["2026-06-04", "Corpus Christi", "SIM"],
      ["2027-02-08", "Carnaval", "SIM"],
      ["2027-02-09", "Carnaval", "SIM"],
      ["2027-03-26", "Sexta-feira Santa", "SIM"],
      ["2027-05-27", "Corpus Christi", "SIM"]
    ]);
  }

  var recMap = {};
  if (rec.getLastRow() > 1) {
    var recDados = rec.getRange(2, 1, rec.getLastRow() - 1, 10).getValues();
    recDados.forEach(function(r) { if (r[0]) recMap[String(r[0])] = { frequencia: String(r[5] || "") }; });
  }

  // Migração única da V5.8: IDs/origem + correção dos status futuros do modelo antigo.
  if (lanc.getLastRow() > 1) {
    var n = lanc.getLastRow() - 1;
    var base = lanc.getRange(2, 1, n, 12).getValues();
    var mudou = false;
    var hojeIso = isoData_(new Date());

    for (var i = 0; i < base.length; i++) {
      var r = base[i];
      if (!r[0]) continue;

      var id = r[7];
      var origem = String(r[8] || "").trim();
      var chave = String(r[9] || "").trim();
      var dataCalc = r[10];
      var override = String(r[11] || "").trim();
      var eraLegado = !id && !origem && !chave;

      if (!id) { id = gerarIdNumerico_(); r[7] = id; mudou = true; }
      if (!origem) {
        if (r[6]) origem = "RECORRENCIA";
        else if (String(r[1] || "").indexOf("Faturamento:") === 0) origem = "CALENDAR";
        else origem = "MANUAL";
        r[8] = origem;
        mudou = true;
      }

      var dataIso = isoData_(r[0]);
      if (!chave) {
        if (origem === "RECORRENCIA" && r[6]) {
          var cfg = recMap[String(r[6])] || {};
          chave = chaveRecorrenciaPorData_(String(r[6]), dataIso, cfg.frequencia);
        } else if (origem === "CALENDAR") chave = "CAL|" + normalizarChave_(r[1]);
        else chave = "MAN|" + id;
        r[9] = chave;
        mudou = true;
      }

      if (!dataCalc && (origem === "CALENDAR" || origem === "RECORRENCIA")) {
        r[10] = dataIso;
        dataCalc = dataIso;
        mudou = true;
      }

      if (eraLegado && origem === "CALENDAR" && String(r[5] || "").toLowerCase() === "projetado" && !override) {
        r[11] = "DATA";
        mudou = true;
      }

      // Regra nova: futuro não pode entrar como realizado.
      // - recorrência/manual futura antiga -> Projetado
      // - faturamento futuro que já estava "Consolidado" no modelo antigo -> Em Aberto
      var status = String(r[5] || "Projetado").toLowerCase().trim();
      if (status === "consolidado") {
        if (origem === "CALENDAR" && dataIso >= hojeIso) { r[5] = "Em Aberto"; mudou = true; }
        else if (origem === "RECORRENCIA" && dataIso >= hojeIso) { r[5] = "Projetado"; mudou = true; }
        else if (origem === "MANUAL" && dataIso > hojeIso) { r[5] = "Projetado"; mudou = true; }
      }
    }
    if (mudou) lanc.getRange(2, 1, n, 12).setValues(base);
  }

  function preencherIds(sheet, colBase, colId) {
    if (sheet.getLastRow() <= 1) return;
    var qtd = sheet.getLastRow() - 1;
    var bases = sheet.getRange(2, colBase, qtd, 1).getValues();
    var ids = sheet.getRange(2, colId, qtd, 1).getValues();
    var alterou = false;
    for (var x = 0; x < qtd; x++) {
      if (bases[x][0] && !ids[x][0]) { ids[x][0] = gerarIdNumerico_(); alterou = true; }
    }
    if (alterou) sheet.getRange(2, colId, qtd, 1).setValues(ids);
  }
  preencherIds(regras, 1, 7);
  preencherIds(cats, 1, 2);
  preencherIds(cond, 1, 6);

  props.setProperty("FLUXO_CAIXA_ESTRUTURA", "5.10");
  ESTRUTURA_CACHE_EXECUCAO_ = true;
}

function encontrarLinhaPorId_(sheet, id, colunaId) {
  if (!sheet || sheet.getLastRow() <= 1) return -1;
  var alvo = String(id);
  var vals = sheet.getRange(2, colunaId, sheet.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]) === alvo) return i + 2;
  return -1;
}

function colunaIdPorAba_(aba) {
  if (aba === "Lancamentos") return 8;
  if (aba === "RegrasClientes") return 7;
  if (aba === "Categorias") return 2;
  if (aba === "CondicoesPagamento") return 6;
  if (aba === "RecorrenciasConfig") return 1;
  return 0;
}

function registrarLog_(acao, registro, detalhes) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName("LOG") || ss.insertSheet("LOG");
    garantirCabecalhos_(sh, ["DataHora", "Acao", "Registro", "Detalhes"]);
    sh.appendRow([new Date(), acao, String(registro || ""), String(detalhes || "")]);
  } catch (e) {}
}

function obterDadosIniciais() {
  garantirEstruturaV58_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetLancamentos = ss.getSheetByName("Lancamentos");
  var sheetRegras = ss.getSheetByName("RegrasClientes");
  var sheetCategorias = ss.getSheetByName("Categorias");
  var sheetCondicoes = ss.getSheetByName("CondicoesPagamento");
  var sheetRecConfig = ss.getSheetByName("RecorrenciasConfig");

  var lancamentos = [];
  var dataL = sheetLancamentos.getDataRange().getValues();
  for (var i = 1; i < dataL.length; i++) {
    if (dataL[i][0]) {
      lancamentos.push({
        id: Number(dataL[i][7]),
        data: isoData_(dataL[i][0]),
        descricao: dataL[i][1],
        valor: Number(dataL[i][2]),
        tipo: dataL[i][3],
        categoria: dataL[i][4] || "Sem Categoria",
        status: dataL[i][5] || "Projetado",
        recorrenciaId: dataL[i][6] ? String(dataL[i][6]) : "",
        origem: dataL[i][8] ? String(dataL[i][8]) : "",
        chaveOrigem: dataL[i][9] ? String(dataL[i][9]) : "",
        dataCalculada: dataL[i][10] ? isoData_(dataL[i][10]) : "",
        overrideManual: dataL[i][11] ? String(dataL[i][11]) : ""
      });
    }
  }

  var regras = [];
  var dataR = sheetRegras.getDataRange().getValues();
  for (var j = 1; j < dataR.length; j++) {
    if (dataR[j][0]) {
      regras.push({
        id: Number(dataR[j][6]),
        cliente: dataR[j][0],
        valorVisita: Number(dataR[j][1]),
        condicaoNome: dataR[j][2],
        novoValor: dataR[j][3] ? Number(dataR[j][3]) : "",
        dataVigor: dataR[j][4] ? isoData_(dataR[j][4]) : "",
        porHora: dataR[j][5] ? String(dataR[j][5]).toUpperCase().trim() === "SIM" : false
      });
    }
  }

  var categorias = [];
  var dataC = sheetCategorias.getDataRange().getValues();
  for (var k = 1; k < dataC.length; k++) if (dataC[k][0]) categorias.push({ id: Number(dataC[k][1]), nome: dataC[k][0] });

  var condicoes = [];
  var dataCond = sheetCondicoes.getDataRange().getValues();
  for (var c = 1; c < dataCond.length; c++) {
    if (dataCond[c][0]) {
      condicoes.push({
        id: Number(dataCond[c][5]), nome: dataCond[c][0], periodo: dataCond[c][1], diaCorte: Number(dataCond[c][2]),
        mesDeslocamento: Number(dataCond[c][3]), diaPagamento: dataCond[c][4] !== undefined && dataCond[c][4] !== null ? String(dataCond[c][4]).trim() : "0"
      });
    }
  }

  var recorrenciasConfig = [];
  var dataRec = sheetRecConfig.getDataRange().getValues();
  for (var r = 1; r < dataRec.length; r++) {
    if (dataRec[r][0]) {
      recorrenciasConfig.push({
        idSerie: String(dataRec[r][0]), descricao: dataRec[r][1], valor: Number(dataRec[r][2]), tipo: dataRec[r][3], categoria: dataRec[r][4],
        frequencia: dataRec[r][5], diaAlvo: Number(dataRec[r][6]), dataInicio: isoData_(dataRec[r][7]),
        tipoTermino: dataRec[r][8] ? String(dataRec[r][8]) : "nunca",
        valorTermino: normalizarValorTerminoRecorrencia_(dataRec[r][8] ? String(dataRec[r][8]) : "nunca", dataRec[r][9])
      });
    }
  }
  return { versao: VERSAO_SISTEMA, lancamentos: lancamentos, regras: regras, categorias: categorias, condicoes: condicoes, recorrenciasConfig: recorrenciasConfig };
}

function hojeIso_() {
  return isoData_(new Date());
}

function statusInicialLancamentoManual_(dataIso) {
  return String(dataIso || "") <= hojeIso_() ? "Consolidado" : "Projetado";
}

// Compatibilidade com o botão "A Faturar": faturar NÃO significa receber.
// Na V5.8, o título passa para Em Aberto e só vira Consolidado quando o dinheiro entrar.
function faturamentoImediatoFila(idLancamento) {
  garantirEstruturaV58_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lancamentos");
  var linha = encontrarLinhaPorId_(sheet, idLancamento, COL_LANC_ID);
  if (linha <= 1) throw new Error("Registro não encontrado.");
  var row = sheet.getRange(linha, 1, 1, 12).getValues()[0];
  row[5] = "Em Aberto";
  sheet.getRange(linha, 1, 1, 12).setValues([row]);
  registrarLog_("FATURAR", idLancamento, "Título marcado como Em Aberto");
  return "Faturado! Título agora está Em Aberto aguardando recebimento.";
}

function liquidarLancamentoBackend(idLancamento) {
  garantirEstruturaV58_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lancamentos");
  var linha = encontrarLinhaPorId_(sheet, idLancamento, COL_LANC_ID);
  if (linha <= 1) throw new Error("Lançamento não encontrado.");

  var row = sheet.getRange(linha, 1, 1, 12).getValues()[0];
  var dataAnterior = row[0] ? isoData_(row[0]) : "";
  var tipo = String(row[3] || "");
  if (!row[10] && dataAnterior) row[10] = dataAnterior;
  row[0] = new Date(hojeIso_() + "T12:00:00");
  row[5] = "Consolidado";
  row[11] = "LIQUIDADO";
  sheet.getRange(linha, 1, 1, 12).setValues([row]);

  registrarLog_(tipo === "Receita" ? "RECEBER" : "PAGAR", idLancamento, "Liquidado em " + hojeIso_() + "; vencimento anterior=" + dataAnterior);
  return tipo === "Receita" ? "Recebimento consolidado!" : "Pagamento consolidado!";
}

function marcarEmAbertoBackend(idLancamento, novaData) {
  garantirEstruturaV58_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lancamentos");
  var linha = encontrarLinhaPorId_(sheet, idLancamento, COL_LANC_ID);
  if (linha <= 1) throw new Error("Lançamento não encontrado.");

  var row = sheet.getRange(linha, 1, 1, 12).getValues()[0];
  var dataAnterior = row[0] ? isoData_(row[0]) : "";
  row[5] = "Em Aberto";

  var novaIso = String(novaData || "").trim();
  if (novaIso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(novaIso)) throw new Error("Nova data inválida.");
    if (!row[10] && dataAnterior) row[10] = dataAnterior;
    row[0] = new Date(novaIso + "T12:00:00");
    row[11] = "DATA";
  }

  sheet.getRange(linha, 1, 1, 12).setValues([row]);
  registrarLog_("MANTER_EM_ABERTO", idLancamento, novaIso ? ("Adiado de " + dataAnterior + " para " + novaIso) : ("Mantido no vencimento " + dataAnterior));
  return novaIso ? "Mantido em aberto e adiado para " + novaIso.split('-').reverse().join('/') + "." : "Mantido em aberto. Se não liquidar, continuará aparecendo nas pendências.";
}

function salvarCondicaoPagamento(dados) {
  garantirEstruturaV58_();
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CondicoesPagamento");
  var id = gerarIdNumerico_();
  sh.appendRow([dados.nome, dados.periodo, Number(dados.diaCorte), Number(dados.mesDeslocamento), String(dados.diaPagamento), id]);
  registrarLog_("CRIAR_CONDICAO", id, dados.nome);
  return "Condição cadastrada!";
}

function salvarRegra(dados) {
  garantirEstruturaV58_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RegrasClientes");
  var id = gerarIdNumerico_();
  var dataVigor = dados.dataVigor ? new Date(dados.dataVigor + "T12:00:00") : "";
  var porHora = String(dados.porHora || "NÃO").toUpperCase() === "SIM" ? "SIM" : "NÃO";
  sheet.appendRow([dados.cliente, Number(dados.valorVisita), dados.condicaoNome, dados.novoValor ? Number(dados.novoValor) : "", dataVigor, porHora, id]);
  registrarLog_("CRIAR_CLIENTE", id, dados.cliente);
  return "Cliente " + dados.cliente + " salvo com sucesso!";
}

function atualizarClienteBackend(dados) {
  garantirEstruturaV58_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RegrasClientes");
  var linha = encontrarLinhaPorId_(sheet, dados.id, 7);
  if (linha > 1) {
    var valVigor = dados.dataVigor ? new Date(dados.dataVigor + "T12:00:00") : "";
    var porHora = String(dados.porHora || "NÃO").toUpperCase() === "SIM" ? "SIM" : "NÃO";
    sheet.getRange(linha, 1, 1, 6).setValues([[dados.cliente, Number(dados.valorVisita), dados.condicaoNome, dados.novoValor ? Number(dados.novoValor) : "", valVigor, porHora]]);
    registrarLog_("ATUALIZAR_CLIENTE", dados.id, dados.cliente);
    return "Cliente atualizado!";
  }
  throw new Error("Cliente não encontrado.");
}

function salvarCategoria(dados) {
  garantirEstruturaV58_();
  var id = gerarIdNumerico_();
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Categorias").appendRow([dados.nome, id]);
  registrarLog_("CRIAR_CATEGORIA", id, dados.nome);
  return "Categoria salva!";
}

function salvarLancamentoManual(dados) {
  garantirEstruturaV58_();
  var dataIso = String(dados.data || "");
  var dataAjustada = new Date(dataIso + "T12:00:00");
  var id = gerarIdNumerico_();
  var chave = "MAN|" + id;
  var status = statusInicialLancamentoManual_(dataIso);
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lancamentos").appendRow([dataAjustada, dados.descricao, Number(dados.valor), dados.tipo, dados.categoria, status, "", id, "MANUAL", chave, "", ""]);
  registrarLog_("CRIAR_LANCAMENTO", id, dados.descricao + "; status=" + status);
  return status === "Consolidado" ? "Lançamento realizado e consolidado!" : "Lançamento futuro salvo como Projetado!";
}

function atualizarLancamentoBackend(dados) {
  garantirEstruturaV58_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lancamentos");
  var linha = encontrarLinhaPorId_(sheet, dados.id, COL_LANC_ID);
  if (linha > 1) {
    var dataAjustada = new Date(dados.data + "T12:00:00");
    sheet.getRange(linha, 1, 1, 5).setValues([[dataAjustada, dados.descricao, Number(dados.valor), dados.tipo, dados.categoria]]);
    var origem = String(sheet.getRange(linha, COL_LANC_ORIGEM).getValue() || "");
    if (origem === "CALENDAR") sheet.getRange(linha, COL_LANC_OVERRIDE).setValue("TOTAL");
    registrarLog_("ATUALIZAR_LANCAMENTO", dados.id, dados.descricao);
    return "Atualizado!";
  }
  throw new Error("Lançamento não encontrado.");
}

function excluirLinha(aba, id) {
  garantirEstruturaV58_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(aba);
  if (!sheet) throw new Error("Aba não encontrada: " + aba);
  var colId = colunaIdPorAba_(aba);
  var linha = colId ? encontrarLinhaPorId_(sheet, id, colId) : Number(id);
  if (linha > 1) {
    sheet.deleteRow(linha);
    registrarLog_("EXCLUIR_" + aba.toUpperCase(), id, "Registro excluído");
    return "Removido!";
  }
  throw new Error("Registro não encontrado.");
}

function salvarContasRecorrentesMaster(dados) {
  garantirEstruturaV58_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetConfig = ss.getSheetByName("RecorrenciasConfig");
  var idSerie = "serie_" + new Date().getTime() + "_" + Math.floor(Math.random() * 1000);
  var dtInicio = new Date(dados.dataInicio + "T12:00:00");
  var tipoTermino = String(dados.tipoTermino || "nunca");
  var valorTerminoNormalizado = normalizarValorTerminoRecorrencia_(tipoTermino, dados.valorTermino);
  var valorTerminoPlanilha = valorTerminoNormalizado;
  if (tipoTermino === "data" && valorTerminoNormalizado) valorTerminoPlanilha = new Date(valorTerminoNormalizado + "T12:00:00");
  sheetConfig.appendRow([idSerie, dados.descricao, Number(dados.valor), dados.tipo, dados.categoria, dados.frequencia, Number(dados.diaAlvo), dtInicio, tipoTermino, valorTerminoPlanilha]);
  gerarParcelasRecorrencia_(idSerie, "");
  registrarLog_("CRIAR_RECORRENCIA", idSerie, dados.descricao);
  return "Conta recorrente configurada com sucesso!";
}

function obterRecorrenciaConfigPorId_(idSerie) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RecorrenciasConfig");
  if (!sh || sh.getLastRow() <= 1) return null;
  var dados = sh.getRange(2, 1, sh.getLastRow() - 1, 10).getValues();
  for (var i = 0; i < dados.length; i++) {
    if (String(dados[i][0]) === String(idSerie)) {
      return {
        linha: i + 2, idSerie: String(dados[i][0]), descricao: dados[i][1], valor: Number(dados[i][2]), tipo: dados[i][3], categoria: dados[i][4],
        frequencia: String(dados[i][5] || "Mensal"), diaAlvo: Number(dados[i][6]), dataInicio: isoData_(dados[i][7]),
        tipoTermino: dados[i][8] ? String(dados[i][8]) : "nunca",
        valorTermino: normalizarValorTerminoRecorrencia_(dados[i][8] ? String(dados[i][8]) : "nunca", dados[i][9])
      };
    }
  }
  return null;
}

function diasNoMes_(ano, mesZero) { return new Date(ano, mesZero + 1, 0).getDate(); }

function montarOcorrenciasRecorrencia_(rec) {
  var inicio = new Date(rec.dataInicio + "T12:00:00");
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  var horizontePadrao = new Date(hoje.getTime()); horizontePadrao.setDate(horizontePadrao.getDate() + 180);
  var terminoData = null;
  if (rec.tipoTermino === "data" && rec.valorTermino) {
    var terminoIso = normalizarValorTerminoRecorrencia_("data", rec.valorTermino);
    terminoData = new Date(terminoIso + "T23:59:59");
    if (isNaN(terminoData.getTime())) throw new Error("Data de término inválida na recorrência " + rec.idSerie + ": " + rec.valorTermino);
  }
  var maxOcorr = rec.tipoTermino === "ocorrencias" ? Math.max(0, Number(rec.valorTermino) || 0) : 0;
  var out = [];
  var contador = 0;
  var seguranca = 0;

  if (rec.frequencia === "Semanal") {
    var alvo = Number(rec.diaAlvo) % 7; // 1=Seg ... 7=Dom -> 0=Dom
    var cursor = new Date(inicio.getTime());
    var diff = (alvo - cursor.getDay() + 7) % 7;
    cursor.setDate(cursor.getDate() + diff);
    while (seguranca++ < 600) {
      var base = new Date(cursor.getTime());
      if (base.getTime() >= inicio.getTime()) contador++;
      if (maxOcorr && contador > maxOcorr) break;
      if (terminoData && base.getTime() > terminoData.getTime()) break;
      if (!terminoData && !maxOcorr && base.getTime() > horizontePadrao.getTime()) break;
      if (base.getTime() >= inicio.getTime()) {
        var ajustada = ajustarFinaisDeSemanaEFeriados(new Date(base.getTime()));
        var baseIso = isoData_(base);
        out.push({ data: ajustada, dataIso: isoData_(ajustada), dataBaseIso: baseIso, chave: "REC|" + rec.idSerie + "|W|" + baseIso, numero: contador });
      }
      cursor.setDate(cursor.getDate() + 7);
    }
  } else {
    var cursorMes = new Date(inicio.getFullYear(), inicio.getMonth(), 1, 12, 0, 0);
    while (seguranca++ < 600) {
      var ano = cursorMes.getFullYear(), mes = cursorMes.getMonth();
      var dia = Math.min(Math.max(1, Number(rec.diaAlvo) || 1), diasNoMes_(ano, mes));
      var baseM = new Date(ano, mes, dia, 12, 0, 0);
      if (baseM.getTime() >= inicio.getTime()) contador++;
      if (maxOcorr && contador > maxOcorr) break;
      if (terminoData && baseM.getTime() > terminoData.getTime()) break;
      if (!terminoData && !maxOcorr && baseM.getTime() > horizontePadrao.getTime()) break;
      if (baseM.getTime() >= inicio.getTime()) {
        var ajustadaM = ajustarFinaisDeSemanaEFeriados(new Date(baseM.getTime()));
        var periodo = ano + "-" + String(mes + 1).padStart(2, "0");
        out.push({ data: ajustadaM, dataIso: isoData_(ajustadaM), dataBaseIso: isoData_(baseM), chave: "REC|" + rec.idSerie + "|M|" + periodo, numero: contador });
      }
      cursorMes.setMonth(cursorMes.getMonth() + 1);
    }
  }
  return out;
}

function obterExcecoesRecorrencia_(idSerie) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RecorrenciasExcecoes");
  var mapa = {};
  if (!sh || sh.getLastRow() <= 1) return mapa;
  var dados = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  for (var i = 0; i < dados.length; i++) {
    if (String(dados[i][0]) === String(idSerie)) {
      mapa[String(dados[i][1])] = true;
      if (dados[i][2]) mapa["DATE|" + isoData_(dados[i][2])] = true;
    }
  }
  return mapa;
}

function reconciliarParcelasRecorrencia_(idSerie) {
  var rec = obterRecorrenciaConfigPorId_(idSerie);
  if (!rec) return 0;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Lancamentos");
  if (!sh || sh.getLastRow() <= 1) return 0;

  var validas = {};
  montarOcorrenciasRecorrencia_(rec).forEach(function(o) { validas[o.chave] = true; });
  var hojeIso = hojeIso_();
  var dados = sh.getDataRange().getValues();
  var vistos = {};
  var finais = [dados[0].slice(0, 12)];
  var removidos = 0;

  for (var i = 1; i < dados.length; i++) {
    var row = dados[i].slice(0, 12);
    while (row.length < 12) row.push("");
    if (String(row[6] || "") !== String(idSerie)) { finais.push(row); continue; }

    var origem = String(row[8] || "");
    var dataIso = row[0] ? isoData_(row[0]) : "";
    var statusRow = String(row[5] || "").toLowerCase().trim();
    if ((origem && origem !== "RECORRENCIA") || !dataIso || dataIso < hojeIso || String(row[11] || "").trim() || statusRow === "consolidado" || statusRow === "em aberto") {
      finais.push(row); continue;
    }

    var chave = String(row[9] || "").trim();
    if (!chave) {
      var baseIso = row[10] ? isoData_(row[10]) : dataIso;
      chave = chaveRecorrenciaPorData_(idSerie, baseIso, rec.frequencia);
      row[8] = "RECORRENCIA";
      row[9] = chave;
      row[10] = baseIso;
    }

    if (!validas[chave] || vistos[chave]) { removidos++; continue; }
    vistos[chave] = true;
    finais.push(row);
  }

  if (removidos) {
    var limpar = Math.max(sh.getLastRow(), finais.length);
    sh.getRange(1, 1, limpar, 12).clearContent();
    sh.getRange(1, 1, finais.length, 12).setValues(finais);
    registrarLog_("RECONCILIAR_RECORRENCIA", idSerie, removidos + " parcela(s) futura(s) inválida(s)/duplicada(s) removida(s)");
  }
  return removidos;
}

function gerarParcelasRecorrencia_(idSerie, dataMinimaIso) {
  garantirEstruturaV58_();
  var rec = obterRecorrenciaConfigPorId_(idSerie);
  if (!rec) return 0;
  reconciliarParcelasRecorrencia_(idSerie);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Lancamentos");
  var dados = sh.getDataRange().getValues();
  var existentesChave = {};
  var existentesData = {};
  for (var i = 1; i < dados.length; i++) {
    if (String(dados[i][6] || "") !== String(idSerie)) continue;
    var chave = String(dados[i][9] || "");
    var dataIso = dados[i][0] ? isoData_(dados[i][0]) : "";
    if (chave) existentesChave[chave] = i + 1;
    if (dataIso) existentesData[dataIso] = i + 1;
  }
  var excecoes = obterExcecoesRecorrencia_(idSerie);
  var ocorrencias = montarOcorrenciasRecorrencia_(rec);
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  var minDate = dataMinimaIso ? new Date(dataMinimaIso + "T00:00:00") : hoje;
  var inserir = [];
  var status = "Projetado";

  ocorrencias.forEach(function(o) {
    var d0 = new Date(o.data.getFullYear(), o.data.getMonth(), o.data.getDate());
    if (d0.getTime() < hoje.getTime() || d0.getTime() < minDate.getTime()) return;
    if (excecoes[o.chave] || excecoes["DATE|" + o.dataIso]) return;
    if (existentesChave[o.chave]) return;
    if (existentesData[o.dataIso]) {
      var linhaLegada = existentesData[o.dataIso];
      if (!sh.getRange(linhaLegada, COL_LANC_CHAVE).getValue()) sh.getRange(linhaLegada, COL_LANC_CHAVE).setValue(o.chave);
      sh.getRange(linhaLegada, COL_LANC_ORIGEM).setValue("RECORRENCIA");
      sh.getRange(linhaLegada, COL_LANC_DATA_CALCULADA).setValue(o.dataBaseIso);
      return;
    }
    var id = gerarIdNumerico_();
    inserir.push([o.data, rec.descricao, rec.valor, rec.tipo, rec.categoria, status, rec.idSerie, id, "RECORRENCIA", o.chave, o.dataBaseIso, ""]);
    existentesChave[o.chave] = true;
    existentesData[o.dataIso] = true;
  });

  if (inserir.length) sh.getRange(sh.getLastRow() + 1, 1, inserir.length, 12).setValues(inserir);
  return inserir.length;
}

function gerarParcelasRecorrentesGerais() {
  garantirEstruturaV58_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shCfg = ss.getSheetByName("RecorrenciasConfig");
  var shLanc = ss.getSheetByName("Lancamentos");
  if (!shCfg || shCfg.getLastRow() <= 1) return 0;

  var cfgRows = shCfg.getRange(2, 1, shCfg.getLastRow() - 1, 10).getValues();
  var configs = {};
  var ordemIds = [];
  cfgRows.forEach(function(r) {
    if (!r[0]) return;
    var id = String(r[0]);
    configs[id] = {
      idSerie: id, descricao: r[1], valor: Number(r[2]), tipo: r[3], categoria: r[4], frequencia: String(r[5] || "Mensal"),
      diaAlvo: Number(r[6]), dataInicio: isoData_(r[7]), tipoTermino: r[8] ? String(r[8]) : "nunca",
      valorTermino: normalizarValorTerminoRecorrencia_(r[8] ? String(r[8]) : "nunca", r[9])
    };
    ordemIds.push(id);
  });

  var excecoesPorSerie = {};
  var shExc = ss.getSheetByName("RecorrenciasExcecoes");
  if (shExc && shExc.getLastRow() > 1) {
    shExc.getRange(2, 1, shExc.getLastRow() - 1, 5).getValues().forEach(function(r) {
      var id = String(r[0] || "");
      if (!id) return;
      if (!excecoesPorSerie[id]) excecoesPorSerie[id] = {};
      if (r[1]) excecoesPorSerie[id][String(r[1])] = true;
      if (r[2]) excecoesPorSerie[id]["DATE|" + isoData_(r[2])] = true;
    });
  }

  var ocorrenciasPorSerie = {};
  var validasPorSerie = {};
  ordemIds.forEach(function(id) {
    var ocorr = montarOcorrenciasRecorrencia_(configs[id]);
    ocorrenciasPorSerie[id] = ocorr;
    var mapa = {};
    ocorr.forEach(function(o) { mapa[o.chave] = true; });
    validasPorSerie[id] = mapa;
  });

  var dados = shLanc.getDataRange().getValues();
  var finais = [dados[0].slice(0, 12)];
  var existentes = {};
  var hojeIso = hojeIso_();
  var removidos = 0;

  for (var i = 1; i < dados.length; i++) {
    var row = dados[i].slice(0, 12);
    while (row.length < 12) row.push("");
    var recId = String(row[6] || "");
    var cfg = configs[recId];
    if (!cfg) { finais.push(row); continue; }

    var dataIso = row[0] ? isoData_(row[0]) : "";
    var chave = String(row[9] || "").trim();
    if (!chave && dataIso) {
      var baseIso = row[10] ? isoData_(row[10]) : dataIso;
      chave = chaveRecorrenciaPorData_(recId, baseIso, cfg.frequencia);
      row[8] = "RECORRENCIA";
      row[9] = chave;
      row[10] = baseIso;
    }

    if (!existentes[recId]) existentes[recId] = {};
    var override = String(row[11] || "").trim();
    var statusAtual = String(row[5] || "").toLowerCase().trim();
    var confirmado = statusAtual === "consolidado" || statusAtual === "em aberto";
    var deveValidar = dataIso && dataIso >= hojeIso && !override && !confirmado;
    if (deveValidar && (!validasPorSerie[recId][chave] || existentes[recId][chave])) {
      removidos++;
      continue;
    }
    if (chave) existentes[recId][chave] = true;
    finais.push(row);
  }

  var inserir = [];
  ordemIds.forEach(function(id) {
    var cfg = configs[id];
    var exc = excecoesPorSerie[id] || {};
    if (!existentes[id]) existentes[id] = {};
    (ocorrenciasPorSerie[id] || []).forEach(function(o) {
      if (o.dataIso < hojeIso) return;
      if (exc[o.chave] || exc["DATE|" + o.dataIso] || existentes[id][o.chave]) return;
      var novoId = gerarIdNumerico_();
      inserir.push([o.data, cfg.descricao, cfg.valor, cfg.tipo, cfg.categoria, "Projetado", cfg.idSerie, novoId, "RECORRENCIA", o.chave, o.dataBaseIso, ""]);
      existentes[id][o.chave] = true;
    });
  });

  if (removidos) {
    inserir.forEach(function(r) { finais.push(r); });
    var limpar = Math.max(shLanc.getLastRow(), finais.length);
    shLanc.getRange(1, 1, limpar, 12).clearContent();
    shLanc.getRange(1, 1, finais.length, 12).setValues(finais);
  } else if (inserir.length) {
    shLanc.getRange(shLanc.getLastRow() + 1, 1, inserir.length, 12).setValues(inserir);
  }

  if (removidos) registrarLog_("RECONCILIAR_RECORRENCIAS", "GERAL", removidos + " inválida(s)/duplicada(s) removida(s)");
  return inserir.length;
}

function excluirLancamentoAvancado(idLancamento, modo, recorrenciaId, dataCorte) {
  garantirEstruturaV58_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Lancamentos");

  if (modo === "unico") {
    var linha = encontrarLinhaPorId_(sh, idLancamento, COL_LANC_ID);
    if (linha <= 1) throw new Error("Lançamento não encontrado.");
    var row = sh.getRange(linha, 1, 1, 12).getValues()[0];
    var recId = String(row[6] || "");
    var chave = String(row[9] || "");
    if (recId && chave) ss.getSheetByName("RecorrenciasExcecoes").appendRow([recId, chave, isoData_(row[0]), "Exclusão individual", new Date()]);
    sh.deleteRow(linha);
    registrarLog_("EXCLUIR_PARCELA", idLancamento, recId || "Lançamento normal");
    return "Parcela removida!";
  }

  if (modo === "posteriores") {
    var recIdFinal = String(recorrenciaId || "").trim();
    var corte = dataCorte ? isoData_(dataCorte) : "";
    var linhaAlvo = encontrarLinhaPorId_(sh, idLancamento, COL_LANC_ID);
    if (linhaAlvo > 1) {
      var alvo = sh.getRange(linhaAlvo, 1, 1, 12).getValues()[0];
      if (!recIdFinal) recIdFinal = String(alvo[6] || "").trim();
      if (!corte) corte = isoData_(alvo[0]);
    }
    if (!recIdFinal) throw new Error("Não foi possível identificar a recorrência a cancelar.");
    if (!corte || !/^\d{4}-\d{2}-\d{2}$/.test(corte)) corte = "2000-01-01";

    var dados = sh.getDataRange().getValues();
    var finais = [dados[0].slice(0, 12)];
    var removidos = 0;
    for (var i = 1; i < dados.length; i++) {
      var rowL = dados[i].slice(0, 12);
      var checkId = String(rowL[6] || "").trim();
      var dataLinha = rowL[0] ? isoData_(rowL[0]) : "";
      if (checkId === recIdFinal && dataLinha && dataLinha >= corte) { removidos++; continue; }
      finais.push(rowL);
    }
    if (removidos) {
      var limpar = Math.max(sh.getLastRow(), finais.length);
      sh.getRange(1, 1, limpar, 12).clearContent();
      sh.getRange(1, 1, finais.length, 12).setValues(finais);
    }

    var config = ss.getSheetByName("RecorrenciasConfig");
    var linhaCfg = encontrarLinhaPorId_(config, recIdFinal, 1);
    if (linhaCfg > 1) config.deleteRow(linhaCfg);

    var exc = ss.getSheetByName("RecorrenciasExcecoes");
    if (exc && exc.getLastRow() > 1) {
      var dExc = exc.getDataRange().getValues();
      var fExc = [dExc[0]];
      var remExc = 0;
      for (var e = 1; e < dExc.length; e++) {
        if (String(dExc[e][0] || "").trim() === recIdFinal) { remExc++; continue; }
        fExc.push(dExc[e]);
      }
      if (remExc) {
        exc.getRange(1, 1, exc.getLastRow(), 5).clearContent();
        exc.getRange(1, 1, fExc.length, 5).setValues(fExc);
      }
    }

    registrarLog_("CANCELAR_RECORRENCIA", recIdFinal, "Corte=" + corte + "; removidas=" + removidos);
    return removidos ? ("Recorrência futura cancelada! " + removidos + " parcela(s) removida(s).") : ("Recorrência cancelada. Nenhuma parcela futura encontrada a partir de " + corte + ".");
  }
  throw new Error("Modo de exclusão inválido.");
}

function limparExcecoesFuturasRecorrencia_(idSerie, dataCorte) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RecorrenciasExcecoes");
  if (!sh || sh.getLastRow() <= 1) return;
  var dados = sh.getDataRange().getValues();
  var finais = [dados[0]];
  var removidos = 0;
  for (var i = 1; i < dados.length; i++) {
    var mesmaSerie = String(dados[i][0]) === String(idSerie);
    var dataExc = dados[i][2] ? isoData_(dados[i][2]) : "";
    if (mesmaSerie && dataExc && dataExc >= dataCorte) { removidos++; continue; }
    finais.push(dados[i]);
  }
  if (removidos) {
    sh.getRange(1, 1, sh.getLastRow(), 5).clearContent();
    sh.getRange(1, 1, finais.length, 5).setValues(finais);
  }
}

function atualizarLancamentoAvancado(dados, tipoEdicao) {
  garantirEstruturaV58_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Lancamentos");
  var recId = String(dados.recorrenciaId || "").trim();
  var linhaAlvo = encontrarLinhaPorId_(sh, dados.id, COL_LANC_ID);
  if (linhaAlvo <= 1) throw new Error("Lançamento não encontrado.");
  var dataNova = new Date(dados.data + "T12:00:00");

  if (tipoEdicao === "unico") {
    sh.getRange(linhaAlvo, 1, 1, 5).setValues([[dataNova, dados.descricao, Number(dados.valor), dados.tipo, dados.categoria]]);
    sh.getRange(linhaAlvo, COL_LANC_OVERRIDE).setValue("TOTAL");
    registrarLog_("ATUALIZAR_PARCELA", dados.id, dados.descricao);
    return "Parcela atualizada com sucesso!";
  }

  if (tipoEdicao === "posteriores" && recId) {
    var cfg = obterRecorrenciaConfigPorId_(recId);
    if (!cfg) throw new Error("Configuração da recorrência não encontrada.");
    var shCfg = ss.getSheetByName("RecorrenciasConfig");
    var diaAlvoNovo = cfg.diaAlvo;
    if (dados.data && dados.dataOriginalCorte && dados.data !== dados.dataOriginalCorte) {
      if (cfg.frequencia === "Semanal") {
        var jsDay = dataNova.getDay();
        diaAlvoNovo = jsDay === 0 ? 7 : jsDay;
      } else diaAlvoNovo = dataNova.getDate();
    }
    shCfg.getRange(cfg.linha, 2, 1, 6).setValues([[dados.descricao, Number(dados.valor), dados.tipo, dados.categoria, cfg.frequencia, Number(diaAlvoNovo)]]);

    var corteOriginal = dados.dataOriginalCorte || dados.data;
    var dadosLanc = sh.getDataRange().getValues();
    var finaisLanc = [dadosLanc[0].slice(0, 12)];
    var removidos = 0;
    for (var i = 1; i < dadosLanc.length; i++) {
      var rowLanc = dadosLanc[i].slice(0, 12);
      var mesmoRec = String(rowLanc[6] || "") === recId;
      var idRow = String(rowLanc[7] || "");
      var dataRow = rowLanc[0] ? isoData_(rowLanc[0]) : "";
      if (mesmoRec && (idRow === String(dados.id) || dataRow >= corteOriginal)) { removidos++; continue; }
      finaisLanc.push(rowLanc);
    }
    if (removidos) {
      var limparLanc = Math.max(sh.getLastRow(), finaisLanc.length);
      sh.getRange(1, 1, limparLanc, 12).clearContent();
      sh.getRange(1, 1, finaisLanc.length, 12).setValues(finaisLanc);
    }
    var minGeracao = dados.data < corteOriginal ? dados.data : corteOriginal;
    limparExcecoesFuturasRecorrencia_(recId, minGeracao);
    var criados = gerarParcelasRecorrencia_(recId, minGeracao);
    registrarLog_("ATUALIZAR_RECORRENCIA", recId, "Removidos=" + removidos + "; recriados=" + criados);
    return "Série atualizada com sucesso! " + criados + " parcela(s) futura(s) recalculada(s).";
  }
  throw new Error("Tipo de edição inválido.");
}

// 🔒 V5.8: sincronização preserva ajustes manuais, Em Aberto e títulos vencidos.
function sincronizarCalendarBackend() {
  var resumo = sincronizarCalendarBackendReal();
  var novasRecorrencias = gerarParcelasRecorrentesGerais();
  var final = resumo + " | Recorrências novas: " + novasRecorrencias;
  registrarLog_("SINCRONIZAR_CALENDAR", "CALENDAR", final);
  return final;
}


function carregarRegrasClientesRapido_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RegrasClientes");
  var out = [];
  if (!sh || sh.getLastRow() <= 1) return out;
  var dados = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues();
  dados.forEach(function(r) {
    if (!r[0]) return;
    out.push({
      cliente: r[0], valorVisita: Number(r[1]), condicaoNome: r[2], novoValor: r[3] ? Number(r[3]) : "",
      dataVigor: r[4] ? isoData_(r[4]) : "", porHora: r[5] ? String(r[5]).toUpperCase().trim() === "SIM" : false
    });
  });
  return out;
}

function carregarCondicoesRapido_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("CondicoesPagamento");
  var out = [];
  if (!sh || sh.getLastRow() <= 1) return out;
  var dados = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  dados.forEach(function(r) {
    if (!r[0]) return;
    out.push({ nome: r[0], periodo: r[1], diaCorte: Number(r[2]), mesDeslocamento: Number(r[3]), diaPagamento: r[4] !== undefined && r[4] !== null ? String(r[4]).trim() : "0" });
  });
  return out;
}

function sincronizarCalendarBackendReal() {
  garantirEstruturaV58_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetLancamentos = ss.getSheetByName("Lancamentos");
  var regrasRapidas = carregarRegrasClientesRapido_();
  var dbCondicoes = carregarCondicoesRapido_();
  var hoje = new Date(); hoje.setHours(0,0,0,0);
  var hojeIsoStr = isoData_(hoje);

  var rulesClientes = {};
  regrasRapidas.forEach(function(r) {
    rulesClientes[r.cliente.toLowerCase().trim()] = {
      nomeOriginal: r.cliente, valorVisita: r.valorVisita, condicaoNome: r.condicaoNome, novoValor: r.novoValor,
      dataVigor: r.dataVigor ? new Date(r.dataVigor + "T00:00:00") : null, porHora: r.porHora
    };
  });

  var dataInicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1, 0, 0, 0);
  var dataFim = new Date(hoje.getTime() + 180 * 24 * 60 * 60 * 1000);
  var eventos = CalendarApp.getDefaultCalendar().getEvents(dataInicio, dataFim);
  var visitasValidas = {};
  var diasJaComputadosPorCliente = {};

  for (var e = 0; e < eventos.length; e++) {
    var tit = eventos[e].getTitle().toLowerCase().trim();
    for (var clKey in rulesClientes) {
      if (tit.indexOf(clKey) === -1) continue;
      var dv = new Date(eventos[e].getStartTime());
      var df = new Date(eventos[e].getEndTime());
      var dataIsoStr = isoData_(dv);
      var clConfig = rulesClientes[clKey];
      var chaveDiaCliente = clKey + "_" + dataIsoStr;
      var duracaoHoras = (df.getTime() - dv.getTime()) / 3600000;
      if (duracaoHoras <= 0) duracaoHoras = 1;
      if (clConfig.porHora) {
        visitasValidas[chaveDiaCliente + "_" + e] = { clienteKey: clKey, dataVisita: dv, horas: duracaoHoras };
      } else if (!diasJaComputadosPorCliente[chaveDiaCliente]) {
        diasJaComputadosPorCliente[chaveDiaCliente] = true;
        visitasValidas[chaveDiaCliente] = { clienteKey: clKey, dataVisita: dv, horas: 1 };
      }
    }
  }

  var faturamentosConsolidados = {};
  var faturamentosMultiplasParcelas = {};
  for (var ch in visitasValidas) {
    var v = visitasValidas[ch], cl = rulesClientes[v.clienteKey], prc = cl.valorVisita;
    if (cl.novoValor && cl.dataVigor && new Date(v.dataVisita.getFullYear(), v.dataVisita.getMonth(), v.dataVisita.getDate()) >= cl.dataVigor) prc = cl.novoValor;
    if (cl.porHora) prc = prc * v.horas;
    var reg = dbCondicoes.filter(function(c) { return c.nome.toLowerCase().trim() === cl.condicaoNome.toLowerCase().trim(); });
    var cond = reg[0];
    if (reg.length > 1) {
      var diaV = v.dataVisita.getDate(); reg.sort(function(a,b){ return a.diaCorte - b.diaCorte; });
      for (var x=0; x<reg.length; x++) if (diaV <= reg[x].diaCorte) { cond = reg[x]; break; }
    }
    if (!cond) continue;

    var diasPagamentoStr = String(cond.diaPagamento).trim();
    if (diasPagamentoStr.indexOf(",") !== -1) {
      var diasArray = diasPagamentoStr.split(",").map(function(d){ return Number(d.trim()); }).filter(function(d){ return !isNaN(d); });
      if (diasArray.length) {
        var mesAnoChave = v.clienteKey + "_" + v.dataVisita.getFullYear() + "_" + v.dataVisita.getMonth();
        if (!faturamentosMultiplasParcelas[mesAnoChave]) faturamentosMultiplasParcelas[mesAnoChave] = {
          clienteNome: cl.nomeOriginal, ano: v.dataVisita.getFullYear(), mes: v.dataVisita.getMonth(), mesDeslocamento: cond.mesDeslocamento || 0,
          diasPagamento: diasArray, valorTotalMes: 0, datasVisitas: []
        };
        faturamentosMultiplasParcelas[mesAnoChave].valorTotalMes += prc;
        faturamentosMultiplasParcelas[mesAnoChave].datasVisitas.push(v);
        continue;
      }
    }

    var dataVenc = rodarMotorCalculo(v.dataVisita, cond), dataVencStr = isoData_(dataVenc);
    if (dataVencStr < hojeIsoStr) continue;
    var chC = v.clienteKey + "_" + dataVencStr;
    if (!faturamentosConsolidados[chC]) faturamentosConsolidados[chC] = { clienteNome: cl.nomeOriginal, clienteKey: v.clienteKey, porHora: cl.porHora, dataVencimento: dataVenc, valorTotal: 0, visitasObjeto: [] };
    faturamentosConsolidados[chC].valorTotal += prc;
    faturamentosConsolidados[chC].visitasObjeto.push(v);
  }

  var gerados = {};
  var geradosPorDesc = {};
  function adicionarGerado(dataVenc, desc, valor, chaveEstrutural) {
    var chave = chaveEstrutural || ("CAL|" + normalizarChave_(desc));
    gerados[chave] = [dataVenc, desc, valor, "Receita", "Visitas Técnicas", "Projetado", "", "", "CALENDAR", chave, isoData_(dataVenc), ""];
    geradosPorDesc[normalizarChave_(desc)] = chave;
  }

  for (var cKey in faturamentosConsolidados) {
    var fat = faturamentosConsolidados[cKey];
    fat.visitasObjeto.sort(function(a,b){ return a.dataVisita - b.dataVisita; });
    var txt;
    if (fat.porHora) txt = "Ref. " + fat.visitasObjeto.map(function(item){ return item.horas + "h dia " + Utilities.formatDate(item.dataVisita, Session.getScriptTimeZone(), "dd/MM"); }).join(" e ");
    else txt = fat.visitasObjeto.length === 1 ? "Ref. visita do dia " + Utilities.formatDate(fat.visitasObjeto[0].dataVisita, Session.getScriptTimeZone(), "dd/MM") : "Ref. visitas dos dias " + fat.visitasObjeto.map(function(vItem){ return Utilities.formatDate(vItem.dataVisita, Session.getScriptTimeZone(), "dd/MM"); }).join(" e ");
    adicionarGerado(fat.dataVencimento, "Faturamento: " + fat.clienteNome + " (" + txt + ")", fat.valorTotal, "CAL|N|" + cKey);
  }

  for (var mKey in faturamentosMultiplasParcelas) {
    var itemMulti = faturamentosMultiplasParcelas[mKey];
    itemMulti.datasVisitas.sort(function(a,b){ return a.dataVisita - b.dataVisita; });
    var totalParcelas = itemMulti.diasPagamento.length, valorParcela = itemMulti.valorTotalMes / totalParcelas;
    var mesAnoRefStr = String(itemMulti.mes + 1).padStart(2,"0") + "/" + itemMulti.ano;
    var txtVisitas = "Ref. " + itemMulti.datasVisitas.length + " visita(s) de " + mesAnoRefStr;
    for (var p=0; p<totalParcelas; p++) {
      var dataVencParcela = ajustarFinaisDeSemanaEFeriados(new Date(itemMulti.ano, itemMulti.mes + itemMulti.mesDeslocamento, itemMulti.diasPagamento[p], 12,0,0));
      if (isoData_(dataVencParcela) < hojeIsoStr) continue;
      var descParcela = "Faturamento: " + itemMulti.clienteNome + " - Parcela " + (p+1) + "/" + totalParcelas + " (" + txtVisitas + ")";
      adicionarGerado(dataVencParcela, descParcela, valorParcela, "CAL|M|" + mKey + "|" + (p + 1) + "-" + totalParcelas);
    }
  }

  var dbLanc = sheetLancamentos.getDataRange().getValues();
  var finais = [dbLanc[0].slice(0,12)];
  var finalizadasChave = {};
  var finalizadasDesc = {};
  var consolidadosPreservados = 0, abertosPreservados = 0, vencidosPreservados = 0, ajustesPreservados = 0, atualizados = 0, removidos = 0;

  for (var k=1; k<dbLanc.length; k++) {
    var row = dbLanc[k].slice(0,12);
    while (row.length < 12) row.push("");
    if (!row[0]) continue;
    var origem = String(row[8] || "");
    var desc = String(row[1] || "");
    var status = String(row[5] || "").toLowerCase().trim();
    var isCalendar = origem === "CALENDAR" || desc.indexOf("Faturamento:") === 0;
    if (!isCalendar) { finais.push(row); continue; }

    var chaveExist = String(row[9] || ("CAL|" + normalizarChave_(desc)));
    var chaveGerada = chaveExist;
    var novo = gerados[chaveGerada];
    if (!novo) {
      var chavePorDescricao = geradosPorDesc[normalizarChave_(desc)];
      if (chavePorDescricao) { chaveGerada = chavePorDescricao; novo = gerados[chavePorDescricao]; }
    }

    // Consolidado = dinheiro liquidado. Em Aberto = já faturado/confirmado.
    // Ambos viram registros financeiros próprios e não podem ser recriados pelo Calendar.
    if (status === "consolidado" || status === "em aberto") {
      row[8] = "CALENDAR"; row[9] = chaveExist;
      finais.push(row);
      finalizadasChave[chaveExist] = true;
      finalizadasDesc[normalizarChave_(desc)] = true;
      if (novo) delete gerados[chaveGerada];
      if (status === "consolidado") consolidadosPreservados++; else abertosPreservados++;
      continue;
    }

    var dataAtual = isoData_(row[0]);
    // Título projetado que já venceu não some na sincronização: fica pendente até o usuário resolver.
    if (!novo && dataAtual <= hojeIsoStr) {
      row[8] = "CALENDAR"; row[9] = chaveExist;
      finais.push(row);
      vencidosPreservados++;
      continue;
    }
    if (!novo) { removidos++; continue; }

    var idExist = row[7] || gerarIdNumerico_();
    var override = String(row[11] || "").toUpperCase();
    var calcAnterior = row[10] ? isoData_(row[10]) : "";
    var dataGerada = isoData_(novo[0]);
    novo[7] = idExist;
    if (override === "TOTAL") {
      novo[0] = row[0]; novo[1] = row[1]; novo[2] = row[2]; novo[3] = row[3]; novo[4] = row[4]; novo[5] = row[5]; novo[6] = row[6]; novo[11] = "TOTAL"; ajustesPreservados++;
    } else if (override === "DATA" || (calcAnterior && dataAtual !== calcAnterior)) {
      novo[0] = row[0]; novo[11] = "DATA"; ajustesPreservados++;
    }
    novo[10] = dataGerada;
    finais.push(novo); delete gerados[chaveGerada]; atualizados++;
  }

  var criados = 0;
  for (var chaveNova in gerados) {
    var novoRow = gerados[chaveNova];
    if (finalizadasChave[chaveNova] || finalizadasDesc[normalizarChave_(novoRow[1])]) continue;
    novoRow[7] = gerarIdNumerico_();
    finais.push(novoRow); criados++;
  }

  var linhasParaLimpar = Math.max(sheetLancamentos.getLastRow(), finais.length);
  sheetLancamentos.getRange(1, 1, linhasParaLimpar, 12).clearContent();
  sheetLancamentos.getRange(1,1,finais.length,12).setValues(finais);
  return "Sincronizado! Novos: " + criados + " | Atualizados: " + atualizados + " | Em aberto preservados: " + abertosPreservados + " | Vencidos pendentes: " + vencidosPreservados + " | Consolidados preservados: " + consolidadosPreservados + " | Ajustes manuais: " + ajustesPreservados + " | Obsoletos removidos: " + removidos;
}

function criarDataComAno(textoDiaMes, ano) {
  var partes = textoDiaMes.split('/');
  return new Date(ano, Number(partes[1]) - 1, Number(partes[0]), 12, 0, 0);
}

function rodarMotorCalculo(dataVisita, c) {
  var data = new Date(dataVisita.getTime());
  var diaPag = Number(c.diaPagamento) || 0;

  if (c.periodo === "Semanal") { 
    var diff = diaPag - data.getDay(); if (diff <= 0) diff += 7; data.setDate(data.getDate() + diff); 
  } else if (c.periodo === "Mensal") { 
    if (diaPag === 0) return ajustarFinaisDeSemanaEFeriados(data); 
    data = new Date(data.getFullYear(), data.getMonth() + c.mesDeslocamento, diaPag); 
  } else if (c.periodo === "Antecipado") { 
    data.setDate(data.getDate() - diaPag); 
  }
  return ajustarFinaisDeSemanaEFeriados(data);
}

function obterFeriadosConfigurados_() {
  if (FERIADOS_CACHE_EXECUCAO_) return FERIADOS_CACHE_EXECUCAO_;
  var mapa = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("Feriados");
  if (sh && sh.getLastRow() > 1) {
    var dados = sh.getRange(2,1,sh.getLastRow()-1,3).getValues();
    dados.forEach(function(r){
      var ativo = String(r[2] === "" ? "SIM" : r[2]).toUpperCase();
      if (r[0] && ativo !== "NÃO" && ativo !== "NAO" && ativo !== "0") mapa[isoData_(r[0])] = true;
    });
  }
  FERIADOS_CACHE_EXECUCAO_ = mapa;
  return mapa;
}

function ajustarFinaisDeSemanaEFeriados(dataAlvo) {
  var d = new Date(dataAlvo.getTime());
  var loop = 0, feriados = obterFeriadosConfigurados_();
  var fixos = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
  while (loop < 12) {
    var ds = d.getDay();
    var fF = Utilities.formatDate(d, Session.getScriptTimeZone(), "MM-dd");
    var fM = isoData_(d);
    if (ds === 6) d.setDate(d.getDate() - 1);
    else if (ds === 0) d.setDate(d.getDate() - 2);
    else if (fixos.indexOf(fF) !== -1 || feriados[fM]) d.setDate(d.getDate() - 1);
    else break;
    loop++;
  }
  return d;
}

function atualizarDatasLoteBackend(listaAlteracoes) {
  garantirEstruturaV58_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lancamentos");
  if (!sheet || sheet.getLastRow() <= 1) return "Nenhum lançamento para alterar.";

  var dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  var mapaIds = {};
  for (var i = 0; i < dados.length; i++) if (dados[i][7]) mapaIds[String(dados[i][7])] = i;

  var totalAlterado = 0, naoEncontrados = 0;
  (listaAlteracoes || []).forEach(function(alteracao) {
    var idx = mapaIds[String(alteracao.id)];
    if (idx === undefined) { naoEncontrados++; return; }
    var novaIso = String(alteracao.novaData || "");
    dados[idx][0] = new Date(novaIso + "T12:00:00");
    var origem = String(dados[idx][8] || "");
    if (origem === "CALENDAR" || origem === "RECORRENCIA") dados[idx][11] = "DATA";
    totalAlterado++;
  });

  if (totalAlterado) sheet.getRange(2, 1, dados.length, 12).setValues(dados);
  registrarLog_("EFETIVAR_SIMULACAO", totalAlterado, naoEncontrados ? (naoEncontrados + " não encontrado(s)") : "Datas preservadas contra sincronização");
  return "🔒 " + totalAlterado + " lançamento(s) alterado(s) e fixados. " + (naoEncontrados ? naoEncontrados + " não encontrado(s)." : "");
}

function enviarAlertasFaturamentoSite() {
  var aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lancamentos");
  if (!aba) return "Erro: Aba 'Lancamentos' não encontrada.";
  
  var dadosTexto = aba.getDataRange().getDisplayValues();
  var dadosRaw = aba.getDataRange().getValues();
  
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  var limite15Dias = new Date(hoje.getTime());
  limite15Dias.setDate(limite15Dias.getDate() + 15);

  var clientesGatilho = {};

  for (var i = 1; i < dadosTexto.length; i++) {
    var dataTexto = String(dadosTexto[i][0]).trim();
    var desc = String(dadosTexto[i][1] || "").trim();
    var tipo = String(dadosTexto[i][3] || "").toLowerCase();
    var status = String(dadosTexto[i][5] || "").toLowerCase();

    if (!tipo.includes("receita") || status.includes("consolidado")) continue;

    var dataVenc = parseDataPersonalizada(dataTexto, dadosRaw[i][0]);
    if (!dataVenc) continue;

    dataVenc.setHours(0, 0, 0, 0);

    if (dataVenc.getTime() >= hoje.getTime() && dataVenc.getTime() <= limite15Dias.getTime()) {
      var cliente = extrairCliente(desc);
      var chaveMesAno = dataVenc.getMonth() + "_" + dataVenc.getFullYear();

      if (!clientesGatilho[cliente]) {
        clientesGatilho[cliente] = [];
      }
      if (clientesGatilho[cliente].indexOf(chaveMesAno) === -1) {
        clientesGatilho[cliente].push(chaveMesAno);
      }
    }
  }

  if (Object.keys(clientesGatilho).length === 0) {
    return "Nenhum título a vencer encontrado nos próximos 15 dias.";
  }

  var agrupado = {};
  var totalPendentes = 0;

  for (var i = 1; i < dadosTexto.length; i++) {
    var dataTexto = String(dadosTexto[i][0]).trim();
    var desc = String(dadosTexto[i][1] || "").trim();
    var valorNum = Number(dadosRaw[i][2] || 0);
    var tipo = String(dadosTexto[i][3] || "").toLowerCase();
    var status = String(dadosTexto[i][5] || "").toLowerCase();

    if (!tipo.includes("receita") || status.includes("consolidado")) continue;

    var dataVenc = parseDataPersonalizada(dataTexto, dadosRaw[i][0]);
    if (!dataVenc) continue;

    var cliente = extrairCliente(desc);
    var chaveMesAno = dataVenc.getMonth() + "_" + dataVenc.getFullYear();

    if (clientesGatilho[cliente] && clientesGatilho[cliente].indexOf(chaveMesAno) !== -1) {
      if (!agrupado[cliente]) {
        agrupado[cliente] = [];
      }

      agrupado[cliente].push({
        venc: dataVenc,
        valor: valorNum,
        obs: desc
      });
    }
  }

  var html = `
  <html>
    <body style="font-family: Arial, sans-serif; color: #333; margin: 20px;">
      <h2 style="color: #222; font-size: 20px; font-weight: bold; margin-bottom: 25px;">
        📋 Aviso Financeiro - Títulos a Vencer
      </h2>
  `;

  for (var cliente in agrupado) {
    var itens = agrupado[cliente];
    itens.sort(function(a, b) { return a.venc - b.venc; });

    html += `
      <div style="background-color: #f2f2f2; padding: 10px 15px; font-weight: bold; font-size: 14px; color: #111; margin-top: 20px; border: 1px solid #e0e0e0; border-bottom: none; text-transform: uppercase;">
        ${cliente}
      </div>

      <table border="0" cellpadding="8" cellspacing="0" style="border-collapse: collapse; width: 100%; border: 1px solid #e0e0e0; margin-bottom: 25px; font-size: 13px;">
        <thead>
          <tr style="background-color: #eaeaea; color: #222; text-align: left;">
            <th style="width: 20%; font-weight: bold; text-align: center;">Vencimento</th>
            <th style="width: 25%; font-weight: bold; text-align: right; padding-right: 20px;">Valor</th>
            <th style="width: 55%; font-weight: bold;">Observação</th>
          </tr>
        </thead>
        <tbody>
    `;

    itens.forEach(function(item) {
      totalPendentes++;
      var dtBrItem = Utilities.formatDate(item.venc, Session.getScriptTimeZone(), "dd/MM/yyyy");
      var valBr = item.valor.toFixed(2).replace(".", ",").replace(/(\d)(?=(\d{3})+(?!\d))/g, "$1.");
      
      html += `
        <tr style="border-top: 1px solid #eee;">
          <td style="text-align: center;">${dtBrItem}</td>
          <td style="text-align: right; padding-right: 20px;">R$ ${valBr}</td>
          <td>${item.obs}</td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;
  }

  html += `
      <br>
      <div style="font-size: 11px; color: #666; margin-top: 10px;">
        E-mail gerado automaticamente pela planilha Financeiro.
      </div>
    </body>
  </html>
  `;

  MailApp.sendEmail({
    to: "richard@consultoriarf.net",
    subject: "📋 Aviso Financeiro - Títulos a Vencer",
    htmlBody: html
  });

  return "E-mail enviado com sucesso contendo " + totalPendentes + " título(s)!";
}

function extrairCliente(desc) {
  var limpo = desc.replace(/^Faturamento:\s*/i, "").trim();
  if (limpo.includes("(")) {
    limpo = limpo.split("(")[0].trim();
  }
  return limpo || desc;
}

function parseDataPersonalizada(dataTexto, dataObjRaw) {
  var apenasData = dataTexto.split(" ")[0];
  if (apenasData.includes("/")) {
    var p = apenasData.split("/");
    return new Date(Number(p[2]), Number(p[1]) - 1, Number(p[0]));
  } else if (apenasData.includes("-")) {
    var p = apenasData.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  } else if (dataObjRaw instanceof Date) {
    return new Date(dataObjRaw.getTime());
  }
  return null;
}

function idString(val) {
  return val ? val.toString() : "";
}

function testarPluggyAuth() {
  const props = PropertiesService.getScriptProperties();

  const clientId = props.getProperty('PLUGGY_CLIENT_ID');
  const clientSecret = props.getProperty('PLUGGY_CLIENT_SECRET');

  if (!clientId || !clientSecret) {
    throw new Error('PLUGGY_CLIENT_ID ou PLUGGY_CLIENT_SECRET não encontrados.');
  }

  const resposta = UrlFetchApp.fetch('https://api.pluggy.ai/auth', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      clientId: clientId,
      clientSecret: clientSecret
    }),
    muteHttpExceptions: true
  });

  const status = resposta.getResponseCode();
  const texto = resposta.getContentText();

  Logger.log('STATUS: ' + status);

  if (status !== 200) {
    Logger.log(texto);
    throw new Error('Erro ao autenticar na Pluggy. HTTP ' + status);
  }

  const dados = JSON.parse(texto);

  Logger.log('✅ AUTENTICAÇÃO PLUGGY FUNCIONOU');
  Logger.log('API Key recebida: SIM');
}

function testarPluggyConta() {
  const props = PropertiesService.getScriptProperties();

  const clientId = props.getProperty('PLUGGY_CLIENT_ID');
  const clientSecret = props.getProperty('PLUGGY_CLIENT_SECRET');
  const itemId = props.getProperty('PLUGGY_ITEM_ID');

  // 1. Autentica
  const authResp = UrlFetchApp.fetch('https://api.pluggy.ai/auth', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      clientId: clientId,
      clientSecret: clientSecret
    })
  });

  const apiKey = JSON.parse(authResp.getContentText()).apiKey;

  // 2. Busca somente contas bancárias
  const url =
    'https://api.pluggy.ai/accounts?itemId=' +
    encodeURIComponent(itemId) +
    '&type=BANK';

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'X-API-KEY': apiKey
    },
    muteHttpExceptions: true
  });

  Logger.log('STATUS: ' + resp.getResponseCode());

  if (resp.getResponseCode() !== 200) {
    Logger.log(resp.getContentText());
    throw new Error('Erro ao buscar contas.');
  }

  const dados = JSON.parse(resp.getContentText());

  Logger.log('✅ CONTAS ENCONTRADAS: ' + dados.results.length);

  dados.results.forEach(function(conta) {
    Logger.log('Nome: ' + conta.name);
    Logger.log('Tipo: ' + conta.type);
    Logger.log('Saldo: ' + conta.balance);
    Logger.log('ACCOUNT ID: ' + conta.id);
  });
}

function testarPluggyTransacoes() {
  const props = PropertiesService.getScriptProperties();

  const clientId = props.getProperty('PLUGGY_CLIENT_ID');
  const clientSecret = props.getProperty('PLUGGY_CLIENT_SECRET');
  const itemId = props.getProperty('PLUGGY_ITEM_ID');

  // 1. Autentica
  const authResp = UrlFetchApp.fetch('https://api.pluggy.ai/auth', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      clientId: clientId,
      clientSecret: clientSecret
    })
  });

  const apiKey = JSON.parse(authResp.getContentText()).apiKey;

  // 2. Busca a conta bancária
  const contaResp = UrlFetchApp.fetch(
    'https://api.pluggy.ai/accounts?itemId=' +
      encodeURIComponent(itemId) +
      '&type=BANK',
    {
      method: 'get',
      headers: {
        'X-API-KEY': apiKey
      }
    }
  );

  const contas = JSON.parse(contaResp.getContentText()).results;

  if (!contas || contas.length === 0) {
    throw new Error('Nenhuma conta bancária encontrada.');
  }

  const accountId = contas[0].id;

  // 3. Busca transações dos últimos 7 dias
  const hoje = new Date();
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(hoje.getDate() - 7);

  const dataFrom = Utilities.formatDate(
    seteDiasAtras,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const dataTo = Utilities.formatDate(
    hoje,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const url =
    'https://api.pluggy.ai/v2/transactions' +
    '?accountId=' + encodeURIComponent(accountId) +
    '&dateFrom=' + encodeURIComponent(dataFrom) +
    '&dateTo=' + encodeURIComponent(dataTo);

  const resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'X-API-KEY': apiKey
    },
    muteHttpExceptions: true
  });

  Logger.log('STATUS: ' + resp.getResponseCode());

  if (resp.getResponseCode() !== 200) {
    Logger.log(resp.getContentText());
    throw new Error('Erro ao buscar transações.');
  }

  const dados = JSON.parse(resp.getContentText());

  Logger.log('✅ TRANSAÇÕES ENCONTRADAS: ' + dados.results.length);

  dados.results.slice(0, 10).forEach(function(t) {
    Logger.log(
      t.date +
      ' | ' +
      t.type +
      ' | R$ ' +
      t.amount +
      ' | ' +
      t.description
    );
  });
}

function testarPluggyDuasContas() {
  const props = PropertiesService.getScriptProperties();

  const clientId = props.getProperty('PLUGGY_CLIENT_ID');
  const clientSecret = props.getProperty('PLUGGY_CLIENT_SECRET');

  const itens = [
    { nome: 'PF', itemId: props.getProperty('PLUGGY_ITEM_ID_PF') },
    { nome: 'PJ', itemId: props.getProperty('PLUGGY_ITEM_ID_PJ') }
  ];

  // Autentica uma única vez
  const authResp = UrlFetchApp.fetch('https://api.pluggy.ai/auth', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      clientId: clientId,
      clientSecret: clientSecret
    })
  });

  const apiKey = JSON.parse(authResp.getContentText()).apiKey;

  itens.forEach(function(item) {

    if (!item.itemId) {
      Logger.log('❌ ' + item.nome + ': ITEM ID não configurado');
      return;
    }

    const url =
      'https://api.pluggy.ai/accounts?itemId=' +
      encodeURIComponent(item.itemId) +
      '&type=BANK';

    const resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'X-API-KEY': apiKey
      },
      muteHttpExceptions: true
    });

    if (resp.getResponseCode() !== 200) {
      Logger.log('❌ ' + item.nome + ': erro HTTP ' + resp.getResponseCode());
      return;
    }

    const dados = JSON.parse(resp.getContentText());

    Logger.log('========================');
    Logger.log('CONTA ' + item.nome);
    Logger.log('Contas encontradas: ' + dados.results.length);

    dados.results.forEach(function(conta) {
      Logger.log('Nome: ' + conta.name);
      Logger.log('Tipo: ' + conta.type);
      Logger.log('Saldo: R$ ' + conta.balance);
    });
  });
}

function importarMovimentosBanco15Dias() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('MovimentosBanco');

  if (!sheet) {
    throw new Error("A aba 'MovimentosBanco' não existe.");
  }

  const props = PropertiesService.getScriptProperties();

  const clientId = props.getProperty('PLUGGY_CLIENT_ID');
  const clientSecret = props.getProperty('PLUGGY_CLIENT_SECRET');

  const itens = [
    { conta: 'PF', itemId: props.getProperty('PLUGGY_ITEM_ID_PF') },
    { conta: 'PJ', itemId: props.getProperty('PLUGGY_ITEM_ID_PJ') }
  ];

  // =========================
  // CABEÇALHO
  // =========================
  const cabecalho = [
    'IdPluggy',
    'Conta',
    'Data',
    'Descricao',
    'DescricaoOriginal',
    'Valor',
    'Tipo',
    'CategoriaPluggy',
    'StatusBanco',
    'AccountId',
    'StatusConciliacao',
    'IdLancamento',
    'DataImportacao'
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
    sheet.setFrozenRows(1);
  }

  // =========================
  // IDs JÁ IMPORTADOS
  // =========================
  const idsExistentes = new Set();

  if (sheet.getLastRow() > 1) {
    const ids = sheet
      .getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getValues();

    ids.forEach(function(linha) {
      if (linha[0]) idsExistentes.add(String(linha[0]));
    });
  }

  // =========================
  // AUTENTICAÇÃO
  // =========================
  const authResp = UrlFetchApp.fetch('https://api.pluggy.ai/auth', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({
      clientId: clientId,
      clientSecret: clientSecret
    })
  });

  const apiKey = JSON.parse(authResp.getContentText()).apiKey;

  // =========================
  // PERÍODO: ÚLTIMOS 15 DIAS
  // =========================
  const hoje = new Date();

  const dataInicial = new Date();
  dataInicial.setDate(hoje.getDate() - 15);

  const dateFrom = Utilities.formatDate(
    dataInicial,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const dateTo = Utilities.formatDate(
    hoje,
    Session.getScriptTimeZone(),
    'yyyy-MM-dd'
  );

  const novasLinhas = [];

  // =========================
  // PF + PJ
  // =========================
  itens.forEach(function(item) {

    if (!item.itemId) return;

    // Descobre a conta BANK
    const contasResp = UrlFetchApp.fetch(
      'https://api.pluggy.ai/accounts?itemId=' +
        encodeURIComponent(item.itemId) +
        '&type=BANK',
      {
        method: 'get',
        headers: {
          'X-API-KEY': apiKey
        }
      }
    );

    const contas = JSON.parse(contasResp.getContentText()).results || [];

    contas.forEach(function(conta) {

      let url =
        'https://api.pluggy.ai/v2/transactions' +
        '?accountId=' + encodeURIComponent(conta.id) +
        '&dateFrom=' + encodeURIComponent(dateFrom) +
        '&dateTo=' + encodeURIComponent(dateTo);

      // Paginação por cursor
      while (url) {

        const resp = UrlFetchApp.fetch(url, {
          method: 'get',
          headers: {
            'X-API-KEY': apiKey
          }
        });

        const dados = JSON.parse(resp.getContentText());
        const transacoes = dados.results || [];

        transacoes.forEach(function(t) {

          if (idsExistentes.has(String(t.id))) {
            return;
          }

          novasLinhas.push([
            t.id,
            item.conta,
            new Date(t.date),
            t.description || '',
            t.descriptionRaw || '',
            Number(t.amount || 0),
            t.type || '',
            t.category || '',
            t.status || '',
            conta.id,
            'NOVO',
            '',
            new Date()
          ]);

          idsExistentes.add(String(t.id));
        });

        if (dados.next) {
          url = 'https://api.pluggy.ai/v2/transactions' + dados.next;
        } else {
          url = null;
        }
      }
    });
  });

  // =========================
  // GRAVAÇÃO EM LOTE
  // =========================
  if (novasLinhas.length > 0) {
    sheet
      .getRange(
        sheet.getLastRow() + 1,
        1,
        novasLinhas.length,
        cabecalho.length
      )
      .setValues(novasLinhas);
  }

  Logger.log('✅ IMPORTAÇÃO CONCLUÍDA');
  Logger.log('Novos movimentos: ' + novasLinhas.length);
  Logger.log('Período: ' + dateFrom + ' até ' + dateTo);
  return 'Banco atualizado: ' + novasLinhas.length + ' novo(s) movimento(s).';
}


// =========================
// V5.10.3 - CONCILIAÇÃO BANCÁRIA
// =========================

function normalizarTextoConciliacao_(texto) {
  var s = String(texto || "").toUpperCase();
  try {
    s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (e) {}
  return s.replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function naturezaMovimentoBancoV59_(mov) {
  var valor = Number(mov.valor || 0);
  if (valor < 0) return "DEBIT";
  if (valor > 0) return "CREDIT";
  var tipo = normalizarTextoConciliacao_(mov.tipo);
  return tipo.indexOf("DEBIT") !== -1 ? "DEBIT" : "CREDIT";
}

function diferencaDiasConciliacaoV59_(dataA, dataB) {
  if (!dataA || !dataB) return 9999;
  var a = new Date(String(dataA).substring(0, 10) + "T12:00:00");
  var b = new Date(String(dataB).substring(0, 10) + "T12:00:00");
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return 9999;
  return Math.abs(Math.round((a.getTime() - b.getTime()) / 86400000));
}

function lerMovimentosBancoV59_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MovimentosBanco");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 13).getValues();
  return dados.map(function(r) {
    return {
      idPluggy: String(r[0] || ""),
      conta: String(r[1] || "").trim().toUpperCase(),
      data: isoData_(r[2]),
      descricao: String(r[3] || ""),
      descricaoOriginal: String(r[4] || ""),
      valor: Number(r[5] || 0),
      tipo: String(r[6] || ""),
      categoriaPluggy: String(r[7] || ""),
      statusBanco: String(r[8] || ""),
      accountId: String(r[9] || ""),
      statusConciliacao: String(r[10] || "NOVO").trim().toUpperCase(),
      idLancamento: String(r[11] || "")
    };
  }).filter(function(m) {
    return m.statusConciliacao === "NOVO";
  });
}

function lerRegrasConciliacaoV59_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RegrasConciliacao");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
  return dados.map(function(r) {
    return {
      idRegra: String(r[0] || ""),
      conta: String(r[1] || "").trim().toUpperCase(),
      padraoBanco: String(r[2] || ""),
      descricaoFluxo: String(r[3] || ""),
      tipo: String(r[4] || ""),
      categoria: String(r[5] || ""),
      acao: String(r[6] || ""),
      automatico: String(r[7] || ""),
      ativo: String(r[8] || "")
    };
  }).filter(function(regra) {
    var ativo = normalizarTextoConciliacao_(regra.ativo);
    return ativo === "SIM" || ativo === "TRUE" || ativo === "1";
  });
}

function lerLancamentosConciliacaoV59_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Lancamentos");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 12).getValues();
  return dados.map(function(r) {
    return {
      data: isoData_(r[0]),
      descricao: String(r[1] || ""),
      valor: Math.abs(Number(r[2] || 0)),
      tipo: String(r[3] || ""),
      categoria: String(r[4] || ""),
      status: String(r[5] || "Projetado"),
      recorrenciaId: String(r[6] || ""),
      idLancamento: String(r[7] || ""),
      origem: String(r[8] || ""),
      chaveOrigem: String(r[9] || "")
    };
  }).filter(function(l) {
    return l.idLancamento || l.descricao;
  });
}

function lerClientesConciliacaoV59_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("RegrasClientes");
  if (!sheet || sheet.getLastRow() <= 1) return [];

  var dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  var vistos = {};
  var clientes = [];
  dados.forEach(function(r) {
    var nome = String(r[0] || "").trim();
    var norm = normalizarTextoConciliacao_(nome);
    if (!nome || !norm || vistos[norm]) return;
    vistos[norm] = true;
    clientes.push({ nome: nome, norm: norm });
  });
  return clientes;
}

function textoBancoConciliacaoV59_(mov) {
  return normalizarTextoConciliacao_(
    [mov.descricao, mov.descricaoOriginal, mov.categoriaPluggy].join(" ")
  );
}

function pareceTransferenciaBancoV59_(mov) {
  var txt = textoBancoConciliacaoV59_(mov);
  return (
    txt.indexOf("TRANSFER") !== -1 ||
    txt.indexOf("PIX") !== -1 ||
    txt.indexOf("SAME PERSON") !== -1 ||
    txt.indexOf("MESMA PESSOA") !== -1 ||
    txt.indexOf("TED") !== -1
  );
}

function detectarTransferenciasInternasV59_(movimentos) {
  var paresPorId = {};
  var usados = {};
  var pares = 0;

  for (var i = 0; i < movimentos.length; i++) {
    var a = movimentos[i];
    if (usados[a.idPluggy]) continue;

    for (var j = i + 1; j < movimentos.length; j++) {
      var b = movimentos[j];
      if (usados[b.idPluggy]) continue;
      if (!a.conta || !b.conta || a.conta === b.conta) continue;
      if (a.valor === 0 || b.valor === 0 || (a.valor > 0) === (b.valor > 0)) continue;
      if (Math.abs(Math.abs(a.valor) - Math.abs(b.valor)) > 0.01) continue;
      if (diferencaDiasConciliacaoV59_(a.data, b.data) > 1) continue;
      if (!pareceTransferenciaBancoV59_(a) || !pareceTransferenciaBancoV59_(b)) continue;

      usados[a.idPluggy] = true;
      usados[b.idPluggy] = true;
      pares++;

      paresPorId[a.idPluggy] = {
        idPluggy: b.idPluggy,
        conta: b.conta,
        data: b.data,
        valor: b.valor,
        descricao: b.descricao
      };
      paresPorId[b.idPluggy] = {
        idPluggy: a.idPluggy,
        conta: a.conta,
        data: a.data,
        valor: a.valor,
        descricao: a.descricao
      };
      break;
    }
  }

  return { paresPorId: paresPorId, quantidadePares: pares };
}

function encontrarRegraConciliacaoV59_(mov, regras) {
  var txt = textoBancoConciliacaoV59_(mov);
  for (var i = 0; i < regras.length; i++) {
    var regra = regras[i];
    if (regra.conta && regra.conta !== "TODOS" && regra.conta !== mov.conta) continue;
    var tipoRegra = normalizarTextoConciliacao_(regra.tipo);
    var tipoMov = naturezaMovimentoBancoV59_(mov) === "DEBIT" ? "DESPESA" : "RECEITA";
    if (tipoRegra && tipoRegra !== tipoMov) continue;
    var padrao = normalizarTextoConciliacao_(regra.padraoBanco);
    if (padrao && txt.indexOf(padrao) !== -1) return regra;
  }
  return null;
}

function encontrarClienteConciliacaoV59_(mov, clientes) {
  if (mov.conta !== "PJ" || naturezaMovimentoBancoV59_(mov) !== "CREDIT") return null;
  var txt = textoBancoConciliacaoV59_(mov);
  for (var i = 0; i < clientes.length; i++) {
    if (clientes[i].norm && txt.indexOf(clientes[i].norm) !== -1) return clientes[i];
  }
  return null;
}

function tokensRelevantesConciliacaoV59_(texto) {
  var stop = {
    PAGAMENTO:1, RECEBIDO:1, RECEBIDA:1, EFETUADO:1, EFETUADA:1,
    ENVIADO:1, ENVIADA:1, TRANSFERENCIA:1, TRANSFER:1, PIX:1,
    BOLETO:1, BRASIL:1, LTDA:1, EIRELI:1, ME:1, SA:1, VIA:1,
    BANCO:1, NUBANK:1, CONTA:1, DEBITO:1, CREDITO:1
  };
  var norm = normalizarTextoConciliacao_(texto);
  if (!norm) return [];
  var partes = norm.split(" ");
  var vistos = {};
  var out = [];
  partes.forEach(function(t) {
    if (t.length < 4 || stop[t] || vistos[t]) return;
    vistos[t] = true;
    out.push(t);
  });
  return out;
}

function pontuarLancamentoConciliacaoV59_(mov, lanc, alvoDescricao) {
  var tipoEsperado = naturezaMovimentoBancoV59_(mov) === "DEBIT" ? "DESPESA" : "RECEITA";
  if (normalizarTextoConciliacao_(lanc.tipo) !== tipoEsperado) return null;

  var descLanc = normalizarTextoConciliacao_(lanc.descricao);
  var alvo = normalizarTextoConciliacao_(alvoDescricao);
  var textoBanco = [mov.descricao, mov.descricaoOriginal].join(" ");
  var bancoAbs = Math.abs(Number(mov.valor || 0));
  var valorLanc = Number(lanc.valor || 0);
  var diff = Math.abs(bancoAbs - valorLanc);
  var perc = valorLanc > 0 ? diff / valorLanc : 1;
  var dias = diferencaDiasConciliacaoV59_(mov.data, lanc.data);
  var statusNorm = normalizarTextoConciliacao_(lanc.status);
  var consolidado = statusNorm === "CONSOLIDADO";
  var lancFuturo = String(lanc.data || "") > String(mov.data || "");
  var sinalDescricao = false;
  var matchExatoDataValor = !consolidado && dias === 0 && diff <= 0.01;
  var score = 0;
  var criterio = "";

  // Quando existe regra/alias (ex.: MILA -> GAUDI), a descrição-alvo é obrigatória.
  if (alvo) {
    if (descLanc && (descLanc.indexOf(alvo) !== -1 || alvo.indexOf(descLanc) !== -1)) {
      sinalDescricao = true;
      score += 60;
      criterio = "Regra/alias + valor + data";
    } else {
      return null;
    }
  } else {
    var tokensBanco = tokensRelevantesConciliacaoV59_(textoBanco);
    var tokensLanc = tokensRelevantesConciliacaoV59_(lanc.descricao);
    var mapa = {};
    tokensLanc.forEach(function(t) { mapa[t] = true; });
    var comuns = tokensBanco.filter(function(t) { return mapa[t]; });

    if (comuns.length > 0) {
      sinalDescricao = true;
      score += 30 + Math.min(18, comuns.length * 6);
      criterio = "Descrição + valor + data";
    }

    // Regra forte para casos como MINISTÉRIO DA FAZENDA x INSS:
    // mesmo tipo + lançamento ainda aberto + MESMA DATA + MESMO VALOR.
    if (!sinalDescricao && matchExatoDataValor) {
      score += 80;
      criterio = "Valor e data exatos";
    }

    if (!sinalDescricao && !matchExatoDataValor) return null;
  }

  // Guard rails contra falsos positivos históricos.
  if (consolidado) {
    // Um movimento atual só pode apontar para algo já consolidado se for praticamente
    // o mesmo evento: descrição compatível, data muito próxima e valor muito próximo.
    if (!sinalDescricao || dias > 3) return null;
    if (diff > Math.max(2, valorLanc * 0.05)) return null;
  } else if (alvo) {
    // Regra/alias pode localizar conta vencida, mas não deve pular para parcela futura distante.
    if (lancFuturo && dias > 7) return null;
    if (!lancFuturo && dias > 120) return null;
  } else if (sinalDescricao) {
    // Match genérico por nome só vale perto da data bancária.
    if (dias > 10) return null;
  } else {
    // Sem descrição, só aceitamos a combinação inequívoca de data + valor exatos.
    if (!matchExatoDataValor) return null;
  }

  if (diff <= 0.01) score += 36;
  else if (diff <= 5) score += 28;
  else if (perc <= 0.03) score += 22;
  else if (perc <= 0.10) score += 14;
  else if (perc <= 0.20) score += 6;
  else if (!alvo) return null;

  if (dias === 0) score += 30;
  else if (dias <= 2) score += 20;
  else if (dias <= 5) score += 12;
  else if (dias <= 10) score += 6;

  if (!consolidado) {
    score += 12;
    if (!lancFuturo) score += 5; // prioriza conta vencida/em aberto antes de futura
  }

  return {
    score: score,
    dias: dias,
    diferenca: Number((bancoAbs - valorLanc).toFixed(2)),
    criterio: criterio,
    lancamento: lanc
  };
}

function encontrarLancamentoConciliacaoV59_(mov, lancamentos, alvoDescricao) {
  var candidatos = [];

  for (var i = 0; i < lancamentos.length; i++) {
    var p = pontuarLancamentoConciliacaoV59_(mov, lancamentos[i], alvoDescricao || "");
    if (p) candidatos.push(p);
  }

  candidatos.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.dias - b.dias;
  });

  if (!candidatos.length || candidatos[0].score < 60) return null;

  // Se o match veio APENAS de valor+data e houver empate real, não chutamos.
  if (
    candidatos.length > 1 &&
    candidatos[0].criterio === "Valor e data exatos" &&
    candidatos[1].criterio === "Valor e data exatos" &&
    candidatos[0].score === candidatos[1].score &&
    candidatos[0].dias === candidatos[1].dias
  ) {
    return null;
  }

  var melhor = candidatos[0];
  var l = melhor.lancamento;

  return {
    idLancamento: l.idLancamento,
    descricao: l.descricao,
    data: l.data,
    valor: Number(l.valor || 0),
    categoria: l.categoria || "",
    status: l.status || "",
    tipo: l.tipo || "",
    diferenca: melhor.diferenca,
    diasDistancia: melhor.dias,
    score: melhor.score,
    criterio: melhor.criterio
  };
}


function encontrarMovimentoBancoLinhaV510_(idPluggy) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("MovimentosBanco");
  if (!sh || sh.getLastRow() <= 1) throw new Error("MovimentosBanco não encontrada ou vazia.");

  var alvo = String(idPluggy || "").trim();
  if (!alvo) throw new Error("IdPluggy não informado.");

  var dados = sh.getRange(2, 1, sh.getLastRow() - 1, 13).getValues();
  for (var i = 0; i < dados.length; i++) {
    if (String(dados[i][0] || "") === alvo) {
      return {
        sheet: sh,
        linha: i + 2,
        idPluggy: alvo,
        conta: String(dados[i][1] || "").trim().toUpperCase(),
        data: isoData_(dados[i][2]),
        descricao: String(dados[i][3] || ""),
        descricaoOriginal: String(dados[i][4] || ""),
        valor: Number(dados[i][5] || 0),
        tipo: String(dados[i][6] || ""),
        categoriaPluggy: String(dados[i][7] || ""),
        statusBanco: String(dados[i][8] || ""),
        accountId: String(dados[i][9] || ""),
        statusConciliacao: String(dados[i][10] || "NOVO").trim().toUpperCase(),
        idLancamento: String(dados[i][11] || "")
      };
    }
  }
  throw new Error("Movimento bancário não encontrado: " + alvo);
}

function validarMovimentoNovoV510_(mov) {
  if (!mov || mov.statusConciliacao !== "NOVO") {
    throw new Error("Este movimento já foi tratado. Atualize a tela Banco.");
  }
}

function marcarMovimentoBancoV510_(mov, status, idLancamento) {
  mov.sheet.getRange(mov.linha, 11).setValue(String(status || ""));
  mov.sheet.getRange(mov.linha, 12).setValue(idLancamento ? String(idLancamento) : "");
}

function tipoFluxoDoMovimentoV510_(mov) {
  return Number(mov.valor || 0) < 0 ? "Despesa" : "Receita";
}

function salvarRegraAprendidaBancoV510_(mov, dados, tipoFluxo) {
  if (!dados || dados.lembrar !== true) return;

  var padrao = String(dados.padraoBanco || "").trim();
  var descricaoFluxo = String(dados.descricao || "").trim();
  var categoria = String(dados.categoria || "").trim();
  if (!padrao || !descricaoFluxo || !categoria) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName("RegrasConciliacao") || ss.insertSheet("RegrasConciliacao");
  garantirCabecalhos_(sh, ["IdRegra", "Conta", "PadraoBanco", "DescricaoFluxo", "Tipo", "Categoria", "Acao", "Automatico", "Ativo"]);

  var conta = String(mov.conta || "TODOS").toUpperCase();
  var padraoNorm = normalizarTextoConciliacao_(padrao);
  var tipoNorm = normalizarTextoConciliacao_(tipoFluxo);

  if (sh.getLastRow() > 1) {
    var existentes = sh.getRange(2, 1, sh.getLastRow() - 1, 9).getValues();
    for (var i = 0; i < existentes.length; i++) {
      var contaExist = String(existentes[i][1] || "").trim().toUpperCase();
      var padraoExist = normalizarTextoConciliacao_(existentes[i][2]);
      var tipoExist = normalizarTextoConciliacao_(existentes[i][4]);
      if (contaExist === conta && padraoExist === padraoNorm && tipoExist === tipoNorm) {
        sh.getRange(i + 2, 4).setValue(descricaoFluxo);
        sh.getRange(i + 2, 6).setValue(categoria);
        sh.getRange(i + 2, 7).setValue("CRIAR");
        sh.getRange(i + 2, 8).setValue("NAO");
        sh.getRange(i + 2, 9).setValue("SIM");
        return;
      }
    }
  }

  sh.appendRow([
    "REG-" + new Date().getTime(),
    conta,
    padrao,
    descricaoFluxo,
    tipoFluxo,
    categoria,
    "CRIAR",
    "NAO",
    "SIM"
  ]);
}

function conciliarMovimentoBancoV510(dados) {
  garantirEstruturaV58_();
  dados = dados || {};

  var mov = encontrarMovimentoBancoLinhaV510_(dados.idPluggy);
  validarMovimentoNovoV510_(mov);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shLanc = ss.getSheetByName("Lancamentos");
  var linhaLanc = encontrarLinhaPorId_(shLanc, dados.idLancamento, COL_LANC_ID);
  if (linhaLanc < 2) throw new Error("Lançamento sugerido não foi encontrado.");

  var linha = shLanc.getRange(linhaLanc, 1, 1, 18).getValues()[0];
  var tipoEsperado = tipoFluxoDoMovimentoV510_(mov);
  var tipoLanc = String(linha[3] || "").trim();
  if (normalizarTextoConciliacao_(tipoLanc) !== normalizarTextoConciliacao_(tipoEsperado)) {
    throw new Error("Tipo incompatível entre banco e lançamento.");
  }

  var statusAtual = normalizarTextoConciliacao_(linha[5]);
  var valorAtual = Math.abs(Number(linha[2] || 0));
  var valorBanco = Math.abs(Number(mov.valor || 0));
  var dataOriginal = isoData_(linha[0]);

  // Se já estava consolidado manualmente antes da integração, apenas vincula o
  // movimento bancário. Não altera valor/data/saldo do lançamento histórico.
  if (statusAtual === "CONSOLIDADO") {
    if (!linha[12]) linha[12] = valorAtual; // ValorPrevisto
    linha[13] = valorBanco;                 // ValorRealizado
    linha[14] = Number((valorBanco - valorAtual).toFixed(2));
    linha[15] = mov.idPluggy;               // IdMovimentoBanco
    linha[16] = new Date();                 // DataConciliacao
    if (!linha[17] && dataOriginal) linha[17] = dataOriginal;

    shLanc.getRange(linhaLanc, 1, 1, 18).setValues([linha]);
    marcarMovimentoBancoV510_(mov, "CONCILIADO", linha[7]);
    registrarLog_("BANCO_VINCULADO", linha[7], mov.idPluggy + " | já consolidado");
    return "Movimento vinculado ao lançamento já consolidado.";
  }

  var valorPrevisto = linha[12] !== "" && linha[12] !== null
    ? Math.abs(Number(linha[12] || 0))
    : valorAtual;

  if (!linha[12]) linha[12] = valorPrevisto;
  linha[13] = valorBanco;
  linha[14] = Number((valorBanco - valorPrevisto).toFixed(2));
  linha[15] = mov.idPluggy;
  linha[16] = new Date();
  if (!linha[17] && dataOriginal) linha[17] = dataOriginal;

  linha[0] = new Date(mov.data + "T12:00:00");
  linha[2] = valorBanco;
  linha[5] = "Consolidado";

  shLanc.getRange(linhaLanc, 1, 1, 18).setValues([linha]);
  marcarMovimentoBancoV510_(mov, "CONCILIADO", linha[7]);

  registrarLog_(
    "BANCO_CONCILIADO",
    linha[7],
    mov.idPluggy + " | previsto=" + valorPrevisto + " | realizado=" + valorBanco
  );

  return "Conciliado com sucesso: " + String(linha[1] || "");
}

function criarLancamentoBancoV510(dados) {
  garantirEstruturaV58_();
  dados = dados || {};

  var mov = encontrarMovimentoBancoLinhaV510_(dados.idPluggy);
  validarMovimentoNovoV510_(mov);

  var descricao = String(dados.descricao || "").trim();
  var categoria = String(dados.categoria || "").trim();
  if (!descricao) throw new Error("Informe a descrição do lançamento.");
  if (!categoria) throw new Error("Escolha a categoria.");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shLanc = ss.getSheetByName("Lancamentos");
  var chave = "BANCO|" + mov.idPluggy;

  if (shLanc.getLastRow() > 1) {
    var chaves = shLanc.getRange(2, COL_LANC_CHAVE, shLanc.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < chaves.length; i++) {
      if (String(chaves[i][0] || "") === chave) {
        throw new Error("Este movimento já possui lançamento criado no fluxo.");
      }
    }
  }

  var id = gerarIdNumerico_();
  var valorBanco = Math.abs(Number(mov.valor || 0));
  var tipoFluxo = tipoFluxoDoMovimentoV510_(mov);

  shLanc.appendRow([
    new Date(mov.data + "T12:00:00"),
    descricao,
    valorBanco,
    tipoFluxo,
    categoria,
    "Consolidado",
    "",
    id,
    "BANCO",
    chave,
    "",
    "BANCO",
    "",
    valorBanco,
    "",
    mov.idPluggy,
    new Date(),
    ""
  ]);

  marcarMovimentoBancoV510_(mov, "CONCILIADO", id);
  salvarRegraAprendidaBancoV510_(mov, dados, tipoFluxo);

  registrarLog_("BANCO_NOVO_LANCAMENTO", id, mov.idPluggy + " | " + descricao + " | " + valorBanco);
  return tipoFluxo + " criada e consolidada: " + descricao;
}

function ignorarMovimentoBancoV510(idPluggy) {
  var mov = encontrarMovimentoBancoLinhaV510_(idPluggy);
  validarMovimentoNovoV510_(mov);
  marcarMovimentoBancoV510_(mov, "IGNORADO", "");
  registrarLog_("BANCO_IGNORADO", mov.idPluggy, mov.conta + " | " + mov.descricao);
  return "Movimento ignorado.";
}

function confirmarTransferenciaBancoV510(dados) {
  dados = dados || {};
  var a = encontrarMovimentoBancoLinhaV510_(dados.idPluggy);
  var b = encontrarMovimentoBancoLinhaV510_(dados.idPar);

  validarMovimentoNovoV510_(a);
  validarMovimentoNovoV510_(b);

  if (!a.conta || !b.conta || a.conta === b.conta) {
    throw new Error("As duas pontas precisam ser PF e PJ.");
  }
  if ((a.valor > 0) === (b.valor > 0)) {
    throw new Error("As duas pontas precisam ter sinais opostos.");
  }
  if (Math.abs(Math.abs(a.valor) - Math.abs(b.valor)) > 0.01) {
    throw new Error("Os valores da transferência não conferem.");
  }
  if (diferencaDiasConciliacaoV59_(a.data, b.data) > 1) {
    throw new Error("As datas estão distantes demais para transferência interna.");
  }

  marcarMovimentoBancoV510_(a, "TRANSFERENCIA_INTERNA", "");
  marcarMovimentoBancoV510_(b, "TRANSFERENCIA_INTERNA", "");

  registrarLog_("BANCO_TRANSFERENCIA_INTERNA", a.idPluggy, a.conta + " <-> " + b.conta + " | " + Math.abs(a.valor));
  return "Transferência interna PF ↔ PJ confirmada.";
}



function conciliarMovimentosBancoLoteV5101(dados) {
  dados = dados || {};
  var itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itens.length) throw new Error("Nenhum movimento confirmado para conciliar.");

  var processados = [];
  var falhas = [];

  itens.forEach(function(item) {
    try {
      var mensagem = conciliarMovimentoBancoV510({
        idPluggy: item.idPluggy,
        idLancamento: item.idLancamento
      });
      processados.push({
        idPluggy: String(item.idPluggy || ""),
        mensagem: mensagem
      });
    } catch (e) {
      falhas.push({
        idPluggy: String(item.idPluggy || ""),
        erro: e && e.message ? e.message : String(e)
      });
    }
  });

  return {
    processados: processados.length,
    erros: falhas.length,
    detalhes: processados,
    falhas: falhas
  };
}



function processarMovimentosBancoLoteV5102(dados) {
  dados = dados || {};
  var itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itens.length) throw new Error("Nenhum movimento confirmado para processar.");

  var processados = [];
  var falhas = [];

  itens.forEach(function(item) {
    try {
      var acao = String(item.acao || "").trim().toUpperCase();
      var mensagem = "";

      if (acao === "CONCILIAR") {
        mensagem = conciliarMovimentoBancoV510({
          idPluggy: item.idPluggy,
          idLancamento: item.idLancamento
        });
      } else if (acao === "TRANSFERENCIA") {
        mensagem = confirmarTransferenciaBancoV510({
          idPluggy: item.idPluggy,
          idPar: item.idPar
        });
      } else if (acao === "CRIAR") {
        mensagem = criarLancamentoBancoV510({
          idPluggy: item.idPluggy,
          descricao: item.descricao,
          categoria: item.categoria,
          lembrar: item.lembrar === true,
          padraoBanco: item.padraoBanco
        });
      } else {
        throw new Error("Ação não reconhecida: " + acao);
      }

      processados.push({
        idPluggy: String(item.idPluggy || ""),
        acao: acao,
        mensagem: mensagem
      });
    } catch (e) {
      falhas.push({
        idPluggy: String(item.idPluggy || ""),
        acao: String(item.acao || ""),
        erro: e && e.message ? e.message : String(e)
      });
    }
  });

  return {
    processados: processados.length,
    erros: falhas.length,
    detalhes: processados,
    falhas: falhas
  };
}



function obterStatusPluggyV5103_() {
  var props = PropertiesService.getScriptProperties();
  var clientId = props.getProperty("PLUGGY_CLIENT_ID");
  var clientSecret = props.getProperty("PLUGGY_CLIENT_SECRET");
  var itens = [
    { conta: "PF", itemId: props.getProperty("PLUGGY_ITEM_ID_PF") },
    { conta: "PJ", itemId: props.getProperty("PLUGGY_ITEM_ID_PJ") }
  ];

  if (!clientId || !clientSecret) {
    return {
      erro: "Credenciais Pluggy não configuradas.",
      itens: []
    };
  }

  var authResp = UrlFetchApp.fetch("https://api.pluggy.ai/auth", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      clientId: clientId,
      clientSecret: clientSecret
    }),
    muteHttpExceptions: true
  });

  if (authResp.getResponseCode() < 200 || authResp.getResponseCode() >= 300) {
    return {
      erro: "Falha ao consultar autenticação Pluggy.",
      itens: []
    };
  }

  var auth = JSON.parse(authResp.getContentText() || "{}");
  var apiKey = auth.apiKey;
  if (!apiKey) {
    return {
      erro: "Pluggy não devolveu apiKey.",
      itens: []
    };
  }

  var saida = [];

  itens.forEach(function(item) {
    if (!item.itemId) return;

    try {
      var resp = UrlFetchApp.fetch(
        "https://api.pluggy.ai/items/" + encodeURIComponent(item.itemId),
        {
          method: "get",
          headers: { "X-API-KEY": apiKey },
          muteHttpExceptions: true
        }
      );

      var code = resp.getResponseCode();
      if (code < 200 || code >= 300) {
        saida.push({
          conta: item.conta,
          erro: "HTTP " + code
        });
        return;
      }

      var dados = JSON.parse(resp.getContentText() || "{}");
      var ultima = dados.lastUpdatedAt || dados.updatedAt || "";
      var proxima = dados.nextAutoSyncAt || "";
      var proximaEstimada = false;

      // No conector MeuPluggy, o item proxy normalmente retorna
      // nextAutoSyncAt = null. Nesse caso usamos lastUpdatedAt + 24h30
      // apenas como estimativa visual.
      if (!proxima && ultima) {
        var dt = new Date(ultima);
        if (!isNaN(dt.getTime())) {
          proxima = new Date(dt.getTime() + (24 * 60 + 30) * 60 * 1000).toISOString();
          proximaEstimada = true;
        }
      }

      saida.push({
        conta: item.conta,
        status: String(dados.status || ""),
        executionStatus: String(dados.executionStatus || ""),
        lastUpdatedAt: ultima,
        nextAutoSyncAt: proxima,
        proximaEstimada: proximaEstimada
      });
    } catch (e) {
      saida.push({
        conta: item.conta,
        erro: e && e.message ? e.message : String(e)
      });
    }
  });

  var timestamps = saida
    .map(function(x) {
      var t = x.lastUpdatedAt ? new Date(x.lastUpdatedAt).getTime() : NaN;
      return isNaN(t) ? null : t;
    })
    .filter(function(t) { return t !== null; });

  var referencia = "";
  var idadeHoras = null;
  var proximaEsperada = "";

  if (timestamps.length) {
    // V5.10.4:
    // próxima provável = sincronização MAIS RECENTE entre PF/PJ
    // + 24 horas + 30 minutos de margem.
    var maxTs = Math.max.apply(null, timestamps);
    referencia = new Date(maxTs).toISOString();
    idadeHoras = Math.max(0, (new Date().getTime() - maxTs) / 3600000);
    proximaEsperada = new Date(maxTs + (24 * 60 + 30) * 60 * 1000).toISOString();
  }

  return {
    itens: saida,
    referenciaAtualizacao: referencia,
    idadeHoras: idadeHoras,
    proximaEsperadaAt: proximaEsperada,
    stale24h: idadeHoras !== null ? idadeHoras >= 24.5 : false,
    consultadoEm: new Date().toISOString()
  };
}


function obterConciliacaoBancoV59() {
  var movimentos = lerMovimentosBancoV59_();
  var regras = lerRegrasConciliacaoV59_();
  var lancamentos = lerLancamentosConciliacaoV59_();
  var clientes = lerClientesConciliacaoV59_();
  var transf = detectarTransferenciasInternasV59_(movimentos);

  var sugestoes = 0;

  movimentos.forEach(function(mov) {
    mov.natureza = naturezaMovimentoBancoV59_(mov);
    var par = transf.paresPorId[mov.idPluggy];

    if (par) {
      mov.sugestao = {
        tipo: "TRANSFERENCIA_INTERNA",
        titulo: "Transferência interna PF ↔ PJ",
        detalhe: "Par encontrado na conta " + par.conta + " em " + par.data + ".",
        par: par
      };
      return;
    }

    var regra = encontrarRegraConciliacaoV59_(mov, regras);
    var cliente = encontrarClienteConciliacaoV59_(mov, clientes);
    var candidato = null;

    if (regra) {
      candidato = encontrarLancamentoConciliacaoV59_(mov, lancamentos, regra.descricaoFluxo);
      mov.sugestao = {
        tipo: "REGRA",
        titulo: "Regra encontrada: " + (regra.descricaoFluxo || regra.padraoBanco),
        detalhe: candidato ? "Lançamento compatível encontrado." : "Regra ativa encontrada, mas sem lançamento compatível.",
        regra: {
          idRegra: regra.idRegra,
          padraoBanco: regra.padraoBanco,
          descricaoFluxo: regra.descricaoFluxo,
          categoria: regra.categoria
        },
        candidato: candidato
      };
      if (candidato) sugestoes++;
      return;
    }

    if (cliente) {
      candidato = encontrarLancamentoConciliacaoV59_(mov, lancamentos, cliente.nome);
      mov.sugestao = {
        tipo: "CLIENTE",
        titulo: "Cliente reconhecido: " + cliente.nome,
        detalhe: candidato ? "Receita correspondente encontrada." : "Cliente reconhecido, mas sem lançamento compatível.",
        candidato: candidato
      };
      if (candidato) sugestoes++;
      return;
    }

    candidato = encontrarLancamentoConciliacaoV59_(mov, lancamentos, "");
    if (candidato) {
      mov.sugestao = {
        tipo: "MATCH",
        titulo: normalizarTextoConciliacao_(candidato.status) === "CONSOLIDADO"
          ? "Possível correspondência já consolidada"
          : "Possível lançamento correspondente",
        detalhe: "Correspondência por descrição, valor e proximidade de data.",
        candidato: candidato
      };
      sugestoes++;
      return;
    }

    if (mov.natureza === "DEBIT") {
      mov.sugestao = {
        tipo: "NOVA_DESPESA",
        titulo: "Nova despesa provável",
        detalhe: mov.categoriaPluggy
          ? "Categoria Pluggy sugerida: " + mov.categoriaPluggy
          : "Sem categoria sugerida pela Pluggy."
      };
    } else {
      mov.sugestao = {
        tipo: "ENTRADA_NAO_IDENTIFICADA",
        titulo: "Entrada não identificada",
        detalhe: "Nenhuma regra, cliente ou lançamento correspondente foi encontrado."
      };
    }
  });

  var movimentosExibicao = movimentos.filter(function(mov) {
    if (
      mov.sugestao &&
      mov.sugestao.tipo === "TRANSFERENCIA_INTERNA" &&
      Number(mov.valor || 0) > 0
    ) return false;
    return true;
  });

  movimentosExibicao.sort(function(a, b) {
    if (a.data === b.data) return Math.abs(b.valor) - Math.abs(a.valor);
    return a.data < b.data ? 1 : -1;
  });

  return {
    versao: "5.10.3",
    statusPluggy: obterStatusPluggyV5103_(),
    resumo: {
      total: movimentosExibicao.length,
      sugestoes: sugestoes,
      transferencias: transf.quantidadePares
    },
    movimentos: movimentosExibicao
  };
}

function prepararRegrasConciliacao() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('RegrasConciliacao');

  if (!sheet) {
    throw new Error("A aba 'RegrasConciliacao' não existe.");
  }

  const cabecalho = [
    'IdRegra',
    'Conta',
    'PadraoBanco',
    'DescricaoFluxo',
    'Tipo',
    'Categoria',
    'Acao',
    'Automatico',
    'Ativo'
  ];

  sheet.clear();

  sheet
    .getRange(1, 1, 1, cabecalho.length)
    .setValues([cabecalho]);

  sheet.setFrozenRows(1);

  Logger.log('✅ Estrutura RegrasConciliacao criada.');
}