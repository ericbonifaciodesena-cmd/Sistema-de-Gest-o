(function () {
  var supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  var DAY_NAMES = ["Seg.", "Ter.", "Qua.", "Qui.", "Sex."];
  var state = { session: null, perfil: null, vendedores: [], comissoes: [], tarefas: [], vendorAberto: null };

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

  document.getElementById("logout-btn").addEventListener("click", async function () {
    await supabase.auth.signOut();
  });

  supabase.auth.onAuthStateChange(function (event, session) {
    state.session = session;
    if (session) {
      showApp();
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

    await loadAll();
    setupSubscriptions();
  }

  // ---- tabs ----
  var tabComissoes = document.getElementById("tab-comissoes");
  var tabTarefas = document.getElementById("tab-tarefas");
  var panelComissoes = document.getElementById("panel-comissoes");
  var panelTarefas = document.getElementById("panel-tarefas");
  function selectTab(which) {
    var onC = which === "comissoes";
    tabComissoes.setAttribute("aria-selected", String(onC));
    tabTarefas.setAttribute("aria-selected", String(!onC));
    panelComissoes.classList.toggle("active", onC);
    panelTarefas.classList.toggle("active", !onC);
  }
  tabComissoes.addEventListener("click", function () { selectTab("comissoes"); });
  tabTarefas.addEventListener("click", function () { selectTab("tarefas"); });

  // ---- data loading ----
  async function loadAll() {
    var [vRes, cRes, tRes] = await Promise.all([
      supabase.from("vendedores").select("*"),
      supabase.from("comissoes").select("*"),
      supabase.from("tarefas").select("*, perfis(nome)")
    ]);
    if (vRes.error) return reportError(vRes.error);
    if (cRes.error) return reportError(cRes.error);
    if (tRes.error) return reportError(tRes.error);
    state.vendedores = vRes.data;
    state.comissoes = cRes.data;
    state.tarefas = tRes.data;
    renderAll();
  }

  var channel = null;
  function setupSubscriptions() {
    channel = supabase.channel("db-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "vendedores" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "comissoes" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "tarefas" }, loadAll)
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

  function renderAll() {
    renderVendors();
    renderWeek();
    if (showingHistory) renderHistory();
  }
})();
