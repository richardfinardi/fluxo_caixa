/* V5.14.1 - relatório de horas */
var horasV514 = { relatorios: [], selecionado: 0 };

function escapeHorasV514_(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function moedaHorasV514_(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function numeroHorasV514_(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dataBrHorasV514_(iso) {
  if (!iso) return '—';
  var p = String(iso).substring(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso;
}

function dataCurtaHorasV514_(iso) {
  if (!iso) return '—';
  var p = String(iso).substring(0, 10).split('-');
  return p.length === 3 ? p[2] + '/' + p[1] : iso;
}

function executarHorasV514_(funcao, args, sucesso) {
  google.script.run
    .withSuccessHandler(function(resp) {
      if (sucesso) sucesso(resp);
    })
    .withFailureHandler(function(err) {
      exibirAvisoNaTela('Erro em Horas: ' + err, 'danger');
    })
    .executarGenerico(funcao, args === undefined ? null : args);
}

function popularCadastrosHorasV514_() {
  var dl = document.getElementById('horasClientesListaV514');
  if (dl) {
    dl.innerHTML = (state.regras || []).map(function(r) {
      return '<option value="' + escapeHorasV514_(r.cliente) + '"></option>';
    }).join('');
  }

  var sel = document.getElementById('horasCategoriaV514');
  if (sel) {
    var categorias = [];
    (state.categorias || []).forEach(function(c) {
      var n = String(c.nome || '').trim();
      if (n && categorias.indexOf(n) === -1) categorias.push(n);
    });
    if (categorias.indexOf('Consultoria') === -1) categorias.unshift('Consultoria');
    var atual = sel.value;
    sel.innerHTML = categorias.map(function(n) {
      return '<option value="' + escapeHorasV514_(n) + '">' + escapeHorasV514_(n) + '</option>';
    }).join('');
    if (atual && categorias.indexOf(atual) !== -1) sel.value = atual;
  }
}

function sugerirValorHoraV514_() {
  var cliente = String(document.getElementById('horasClienteV514').value || '').trim().toLowerCase();
  if (!cliente) return;
  var regra = (state.regras || []).find(function(r) {
    return String(r.cliente || '').trim().toLowerCase() === cliente;
  });
  if (!regra) return;

  var valor = Number(regra.valorVisita || 0);
  var hoje = hojeIsoJs();
  if (regra.novoValor && regra.dataVigor && hoje >= regra.dataVigor) valor = Number(regra.novoValor || valor);
  if (valor > 0) document.getElementById('horasValorHoraV514').value = valor.toFixed(2);
}

function limparPeriodoHorasV514_() {
  horasV514.selecionado = horasV514.selecionado || 0;
  var f = document.getElementById('formPeriodoHorasV514');
  if (f) f.reset();
  document.getElementById('horasRelatorioIdV514').value = '';
  document.getElementById('horasFormTituloV514').innerText = '⏱️ Novo período';
  document.getElementById('btnSalvarPeriodoHorasV514').innerText = 'Salvar período';
  popularCadastrosHorasV514_();
}

function salvarPeriodoHorasV514(e) {
  e.preventDefault();
  var btn = document.getElementById('btnSalvarPeriodoHorasV514');
  var dados = {
    id: document.getElementById('horasRelatorioIdV514').value,
    cliente: document.getElementById('horasClienteV514').value,
    periodoInicio: document.getElementById('horasInicioV514').value,
    periodoFim: document.getElementById('horasFimV514').value,
    vencimento: document.getElementById('horasVencimentoV514').value,
    valorHora: document.getElementById('horasValorHoraV514').value,
    categoria: document.getElementById('horasCategoriaV514').value
  };

  btn.disabled = true;
  executarHorasV514_('salvarRelatorioHoras', dados, function(msg) {
    btn.disabled = false;
    exibirAvisoNaTela(msg || 'Período salvo.', 'success');
    horasV514.selecionado = 0;
    limparPeriodoHorasV514_();
    carregarRelatoriosHorasV514();
  });
}

function carregarRelatoriosHorasV514() {
  if (!document.getElementById('listaRelatoriosHorasV514')) return;
  popularCadastrosHorasV514_();
  document.getElementById('listaRelatoriosHorasV514').innerHTML =
    '<div class="horas-v514-vazio">Carregando relatórios...</div>';

  executarHorasV514_('obterRelatoriosHoras', null, function(dados) {
    horasV514.relatorios = (dados && dados.relatorios) ? dados.relatorios : [];
    renderizarListaHorasV514_();

    var alvo = horasV514.selecionado;
    if (!alvo && horasV514.relatorios.length) alvo = Number(horasV514.relatorios[0].id);
    if (alvo) selecionarRelatorioHorasV514(alvo);
    else renderizarDetalheHorasV514_();
  });
}

function renderizarListaHorasV514_() {
  var box = document.getElementById('listaRelatoriosHorasV514');
  if (!box) return;
  if (!horasV514.relatorios.length) {
    box.innerHTML = '<div class="horas-v514-vazio">Nenhum período criado ainda.</div>';
    return;
  }

  box.innerHTML = horasV514.relatorios.map(function(r) {
    var ativo = Number(r.id) === Number(horasV514.selecionado) ? ' ativo' : '';
    var prev = r.lancamentoId
      ? '<span class="badge bg-success horas-v514-badge-prev">Previsão ativa</span>'
      : '<span class="badge bg-secondary horas-v514-badge-prev">Sem previsão</span>';

    return '<div class="horas-v514-card' + ativo + '" onclick="selecionarRelatorioHorasV514(' + Number(r.id) + ')">' +
      '<div class="horas-v514-card-topo">' +
        '<div><div class="horas-v514-cliente">' + escapeHorasV514_(r.cliente) + '</div>' +
        '<div class="horas-v514-periodo">' + dataCurtaHorasV514_(r.periodoInicio) + ' a ' + dataCurtaHorasV514_(r.periodoFim) +
        ' • vence ' + dataBrHorasV514_(r.vencimento) + '</div></div>' + prev +
      '</div>' +
      '<div class="horas-v514-valores">' +
        '<div class="horas-v514-kpi"><small>HORAS</small><strong>' + numeroHorasV514_(r.totalHoras) + '</strong></div>' +
        '<div class="horas-v514-kpi"><small>R$/H</small><strong>' + moedaHorasV514_(r.valorHora) + '</strong></div>' +
        '<div class="horas-v514-kpi"><small>TOTAL</small><strong>' + moedaHorasV514_(r.valorTotal) + '</strong></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function selecionarRelatorioHorasV514(id) {
  horasV514.selecionado = Number(id);
  renderizarListaHorasV514_();
  renderizarDetalheHorasV514_();
}

function relatorioSelecionadoHorasV514_() {
  return horasV514.relatorios.find(function(r) {
    return Number(r.id) === Number(horasV514.selecionado);
  }) || null;
}

function renderizarDetalheHorasV514_() {
  var box = document.getElementById('detalheRelatorioHorasV514');
  if (!box) return;
  var r = relatorioSelecionadoHorasV514_();
  if (!r) {
    box.classList.add('d-none');
    return;
  }
  box.classList.remove('d-none');

  document.getElementById('detalheHorasClienteV514').innerText = r.cliente;
  document.getElementById('detalheHorasPeriodoV514').innerText =
    dataBrHorasV514_(r.periodoInicio) + ' a ' + dataBrHorasV514_(r.periodoFim) +
    ' • vencimento ' + dataBrHorasV514_(r.vencimento);
  document.getElementById('detalheHorasTotalV514').innerText = numeroHorasV514_(r.totalHoras) + ' h';
  document.getElementById('detalheHorasValorHoraV514').innerText = moedaHorasV514_(r.valorHora);
  document.getElementById('detalheHorasValorTotalV514').innerText = moedaHorasV514_(r.valorTotal);
  document.getElementById('detalheHorasPrevisaoV514').innerText = r.lancamentoId ? 'Ativa' : 'Não lançada';

  var btnPrev = document.getElementById('btnPrevisaoHorasV514');
  btnPrev.innerText = '↻ Sincronizar previsão';

  var dataInput = document.getElementById('horaDataV514');
  var hoje = hojeIsoJs();
  dataInput.min = r.periodoInicio;
  dataInput.max = r.periodoFim;
  if (!dataInput.value || dataInput.value < r.periodoInicio || dataInput.value > r.periodoFim) {
    dataInput.value = (hoje >= r.periodoInicio && hoje <= r.periodoFim) ? hoje : r.periodoInicio;
  }

  var tbody = document.getElementById('tbodyHorasV514');
  var itens = r.horas || [];
  if (!itens.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-3">Nenhuma hora lançada.</td></tr>';
  } else {
    tbody.innerHTML = itens.map(function(h) {
      return '<tr>' +
        '<td><b>' + dataCurtaHorasV514_(h.data) + '</b></td>' +
        '<td>' + escapeHorasV514_(h.horaEntrada) + '</td>' +
        '<td>' + escapeHorasV514_(h.horaSaida) + '</td>' +
        '<td>' + escapeHorasV514_(h.observacao || '') + '</td>' +
        '<td class="text-end fw-bold">' + numeroHorasV514_(h.totalHoras) + '</td>' +
        '<td class="text-end"><button type="button" class="btn btn-sm text-danger border-0" onclick="excluirHoraV514(' + Number(h.id) + ')">🗑️</button></td>' +
      '</tr>';
    }).join('');
  }
}

function editarPeriodoHorasV514() {
  var r = relatorioSelecionadoHorasV514_();
  if (!r) return;
  document.getElementById('horasRelatorioIdV514').value = r.id;
  document.getElementById('horasClienteV514').value = r.cliente;
  document.getElementById('horasInicioV514').value = r.periodoInicio;
  document.getElementById('horasFimV514').value = r.periodoFim;
  document.getElementById('horasVencimentoV514').value = r.vencimento;
  document.getElementById('horasValorHoraV514').value = Number(r.valorHora || 0).toFixed(2);
  document.getElementById('horasCategoriaV514').value = r.categoria || 'Consultoria';
  document.getElementById('horasFormTituloV514').innerText = '✏️ Editando período';
  document.getElementById('btnSalvarPeriodoHorasV514').innerText = 'Atualizar período';
  document.getElementById('horas').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function salvarHoraV514(e) {
  e.preventDefault();
  var r = relatorioSelecionadoHorasV514_();
  if (!r) return;
  var btn = document.getElementById('btnAdicionarHoraV514');
  var dados = {
    idRelatorio: r.id,
    data: document.getElementById('horaDataV514').value,
    horaEntrada: document.getElementById('horaEntradaV514').value,
    horaSaida: document.getElementById('horaSaidaV514').value,
    observacao: document.getElementById('horaObsV514').value
  };
  btn.disabled = true;
  executarHorasV514_('salvarHoraRelatorio', dados, function(msg) {
    btn.disabled = false;
    exibirAvisoNaTela(msg || 'Hora adicionada.', 'success');
    document.getElementById('horaEntradaV514').value = '';
    document.getElementById('horaSaidaV514').value = '';
    document.getElementById('horaObsV514').value = '';
    carregarRelatoriosHorasV514();
  });
}

function excluirHoraV514(idHora) {
  exibirModalConfirmacao('Remover este apontamento de horas?', function() {
    executarHorasV514_('excluirHoraRelatorio', Number(idHora), function(msg) {
      exibirAvisoNaTela(msg || 'Apontamento removido.', 'success');
      carregarRelatoriosHorasV514();
    });
  });
}

function sincronizarPrevisaoHorasV514() {
  var r = relatorioSelecionadoHorasV514_();
  if (!r) return;
  var btn = document.getElementById('btnPrevisaoHorasV514');
  btn.disabled = true;
  executarHorasV514_('sincronizarPrevisaoRelatorioHoras', Number(r.id), function(msg) {
    btn.disabled = false;
    exibirAvisoNaTela(msg || 'Previsão atualizada.', 'success');
    carregarRelatoriosHorasV514();
  });
}

function carregarLogoPdfHorasV514_() {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      try {
        var canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          width: canvas.width,
          height: canvas.height
        });
      } catch (e) {
        console.warn('Não foi possível converter o logo para o PDF:', e);
        resolve(null);
      }
    };
    img.onerror = function() {
      console.warn('Logo não encontrado para o PDF.');
      resolve(null);
    };
    img.src = './LOGO%20APLICACAO%20FUNDO%20BRANCO.png?v=5144';
  });
}

async function baixarPdfHorasV514() {
  var r = relatorioSelecionadoHorasV514_();
  if (!r) return;

  var btn = document.getElementById('btnPdfHorasV514');
  btn.disabled = true;
  btn.innerText = '⏳ Gerando PDF...';

  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('Biblioteca de PDF não carregou. Atualize a página e tente novamente.');
    }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    var itens = r.horas || [];
    var totalHoras = Number(r.totalHoras || 0);
    var valorTotal = Number(r.valorTotal || 0);

    // Paleta CONSULTORIA.RF / Fluxo de Caixa
    var COR_NAVY = [44, 62, 80];
    var COR_AZUL = [52, 152, 219];
    var COR_LARANJA = [243, 156, 18];
    var COR_CINZA = [108, 117, 125];
    var COR_CLARA = [244, 246, 249];

    // Cabeçalho com identidade visual
    doc.setFillColor(COR_CLARA[0], COR_CLARA[1], COR_CLARA[2]);
    doc.roundedRect(10, 9, 190, 24, 2, 2, 'F');

    var logo = await carregarLogoPdfHorasV514_();
    if (logo && logo.dataUrl) {
      var maxW = 48;
      var maxH = 15;
      var proporcao = logo.width / logo.height;
      var w = maxW;
      var h = w / proporcao;
      if (h > maxH) {
        h = maxH;
        w = h * proporcao;
      }
      doc.addImage(logo.dataUrl, 'PNG', 14, 13, w, h);
    }

    doc.setTextColor(COR_NAVY[0], COR_NAVY[1], COR_NAVY[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('RELATÓRIO DE HORAS', 105, 17, { align: 'center' });

    doc.setTextColor(COR_AZUL[0], COR_AZUL[1], COR_AZUL[2]);
    doc.setFontSize(10.5);
    doc.text(String(r.cliente || '').toUpperCase(), 105, 23, { align: 'center' });

    doc.setTextColor(COR_CINZA[0], COR_CINZA[1], COR_CINZA[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(
      dataBrHorasV514_(r.periodoInicio) + ' a ' + dataBrHorasV514_(r.periodoFim),
      195, 17, { align: 'right' }
    );
    doc.setTextColor(COR_LARANJA[0], COR_LARANJA[1], COR_LARANJA[2]);
    doc.setFont('helvetica', 'bold');
    doc.text('Venc. ' + dataBrHorasV514_(r.vencimento), 195, 23, { align: 'right' });

    doc.setDrawColor(COR_LARANJA[0], COR_LARANJA[1], COR_LARANJA[2]);
    doc.setLineWidth(1.1);
    doc.line(10, 35, 200, 35);

    var linhas = itens.map(function(h) {
      return [
        dataCurtaHorasV514_(h.data),
        h.horaEntrada || '',
        h.horaSaida || '',
        h.observacao || '',
        numeroHorasV514_(h.totalHoras)
      ];
    });

    doc.autoTable({
      startY: 40,
      head: [['DATA', 'HR ENT.', 'HR SAÍDA', 'OBSERVAÇÃO', 'TOTAL']],
      body: linhas,
      foot: [['', '', '', 'TOTAL', numeroHorasV514_(totalHoras)]],
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        cellPadding: 2.4,
        valign: 'middle',
        lineColor: [220, 225, 230],
        lineWidth: 0.15,
        textColor: COR_NAVY
      },
      headStyles: {
        fillColor: COR_NAVY,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center'
      },
      footStyles: {
        fillColor: COR_LARANJA,
        textColor: [255, 255, 255],
        fontStyle: 'bold'
      },
      alternateRowStyles: {
        fillColor: COR_CLARA
      },
      columnStyles: {
        0: { cellWidth: 22, halign: 'center' },
        1: { cellWidth: 22, halign: 'center' },
        2: { cellWidth: 22, halign: 'center' },
        3: { cellWidth: 92 },
        4: { cellWidth: 25, halign: 'right', fontStyle: 'bold' }
      },
      margin: { left: 14, right: 14 }
    });

    var y = (doc.lastAutoTable && doc.lastAutoTable.finalY ? doc.lastAutoTable.finalY : 55) + 8;

    // Resumo financeiro
    doc.setFillColor(COR_NAVY[0], COR_NAVY[1], COR_NAVY[2]);
    doc.roundedRect(14, y, 182, 22, 2, 2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('TOTAL DE HORAS', 37, y + 7, { align: 'center' });
    doc.text('VALOR/HORA', 105, y + 7, { align: 'center' });
    doc.text('VALOR TOTAL', 172, y + 7, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(numeroHorasV514_(totalHoras) + ' h', 37, y + 15, { align: 'center' });
    doc.text(moedaHorasV514_(r.valorHora), 105, y + 15, { align: 'center' });

    doc.setTextColor(COR_LARANJA[0], COR_LARANJA[1], COR_LARANJA[2]);
    doc.setFontSize(12);
    doc.text(moedaHorasV514_(valorTotal), 172, y + 15, { align: 'center' });

    y += 31;

    doc.setTextColor(COR_NAVY[0], COR_NAVY[1], COR_NAVY[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    var texto = 'Segue relatório de horas da prestação de serviço, referente ao período de ' +
      dataCurtaHorasV514_(r.periodoInicio) + ' a ' + dataCurtaHorasV514_(r.periodoFim) +
      ', no valor de ' + moedaHorasV514_(valorTotal) +
      ', a ser pago através de boleto bancário.';
    var quebrado = doc.splitTextToSize(texto, 180);
    doc.text(quebrado, 14, y);

    // Rodapé discreto
    doc.setDrawColor(COR_AZUL[0], COR_AZUL[1], COR_AZUL[2]);
    doc.setLineWidth(0.4);
    doc.line(14, 282, 196, 282);
    doc.setTextColor(COR_CINZA[0], COR_CINZA[1], COR_CINZA[2]);
    doc.setFontSize(7);
    doc.text('CONSULTORIA.RF', 14, 287);
    doc.text('Relatório gerado pelo Fluxo de Caixa', 196, 287, { align: 'right' });

    var nome = 'Relatorio_Horas_' + String(r.cliente || 'Cliente')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_') +
      '_' + String(r.periodoInicio || '').replace(/-/g, '') +
      '_' + String(r.periodoFim || '').replace(/-/g, '') + '.pdf';

    doc.save(nome);
    exibirAvisoNaTela('PDF gerado com sucesso.', 'success');
  } catch (err) {
    console.error('Erro ao gerar PDF local:', err);
    exibirAvisoNaTela('Erro ao gerar PDF: ' + (err.message || err), 'danger');
  } finally {
    btn.disabled = false;
    btn.innerText = '📄 Gerar PDF';
  }
}
