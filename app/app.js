(function () {
  var supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  var DAY_NAMES = ["Seg.", "Ter.", "Qua.", "Qui.", "Sex."];
  var ESTAGIOS = {
    novo: ["Pedido de cotação", "Cotação Realizada", "Proposta Apresentada", "Follow Up", "Negócio Fechado"],
    renovacao: ["Pedido de renovação", "Renovação Realizada", "Proposta Apresentada", "Follow Up", "Negócio Fechado"]
  };
  var state = {
    session: null, perfil: null, vendedores: [], comissoes: [], tarefas: [], vendorAberto: null,
    cobrancaClientes: [], parcelas: [], cbForma: "Boleto", cbModalClienteId: null, cbEditingParcelaId: null,
    novaTarefaDrafts: {},
    negocios: [], cotacoes: [], atividades: [], crmTipo: "novo", crmModalNegocioId: null
  };

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
    tabCrm.hidden = !isAdmin;
    var lembrada = safeStorageGet("abaAtiva");
    var valida = isAdmin ? ["comissoes", "tarefas", "cobrancas", "crm"] : ["cobrancas"];
    selectTab(valida.indexOf(lembrada) !== -1 ? lembrada : valida[0]);
  }

  // ---- tabs ----
  var tabComissoes = document.getElementById("tab-comissoes");
  var tabTarefas = document.getElementById("tab-tarefas");
  var tabCobrancas = document.getElementById("tab-cobrancas");
  var tabCrm = document.getElementById("tab-crm");
  var panelComissoes = document.getElementById("panel-comissoes");
  var panelTarefas = document.getElementById("panel-tarefas");
  var panelCobrancas = document.getElementById("panel-cobrancas");
  var panelCrm = document.getElementById("panel-crm");
  function selectTab(which) {
    tabComissoes.setAttribute("aria-selected", String(which === "comissoes"));
    tabTarefas.setAttribute("aria-selected", String(which === "tarefas"));
    tabCobrancas.setAttribute("aria-selected", String(which === "cobrancas"));
    tabCrm.setAttribute("aria-selected", String(which === "crm"));
    panelComissoes.classList.toggle("active", which === "comissoes");
    panelTarefas.classList.toggle("active", which === "tarefas");
    panelCobrancas.classList.toggle("active", which === "cobrancas");
    panelCrm.classList.toggle("active", which === "crm");
    safeStorageSet("abaAtiva", which);
  }
  tabComissoes.addEventListener("click", function () { selectTab("comissoes"); });
  tabTarefas.addEventListener("click", function () { selectTab("tarefas"); });
  tabCobrancas.addEventListener("click", function () { selectTab("cobrancas"); });
  tabCrm.addEventListener("click", function () { selectTab("crm"); });

  // ---- data loading ----
  async function loadAll() {
    var [vRes, cRes, tRes, ccRes, pRes, nRes, qRes, aRes] = await Promise.all([
      supabase.from("vendedores").select("*"),
      supabase.from("comissoes").select("*"),
      supabase.from("tarefas").select("*, perfis(nome)"),
      supabase.from("cobranca_clientes").select("*"),
      supabase.from("parcelas").select("*"),
      supabase.from("negocios").select("*"),
      supabase.from("cotacoes").select("*"),
      supabase.from("atividades").select("*, perfis(nome)")
    ]);
    if (vRes.error) return reportError(vRes.error);
    if (cRes.error) return reportError(cRes.error);
    if (tRes.error) return reportError(tRes.error);
    if (ccRes.error) return reportError(ccRes.error);
    if (pRes.error) return reportError(pRes.error);
    if (nRes.error) return reportError(nRes.error);
    if (qRes.error) return reportError(qRes.error);
    if (aRes.error) return reportError(aRes.error);
    state.vendedores = vRes.data;
    state.comissoes = cRes.data;
    state.tarefas = tRes.data;
    state.cobrancaClientes = ccRes.data;
    state.parcelas = pRes.data;
    state.negocios = nRes.data;
    state.cotacoes = qRes.data;
    state.atividades = aRes.data;
    renderAll();
  }

  var channel = null;
  function setupSubscriptions() {
    channel = supabase.channel("db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vendedores" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "comissoes" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "tarefas" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "cobranca_clientes" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "parcelas" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "negocios" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "cotacoes" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "atividades" }, loadAll)
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

    var table = document.createElement("table");
    table.className = "commissions";
    var thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>Cliente</th><th>Situação</th><th>Data</th><th style=\"text-align:right\">Valor</th><th></th></tr>";
    table.appendChild(thead);
    var tbody = document.createElement("tbody");

    if (!rows.length) {
      var er = document.createElement("tr");
      er.className = "empty-row";
      er.innerHTML = "<td colspan=\"5\">Sem comissões lançadas.</td>";
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

      var tdVal = document.createElement("td");
      tdVal.className = "val tabular" + (Number(c.valor) < 0 ? " neg" : "");
      tdVal.textContent = fmtMoney(Number(c.valor));
      tr.appendChild(tdVal);

      var tdDel = document.createElement("td");
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
        data: dataInput.value || todayISO()
      });
      if (res.error) return reportError(res.error);
      clienteInput.value = "";
      valInput.value = "";
      loadAll();
    });
    newRow.appendChild(clienteInput);
    newRow.appendChild(dataInput);
    newRow.appendChild(valInput);
    newRow.appendChild(addBtn);
    card.appendChild(newRow);

    var foot = document.createElement("div");
    foot.className = "vendor-foot";
    foot.innerHTML = "<span>Total transferido</span><span class=\"total tabular\">" + fmtMoney(totalPago) + "</span>";
    card.appendChild(foot);

    return card;
  }

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
      mid.textContent = t.descricao;
      var resp = document.createElement("span");
      resp.className = "resp";
      resp.textContent = t.perfis ? t.perfis.nome : "";
      mid.appendChild(resp);
      row.appendChild(mid);

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
  var cbAddToggle = document.getElementById("cb-add-toggle");
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
    var atrasados = fila.filter(function (f) { return f.parcela.data < today; });
    var hoje = fila.filter(function (f) { return f.parcela.data === today; });
    var totalReceber = fila.reduce(function (s, f) { return s + Number(f.parcela.valor); }, 0);

    document.getElementById("cb-stat-atrasados-n").textContent = atrasados.length;
    document.getElementById("cb-stat-atrasados-v").textContent = fmtMoney(atrasados.reduce(function (s, f) { return s + Number(f.parcela.valor); }, 0));
    document.getElementById("cb-stat-hoje-n").textContent = hoje.length;
    document.getElementById("cb-stat-hoje-v").textContent = fmtMoney(hoje.reduce(function (s, f) { return s + Number(f.parcela.valor); }, 0));
    document.getElementById("cb-stat-total").textContent = fmtMoney(totalReceber);

    var grupos = [];
    fila.forEach(function (item) {
      var last = grupos[grupos.length - 1];
      if (last && last.data === item.parcela.data) last.itens.push(item);
      else grupos.push({ data: item.parcela.data, itens: [item] });
    });

    cbFila.innerHTML = "";
    if (!grupos.length) {
      var empty = document.createElement("div");
      empty.className = "cb-empty";
      empty.textContent = "Nenhuma cobrança pendente.";
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
    meta.textContent = cliente.forma + " · parcela " + parcela.numero + " de " + totalParcelas;
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

  cbAddToggle.addEventListener("click", function () {
    cbNewForm.hidden = !cbNewForm.hidden;
  });
  document.getElementById("cb-add-cancel").addEventListener("click", function () { cbNewForm.hidden = true; });
  document.querySelectorAll(".cb-forma-chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.cbForma = chip.getAttribute("data-forma");
      document.querySelectorAll(".cb-forma-chip").forEach(function (c) { c.classList.toggle("is-on", c === chip); });
    });
  });
  document.getElementById("cb-add-confirm").addEventListener("click", async function () {
    var nome = document.getElementById("cb-nome").value.trim();
    var valor = parseFloat(document.getElementById("cb-valor").value);
    var dataIni = document.getElementById("cb-data").value;
    var numParcelas = parseInt(document.getElementById("cb-parcelas").value, 10);
    if (!nome || isNaN(valor) || !dataIni || !numParcelas || numParcelas < 1) return;

    var clienteRes = await supabase.from("cobranca_clientes").insert({ nome: nome, forma: state.cbForma }).select().single();
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
    var pRes = await supabase.from("parcelas").insert(parcelasRows);
    if (pRes.error) return reportError(pRes.error);

    document.getElementById("cb-nome").value = "";
    document.getElementById("cb-valor").value = "";
    document.getElementById("cb-parcelas").value = "12";
    cbNewForm.hidden = true;
    loadAll();
  });

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
  cbModalObs.addEventListener("blur", async function () {
    if (!state.cbModalClienteId) return;
    await supabase.from("cobranca_clientes").update({ observacoes: cbModalObs.value }).eq("id", state.cbModalClienteId);
  });

  function renderCbModal() {
    var cliente = state.cobrancaClientes.find(function (c) { return c.id === state.cbModalClienteId; });
    if (!cliente) return;
    document.getElementById("cb-modal-nome").textContent = cliente.nome;
    document.getElementById("cb-modal-forma").textContent = cliente.forma;
    if (document.activeElement !== cbModalObs) cbModalObs.value = cliente.observacoes || "";

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
    var nome = document.getElementById("crm-nome").value.trim();
    if (!nome) return;
    var contato = document.getElementById("crm-contato").value.trim();
    var valorRaw = document.getElementById("crm-valor").value;
    var res = await supabase.from("negocios").insert({
      cliente_nome: nome,
      contato: contato || null,
      tipo: state.crmTipo,
      estagio: ESTAGIOS[state.crmTipo][0],
      valor: valorRaw ? parseFloat(valorRaw) : null
    });
    if (res.error) return reportError(res.error);
    document.getElementById("crm-nome").value = "";
    document.getElementById("crm-contato").value = "";
    document.getElementById("crm-valor").value = "";
    crmNewForm.hidden = true;
    loadAll();
  });

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

      crmBoard.appendChild(col);
    });
  }

  function renderCrmCard(n) {
    var card = document.createElement("button");
    card.className = "crm-card status-" + n.status;
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
    var desc = input.value.trim();
    if (!desc) return;
    var res = await supabase.from("atividades").insert({
      negocio_id: state.crmModalNegocioId,
      autor_id: state.perfil.id,
      descricao: desc
    });
    if (res.error) return reportError(res.error);
    input.value = "";
    loadAll();
  });

  function renderCrmModal() {
    var n = state.negocios.find(function (x) { return x.id === state.crmModalNegocioId; });
    if (!n) return;

    document.getElementById("crm-modal-nome").textContent = n.cliente_nome;
    document.getElementById("crm-modal-contato").textContent = n.contato || "sem contato registrado";

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
      .sort(function (a, b) { return (b.criado_em || "").localeCompare(a.criado_em || ""); });
    if (!atvs.length) {
      var emptyA = document.createElement("div");
      emptyA.className = "crm-empty-col";
      emptyA.textContent = "Nenhuma atividade registrada ainda.";
      atvWrap.appendChild(emptyA);
    }
    atvs.forEach(function (a) {
      var row = document.createElement("div");
      row.className = "crm-atividade-row";
      var desc = document.createElement("div");
      desc.textContent = a.descricao;
      var meta = document.createElement("div");
      meta.className = "crm-atividade-meta";
      var d = new Date(a.criado_em);
      meta.textContent = (a.perfis ? a.perfis.nome : "") + " · " + d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      row.appendChild(desc);
      row.appendChild(meta);
      atvWrap.appendChild(row);
    });
  }

  function renderAll() {
    renderVendors();
    renderWeek();
    if (showingHistory) renderHistory();
    renderCobrancas();
    if (state.cbModalClienteId) renderCbModal();
    renderCrm();
    if (state.crmModalNegocioId) renderCrmModal();
  }
})();
