(function () {
  // Sem isso, o navegador (ou um proxy no meio do caminho) pode guardar em
  // cache a resposta de consultas repetidas (ex: "buscar todos os clientes"
  // é sempre a mesma URL) e nunca trazer registros criados depois — dando
  // a impressão de que um cadastro novo "sumiu", mesmo estando salvo certo.
  var supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    global: {
      fetch: function (url, options) {
        options = options || {};
        options.cache = "no-store";
        return fetch(url, options);
      }
    }
  });

  var DAY_NAMES = ["Seg.", "Ter.", "Qua.", "Qui.", "Sex."];
  var ESTAGIOS = {
    novo: ["Pedido de cotação", "Cotação Realizada", "Proposta Apresentada", "Follow Up", "Negócio Fechado"],
    renovacao: ["Pedido de renovação", "Renovação Realizada", "Proposta Apresentada", "Follow Up", "Negócio Fechado"]
  };
  var state = {
    session: null, perfil: null, vendedores: [], comissoes: [], tarefas: [], vendorAberto: null,
    cobrancaClientes: [], parcelas: [], cbForma: "Boleto", cbModalClienteId: null, cbEditingParcelaId: null, cbSearchTerm: "", cbFilterSeguradora: "", cbFilterCorretor: "",
    novaTarefaDrafts: {}, comissaoCardId: null, tarefaEditandoId: null,
    negocios: [], cotacoes: [], atividades: [], crmTipo: "novo", crmModalNegocioId: null,
    processos: [], processosExpandidos: {}
  };
  // Exposto só pra dar pra inspecionar pelo console do navegador durante
  // depuração (window.__debug.state...). Não expõe nada que já não
  // apareça na tela — é a mesma "anon key" pública usada pelo app.
  window.__debug = { state: state };

  function safeStorageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }
  function safeStorageRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  }

  function fmtMoney(n) {
    var neg = n < 0;
    var v = Math.abs(n).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? "-R$ " : "R$ ") + v;
  }
  function fmtDate(iso) {
    var d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("pt-BR");
  }
  function todayISO(offsetDays) {
    var d = new Date();
    d.setDate(d.getDate() + (offsetDays || 0));
    return d.toISOString().slice(0, 10);
  }
  function mondayOfThisWeek() {
    var d = new Date();
    var dow = d.getDay();
    var diff = dow === 0 ? -6 : 1 - dow;
    d.setDate(d.getDate() + diff);
    return d;
  }
  function addMonths(iso, n) {
    var parts = iso.split("-").map(Number);
    var d = new Date(parts[0], parts[1] - 1 + n, parts[2]);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtDateLong(iso) {
    var d = new Date(iso + "T00:00:00");
    var s = d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function weekDates() {
    var mon = mondayOfThisWeek();
    var out = [];
    for (var i = 0; i < 5; i++) {
      var d = new Date(mon);
      d.setDate(mon.getDate() + i);
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }
  function reportError(err) {
    console.error(err);
    alert("Erro: " + (err && err.message ? err.message : String(err)));
  }

  // Evita que uma chamada ao Supabase fique travada para sempre sem
  // avisar nada (ex: sessão presa após trocar de aba muitas vezes).
  function comLimiteDeTempo(promessa, segundos) {
    var aviso = new Promise(function (resolve) {
      setTimeout(function () {
        resolve({ error: { message: "A operação demorou demais e foi cancelada. Atualize a página (F5) e tente de novo." } });
      }, segundos * 1000);
    });
    return Promise.race([promessa, aviso]);
  }

  // ---- login ----
  var loginWrap = document.getElementById("login-wrap");
  var appWrap = document.getElementById("app-wrap");
  var loginForm = document.getElementById("login-form");
  var loginError = document.getElementById("login-error");

  loginForm.addEventListener("submit", async function (ev) {
    ev.preventDefault();
    loginError.textContent = "";
    var email = document.getElementById("login-email").value.trim();
    var password = document.getElementById("login-password").value;
    var res = await supabase.auth.signInWithPassword({ email: email, password: password });
    if (res.error) {
      loginError.textContent = "Não foi possível entrar: " + res.error.message;
    }
  });

  document.getElementById("forgot-link").addEventListener("click", async function (ev) {
    ev.preventDefault();
    var email = document.getElementById("login-email").value.trim();
    if (!email) {
      loginError.textContent = "Digite seu e-mail no campo acima primeiro.";
      return;
    }
    loginError.textContent = "";
    var redirectTo = window.location.origin + window.location.pathname.replace(/index\.html$/, "") + "reset-password.html";
    var res = await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
    if (res.error) {
      loginError.textContent = "Erro ao enviar: " + res.error.message;
    } else {
      loginError.style.color = "var(--good)";
      loginError.textContent = "Link enviado! Confere seu e-mail.";
    }
  });

  document.getElementById("logout-btn").addEventListener("click", async function () {
    await supabase.auth.signOut();
  });

  document.getElementById("backup-btn").addEventListener("click", async function () {
    var tabelas = ["vendedores", "comissoes", "tarefas", "cobranca_clientes", "parcelas"];
    var backup = { exportado_em: new Date().toISOString() };
    for (var i = 0; i < tabelas.length; i++) {
      var res = await supabase.from(tabelas[i]).select("*");
      if (res.error) return reportError(res.error);
      backup[tabelas[i]] = res.data;
    }
    var blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "backup-sistema-" + todayISO() + ".json";
    a.click();
    URL.revokeObjectURL(url);
  });

  supabase.auth.onAuthStateChange(function (event, session) {
    state.session = session;
    if (session) {
      // Trocar de aba do navegador e voltar dispara TOKEN_REFRESHED (a lib
      // renova o token sozinha) — isso não é um login novo, então não pode
      // recarregar a tela nem voltar pra aba padrão, senão apaga o que a
      // pessoa estava digitando. Só reinicia a UI em login de verdade.
      if (event !== "SIGNED_IN" && event !== "INITIAL_SESSION") return;
      // Voltar de outra aba pode disparar SIGNED_IN de novo pro mesmo
      // usuário (recuperação de sessão), não só TOKEN_REFRESHED — se já
      // tiver carregado esse mesmo usuário, não precisa refazer tudo
      // (evita recriar a inscrição em tempo real e travas repetidas).
      if (state.perfil && state.perfil.id === session.user.id) return;
      // Adiado: consultar o banco direto aqui trava a sincronização do
      // token de sessão do supabase-js (a lib ainda está com um lock
      // interno de auth durante esse callback).
      setTimeout(function () { showApp(); }, 0);
    } else {
      loginWrap.hidden = false;
      appWrap.hidden = true;
      teardownSubscriptions();
    }
  });

  async function showApp() {
    loginWrap.hidden = true;
    appWrap.hidden = false;

    var perfilRes = await supabase.from("perfis").select("*").eq("id", state.session.user.id).single();
    if (perfilRes.error) { reportError(perfilRes.error); return; }
    state.perfil = perfilRes.data;
    document.getElementById("who-name").textContent = state.perfil.nome;
    applyPermissions();

    await loadAll();
    setupSubscriptions();
  }

  function applyPermissions() {
    var isAdmin = state.perfil.papel === "admin";
    tabComissoes.hidden = !isAdmin;
    tabTarefas.hidden = !isAdmin;
    tabProcessos.hidden = !isAdmin;
    tabCrm.hidden = !isAdmin;
    tabConversor.hidden = !isAdmin;
    var lembrada = safeStorageGet("abaAtiva");
    var valida = isAdmin ? ["comissoes", "tarefas", "processos", "cobrancas", "crm", "conversor"] : ["cobrancas"];
    selectTab(valida.indexOf(lembrada) !== -1 ? lembrada : valida[0]);
  }

  // ---- tabs ----
  var tabComissoes = document.getElementById("tab-comissoes");
  var tabTarefas = document.getElementById("tab-tarefas");
  var tabProcessos = document.getElementById("tab-processos");
  var tabCobrancas = document.getElementById("tab-cobrancas");
  var tabCrm = document.getElementById("tab-crm");
  var tabConversor = document.getElementById("tab-conversor");
  var panelComissoes = document.getElementById("panel-comissoes");
  var panelTarefas = document.getElementById("panel-tarefas");
  var panelProcessos = document.getElementById("panel-processos");
  var panelCobrancas = document.getElementById("panel-cobrancas");
  var panelCrm = document.getElementById("panel-crm");
  var panelConversor = document.getElementById("panel-conversor");
  function selectTab(which) {
    tabComissoes.setAttribute("aria-selected", String(which === "comissoes"));
    tabTarefas.setAttribute("aria-selected", String(which === "tarefas"));
    tabProcessos.setAttribute("aria-selected", String(which === "processos"));
    tabCobrancas.setAttribute("aria-selected", String(which === "cobrancas"));
    tabCrm.setAttribute("aria-selected", String(which === "crm"));
    tabConversor.setAttribute("aria-selected", String(which === "conversor"));
    panelComissoes.classList.toggle("active", which === "comissoes");
    panelTarefas.classList.toggle("active", which === "tarefas");
    panelProcessos.classList.toggle("active", which === "processos");
    panelCobrancas.classList.toggle("active", which === "cobrancas");
    panelCrm.classList.toggle("active", which === "crm");
    panelConversor.classList.toggle("active", which === "conversor");
    safeStorageSet("abaAtiva", which);
  }
  tabComissoes.addEventListener("click", function () { selectTab("comissoes"); });
  tabTarefas.addEventListener("click", function () { selectTab("tarefas"); });
  tabProcessos.addEventListener("click", function () { selectTab("processos"); });
  tabCobrancas.addEventListener("click", function () { selectTab("cobrancas"); });
  tabCrm.addEventListener("click", function () { selectTab("crm"); });
  tabConversor.addEventListener("click", function () { selectTab("conversor"); });

  // ---- data loading ----
  // O Supabase (PostgREST) limita cada resposta a um número máximo de
  // linhas por padrão (geralmente 1000), sem avisar nada — se a tabela
  // já tiver mais linhas que isso, os registros "extras" simplesmente
  // não vêm na resposta. Isso faz parecer que um cadastro novo sumiu,
  // quando na verdade só ficou de fora do bloco trazido. Busca em
  // blocos até trazer tudo, não importa quantas linhas existam.
  async function fetchAllRows(tableName, selectStr) {
    var pageSize = 1000;
    var all = [];
    var from = 0;
    while (true) {
      var res = await supabase.from(tableName).select(selectStr).range(from, from + pageSize - 1);
      if (res.error) return res;
      all = all.concat(res.data);
      if (res.data.length < pageSize) break;
      from += pageSize;
    }
    return { data: all, error: null };
  }

  async function loadAllOnce() {
    var [vRes, cRes, tRes, ccRes, pRes, nRes, qRes, aRes, prRes] = await Promise.all([
      fetchAllRows("vendedores", "*"),
      fetchAllRows("comissoes", "*"),
      fetchAllRows("tarefas", "*, perfis(nome)"),
      fetchAllRows("cobranca_clientes", "*"),
      fetchAllRows("parcelas", "*"),
      fetchAllRows("negocios", "*"),
      fetchAllRows("cotacoes", "*"),
      fetchAllRows("atividades", "*, perfis(nome)"),
      fetchAllRows("processos", "*")
    ]);
    var erro = vRes.error || cRes.error || tRes.error || ccRes.error || pRes.error || nRes.error || qRes.error || aRes.error || prRes.error;
    if (erro) return erro;
    state.vendedores = vRes.data;
    state.comissoes = cRes.data;
    state.tarefas = tRes.data;
    state.cobrancaClientes = ccRes.data;
    state.parcelas = pRes.data;
    state.negocios = nRes.data;
    state.cotacoes = qRes.data;
    state.atividades = aRes.data;
    state.processos = prRes.data;
    renderAll();
    return null;
  }
  // Uma consulta entre as várias que essa função dispara ao mesmo tempo
  // pode falhar isoladamente (ex: token de sessão renovando bem nesse
  // instante) — sem isso, a tela ficava com dados desatualizados sem
  // avisar nada. Tenta de novo uma vez antes de desistir e avisar.
  async function loadAll() {
    var erro = await loadAllOnce();
    if (!erro) return true;
    erro = await loadAllOnce();
    if (!erro) return true;
    reportError(erro);
    return false;
  }

  var channel = null;
  function setupSubscriptions() {
    teardownSubscriptions();
    channel = supabase.channel("db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vendedores" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "comissoes" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "tarefas" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "cobranca_clientes" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "parcelas" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "negocios" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "cotacoes" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "atividades" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "processos" }, loadAll)
      .subscribe();
  }
  function teardownSubscriptions() {
    if (channel) { supabase.removeChannel(channel); channel = null; }
  }

  // ---- render: comissoes ----
  var vendorGrid = document.getElementById("vendor-grid");
  var comissoesHint = document.getElementById("comissoes-hint");

  function vendorTotal(vendorId) {
    return state.comissoes
      .filter(function (c) { return c.vendedor_id === vendorId && c.situacao === "pago"; })
      .reduce(function (sum, c) { return sum + Number(c.valor); }, 0);
  }

  function renderVendors() {
    vendorGrid.innerHTML = "";

    if (state.vendorAberto) {
      var vendor = state.vendedores.find(function (v) { return v.id === state.vendorAberto; });
      if (!vendor) { state.vendorAberto = null; return renderVendors(); }
      comissoesHint.innerHTML = "";
      var backBtn = document.createElement("button");
      backBtn.className = "btn ghost small";
      backBtn.textContent = "← todos os vendedores";
      backBtn.addEventListener("click", function () { state.vendorAberto = null; renderVendors(); });
      comissoesHint.appendChild(backBtn);
      vendorGrid.className = "vendor-detail";
      vendorGrid.appendChild(renderVendorCard(vendor));
      return;
    }

    vendorGrid.className = "vendor-list";
    comissoesHint.textContent = state.vendedores.length
      ? state.vendedores.length + " vendedor(es)"
      : "Nenhum vendedor cadastrado ainda.";
    state.vendedores
      .slice()
      .sort(function (a, b) { return (a.nome || "").localeCompare(b.nome || ""); })
      .forEach(function (v) { vendorGrid.appendChild(renderVendorTile(v)); });
  }

  function renderVendorTile(vendor) {
    var tile = document.createElement("button");
    tile.className = "vendor-tile";
    tile.addEventListener("click", function () { state.vendorAberto = vendor.id; renderVendors(); });

    var count = state.comissoes.filter(function (c) { return c.vendedor_id === vendor.id; }).length;

    var name = document.createElement("span");
    name.className = "vendor-tile-name";
    name.textContent = vendor.nome;

    var meta = document.createElement("span");
    meta.className = "vendor-tile-meta";
    meta.textContent = count + (count === 1 ? " comissão" : " comissões");

    var total = document.createElement("span");
    total.className = "vendor-tile-total tabular";
    total.textContent = fmtMoney(vendorTotal(vendor.id));

    tile.appendChild(name);
    tile.appendChild(meta);
    tile.appendChild(total);
    return tile;
  }

  function renderVendorCard(vendor) {
    var card = document.createElement("div");
    card.className = "vendor-card";

    var head = document.createElement("div");
    head.className = "vendor-head";
    var h3 = document.createElement("h3");
    h3.textContent = vendor.nome;
    var delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.title = "Remover vendedor";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", async function () {
      if (!confirm('Remover "' + vendor.nome + '" e suas comissões?')) return;
      var ids = state.comissoes.filter(function (c) { return c.vendedor_id === vendor.id; }).map(function (c) { return c.id; });
      if (ids.length) await supabase.from("comissoes").delete().in("id", ids);
      var res = await supabase.from("vendedores").delete().eq("id", vendor.id);
      if (res.error) return reportError(res.error);
      state.vendorAberto = null;
      loadAll();
    });
    head.appendChild(h3);
    head.appendChild(delBtn);
    card.appendChild(head);

    var rows = state.comissoes
      .filter(function (c) { return c.vendedor_id === vendor.id; })
      .sort(function (a, b) { return (a.data || "").localeCompare(b.data || ""); });

    // A coluna de colaborador (Julio/Matheus/Cícero/Gabriel) é só pra
    // Cerol Car — outros vendedores não têm essa divisão de equipe.
    var mostrarColaborador = vendor.nome === "Cerol Car";

    var table = document.createElement("table");
    table.className = "commissions";
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Cliente</th><th>Situação</th><th>Data</th>" +
      (mostrarColaborador ? "<th>Colaborador</th>" : "") +
      "<th style=\"text-align:right\">Valor</th><th></th></tr>";
    table.appendChild(thead);
    var tbody = document.createElement("tbody");

    if (!rows.length) {
      var er = document.createElement("tr");
      er.className = "empty-row";
      er.innerHTML = "<td colspan=\"" + (mostrarColaborador ? 6 : 5) + "\">Sem comissões lançadas.</td>";
      tbody.appendChild(er);
    }

    var totalPago = 0;
    rows.forEach(function (c) {
      if (c.situacao === "pago") totalPago += Number(c.valor);
      var tr = document.createElement("tr");

      var tdCliente = document.createElement("td");
      tdCliente.textContent = c.cliente_nome;
      tr.appendChild(tdCliente);

      var tdSit = document.createElement("td");
      var chip = document.createElement("button");
      chip.className = "status-chip " + c.situacao;
      chip.textContent = c.situacao;
      chip.addEventListener("click", async function () {
        var res = await supabase.from("comissoes").update({ situacao: c.situacao === "pago" ? "pendente" : "pago" }).eq("id", c.id);
        if (res.error) reportError(res.error); else loadAll();
      });
      tdSit.appendChild(chip);
      tr.appendChild(tdSit);

      var tdData = document.createElement("td");
      tdData.className = "mono";
      tdData.textContent = fmtDate(c.data);
      tr.appendChild(tdData);

      if (mostrarColaborador) {
        var tdColab = document.createElement("td");
        var colabSelect = document.createElement("select");
        colabSelect.className = "cb-input";
        ["", "Julio", "Matheus", "Cícero", "Gabriel"].forEach(function (opt) {
          var o = document.createElement("option");
          o.value = opt;
          o.textContent = opt || "não informado";
          colabSelect.appendChild(o);
        });
        colabSelect.value = c.colaborador || "";
        colabSelect.addEventListener("change", async function () {
          var res = await supabase.from("comissoes").update({ colaborador: colabSelect.value || null }).eq("id", c.id);
          if (res.error) reportError(res.error); else loadAll();
        });
        tdColab.appendChild(colabSelect);
        tr.appendChild(tdColab);
      }

      var tdVal = document.createElement("td");
      tdVal.className = "val tabular" + (Number(c.valor) < 0 ? " neg" : "");
      tdVal.textContent = fmtMoney(Number(c.valor));
      tr.appendChild(tdVal);

      var tdDel = document.createElement("td");
      var sendBtn = document.createElement("button");
      sendBtn.className = "icon-btn";
      sendBtn.textContent = "📤";
      sendBtn.title = "Enviar comissão";
      sendBtn.addEventListener("click", function () { openComissaoCard(c.id, vendor); });
      tdDel.appendChild(sendBtn);

      var delRowBtn = document.createElement("button");
      delRowBtn.className = "icon-btn";
      delRowBtn.textContent = "✕";
      delRowBtn.title = "Remover linha";
      delRowBtn.addEventListener("click", async function () {
        var res = await supabase.from("comissoes").delete().eq("id", c.id);
        if (res.error) reportError(res.error); else loadAll();
      });
      tdDel.appendChild(delRowBtn);
      tr.appendChild(tdDel);

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    card.appendChild(table);

    var newRow = document.createElement("div");
    newRow.className = "new-row";
    var clienteInput = document.createElement("input");
    clienteInput.placeholder = "Nome do cliente";
    var dataInput = document.createElement("input");
    dataInput.type = "date";
    dataInput.value = todayISO();
    var valInput = document.createElement("input");
    valInput.className = "val";
    valInput.placeholder = "Valor";
    valInput.type = "number";
    valInput.step = "0.01";
    var colabInput = null;
    if (mostrarColaborador) {
      colabInput = document.createElement("select");
      colabInput.className = "val";
      ["", "Julio", "Matheus", "Cícero", "Gabriel"].forEach(function (opt) {
        var o = document.createElement("option");
        o.value = opt;
        o.textContent = opt || "Colaborador";
        colabInput.appendChild(o);
      });
    } else {
      newRow.style.gridTemplateColumns = "1.4fr 1fr 1fr auto";
    }
    var addBtn = document.createElement("button");
    addBtn.className = "btn small";
    addBtn.textContent = "Adicionar";
    addBtn.addEventListener("click", async function () {
      var nome = clienteInput.value.trim();
      var val = parseFloat(valInput.value);
      if (!nome || isNaN(val)) return;
      var res = await supabase.from("comissoes").insert({
        vendedor_id: vendor.id,
        cliente_nome: nome,
        valor: val,
        situacao: "pendente",
        data: dataInput.value || todayISO(),
        colaborador: colabInput ? (colabInput.value || null) : null
      });
      if (res.error) return reportError(res.error);
      clienteInput.value = "";
      valInput.value = "";
      if (colabInput) colabInput.value = "";
      loadAll();
    });
    newRow.appendChild(clienteInput);
    newRow.appendChild(dataInput);
    if (colabInput) newRow.appendChild(colabInput);
    newRow.appendChild(valInput);
    newRow.appendChild(addBtn);
    card.appendChild(newRow);

    var foot = document.createElement("div");
    foot.className = "vendor-foot";
    foot.innerHTML = "<span>Total transferido</span><span class=\"total tabular\">" + fmtMoney(totalPago) + "</span>";
    card.appendChild(foot);

    return card;
  }

  // ---- cartão de comissão ----
  var IOF_PCT = 7.38;
  var IMPOSTO_PCT = 14;

  var comissaoCardOverlay = document.getElementById("comissao-card-overlay");
  var comissaoCardCliente = document.getElementById("comissao-card-cliente");
  var comissaoCardVendedor = document.getElementById("comissao-card-vendedor");
  var comissaoCardSeguro = document.getElementById("comissao-card-seguro");
  var comissaoCardPctComissao = document.getElementById("comissao-card-pct-comissao");
  var comissaoCardPctVendedor = document.getElementById("comissao-card-pct-vendedor");
  var comissaoCardPreview = document.getElementById("comissao-card-preview");

  function openComissaoCard(comissaoId, vendor) {
    state.comissaoCardId = comissaoId;
    state.comissaoCardVendorNome = vendor.nome;
    renderComissaoCard();
    comissaoCardOverlay.hidden = false;
  }
  function closeComissaoCard() {
    comissaoCardOverlay.hidden = true;
    state.comissaoCardId = null;
  }
  document.getElementById("comissao-card-close").addEventListener("click", closeComissaoCard);
  comissaoCardOverlay.addEventListener("click", function (ev) { if (ev.target === comissaoCardOverlay) closeComissaoCard(); });

  function renderComissaoCard() {
    var c = state.comissoes.find(function (x) { return x.id === state.comissaoCardId; });
    if (!c) return;
    comissaoCardCliente.textContent = c.cliente_nome;
    comissaoCardVendedor.textContent = state.comissaoCardVendorNome;
    if (document.activeElement !== comissaoCardSeguro) comissaoCardSeguro.value = c.valor_seguro != null ? c.valor_seguro : "";
    if (document.activeElement !== comissaoCardPctComissao) comissaoCardPctComissao.value = c.percentual_comissao != null ? c.percentual_comissao : "";
    if (document.activeElement !== comissaoCardPctVendedor) comissaoCardPctVendedor.value = c.percentual_vendedor != null ? c.percentual_vendedor : "";
    atualizarComissaoCardPreview(c);
  }

  function calcularComissaoCard() {
    var premioTotal = parseFloat(comissaoCardSeguro.value);
    var pctComissao = parseFloat(comissaoCardPctComissao.value);
    var pctVendedor = parseFloat(comissaoCardPctVendedor.value);
    if (isNaN(premioTotal) || isNaN(pctComissao) || isNaN(pctVendedor)) return null;

    var premioLiquido = premioTotal / (1 + IOF_PCT / 100);
    var comissaoBruta = premioLiquido * (pctComissao / 100);
    var comissaoLiquida = comissaoBruta * (1 - IMPOSTO_PCT / 100);
    var valorFinal = comissaoLiquida * (pctVendedor / 100);

    return {
      premioTotal: premioTotal, premioLiquido: premioLiquido,
      comissaoBruta: comissaoBruta, comissaoLiquida: comissaoLiquida,
      pctComissao: pctComissao, pctVendedor: pctVendedor, valorFinal: valorFinal
    };
  }

  function atualizarComissaoCardPreview(c) {
    var r = calcularComissaoCard();
    if (!r) {
      comissaoCardPreview.innerHTML = "<p class=\"tag\">Preencha prêmio total, % de comissão e % do vendedor para gerar o cartão.</p>";
      return;
    }
    var primeiroNome = (c.cliente_nome || "").trim().split(" ")[0];
    comissaoCardPreview.innerHTML =
      "<table class=\"comissao-card-table\">" +
      "<thead><tr><th colspan=\"2\"><div class=\"comissao-card-title\">" +
      "<img src=\"icone-sena-offwhite.png?v=3\" alt=\"Sena Seguros\" class=\"comissao-card-logo\">" +
      "<span>Pagamento de comissão - " + primeiroNome + "</span>" +
      "</div></th></tr></thead>" +
      "<tbody>" +
      "<tr><th>Prêmio Total</th><td>" + fmtMoney(r.premioTotal) + "</td></tr>" +
      "<tr><th>Prêmio Líquido</th><td>" + fmtMoney(r.premioLiquido) + "</td></tr>" +
      "<tr><th>Comissão Bruta</th><td>" + fmtMoney(r.comissaoBruta) + "</td></tr>" +
      "<tr><th>Comissão Líquida</th><td>" + fmtMoney(r.comissaoLiquida) + "</td></tr>" +
      "<tr><th>Comissão " + r.pctComissao + "% (" + r.pctVendedor + "%)</th><td>" + fmtMoney(r.valorFinal) + "</td></tr>" +
      "</tbody></table>";
  }

  function comissaoCardBindField(el, campo) {
    el.addEventListener("blur", async function () {
      if (!state.comissaoCardId) return;
      var v = parseFloat(el.value);
      var res = await supabase.from("comissoes").update(
        Object.fromEntries([[campo, isNaN(v) ? null : v]])
      ).eq("id", state.comissaoCardId);
      if (res.error) reportError(res.error); else loadAll();
    });
    el.addEventListener("input", function () {
      var c = state.comissoes.find(function (x) { return x.id === state.comissaoCardId; });
      if (c) atualizarComissaoCardPreview(c);
    });
  }
  comissaoCardBindField(comissaoCardSeguro, "valor_seguro");
  comissaoCardBindField(comissaoCardPctComissao, "percentual_comissao");
  comissaoCardBindField(comissaoCardPctVendedor, "percentual_vendedor");

  document.getElementById("comissao-card-usar-valor").addEventListener("click", async function () {
    var r = calcularComissaoCard();
    if (!r || !state.comissaoCardId) return;
    var res = await supabase.from("comissoes").update({ valor: Number(r.valorFinal.toFixed(2)) }).eq("id", state.comissaoCardId);
    if (res.error) reportError(res.error); else loadAll();
  });

  document.getElementById("comissao-card-copy").addEventListener("click", async function () {
    var c = state.comissoes.find(function (x) { return x.id === state.comissaoCardId; });
    var r = calcularComissaoCard();
    if (!c || !r) return;
    var primeiroNome = (c.cliente_nome || "").trim().split(" ")[0];
    var texto = "Pagamento de comissão - " + primeiroNome + "\n" +
      "Prêmio Total: " + fmtMoney(r.premioTotal) + "\n" +
      "Prêmio Líquido: " + fmtMoney(r.premioLiquido) + "\n" +
      "Comissão Bruta: " + fmtMoney(r.comissaoBruta) + "\n" +
      "Comissão Líquida: " + fmtMoney(r.comissaoLiquida) + "\n" +
      "Comissão " + r.pctComissao + "% (" + r.pctVendedor + "%): " + fmtMoney(r.valorFinal);
    try {
      await navigator.clipboard.writeText(texto);
    } catch (e) {
      reportError("Não foi possível copiar automaticamente. Selecione o texto do cartão manualmente.");
    }
  });

  function aguardarImagens(el) {
    var imgs = el.querySelectorAll("img");
    return Promise.all(Array.prototype.map.call(imgs, function (img) {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(function (resolve) {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }));
  }

  function recortarCantosArredondados(canvasOrigem, raioCss, escala) {
    var raio = raioCss * escala;
    var w = canvasOrigem.width;
    var h = canvasOrigem.height;
    var saida = document.createElement("canvas");
    saida.width = w;
    saida.height = h;
    var ctx = saida.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(0, 0, w, h, raio);
    } else {
      ctx.moveTo(raio, 0);
      ctx.arcTo(w, 0, w, h, raio);
      ctx.arcTo(w, h, 0, h, raio);
      ctx.arcTo(0, h, 0, 0, raio);
      ctx.arcTo(0, 0, w, 0, raio);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(canvasOrigem, 0, 0);
    return saida;
  }

  document.getElementById("comissao-card-baixar").addEventListener("click", async function () {
    var c = state.comissoes.find(function (x) { return x.id === state.comissaoCardId; });
    var tabela = comissaoCardPreview.querySelector("table");
    if (!c || !tabela) return;
    try {
      await aguardarImagens(tabela);
      var escala = 3;
      var canvasBruto = await html2canvas(tabela, { backgroundColor: null, scale: escala, useCORS: true });
      var canvasFinal = recortarCantosArredondados(canvasBruto, 10, escala);
      var primeiroNome = (c.cliente_nome || "").trim().split(" ")[0];
      var link = document.createElement("a");
      link.download = ("comissao-" + state.comissaoCardVendorNome + "-" + primeiroNome).replace(/\s+/g, "-") + ".png";
      link.href = canvasFinal.toDataURL("image/png");
      link.click();
    } catch (e) {
      reportError("Não foi possível gerar a imagem do cartão.");
    }
  });

  document.getElementById("add-vendor-btn").addEventListener("click", async function () {
    var nome = prompt("Nome do vendedor:");
    if (!nome) return;
    var res = await supabase.from("vendedores").insert({ nome: nome.trim(), ativo: true });
    if (res.error) reportError(res.error); else loadAll();
  });

  // ---- render: tarefas ----
  var weekGrid = document.getElementById("week-grid");
  var historyBtn = document.getElementById("history-btn");
  var historico = document.getElementById("historico");
  var historyBody = document.getElementById("history-body");
  var showingHistory = false;

  historyBtn.addEventListener("click", function () {
    showingHistory = !showingHistory;
    historico.classList.toggle("active", showingHistory);
    document.getElementById("board").style.display = showingHistory ? "none" : "";
    historyBtn.textContent = showingHistory ? "Ver quadro da semana" : "Ver histórico";
    if (showingHistory) renderHistory();
  });

  function renderWeek() {
    var dates = weekDates();
    weekGrid.innerHTML = "";
    dates.forEach(function (iso, idx) { weekGrid.appendChild(renderDayColumn(iso, DAY_NAMES[idx])); });
  }

  function renderDayColumn(iso, label) {
    var col = document.createElement("div");
    col.className = "day-col";

    var head = document.createElement("div");
    head.className = "day-head";
    head.innerHTML = "<div class=\"dname\">" + label + "</div><div class=\"ddate mono\">" + fmtDate(iso) + "</div>";
    col.appendChild(head);

    var body = document.createElement("div");
    body.className = "day-body";

    var tasks = state.tarefas
      .filter(function (t) { return t.data === iso && !t.arquivada; })
      .sort(function (a, b) { return (a.criado_em || "").localeCompare(b.criado_em || ""); });

    if (!tasks.length) {
      var empty = document.createElement("div");
      empty.className = "empty-day";
      empty.textContent = "Sem tarefas.";
      body.appendChild(empty);
    }

    tasks.forEach(function (t) {
      var row = document.createElement("div");
      row.className = "task" + (t.concluida ? " done" : "");

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!t.concluida;
      cb.addEventListener("change", async function () {
        var res = await supabase.from("tarefas").update({ concluida: cb.checked }).eq("id", t.id);
        if (res.error) reportError(res.error); else loadAll();
      });
      row.appendChild(cb);

      var mid = document.createElement("div");
      mid.className = "desc";

      if (state.tarefaEditandoId === t.id) {
        var editInput = document.createElement("input");
        editInput.className = "task-edit-input";
        editInput.value = t.descricao;
        var salvarEdicao = async function () {
          var novoTexto = editInput.value.trim();
          state.tarefaEditandoId = null;
          if (!novoTexto || novoTexto === t.descricao) { renderWeek(); return; }
          var res = await supabase.from("tarefas").update({ descricao: novoTexto }).eq("id", t.id);
          if (res.error) reportError(res.error); else loadAll();
        };
        editInput.addEventListener("blur", salvarEdicao);
        editInput.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") editInput.blur();
          if (ev.key === "Escape") { state.tarefaEditandoId = null; renderWeek(); }
        });
        mid.appendChild(editInput);
        row.appendChild(mid);
        setTimeout(function () { editInput.focus(); editInput.select(); }, 0);
      } else {
        var descText = document.createElement("span");
        descText.textContent = t.descricao;
        mid.appendChild(descText);
        var resp = document.createElement("span");
        resp.className = "resp";
        resp.textContent = t.perfis ? t.perfis.nome : "";
        mid.appendChild(resp);
        row.appendChild(mid);

        var editBtn = document.createElement("button");
        editBtn.className = "icon-btn task-edit-btn";
        editBtn.textContent = "✎";
        editBtn.title = "Editar tarefa";
        editBtn.addEventListener("click", function () {
          state.tarefaEditandoId = t.id;
          renderWeek();
        });
        row.appendChild(editBtn);
      }

      if (t.concluida) {
        var archBtn = document.createElement("button");
        archBtn.className = "archive-btn";
        archBtn.textContent = "arquivar";
        archBtn.addEventListener("click", async function () {
          var res = await supabase.from("tarefas").update({ arquivada: true, arquivada_em: new Date().toISOString() }).eq("id", t.id);
          if (res.error) reportError(res.error); else loadAll();
        });
        row.appendChild(archBtn);
      }

      body.appendChild(row);
    });

    col.appendChild(body);

    var addWrap = document.createElement("div");
    addWrap.className = "day-add";
    var input = document.createElement("input");
    input.placeholder = "+ nova tarefa";
    // Guardamos o rascunho no localStorage (não só na memória) porque o
    // Chrome pode descarregar a aba da memória e recarregar a página do
    // zero quando você volta pra ela depois de um tempo em outra aba —
    // isso apaga qualquer estado só em JS, mas localStorage sobrevive.
    var draftKey = "novaTarefaDraft:" + iso;
    input.value = state.novaTarefaDrafts[iso] || safeStorageGet(draftKey) || "";
    input.addEventListener("input", function () {
      state.novaTarefaDrafts[iso] = input.value;
      safeStorageSet(draftKey, input.value);
    });
    input.addEventListener("keydown", async function (ev) {
      if (ev.key !== "Enter") return;
      var desc = input.value.trim();
      if (!desc) return;
      var res = await supabase.from("tarefas").insert({
        responsavel_id: state.perfil.id,
        descricao: desc,
        data: iso,
        concluida: false,
        arquivada: false
      });
      if (res.error) return reportError(res.error);
      delete state.novaTarefaDrafts[iso];
      safeStorageRemove(draftKey);
      input.value = "";
      loadAll();
    });
    addWrap.appendChild(input);
    col.appendChild(addWrap);

    return col;
  }

  function renderHistory() {
    var rows = state.tarefas
      .filter(function (t) { return t.arquivada; })
      .sort(function (a, b) { return (b.arquivada_em || "").localeCompare(a.arquivada_em || ""); });
    historyBody.innerHTML = "";
    if (!rows.length) {
      var tr = document.createElement("tr");
      tr.innerHTML = "<td colspan=\"4\" style=\"color:var(--muted);font-style:italic;\">Nenhuma tarefa arquivada ainda.</td>";
      historyBody.appendChild(tr);
      return;
    }
    rows.forEach(function (t) {
      var d = new Date(t.data + "T00:00:00");
      var dow = d.getDay();
      var dayLabel = ["Dom.", "Seg.", "Ter.", "Qua.", "Qui.", "Sex.", "Sáb."][dow];
      var tr = document.createElement("tr");
      var tdData = document.createElement("td"); tdData.className = "mono"; tdData.textContent = fmtDate(t.data);
      var tdDia = document.createElement("td"); tdDia.textContent = dayLabel;
      var tdDesc = document.createElement("td"); tdDesc.textContent = t.descricao;
      var tdResp = document.createElement("td"); tdResp.textContent = t.perfis ? t.perfis.nome : "";
      tr.appendChild(tdData); tr.appendChild(tdDia); tr.appendChild(tdDesc); tr.appendChild(tdResp);
      historyBody.appendChild(tr);
    });
  }

  // ---- render: cobrancas ----
  var cbFila = document.getElementById("cb-fila");
  var cbAddToggle = document.getElementById("cb-abrir-form");
  var cbNewForm = document.getElementById("cb-new-form");
  var cbModalOverlay = document.getElementById("cb-modal-overlay");

  function clienteParcelas(clienteId) {
    return state.parcelas
      .filter(function (p) { return p.cliente_id === clienteId; })
      .sort(function (a, b) { return a.data.localeCompare(b.data); });
  }

  function buildFila() {
    var items = [];
    state.cobrancaClientes.forEach(function (c) {
      var proxima = state.parcelas
        .filter(function (p) { return p.cliente_id === c.id && p.status === "pendente"; })
        .sort(function (a, b) { return a.data.localeCompare(b.data); })[0];
      if (proxima) items.push({ cliente: c, parcela: proxima });
    });
    items.sort(function (a, b) { return a.parcela.data.localeCompare(b.parcela.data); });
    return items;
  }

  function renderCobrancas() {
    var fila = buildFila();
    var today = todayISO();

    var termo = (state.cbSearchTerm || "").trim().toLowerCase();
    var filaFiltrada = fila.filter(function (f) {
      if (termo && f.cliente.nome.toLowerCase().indexOf(termo) === -1) return false;
      if (state.cbFilterSeguradora && f.cliente.seguradora !== state.cbFilterSeguradora) return false;
      if (state.cbFilterCorretor && f.cliente.corretor !== state.cbFilterCorretor) return false;
      return true;
    });

    var atrasados = filaFiltrada.filter(function (f) { return f.parcela.data < today; });
    var hoje = filaFiltrada.filter(function (f) { return f.parcela.data === today; });
    var totalReceber = filaFiltrada.reduce(function (s, f) { return s + Number(f.parcela.valor); }, 0);

    document.getElementById("cb-stat-atrasados-n").textContent = atrasados.length;
    document.getElementById("cb-stat-atrasados-v").textContent = fmtMoney(atrasados.reduce(function (s, f) { return s + Number(f.parcela.valor); }, 0));
    document.getElementById("cb-stat-hoje-n").textContent = hoje.length;
    document.getElementById("cb-stat-hoje-v").textContent = fmtMoney(hoje.reduce(function (s, f) { return s + Number(f.parcela.valor); }, 0));
    document.getElementById("cb-stat-total").textContent = fmtMoney(totalReceber);

    var grupos = [];
    filaFiltrada.forEach(function (item) {
      var last = grupos[grupos.length - 1];
      if (last && last.data === item.parcela.data) last.itens.push(item);
      else grupos.push({ data: item.parcela.data, itens: [item] });
    });

    cbFila.innerHTML = "";
    if (!grupos.length) {
      var empty = document.createElement("div");
      empty.className = "cb-empty";
      var temFiltro = termo || state.cbFilterSeguradora || state.cbFilterCorretor;
      empty.textContent = temFiltro ? "Nenhum cliente encontrado para os filtros aplicados." : "Nenhuma cobrança pendente.";
      cbFila.appendChild(empty);
      return;
    }

    grupos.forEach(function (g) {
      var group = document.createElement("div");
      group.className = "cb-group";

      var head = document.createElement("div");
      head.className = "cb-group-head";
      var dateEl = document.createElement("span");
      dateEl.className = "cb-group-date" + (g.data < today ? " overdue" : "");
      dateEl.textContent = fmtDateLong(g.data);
      var countEl = document.createElement("span");
      countEl.className = "cb-group-count";
      countEl.textContent = g.itens.length;
      head.appendChild(dateEl);
      head.appendChild(countEl);
      group.appendChild(head);

      g.itens.forEach(function (item) { group.appendChild(renderCbRow(item.cliente, item.parcela)); });
      cbFila.appendChild(group);
    });
  }

  function renderCbRow(cliente, parcela) {
    var row = document.createElement("div");
    row.className = "cb-row";

    var nameWrap = document.createElement("div");
    nameWrap.className = "cb-row-name";
    var nameBtn = document.createElement("button");
    nameBtn.className = "cb-name-btn";
    nameBtn.textContent = cliente.nome;
    nameBtn.addEventListener("click", function () { openCbModal(cliente.id); });
    var meta = document.createElement("div");
    meta.className = "cb-row-meta";
    var totalParcelas = state.parcelas.filter(function (p) { return p.cliente_id === cliente.id; }).length;
    var metaTxt = cliente.forma + " · parcela " + parcela.numero + " de " + totalParcelas;
    if (cliente.seguradora) metaTxt += " · " + cliente.seguradora;
    if (cliente.corretor) metaTxt += " · " + cliente.corretor;
    meta.textContent = metaTxt;
    nameWrap.appendChild(nameBtn);
    nameWrap.appendChild(meta);
    row.appendChild(nameWrap);

    if (state.cbEditingParcelaId === parcela.id) {
      var editWrap = document.createElement("div");
      editWrap.className = "cb-date-edit";
      var dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.value = parcela.data;
      var okBtn = document.createElement("button");
      okBtn.className = "icon-btn";
      okBtn.textContent = "✓";
      okBtn.addEventListener("click", async function () {
        var res = await supabase.from("parcelas").update({ data: dateInput.value }).eq("id", parcela.id);
        state.cbEditingParcelaId = null;
        if (res.error) reportError(res.error); else loadAll();
      });
      var cancelBtn = document.createElement("button");
      cancelBtn.className = "icon-btn";
      cancelBtn.textContent = "✕";
      cancelBtn.addEventListener("click", function () { state.cbEditingParcelaId = null; renderCobrancas(); });
      editWrap.appendChild(dateInput);
      editWrap.appendChild(okBtn);
      editWrap.appendChild(cancelBtn);
      row.appendChild(editWrap);
    } else {
      var valEl = document.createElement("div");
      valEl.className = "cb-row-value tabular";
      valEl.textContent = fmtMoney(Number(parcela.valor));
      row.appendChild(valEl);

      var editBtn = document.createElement("button");
      editBtn.className = "icon-btn";
      editBtn.title = "Reagendar data";
      editBtn.textContent = "✎";
      editBtn.addEventListener("click", function () { state.cbEditingParcelaId = parcela.id; renderCobrancas(); });
      row.appendChild(editBtn);

      var payBtn = document.createElement("button");
      payBtn.className = "btn small";
      payBtn.textContent = "Cobrado e pago";
      payBtn.addEventListener("click", async function () {
        var res = await supabase.from("parcelas").update({ status: "paga", data_pagamento: todayISO() }).eq("id", parcela.id);
        if (res.error) reportError(res.error); else loadAll();
      });
      row.appendChild(payBtn);

      var delBtn = document.createElement("button");
      delBtn.className = "icon-btn";
      delBtn.title = "Remover cliente";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", async function () {
        if (!confirm('Remover "' + cliente.nome + '" e todas as parcelas dele?')) return;
        var res = await supabase.from("cobranca_clientes").delete().eq("id", cliente.id);
        if (res.error) reportError(res.error); else loadAll();
      });
      row.appendChild(delBtn);
    }

    return row;
  }

  document.getElementById("cb-search").addEventListener("input", function (ev) {
    state.cbSearchTerm = ev.target.value;
    renderCobrancas();
  });
  document.getElementById("cb-filter-seguradora").addEventListener("change", function (ev) {
    state.cbFilterSeguradora = ev.target.value;
    renderCobrancas();
  });
  document.getElementById("cb-filter-corretor").addEventListener("change", function (ev) {
    state.cbFilterCorretor = ev.target.value;
    renderCobrancas();
  });

  cbAddToggle.addEventListener("click", function () {
    cbNewForm.hidden = !cbNewForm.hidden;
  });
  document.getElementById("cb-fechar-form").addEventListener("click", function () { cbNewForm.hidden = true; });
  document.querySelectorAll(".cb-forma-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.cbForma = chip.getAttribute("data-forma");
      document.querySelectorAll(".cb-forma-chip").forEach(function (c) { c.classList.toggle("is-on", c === chip); });
    });
  });
  var cbSalvandoCliente = false;
  async function salvarNovoCliente() {
    if (cbSalvandoCliente) return;
    cbSalvandoCliente = true;
    try {
      await salvarNovoClienteImpl();
    } finally {
      cbSalvandoCliente = false;
    }
  }
  // Escuta o clique no formulário inteiro (em vez de só no botão) — assim
  // continua funcionando mesmo se alguma extensão do navegador (ex:
  // bloqueador de anúncios/Avast) interferir num elemento específico.
  cbNewForm.addEventListener("click", function (ev) {
    if (ev.target.closest("#cb-salvar-cliente")) salvarNovoCliente();
  });
  async function salvarNovoClienteImpl() {
    var nome = document.getElementById("cb-nome").value.trim();
    var valor = parseFloat(document.getElementById("cb-valor").value);
    var dataIni = document.getElementById("cb-data").value;
    var numParcelas = parseInt(document.getElementById("cb-parcelas").value, 10);
    var faltando = [];
    if (!nome) faltando.push("Nome do cliente");
    if (isNaN(valor)) faltando.push("Valor da parcela");
    if (!dataIni) faltando.push("Data da primeira cobrança");
    if (!numParcelas || numParcelas < 1) faltando.push("Número de parcelas");
    if (faltando.length) {
      alert("Preencha antes de adicionar: " + faltando.join(", ") + ".");
      return;
    }

    var seguradora = document.getElementById("cb-seguradora").value;
    var cpf = document.getElementById("cb-cpf").value.trim();
    var corretor = document.getElementById("cb-corretor").value;
    var clienteRes = await comLimiteDeTempo(supabase.from("cobranca_clientes").insert({
      nome: nome,
      forma: state.cbForma,
      seguradora: seguradora || null,
      cpf: cpf || null,
      corretor: corretor || null
    }).select().single(), 10);
    if (clienteRes.error) return reportError(clienteRes.error);

    var parcelasRows = [];
    for (var i = 0; i < numParcelas; i++) {
      parcelasRows.push({
        cliente_id: clienteRes.data.id,
        numero: i + 1,
        valor: valor,
        data: addMonths(dataIni, i),
        status: "pendente"
      });
    }
    var pRes = await comLimiteDeTempo(supabase.from("parcelas").insert(parcelasRows), 10);
    if (pRes.error) return reportError(pRes.error);

    // Confere de verdade se o cliente E as parcelas ficaram visíveis pra
    // essa conta (RLS pode deixar inserir mas esconder na leitura, ou
    // algo pode ter dado errado sem gerar erro) — evita cadastro
    // "fantasma" sem avisar nada.
    var checkCliente = await comLimiteDeTempo(
      supabase.from("cobranca_clientes").select("id").eq("id", clienteRes.data.id).maybeSingle(),
      10
    );
    var checkParcelas = await comLimiteDeTempo(
      supabase.from("parcelas").select("id", { count: "exact", head: true }).eq("cliente_id", clienteRes.data.id),
      10
    );
    console.log("Verificação após cadastro:", { checkCliente: checkCliente, checkParcelas: checkParcelas });
    if (checkCliente.error || !checkCliente.data) {
      alert("O cliente foi enviado, mas não consegui confirmar que ele ficou salvo. Atualize a página (F5) e confira antes de cadastrar de novo, pra não duplicar.");
      return;
    }
    if (checkParcelas.error || !checkParcelas.count) {
      alert('O cliente "' + nome + '" foi salvo, mas as parcelas dele não. Abra o console (F12) e me mostre a linha "Verificação após cadastro" que apareceu — isso vai mostrar o motivo exato.');
      return;
    }

    document.getElementById("cb-nome").value = "";
    document.getElementById("cb-valor").value = "";
    document.getElementById("cb-parcelas").value = "12";
    document.getElementById("cb-seguradora").value = "";
    document.getElementById("cb-cpf").value = "";
    document.getElementById("cb-corretor").value = "";
    cbNewForm.hidden = true;

    // Limpa busca/filtros: se tiver algo ativo, o cliente novo pode ficar
    // escondido na lista e parecer que não foi cadastrado.
    state.cbSearchTerm = "";
    state.cbFilterSeguradora = "";
    state.cbFilterCorretor = "";
    document.getElementById("cb-search").value = "";
    document.getElementById("cb-filter-seguradora").value = "";
    document.getElementById("cb-filter-corretor").value = "";

    var atualizou = await loadAll();
    if (!atualizou) {
      alert('O cliente "' + nome + '" foi salvo (confirmado no banco), mas a tela não conseguiu atualizar a lista agora. Atualize a página (F5) pra ver ele — não precisa cadastrar de novo.');
      return;
    }
    alert('Cliente "' + nome + '" adicionado com sucesso.');
  }

  function openCbModal(clienteId) {
    state.cbModalClienteId = clienteId;
    renderCbModal();
    cbModalOverlay.hidden = false;
  }
  function closeCbModal() {
    cbModalOverlay.hidden = true;
    state.cbModalClienteId = null;
    state.cbEditingParcelaId = null;
  }
  document.getElementById("cb-modal-close").addEventListener("click", closeCbModal);
  cbModalOverlay.addEventListener("click", function (ev) { if (ev.target === cbModalOverlay) closeCbModal(); });

  var cbModalObs = document.getElementById("cb-modal-obs");
  var cbModalObsStatus = document.getElementById("cb-modal-obs-status");
  var cbSalvandoObs = false;
  async function salvarObservacoes() {
    if (!state.cbModalClienteId || cbSalvandoObs) return;
    cbSalvandoObs = true;
    var clienteId = state.cbModalClienteId;
    var texto = cbModalObs.value;
    cbModalObsStatus.textContent = "Salvando...";
    var res = await comLimiteDeTempo(
      supabase.from("cobranca_clientes").update({ observacoes: texto }).eq("id", clienteId),
      10
    );
    cbSalvandoObs = false;
    if (res.error) {
      cbModalObsStatus.textContent = "";
      reportError(res.error);
      return;
    }
    await loadAll();
    cbModalObsStatus.textContent = "Salvo.";
    setTimeout(function () { if (cbModalObsStatus.textContent === "Salvo.") cbModalObsStatus.textContent = ""; }, 2500);
  }
  cbModalObs.addEventListener("blur", salvarObservacoes);
  document.getElementById("cb-modal-obs-salvar").addEventListener("click", salvarObservacoes);

  function cbBindClienteField(elId, campo, eventName) {
    var el = document.getElementById(elId);
    el.addEventListener(eventName, async function () {
      if (!state.cbModalClienteId) return;
      var v = el.value.trim ? el.value.trim() : el.value;
      var res = await supabase.from("cobranca_clientes").update(
        Object.fromEntries([[campo, v || null]])
      ).eq("id", state.cbModalClienteId);
      if (res.error) reportError(res.error); else loadAll();
    });
    return el;
  }
  var cbModalSeguradora = cbBindClienteField("cb-modal-seguradora", "seguradora", "change");
  var cbModalCpf = cbBindClienteField("cb-modal-cpf", "cpf", "blur");
  var cbModalCorretor = cbBindClienteField("cb-modal-corretor", "corretor", "change");

  function renderCbModal() {
    var cliente = state.cobrancaClientes.find(function (c) { return c.id === state.cbModalClienteId; });
    if (!cliente) return;
    document.getElementById("cb-modal-nome").textContent = cliente.nome;
    document.getElementById("cb-modal-forma").textContent = cliente.forma;
    if (document.activeElement !== cbModalObs) cbModalObs.value = cliente.observacoes || "";
    cbModalSeguradora.value = cliente.seguradora || "";
    if (document.activeElement !== cbModalCpf) cbModalCpf.value = cliente.cpf || "";
    cbModalCorretor.value = cliente.corretor || "";

    var wrap = document.getElementById("cb-modal-parcelas");
    wrap.innerHTML = "";
    clienteParcelas(cliente.id).forEach(function (p) {
      var row = document.createElement("div");
      row.className = "cb-parcela-row";

      var num = document.createElement("span");
      num.className = "cb-parcela-num";
      num.textContent = p.numero;
      row.appendChild(num);

      if (state.cbEditingParcelaId === p.id) {
        var editWrap = document.createElement("div");
        editWrap.className = "cb-date-edit";
        var dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.value = p.data;
        var okBtn = document.createElement("button");
        okBtn.className = "icon-btn";
        okBtn.textContent = "✓";
        okBtn.addEventListener("click", async function () {
          var res = await supabase.from("parcelas").update({ data: dateInput.value }).eq("id", p.id);
          state.cbEditingParcelaId = null;
          if (res.error) reportError(res.error); else loadAll();
        });
        var cancelBtn = document.createElement("button");
        cancelBtn.className = "icon-btn";
        cancelBtn.textContent = "✕";
        cancelBtn.addEventListener("click", function () { state.cbEditingParcelaId = null; renderCbModal(); });
        editWrap.appendChild(dateInput);
        editWrap.appendChild(okBtn);
        editWrap.appendChild(cancelBtn);
        row.appendChild(editWrap);
      } else {
        var dateEl = document.createElement("span");
        dateEl.className = "cb-parcela-date";
        dateEl.textContent = fmtDate(p.data) + (p.status === "paga" && p.data_pagamento ? " · pago " + fmtDate(p.data_pagamento) : "");
        if (p.status === "pendente") {
          var editBtn = document.createElement("button");
          editBtn.className = "icon-btn";
          editBtn.textContent = "✎";
          editBtn.title = "Reagendar";
          editBtn.style.marginLeft = "4px";
          editBtn.addEventListener("click", function () { state.cbEditingParcelaId = p.id; renderCbModal(); });
          dateEl.appendChild(editBtn);
        }
        row.appendChild(dateEl);
      }

      var val = document.createElement("span");
      val.className = "cb-parcela-value tabular";
      val.textContent = fmtMoney(Number(p.valor));
      row.appendChild(val);

      var statusBtn = document.createElement("button");
      statusBtn.className = "chip" + (p.status === "paga" ? " is-on" : "");
      statusBtn.textContent = p.status === "paga" ? "Paga" : "Pendente";
      statusBtn.addEventListener("click", async function () {
        var patch = p.status === "pendente"
          ? { status: "paga", data_pagamento: todayISO() }
          : { status: "pendente", data_pagamento: null };
        var res = await supabase.from("parcelas").update(patch).eq("id", p.id);
        if (res.error) reportError(res.error); else loadAll();
      });
      row.appendChild(statusBtn);

      wrap.appendChild(row);
    });
  }

  // ---- render: crm ----
  var crmBoard = document.getElementById("crm-board");
  var crmPipeNovo = document.getElementById("crm-pipe-novo");
  var crmPipeRenovacao = document.getElementById("crm-pipe-renovacao");
  var crmAddToggle = document.getElementById("crm-add-toggle");
  var crmNewForm = document.getElementById("crm-new-form");
  var crmModalOverlay = document.getElementById("crm-modal-overlay");

  function setCrmTipo(tipo) {
    state.crmTipo = tipo;
    crmPipeNovo.classList.toggle("is-on", tipo === "novo");
    crmPipeRenovacao.classList.toggle("is-on", tipo === "renovacao");
    renderCrm();
  }
  crmPipeNovo.addEventListener("click", function () { setCrmTipo("novo"); });
  crmPipeRenovacao.addEventListener("click", function () { setCrmTipo("renovacao"); });

  crmAddToggle.addEventListener("click", function () { crmNewForm.hidden = !crmNewForm.hidden; });
  document.getElementById("crm-add-cancel").addEventListener("click", function () { crmNewForm.hidden = true; });
  document.getElementById("crm-add-confirm").addEventListener("click", async function () {
    var titulo = document.getElementById("crm-titulo").value.trim();
    var nome = document.getElementById("crm-nome").value.trim();
    if (!titulo || !nome) return;
    var email = document.getElementById("crm-email").value.trim();
    var telefone = document.getElementById("crm-telefone").value.trim();
    var valorRaw = document.getElementById("crm-valor").value;
    var res = await supabase.from("negocios").insert({
      titulo: titulo,
      cliente_nome: nome,
      email: email || null,
      telefone: telefone || null,
      tipo: state.crmTipo,
      estagio: ESTAGIOS[state.crmTipo][0],
      valor: valorRaw ? parseFloat(valorRaw) : null
    });
    if (res.error) return reportError(res.error);
    document.getElementById("crm-titulo").value = "";
    document.getElementById("crm-nome").value = "";
    document.getElementById("crm-email").value = "";
    document.getElementById("crm-telefone").value = "";
    document.getElementById("crm-valor").value = "";
    crmNewForm.hidden = true;
    loadAll();
  });

  async function moverNegocioParaEstagio(id, estagio) {
    var res = await supabase.from("negocios").update({ estagio: estagio }).eq("id", id);
    if (res.error) reportError(res.error); else loadAll();
  }

  function renderCrm() {
    var estagios = ESTAGIOS[state.crmTipo];
    var negociosDoTipo = state.negocios.filter(function (n) { return n.tipo === state.crmTipo; });

    crmBoard.innerHTML = "";
    estagios.forEach(function (estagio) {
      var itens = negociosDoTipo.filter(function (n) { return n.estagio === estagio; });

      var col = document.createElement("div");
      col.className = "crm-col";

      var head = document.createElement("div");
      head.className = "crm-col-head";
      head.innerHTML = "<div class=\"crm-col-title\">" + estagio + "</div>" +
        "<div class=\"crm-col-meta\">" + itens.length + " negócio(s)</div>";
      col.appendChild(head);

      var body = document.createElement("div");
      body.className = "crm-col-body";
      if (!itens.length) {
        var empty = document.createElement("div");
        empty.className = "crm-empty-col";
        empty.textContent = "Vazio.";
        body.appendChild(empty);
      }
      itens.forEach(function (n) { body.appendChild(renderCrmCard(n)); });
      col.appendChild(body);

      body.addEventListener("dragover", function (ev) {
        ev.preventDefault();
        body.classList.add("drag-over");
      });
      body.addEventListener("dragleave", function () { body.classList.remove("drag-over"); });
      body.addEventListener("drop", function (ev) {
        ev.preventDefault();
        body.classList.remove("drag-over");
        var id = ev.dataTransfer.getData("text/plain");
        if (id) moverNegocioParaEstagio(id, estagio);
      });

      crmBoard.appendChild(col);
    });
  }

  function renderCrmCard(n) {
    var card = document.createElement("button");
    card.className = "crm-card status-" + n.status;
    card.draggable = true;
    card.addEventListener("dragstart", function (ev) {
      ev.dataTransfer.setData("text/plain", n.id);
      ev.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", function () { card.classList.remove("dragging"); });

    var titulo = document.createElement("div");
    titulo.className = "crm-card-title";
    titulo.textContent = n.titulo;
    card.appendChild(titulo);

    var name = document.createElement("div");
    name.className = "crm-card-name";
    name.textContent = n.cliente_nome;
    card.appendChild(name);

    if (n.valor) {
      var val = document.createElement("div");
      val.className = "crm-card-value tabular";
      val.textContent = fmtMoney(Number(n.valor));
      card.appendChild(val);
    }
    card.addEventListener("click", function () { openCrmModal(n.id); });
    return card;
  }

  function openCrmModal(id) {
    state.crmModalNegocioId = id;
    renderCrmModal();
    crmModalOverlay.hidden = false;
  }
  function closeCrmModal() {
    crmModalOverlay.hidden = true;
    state.crmModalNegocioId = null;
  }
  document.getElementById("crm-modal-close").addEventListener("click", closeCrmModal);
  crmModalOverlay.addEventListener("click", function (ev) { if (ev.target === crmModalOverlay) closeCrmModal(); });

  var crmModalEstagio = document.getElementById("crm-modal-estagio");
  crmModalEstagio.addEventListener("change", async function () {
    var res = await supabase.from("negocios").update({ estagio: crmModalEstagio.value }).eq("id", state.crmModalNegocioId);
    if (res.error) reportError(res.error); else loadAll();
  });

  var crmModalValor = document.getElementById("crm-modal-valor");
  crmModalValor.addEventListener("blur", async function () {
    var v = crmModalValor.value ? parseFloat(crmModalValor.value) : null;
    await supabase.from("negocios").update({ valor: v }).eq("id", state.crmModalNegocioId);
  });

  function crmBindTextField(elId, campo) {
    var el = document.getElementById(elId);
    el.addEventListener("blur", async function () {
      var v = el.value.trim();
      var res = await supabase.from("negocios").update(
        Object.fromEntries([[campo, v || null]])
      ).eq("id", state.crmModalNegocioId);
      if (res.error) reportError(res.error); else loadAll();
    });
    return el;
  }
  var crmModalTitulo = crmBindTextField("crm-modal-titulo", "titulo");
  var crmModalClienteNome = crmBindTextField("crm-modal-cliente-nome", "cliente_nome");
  var crmModalEmail = crmBindTextField("crm-modal-email", "email");
  var crmModalTelefone = crmBindTextField("crm-modal-telefone", "telefone");

  function crmSetStatus(status) {
    return async function () {
      var res = await supabase.from("negocios").update({ status: status }).eq("id", state.crmModalNegocioId);
      if (res.error) reportError(res.error); else loadAll();
    };
  }
  document.getElementById("crm-modal-ganho").addEventListener("click", crmSetStatus("ganho"));
  document.getElementById("crm-modal-perdido").addEventListener("click", crmSetStatus("perdido"));
  document.getElementById("crm-modal-reabrir").addEventListener("click", crmSetStatus("aberto"));

  document.getElementById("crm-modal-pdf-input").addEventListener("change", async function (ev) {
    var file = ev.target.files[0];
    if (!file) return;
    var negocioId = state.crmModalNegocioId;
    var path = negocioId + "/" + Date.now() + "-" + file.name;
    var upRes = await supabase.storage.from("cotacoes").upload(path, file);
    if (upRes.error) return reportError(upRes.error);
    var insRes = await supabase.from("cotacoes").insert({
      negocio_id: negocioId,
      arquivo_path: path,
      nome_arquivo: file.name
    });
    if (insRes.error) return reportError(insRes.error);
    ev.target.value = "";
    loadAll();
  });

  document.getElementById("crm-modal-add-atividade").addEventListener("click", async function () {
    var input = document.getElementById("crm-modal-nova-atividade");
    var dataInput = document.getElementById("crm-modal-atividade-data");
    var desc = input.value.trim();
    if (!desc) return;
    var res = await supabase.from("atividades").insert({
      negocio_id: state.crmModalNegocioId,
      autor_id: state.perfil.id,
      descricao: desc,
      data_agendada: dataInput.value || todayISO()
    });
    if (res.error) return reportError(res.error);
    input.value = "";
    dataInput.value = "";
    loadAll();
  });

  function renderCrmModal() {
    var n = state.negocios.find(function (x) { return x.id === state.crmModalNegocioId; });
    if (!n) return;

    if (document.activeElement !== crmModalTitulo) crmModalTitulo.value = n.titulo || "";
    if (document.activeElement !== crmModalClienteNome) crmModalClienteNome.value = n.cliente_nome || "";
    if (document.activeElement !== crmModalEmail) crmModalEmail.value = n.email || "";
    if (document.activeElement !== crmModalTelefone) crmModalTelefone.value = n.telefone || "";

    var badge = document.getElementById("crm-modal-status-badge");
    badge.className = "status-chip " + n.status;
    badge.textContent = n.status;
    document.getElementById("crm-modal-ganho").hidden = n.status !== "aberto";
    document.getElementById("crm-modal-perdido").hidden = n.status !== "aberto";
    document.getElementById("crm-modal-reabrir").hidden = n.status === "aberto";

    crmModalEstagio.innerHTML = "";
    ESTAGIOS[n.tipo].forEach(function (est) {
      var opt = document.createElement("option");
      opt.value = est;
      opt.textContent = est;
      if (est === n.estagio) opt.selected = true;
      crmModalEstagio.appendChild(opt);
    });

    if (document.activeElement !== crmModalValor) crmModalValor.value = n.valor || "";

    var cotWrap = document.getElementById("crm-modal-cotacoes");
    cotWrap.innerHTML = "";
    var cots = state.cotacoes.filter(function (c) { return c.negocio_id === n.id; });
    if (!cots.length) {
      var emptyC = document.createElement("div");
      emptyC.className = "crm-empty-col";
      emptyC.textContent = "Nenhum PDF anexado ainda.";
      cotWrap.appendChild(emptyC);
    }
    cots.forEach(function (c) {
      var row = document.createElement("div");
      row.className = "crm-cotacao-row";
      var label = document.createElement("span");
      label.textContent = c.nome_arquivo;
      var openBtn = document.createElement("button");
      openBtn.className = "btn ghost small";
      openBtn.textContent = "Abrir";
      openBtn.addEventListener("click", async function () {
        var signed = await supabase.storage.from("cotacoes").createSignedUrl(c.arquivo_path, 300);
        if (signed.error) return reportError(signed.error);
        window.open(signed.data.signedUrl, "_blank");
      });
      row.appendChild(label);
      row.appendChild(openBtn);
      cotWrap.appendChild(row);
    });

    var atvWrap = document.getElementById("crm-modal-atividades");
    atvWrap.innerHTML = "";
    var atvs = state.atividades
      .filter(function (a) { return a.negocio_id === n.id; })
      .sort(function (a, b) { return (a.data_agendada || "").localeCompare(b.data_agendada || ""); });
    if (!atvs.length) {
      var emptyA = document.createElement("div");
      emptyA.className = "crm-empty-col";
      emptyA.textContent = "Nenhuma atividade registrada ainda.";
      atvWrap.appendChild(emptyA);
    }
    var today = todayISO();
    atvs.forEach(function (a) {
      var row = document.createElement("div");
      row.className = "crm-atividade-row";

      var top = document.createElement("div");
      top.style.display = "flex";
      top.style.alignItems = "center";
      top.style.gap = "6px";
      top.style.width = "100%";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!a.concluida;
      cb.addEventListener("change", async function () {
        var res = await supabase.from("atividades").update({ concluida: cb.checked }).eq("id", a.id);
        if (res.error) reportError(res.error); else loadAll();
      });
      top.appendChild(cb);

      var desc = document.createElement("div");
      desc.style.flex = "1";
      desc.textContent = a.descricao;
      if (a.concluida) desc.style.textDecoration = "line-through";
      top.appendChild(desc);

      var dateBadge = document.createElement("span");
      dateBadge.className = "crm-atividade-meta";
      var futura = a.data_agendada > today;
      var atrasada = a.data_agendada < today && !a.concluida;
      dateBadge.style.color = atrasada ? "var(--bad)" : futura ? "var(--accent)" : "";
      dateBadge.textContent = fmtDate(a.data_agendada) + (futura ? " · agendada" : atrasada ? " · atrasada" : "");
      top.appendChild(dateBadge);

      row.appendChild(top);

      var meta = document.createElement("div");
      meta.className = "crm-atividade-meta";
      meta.textContent = "por " + (a.perfis ? a.perfis.nome : "—");
      row.appendChild(meta);

      atvWrap.appendChild(row);
    });
  }

  // ---- processos (toggle list de documentos internos, estilo Notion) ----
  var processosTreeEl = document.getElementById("processos-tree");

  function processosFilhos(parentId) {
    return state.processos
      .filter(function (p) { return p.parent_id === parentId; })
      .sort(function (a, b) {
        if (a.ordem !== b.ordem) return a.ordem - b.ordem;
        return (a.criado_em || "").localeCompare(b.criado_em || "");
      });
  }

  async function processosCriar(parentId) {
    var res = await supabase.from("processos").insert({
      titulo: "",
      conteudo: "",
      parent_id: parentId,
      ordem: processosFilhos(parentId).length
    }).select().single();
    if (res.error) return reportError(res.error);
    if (parentId) state.processosExpandidos[parentId] = true;
    state.processosExpandidos[res.data.id] = true;
    await loadAll();
  }

  async function processosExcluir(p) {
    var temFilhos = processosFilhos(p.id).length > 0;
    var aviso = 'Excluir "' + (p.titulo || "Sem título") + '"' + (temFilhos ? " e todas as subpáginas dele" : "") + "?";
    if (!confirm(aviso)) return;
    var res = await supabase.from("processos").delete().eq("id", p.id);
    if (res.error) return reportError(res.error);
    await loadAll();
  }

  async function processosSalvarCampo(id, campo, valor, statusEl) {
    if (statusEl) statusEl.textContent = "Salvando...";
    var res = await comLimiteDeTempo(
      supabase.from("processos").update(Object.fromEntries([[campo, valor]])).eq("id", id),
      10
    );
    if (res.error) {
      if (statusEl) statusEl.textContent = "";
      reportError(res.error);
      return;
    }
    await loadAll();
    if (statusEl) {
      statusEl.textContent = "Salvo.";
      setTimeout(function () { if (statusEl.textContent === "Salvo.") statusEl.textContent = ""; }, 2500);
    }
  }

  function renderProcessoItem(p, depth) {
    var wrap = document.createElement("div");
    wrap.className = "processo-item";

    var row = document.createElement("div");
    row.className = "processos-row";
    row.style.paddingLeft = (depth * 20) + "px";

    var expandido = !!state.processosExpandidos[p.id];
    var toggle = document.createElement("button");
    toggle.className = "processos-toggle";
    toggle.textContent = expandido ? "▾" : "▸";
    toggle.title = expandido ? "Recolher" : "Expandir";
    toggle.addEventListener("click", function () {
      state.processosExpandidos[p.id] = !expandido;
      renderProcessos();
    });
    row.appendChild(toggle);

    var titleInput = document.createElement("input");
    titleInput.className = "processos-title-inline";
    titleInput.value = p.titulo || "";
    titleInput.placeholder = "Sem título";
    titleInput.addEventListener("blur", function () {
      var novo = titleInput.value.trim();
      if (novo !== (p.titulo || "")) processosSalvarCampo(p.id, "titulo", novo, null);
    });
    titleInput.addEventListener("keydown", function (ev) { if (ev.key === "Enter") titleInput.blur(); });
    row.appendChild(titleInput);

    var delBtn = document.createElement("button");
    delBtn.className = "icon-btn processos-del";
    delBtn.textContent = "✕";
    delBtn.title = "Excluir";
    delBtn.addEventListener("click", function () { processosExcluir(p); });
    row.appendChild(delBtn);

    wrap.appendChild(row);

    if (expandido) {
      var body = document.createElement("div");
      body.className = "processos-body";
      body.style.paddingLeft = (depth * 20 + 26) + "px";

      var conteudoRow = document.createElement("div");
      conteudoRow.className = "processos-conteudo-row";

      var textarea = document.createElement("textarea");
      textarea.className = "processos-conteudo";
      textarea.rows = 1;
      textarea.placeholder = "Escreva aqui...";
      textarea.value = p.conteudo || "";
      var ajustarAltura = function () {
        textarea.style.height = "auto";
        textarea.style.height = (textarea.scrollHeight + 2) + "px";
      };
      textarea.addEventListener("input", ajustarAltura);
      var statusEl = document.createElement("span");
      statusEl.className = "cb-obs-status";
      textarea.addEventListener("blur", function () {
        if (textarea.value !== (p.conteudo || "")) processosSalvarCampo(p.id, "conteudo", textarea.value, statusEl);
      });
      conteudoRow.appendChild(textarea);

      var addSubLink = document.createElement("button");
      addSubLink.className = "processos-add-sub-link";
      addSubLink.textContent = "+ toggle";
      addSubLink.title = "Adicionar sub-tópico (toggle)";
      addSubLink.addEventListener("click", function () { processosCriar(p.id); });
      conteudoRow.appendChild(addSubLink);

      body.appendChild(conteudoRow);
      body.appendChild(statusEl);
      setTimeout(ajustarAltura, 0);

      processosFilhos(p.id).forEach(function (filho) { body.appendChild(renderProcessoItem(filho, depth + 1)); });

      wrap.appendChild(body);
    }

    return wrap;
  }

  document.getElementById("processos-add-raiz").addEventListener("click", function () { processosCriar(null); });

  function renderProcessos() {
    processosTreeEl.innerHTML = "";
    var raiz = processosFilhos(null);
    if (!raiz.length) {
      var vazio = document.createElement("div");
      vazio.className = "processos-empty";
      vazio.textContent = 'Nenhum processo ainda. Clique em "+ novo processo" pra começar.';
      processosTreeEl.appendChild(vazio);
      return;
    }
    raiz.forEach(function (p) { processosTreeEl.appendChild(renderProcessoItem(p, 0)); });
  }

  function renderAll() {
    renderVendors();
    renderWeek();
    if (showingHistory) renderHistory();
    renderCobrancas();
    if (state.cbModalClienteId) renderCbModal();
    renderCrm();
    if (state.crmModalNegocioId) renderCrmModal();
    if (state.comissaoCardId) renderComissaoCard();
    renderProcessos();
  }
})();
