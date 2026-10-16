/* FLUXO V6 | Navegação clean + leitura cache-first / revalidação silenciosa.
   Não salva pagamentos offline e não altera a lógica de conciliação. */
(function () {
  'use strict';
  var CACHE_DB = 'FLUXO_V6_CACHE';
  var CACHE_STORE = 'snapshots';
  var THEME_KEY = 'FLUXO_V6_THEME';
  var SESSION_KEY = 'FLUXO_V6_SUBVIEW';
  var ultimaBusca = { global: 0, banco: 0, cartao: 0 };
  var carregando = { global: false, banco: false, cartao: false };
  var viewMov = 'extrato';
  var tempo = 150000;
  var mediaEscuro = window.matchMedia('(prefers-color-scheme: dark)');
  var aberto = false;

  function id(name) { return document.getElementById(name); }
  function atualizarRelogio(at, veioCache) {
    var el = id('v6SyncInfo');
    if (!el || !at) return;
    el.textContent = (veioCache ? 'Dados em cache · ' : 'Atualizado · ') +
      new Date(at).toLocaleString('pt-BR', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  function dbOpen() {
    return new Promise(function (resolve) {
      if (!('indexedDB' in window)) return resolve(null);
      try {
        var req = indexedDB.open(CACHE_DB, 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains(CACHE_STORE)) req.result.createObjectStore(CACHE_STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
  }
  async function cacheAcessar(key, data) {
    var db = await dbOpen();
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(CACHE_STORE, data === undefined ? 'readonly' : 'readwrite');
        var store = tx.objectStore(CACHE_STORE);
        var req = data === undefined ? store.get(key) : store.put({ at: Date.now(), data: data }, key);
        req.onsuccess = function () { resolve(data === undefined ? req.result || null : true); };
        req.onerror = function () { resolve(null); };
        tx.onabort = function () { resolve(null); };
        tx.oncomplete = function () { db.close(); };
      } catch (_) { try { db.close(); } catch (_) {} resolve(null); }
    });
  }
  window.v6GuardarCache = function (key, dados) {
    if (!dados || window.v6LendoCache) return;
    cacheAcessar(key, dados).catch(function () {});
    if (key === 'global') {
      ultimaBusca.global = Date.now();
      atualizarRelogio(ultimaBusca.global, false);
    }
    if (key === 'banco' || key === 'cartao') ultimaBusca[key] = Date.now();
  };
  async function lerCache(key) {
    try { return await cacheAcessar(key); } catch (_) { return null; }
  }
  async function restaurarGlobal() {
    var snapshot = await lerCache('global');
    if (!snapshot || !snapshot.data || !Array.isArray(snapshot.data.lancamentos)) return;
    window.v6LendoCache = true;
    try { aplicarDadosGlobais(snapshot.data); } catch (e) { console.warn('Cache financeiro inválido', e); }
    finally { window.v6LendoCache = false; }
    atualizarRelogio(snapshot.at, true);
  }
  async function restaurarBanco() {
    if (bancoV59.dados) return;
    var snapshot = await lerCache('banco');
    if (!snapshot || !snapshot.data) return;
    bancoV59.dados = snapshot.data;
    renderizarBancoV59();
    var st = id('bancoStatusV59');
    if (st) st.textContent = 'Exibindo última consulta salva. Atualizando sem interromper a tela...';
  }
  async function restaurarCartao() {
    if (cartaoV513.dados) return;
    var snapshot = await lerCache('cartao');
    if (!snapshot || !snapshot.data) return;
    cartaoV513.dados = snapshot.data;
    renderizarCartaoV513();
  }
  window.v6CarregarComCache = async function () {
    if (aberto) return;
    aberto = true;
    await Promise.all([restaurarGlobal(), restaurarBanco(), restaurarCartao()]);
    if (bancoV59.dados) renderizarBancoV59();
    v6SincronizarGlobal(true);
  };
  function temEdicaoAtiva() {
    if (document.hidden) return true;
    if (document.querySelector('.modal.show')) return true;
    if (id('lancamentos') && id('lancamentos').classList.contains('v6-form-visible')) return true;
    if (typeof lancamentosSimulados !== 'undefined' && lancamentosSimulados) return true;
    var el = document.activeElement;
    if (el && el.closest && (el.closest('form') || el.closest('#v6FiltrosExtrato'))) return true;
    return false;
  }
  function v6SincronizarGlobal(force) {
    if (!aberto || carregando.global || temEdicaoAtiva()) return;
    if (!force && Date.now()-ultimaBusca.global < tempo) return;
    carregando.global = true;
    // A chamada mantém o handler original, que atualiza em memória e persiste no IndexedDB.
    return Promise.resolve(recarregarDadosGlobais(true)).finally(function () { carregando.global=false; });
  }
  function v6SincronizarBanco() {
    if (carregando.banco || temEdicaoAtiva()) return;
    if (Date.now()-ultimaBusca.banco < tempo) return;
    carregando.banco = true;
    return Promise.resolve(carregarConciliacaoBancoV59()).finally(function () { carregando.banco=false; });
  }
  function v6SincronizarCartao() {
    if (carregando.cartao || temEdicaoAtiva()) return;
    if (Date.now()-ultimaBusca.cartao < tempo) return;
    carregando.cartao = true;
    return Promise.resolve(carregarCartaoV513()).finally(function () { carregando.cartao=false; });
  }

  function temaPreferido() {
    try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (_) { return 'auto'; }
  }
  function aplicarTema(pref, persistir) {
    pref = ['auto','light','dark'].includes(pref) ? pref : 'auto';
    if (persistir) { try { localStorage.setItem(THEME_KEY, pref); } catch (_) {} }
    var valor = pref === 'auto' ? (mediaEscuro.matches ? 'dark' : 'light') : pref;
    document.documentElement.setAttribute('data-bs-theme', valor);
    document.documentElement.dataset.v6ThemePref = pref;
    var selector = id('v6Theme');
    if (selector) selector.value = pref;
    var cor = valor === 'dark' ? '#0d1625' : '#ffffff';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta');meta.name='theme-color';document.head.appendChild(meta); }
    meta.content = cor;
    if (window.Chart) {
      Chart.defaults.color = valor === 'dark' ? '#bdcce1' : '#526273';
      Chart.defaults.borderColor = valor === 'dark' ? '#36465b' : '#e5eaf0';
      if (typeof chartInstance !== 'undefined' && chartInstance) {
        try {
          Object.values(chartInstance.options.scales || {}).forEach(function(axis) {
            if (!axis.ticks) axis.ticks = {};
            axis.ticks.color = Chart.defaults.color;
            axis.grid = axis.grid || {};
            axis.grid.color = Chart.defaults.borderColor;
          });
          chartInstance.update('none');
        } catch (_) {}
      }
    }
  }
  window.v6Tema = function (v) { aplicarTema(v, true); };
  if (mediaEscuro.addEventListener) mediaEscuro.addEventListener('change', function () {
    if (temaPreferido() === 'auto') aplicarTema('auto', false);
  });
  aplicarTema(temaPreferido(), false);

  function viewLabel(tab) {
    return ({fluxo:'Início',lancamentos:'Movimentações',dashboard:'Análises',faturar:'A faturar',
      recorrente:'Recorrências',agenda:'Agenda',clientes:'Clientes',horas:'Horas',
      categorias:'Categorias',condicoes:'Termos de pagamento'})[tab] || 'Início';
  }
  window.v6Navegar = function(tab) {
    var target = id(tab+'-tab');
    if (!target) return;
    bootstrap.Tab.getOrCreateInstance(target).show();
    document.querySelectorAll('#v6Navigation [data-v6-view]').forEach(function(btn) {
      var v=btn.getAttribute('data-v6-view');
      btn.classList.toggle('active', v===tab || (v==='mais' && !['fluxo','lancamentos','dashboard'].includes(tab)));
    });
    var titulo = id('v6SectionTitle');
    if (titulo) titulo.textContent = viewLabel(tab);
    document.body.classList.toggle('v6-other-view', tab!=='fluxo');
    if (tab==='lancamentos' && viewMov==='banco') v6SincronizarBanco();
    if (tab==='lancamentos' && viewMov==='cartao') v6SincronizarCartao();
    if (tab==='dashboard') renderizarDashboardMensal();
    if (tab==='horas') carregarRelatoriosHorasV514();
    window.scrollTo({top:0,behavior:'auto'});
  };
  window.v6AlternarMovimentos = function(sub, forcar) {
    sub = ['extrato','banco','cartao'].includes(sub) ? sub : 'extrato';
    viewMov = sub;
    document.querySelectorAll('.v6-subpanel').forEach(function(el) {
      el.hidden = el.id !== 'v6-panel-'+sub;
    });
    document.querySelectorAll('[data-v6-sub]').forEach(function(btn) {
      btn.classList.toggle('active',btn.getAttribute('data-v6-sub')===sub);
    });
    try { sessionStorage.setItem(SESSION_KEY,sub); } catch (_) {}
    if (sub==='banco') {
      if (!bancoV59.dados) restaurarBanco().then(function(){ v6SincronizarBanco(); });
      else if (forcar || Date.now()-ultimaBusca.banco >= tempo) v6SincronizarBanco();
    }
    if (sub==='cartao') {
      if (!cartaoV513.dados) restaurarCartao().then(function(){ v6SincronizarCartao(); });
      else if (forcar || Date.now()-ultimaBusca.cartao >= tempo) v6SincronizarCartao();
    }
  };
  window.v6MostrarFormulario = function(mostrar) {
    var pane = id('lancamentos');
    if (!pane) return;
    pane.classList.toggle('v6-form-visible', !!mostrar);
    if (mostrar) {
      v6AlternarMovimentos('extrato');
      var form = id('cardFormLancamento');
      if (form) form.scrollIntoView({block:'start',behavior:'smooth'});
    } else if (typeof cancelarEdicao === 'function' && id('editLancamentoId') && id('editLancamentoId').value) {
      cancelarEdicao();
    }
    var btn = id('v6NewLanc');
    if (btn) btn.textContent = mostrar ? 'Fechar formulário' : '+ Novo lançamento';
  };
  window.v6NovoLancamento = function() {
    v6Navegar('lancamentos');
    v6MostrarFormulario(!id('lancamentos').classList.contains('v6-form-visible'));
  };
  window.v6ToggleFiltro = function() {
    var b = id('v6FiltrosExtrato');
    var t = id('v6FiltrosToggle');
    if (!b) return;
    b.classList.toggle('v6-filtros-abertos');
    if (t) t.textContent = b.classList.contains('v6-filtros-abertos') ? 'Ocultar filtros' : 'Filtros';
  };
  window.v6DetalhesKpis = function() {
    document.body.classList.toggle('v6-more-kpis');
    var btn = id('v6KpisToggle');
    if (btn) btn.textContent = document.body.classList.contains('v6-more-kpis') ? 'Menos indicadores' : 'Ver mais indicadores';
  };
  window.v6AtualizarAgora = function() {
    ultimaBusca.global = 0;
    v6SincronizarGlobal(true);
    if (viewMov==='banco') { ultimaBusca.banco=0;v6SincronizarBanco(); }
    if (viewMov==='cartao') { ultimaBusca.cartao=0;v6SincronizarCartao(); }
  };
  window.v6LimparCache = async function() {
    if (!window.confirm('Remover dados financeiros salvos neste navegador? Os dados do sistema permanecem intactos.')) return;
    var db = await dbOpen();
    if (db) {
      try {
        await new Promise(function(resolve) {
          var tx=db.transaction(CACHE_STORE,'readwrite');
          tx.objectStore(CACHE_STORE).clear();
          tx.oncomplete=resolve;tx.onerror=resolve;tx.onabort=resolve;
        });
      } finally {db.close();}
    }
    var el=id('v6SyncInfo'); if(el) el.textContent='Cache apagado deste navegador';
  };
  function criarSubpanel(container, nome, origem) {
    var p=document.createElement('section');
    p.id='v6-panel-'+nome;
    p.className='v6-subpanel v6-view-pane';
    p.hidden=nome!=='extrato';
    while (origem.firstChild) p.appendChild(origem.firstChild);
    container.appendChild(p);
  }
  function criarInterface() {
    var tabs=id('mainTabs');
    var content=id('mainTabsContent');
    if (!tabs || !content || id('v6Navigation')) return;
    var nav=document.createElement('div');
    nav.id='v6Navigation';
    nav.innerHTML =
      '<div class="v6-links" role="navigation" aria-label="Navegação principal">'+
        '<button type="button" class="v6-nav-btn active" data-v6-view="fluxo" onclick="v6Navegar(\'fluxo\')">⌂ Início</button>'+
        '<button type="button" class="v6-nav-btn" data-v6-view="lancamentos" onclick="v6Navegar(\'lancamentos\')">⇄ Movimentos</button>'+
        '<button type="button" class="v6-nav-btn" data-v6-view="dashboard" onclick="v6Navegar(\'dashboard\')">▥ Análises</button>'+
        '<div class="dropdown v6-dropdown">'+
          '<button type="button" class="v6-nav-btn dropdown-toggle" data-v6-view="mais" data-bs-toggle="dropdown" data-bs-auto-close="true">Mais</button>'+
          '<div class="dropdown-menu dropdown-menu-end shadow-sm">'+
            '<h6 class="dropdown-header">Rotinas</h6>'+
            '<button class="dropdown-item" onclick="v6Navegar(\'faturar\')">A faturar</button>'+
            '<button class="dropdown-item" onclick="v6Navegar(\'recorrente\')">Contas recorrentes</button>'+
            '<button class="dropdown-item" onclick="v6Navegar(\'agenda\')">Agenda</button>'+
            '<button class="dropdown-item" onclick="v6Navegar(\'clientes\')">Clientes</button>'+
            '<button class="dropdown-item" onclick="v6Navegar(\'horas\')">Horas trabalhadas</button>'+
            '<div class="dropdown-divider"></div><h6 class="dropdown-header">Configurações</h6>'+
            '<button class="dropdown-item" onclick="v6Navegar(\'categorias\')">Categorias</button>'+
            '<button class="dropdown-item" onclick="v6Navegar(\'condicoes\')">Termos de pagamento</button>'+
            '<button class="dropdown-item" onclick="v6DetalhesKpis()">Exibir/ocultar indicadores</button>'+
            '<button class="dropdown-item" onclick="v6LimparCache()">Limpar dados em cache</button>'+
          '</div>'+
        '</div>'+
      '</div>'+
      '<div class="v6-controls">'+
        '<span id="v6SyncInfo" class="v6-sync-info">Sincronizando...</span>'+
        '<button type="button" class="v6-inline-btn" onclick="v6AtualizarAgora()" title="Atualizar dados em segundo plano" aria-label="Atualizar">↻</button>'+
        '<select id="v6Theme" class="form-select form-select-sm v6-theme-select" aria-label="Tema" onchange="v6Tema(this.value)">'+
          '<option value="auto">◐ Auto</option><option value="light">☀ Claro</option><option value="dark">☾ Escuro</option>'+
        '</select>'+
        '<button id="v6NewTop" class="v6-btn-primary" onclick="v6NovoLancamento()">+ Novo</button>'+
      '</div>';
    tabs.parentNode.insertBefore(nav,id('cockpitFinanceiro'));
    aplicarTema(temaPreferido(),false);

    var dashboardHdr=document.createElement('div');
    dashboardHdr.className='v6-secondary-header';
    dashboardHdr.innerHTML='<h1 id="v6SectionTitle" class="v6-section-title">Início</h1>'+
      '<button type="button" class="v6-inline-btn" id="v6KpisToggle" onclick="v6DetalhesKpis()">Ver mais indicadores</button>';
    id('cockpitFinanceiro').parentNode.insertBefore(dashboardHdr,id('cockpitFinanceiro'));

    var fluxo=id('fluxo'), hoje=id('hoje');
    if (fluxo && hoje) {
      var pendencias=document.createElement('section');
      pendencias.id='v6Pendencias';
      pendencias.innerHTML='<div class="v6-secondary-header"><h2 class="v6-section-title">Pendências de hoje</h2></div>';
      while(hoje.firstChild) pendencias.appendChild(hoje.firstChild);
      fluxo.insertBefore(pendencias,fluxo.firstChild);
    }

    var lanc=id('lancamentos');
    var banco=id('banco'), cartao=id('cartao');
    if (lanc && banco && cartao) {
      var area=document.createElement('div');area.id='v6MovArea';
      var tools=document.createElement('div');tools.className='v6-secondary-header';
      tools.innerHTML='<h2 class="v6-section-title">Lançamentos e banco</h2>'+
        '<div class="d-flex gap-2 align-items-center">'+
          '<button type="button" id="v6FiltrosToggle" class="v6-inline-btn" onclick="v6ToggleFiltro()">Filtros</button>'+
          '<button type="button" id="v6NewLanc" class="v6-btn-primary" onclick="v6NovoLancamento()">+ Novo lançamento</button>'+
        '</div>';
      area.appendChild(tools);
      var sub=document.createElement('div');
      sub.className='v6-subtabs';sub.setAttribute('role','navigation');sub.setAttribute('aria-label','Tipo de movimentação');
      sub.innerHTML=
        '<button type="button" class="active" data-v6-sub="extrato" onclick="v6AlternarMovimentos(\'extrato\')">Extrato do fluxo</button>'+
        '<button type="button" data-v6-sub="banco" onclick="v6AlternarMovimentos(\'banco\')">Banco e conciliação</button>'+
        '<button type="button" data-v6-sub="cartao" onclick="v6AlternarMovimentos(\'cartao\')">Cartões</button>';
      area.appendChild(sub);
      criarSubpanel(area,'extrato',lanc);
      criarSubpanel(area,'banco',banco);
      criarSubpanel(area,'cartao',cartao);
      lanc.appendChild(area);
      var filtro=id('filtroTexto');
      if(filtro){
        var container=filtro.closest('.row');
        if(container){container.id='v6FiltrosExtrato';}
      }
      var automacao=id('automacaoBancoV511');
      if(automacao){
        var old=automacao.closest('.automacao-v511');
        if(old){
          var detalhe=document.createElement('details');detalhe.className='v6-advanced-box';
          var sum=document.createElement('summary');sum.className='v6-panel-summary';sum.textContent='Monitor, notificações e opções do banco';
          old.parentNode.insertBefore(detalhe,old); detalhe.appendChild(sum); detalhe.appendChild(old);
        }
      }
    }
    var brand=document.querySelector('.navbar-brand');
    if(brand) brand.textContent='FLUXO DE CAIXA · V6';
  }

  // O backend permanece como fonte de verdade. Atualização recorrente é apenas leitura.
  window.addEventListener('load', function() {
    criarInterface();
    setInterval(function() {
      if(!document.hidden) v6SincronizarGlobal(false);
      // Banco e cartão: só consultar quando estiver fora da edição da tela; não mudar seleção de conciliação em andamento.
      if (!document.hidden) {
        if (cartaoV513.dados) v6SincronizarCartao();
        // Banco em cache continua sendo atualizado, mas nunca durante uma conciliação em andamento.
        var painelBancoAtivo = id('lancamentos').classList.contains('active') && viewMov === 'banco';
        var bancoEmEdicao = Object.keys(bancoV59.confirmados || {}).length ||
          Object.keys((bancoV59.grupoV515 || {}).banco || {}).length ||
          Object.keys((bancoV59.grupoV515 || {}).fluxo || {}).length;
        if (bancoV59.dados && !painelBancoAtivo && !bancoEmEdicao) v6SincronizarBanco();
      }
    },60000);
  });

  document.addEventListener('visibilitychange',function() {
    if (!document.hidden && aberto) setTimeout(function(){v6SincronizarGlobal(false);},650);
  });
})();
