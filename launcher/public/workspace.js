;(function () {
  "use strict";

  var state = {
    mode: "home",
    workSubMode: "work",
    agent: "openclaw",
    config: null,
    statuses: {},
    messages: [],
    attachments: [],
    loading: false,
    activePreset: null,
    abortController: null,
    simpleChats: {},
    simpleLoading: {},
    simpleAbort: {},
    channels: [],
    agentChannels: {},
    providers: [],
    chatModel: null,
    simpleChatModel: {},
    proMode: false,
    rawMode: false,
    fileListCache: {},
    fileCurrentPath: {},
    logStreamController: null,
    lastRawReqRes: null,
  };

  var AGENT_LIST = ["openclaw", "hermes"];
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };

  /* ── API helper ────────────────────────────────────────────── */
  async function api(path, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };
    var fetchOptions = { headers: headers, ...options };
    if (!fetchOptions.method) fetchOptions.method = "POST";
    if (options.body && typeof options.body === "object" && !(options.body instanceof FormData)) {
      fetchOptions.body = JSON.stringify(options.body);
    }
    var response = await fetch(path, fetchOptions);
    var data = await response.json();
    if (!response.ok) throw new Error(data.error || data.message || "请求失败");
    return data;
  }

  /* ── View switching ────────────────────────────────────────── */
  function showView(viewId) {
    var views = document.querySelectorAll(".view");
    for (var i = 0; i < views.length; i++) {
      views[i].classList.toggle("active", views[i].id === "view-" + viewId);
    }
    state.mode = viewId;
  }

  function navigate(hash) {
    hash = hash || location.hash || "#home";
    if (hash === "#home" || hash === "" || hash === "#") {
      showView("home");
      history.replaceState(null, "", "#home");
      localStorage.setItem("lastMode", "home");
      return;
    }
    if (hash.indexOf("#simple") === 0) {
      showView("work");
      setWorkMode("simple");
      history.replaceState(null, "", "#simple");
      localStorage.setItem("lastMode", "simple");
      refreshStatus();
      return;
    }
    if (hash.indexOf("#work") === 0) {
      showView("work");
      setWorkMode("work");
      var parts = hash.split("/");
      var agent = parts[1] || state.agent || "openclaw";
      if (agent !== "openclaw" && agent !== "hermes") agent = "openclaw";
      setAgent(agent);
      history.replaceState(null, "", "#work/" + agent);
      localStorage.setItem("lastMode", "work");
      localStorage.setItem("lastAgent", agent);
      loadChat();
      refreshStatus();
      return;
    }
    if (hash.indexOf("#pro") === 0) {
      showView("work");
      setWorkMode("pro");
      var parts = hash.split("/");
      var agent = parts[1] || state.agent || "openclaw";
      if (agent !== "openclaw" && agent !== "hermes") agent = "openclaw";
      setAgent(agent);
      history.replaceState(null, "", "#pro/" + agent);
      localStorage.setItem("lastMode", "pro");
      localStorage.setItem("lastAgent", agent);
      loadChat();
      refreshStatus();
      return;
    }
    showView("home");
    history.replaceState(null, "", "#home");
  }

  function setWorkMode(mode) {
    state.workSubMode = mode;
    var isSimple = mode === "simple";
    var isPro = mode === "pro";
    var workTopbar = $("workTopbar");
    var simpleTopbar = $("simpleTopbar");
    var sidebar = $("sidebar");
    var simpleConfig = $("simpleConfigPanel");
    var simpleChatArea = $("simpleChatArea");
    var workLayout = document.querySelector(".work-layout");
    if (workTopbar) workTopbar.style.display = isSimple ? "none" : "";
    if (simpleTopbar) simpleTopbar.style.display = isSimple ? "" : "none";
    if (sidebar) sidebar.style.display = isSimple ? "none" : "";
    if (simpleConfig) simpleConfig.style.display = isSimple ? "" : "none";
    if (simpleChatArea) simpleChatArea.style.display = isSimple ? "" : "none";
    if (workLayout) workLayout.style.display = isSimple ? "none" : "";

    state.proMode = isPro;

    // Show/hide pro-only sidebar items
    var proItems = document.querySelectorAll(".sidebar-menu .pro-only");
    for (var pi = 0; pi < proItems.length; pi++) {
      proItems[pi].style.display = isPro ? "" : "none";
    }

    // Show/hide raw toggle
    var rawToggle = $("chatRawToggle");
    if (rawToggle) rawToggle.style.display = isPro ? "" : "none";

    // Update topbar back link for pro mode
    var backLink = workTopbar && workTopbar.querySelector(".back-link");
    if (backLink) {
      backLink.textContent = isPro ? "返回首页" : "简易模式";
      backLink.href = isPro ? "#home" : "#simple";
    }

    if (isSimple) {
      renderSimpleConfig();
      renderSimpleTools();
      renderSimpleChats();
      loadSimpleChat("openclaw");
      loadSimpleChat("hermes");
    } else {
      renderChat();
    }
  }

  /* ── Agent selection ───────────────────────────────────────── */
  function setAgent(agentId) {
    state.agent = agentId;
    var select = $("workAgentSelect");
    if (select) select.value = agentId;
    updateWorkStatus();
    var ctx = $("chatContextName");
    var agents = state.config && state.config.agents ? state.config.agents.agents || {} : {};
    if (ctx) ctx.textContent = agents[agentId] ? agents[agentId].name : agentId;
    populateWorkModelSelect();
    populateSimpleModelSelect(agentId);
  }

  function updateWorkStatus() {
    var nameEl = $("workAgentName");
    var statusEl = $("workAgentStatus");
    var dotEl = $("workAgentDot");
    var agents = state.config && state.config.agents ? state.config.agents.agents || {} : {};
    var agentMeta = agents[state.agent];
    if (nameEl) nameEl.textContent = agentMeta ? agentMeta.name : state.agent;
    var s = state.statuses[state.agent];
    if (s) {
      if (s.running) {
        if (dotEl) dotEl.className = "status-dot running";
        if (statusEl) statusEl.textContent = "运行中 · 端口 " + (s.ports && s.ports.port ? s.ports.port : "?");
      } else if (s.installed) {
        if (dotEl) dotEl.className = "status-dot stopped";
        if (statusEl) statusEl.textContent = "";
      } else {
        if (dotEl) dotEl.className = "status-dot missing";
        if (statusEl) statusEl.textContent = "未安装";
      }
    } else {
      if (dotEl) dotEl.className = "status-dot";
      if (statusEl) statusEl.textContent = "未知";
    }
    updateWorkButtons();
  }

  function updateWorkButtons() {
    var actionsEl = $("workAgentActions");
    if (!actionsEl) return;
    var s = state.statuses[state.agent];
    var running = s && s.running;
    var startBtn = actionsEl.querySelector('[data-action="start"]');
    var stopBtn = actionsEl.querySelector('[data-action="stop"]');
    var restartBtn = actionsEl.querySelector('[data-action="restart"]');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = false;
    if (restartBtn) restartBtn.disabled = false;
  }

  /* ── Status polling ────────────────────────────────────────── */
  async function refreshStatus() {
    try {
      var data = await api("/api/config", { method: "GET" });
      state.config = data;
      state.statuses = data.status || {};
      loadChannelsFromConfig();
      updateWorkStatus();
      updateSimpleStatus();
      updateAgentSelect();
      populateWorkModelSelect();
      populateSimpleModelSelect("openclaw");
      populateSimpleModelSelect("hermes");
    } catch (e) {
      console.error("workspace refresh error:", e);
    }
  }

  /* ── Bridge for shortcuts.js (replaces app.js functions) ── */
  window.refreshAll = refreshStatus;
  window.backupData = async function () {
    try {
      var result = await api("/api/backup", { method: "POST" });
      if (window.showToast) showToast("备份完成：" + (result.backupPath || ""), "success");
    } catch (e) {
      if (window.showToast) showToast("备份失败：" + e.message, "error");
    }
  };
  window.restoreBackup = async function () {
    if (!confirm("确认使用最新备份还原？")) return;
    try {
      var result = await api("/api/restore", { method: "POST" });
      if (window.showToast) showToast(result.message || "还原完成", "success");
      await refreshStatus();
    } catch (e) {
      if (window.showToast) showToast("还原失败：" + e.message, "error");
    }
  };
  window.cleanCache = async function () {
    if (!confirm("确认清理 Agent 缓存？")) return;
    try {
      await api("/api/clean-cache", { method: "POST" });
      if (window.showToast) showToast("缓存已清理", "success");
    } catch (e) {
      if (window.showToast) showToast("清理失败：" + e.message, "error");
    }
  };
  window.runDiagnostics = async function () {
    try {
      var data = await api("/api/diagnostics", { method: "GET" });
      alert(JSON.stringify(data, null, 2));
    } catch (e) {
      if (window.showToast) showToast("诊断失败：" + e.message, "error");
    }
  };
  async function agentAction(action, agentId) {
    agentId = agentId || state.agent;
    if (action === "start") {
      await api("/api/agent/" + agentId + "/start", { method: "POST" });
      if (window.showToast) showToast(agentId + " 已启动", "success");
    } else if (action === "stop") {
      await api("/api/agent/" + agentId + "/stop", { method: "POST" });
      if (window.showToast) showToast(agentId + " 已停止", "info");
    } else if (action === "restart") {
      await api("/api/agent/" + agentId + "/restart", { method: "POST" });
      if (window.showToast) showToast(agentId + " 已重启", "success");
    }
    await refreshStatus();
    updateSimpleStatus();
  }

  function updateSimpleStatus() {
    var agents = state.config && state.config.agents ? Object.keys(state.config.agents.agents || {}) : ["openclaw", "hermes"];
    for (var ai = 0; ai < agents.length; ai++) {
      var aid = agents[ai];
      var statusEl = document.getElementById("simpleStatus" + aid.charAt(0).toUpperCase() + aid.slice(1));
      var s = state.statuses[aid];
      var text = "检查中...";
      if (s) {
        if (s.running) text = "✅ 运行中 · 端口 " + (s.ports && s.ports.port ? s.ports.port : "?");
        else if (s.installed) text = "";
        else text = "❌ 未安装";
      }
      if (statusEl) statusEl.textContent = text;
      // Update per-panel button states
      var panel = document.querySelector('.simple-chat-col[data-agent="' + aid + '"]');
      if (!panel) continue;
      var startBtn = panel.querySelector('[data-action="start"]');
      var stopBtn = panel.querySelector('[data-action="stop"]');
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = false;
    }
  }

  function updateAgentSelect() {
    var select = $("workAgentSelect");
    if (!select || !state.config || !state.config.agents) return;
    var currentVal = select.value;
    var agents = state.config.agents.agents || {};
    var keys = Object.keys(agents);
    if (keys.length === select.options.length && keys.every(function(k, i) { return select.options[i].value === k; })) return;
    select.innerHTML = "";
    for (var i = 0; i < keys.length; i++) {
      var id = keys[i];
      if (agents[id].disabled) continue;
      var opt = document.createElement("option");
      opt.value = id;
      opt.textContent = agents[id].name || id;
      select.appendChild(opt);
    }
    if (currentVal && keys.indexOf(currentVal) >= 0) select.value = currentVal;
  }

  /* ── Simple mode dual-panel chat ──────────────────────────── */
  function capFirst(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function buildSimpleBubbleHtml(agentId, idx, m) {
    var role = m.role === "user" ? "user" : "assistant";
    var label = role === "user" ? "你" : (agentId === "hermes" ? "Hermes" : "OpenClaw");
    var content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = m.content.map(function(p) { return typeof p === "string" ? p : p.text || ""; }).join(" ");
    }
    var rendered = renderContent(content);
    return '<div class="chat-bubble-modern ' + role + ' fade-in">' +
      '<div class="bubble-meta"><span class="bubble-label">' + label + '</span></div>' +
      '<div class="bubble-content">' + rendered + '</div>' +
      '<div class="bubble-actions"><button class="bubble-copy" data-copy="' + idx + '" data-agent="' + agentId + '" title="复制">📋</button></div>' +
      "</div>";
  }

  function renderSimpleChatMessages(agentId) {
    var box = $("simpleChat" + capFirst(agentId));
    if (!box) return;
    var msgs = state.simpleChats[agentId] || [];

    if (!msgs.length) {
      box.innerHTML = '<div class="chat-empty">没有消息。启动 Agent 后开始对话。</div>';
      return;
    }

    var html = "";
    for (var i = 0; i < msgs.length; i++) {
      html += buildSimpleBubbleHtml(agentId, i, msgs[i]);
    }
    // In-place update of last streaming content
    var lastMsg = msgs[msgs.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && typeof lastMsg.content === "string" && lastMsg.content) {
      // re-render to capture updated content
    }
    box.innerHTML = html;

    // Loading indicator
    var loadingEl = box.querySelector(".simple-loading-dots");
    if (state.simpleLoading[agentId]) {
      var hasStreaming = msgs.length > 0 && msgs[msgs.length - 1].role === "assistant";
      if (!hasStreaming && !loadingEl) {
        var div = document.createElement("div");
        div.className = "chat-bubble-modern assistant fade-in simple-loading-dots";
        div.innerHTML = '<div class="bubble-content"><span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span></div>';
        box.appendChild(div);
      } else if (hasStreaming && loadingEl) {
        loadingEl.remove();
      }
    } else {
      if (loadingEl) loadingEl.remove();
    }

    box.scrollTop = box.scrollHeight;
  }

  function renderSimpleChats() {
    renderSimpleChatMessages("openclaw");
    renderSimpleChatMessages("hermes");
  }

  async function loadSimpleChat(agentId) {
    try {
      var result = await api("/simple-chat?agent=" + agentId, { method: "GET" });
      state.simpleChats[agentId] = result.messages || [];
    } catch (e) {
      state.simpleChats[agentId] = [];
    }
    renderSimpleChatMessages(agentId);
  }

  async function sendSimpleMessage(agentId, text) {
    if (state.simpleLoading[agentId]) {
      var ctrl = state.simpleAbort[agentId];
      if (ctrl) { ctrl.abort(); state.simpleAbort[agentId] = null; }
      state.simpleLoading[agentId] = false;
    }
    if (!text) return;

    state.simpleChats[agentId] = (state.simpleChats[agentId] || []).concat([
      { role: "user", content: text }
    ]);
    state.simpleLoading[agentId] = true;
    state.simpleAbort[agentId] = new AbortController();
    renderSimpleChatMessages(agentId);

    var body = { agentId: agentId, message: text };
    var systemPrompt = null;
    if (state.activePreset && state.activePreset.systemPrompt) {
      systemPrompt = state.activePreset.systemPrompt;
    }
    if (systemPrompt) body.systemPrompt = systemPrompt;
    var modelSelectId = "simpleModel" + agentId.charAt(0).toUpperCase() + agentId.slice(1);
    var modelSelect = $(modelSelectId);
    if (modelSelect && modelSelect.value) body.model = modelSelect.value;

    var streamed = false;
    try {
      var response = await fetch("/api/agent-chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: state.simpleAbort[agentId].signal
      });
      if (response.ok && response.body) {
        streamed = true;
        state.simpleChats[agentId] = state.simpleChats[agentId].concat([{ role: "assistant", content: "" }]);
        var msgIdx = state.simpleChats[agentId].length - 1;
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buf = "", fullContent = "";
        while (true) {
          var result = await reader.read();
          if (result.done) break;
          buf += decoder.decode(result.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          for (var li = 0; li < lines.length; li++) {
            var l = lines[li].trim();
            if (!l.startsWith("data: ")) continue;
            var d = l.slice(6).trim();
            if (d === "[DONE]") continue;
            try {
              var p = JSON.parse(d);
              if (p.error) throw new Error(p.error);
              if (p.content) {
                fullContent += p.content;
                state.simpleChats[agentId][msgIdx].content = fullContent;
                renderSimpleChatMessages(agentId);
              }
            } catch (pe) { if (pe.message) throw pe; }
          }
        }
        if (!fullContent) throw new Error("模型返回内容为空。");
      }
    } catch (e) {
      if (e.name === "AbortError") { streamed = true; }
    }

    if (!streamed) {
      try {
        var result = await api("/api/agent-chat", { body: body });
        state.simpleChats[agentId] = state.simpleChats[agentId].concat([
          { role: "assistant", content: result.content }
        ]);
      } catch (e) {
        state.simpleChats[agentId] = state.simpleChats[agentId].concat([
          { role: "assistant", content: "发送失败：" + e.message }
        ]);
      }
    }

    state.simpleLoading[agentId] = false;
    state.simpleAbort[agentId] = null;
    renderSimpleChatMessages(agentId);
  }

  function clearSimpleChat(agentId) {
    var ctrl = state.simpleAbort[agentId];
    if (ctrl) { ctrl.abort(); state.simpleAbort[agentId] = null; }
    state.simpleLoading[agentId] = false;
    state.simpleChats[agentId] = [];
    renderSimpleChatMessages(agentId);
    api("/api/agent-chat", { body: { agentId: agentId, reset: true } }).catch(function () {});
  }

  /* ── Simple mode rendering ─────────────────────────────────── */
  function renderSimpleConfig() {
    var body = $("simpleConfigBody");
    if (!body) return;
    var agentModel = state.config && state.config.agentModels && state.config.agentModels[state.agent];
    var hasConfig = agentModel && agentModel.apiKey && agentModel.apiKey !== "";
    var agentName = state.agent === "hermes" ? "Hermes" : "OpenClaw";
    body.innerHTML =
      '<div class="current-config-bar">' +
      '当前 ' + agentName + ' 模型：<strong>' + (agentModel && agentModel.providerName ? esc(agentModel.providerName) : "未配置") + ' / ' + (agentModel && agentModel.model ? esc(agentModel.model) : "-") + '</strong>' +
      ' <span class="cfg-badge ' + (hasConfig ? "configured" : "unconfigured") + '">' + (hasConfig ? "已配置" : "未配置") + '</span>' +
      (hasConfig ? ' <button class="cfg-del-btn" data-action="clear-key-simple">删除 Key</button>' : "") +
      '</div>' +
      '<p style="color:var(--muted);font-size:13px;padding:4px 0">如需修改 API 配置，请到 <a href="#work" style="color:var(--accent)">工作模式 → API 配置</a> 页面操作。</p>';
    // Wire clear-key button
    var clearBtn = body.querySelector('[data-action="clear-key-simple"]');
    if (clearBtn) {
      clearBtn.addEventListener("click", async function () {
        if (!confirm("确认清除 " + agentName + " 的 API Key？")) return;
        try {
          await api("/api/config/clear-key", { body: { scope: state.agent } });
          if (window.showToast) showToast("Key 已清除", "success");
          await refreshStatus();
          renderSimpleConfig();
        } catch (e) {
          if (window.showToast) showToast("清除失败：" + e.message, "error");
        }
      });
    }
  }

  function renderSimpleTools() {
    var body = $("simpleToolsBody");
    if (!body) return;
    body.innerHTML =
      '<div class="simple-tools-grid">' +
      '<button id="simpleDiagnostics" class="model-btn">🔍 运行诊断</button>' +
      '<button id="simpleBackup" class="model-btn">💾 备份数据</button>' +
      '<button id="simpleRestore" class="model-btn">📂 恢复备份</button>' +
      '<button id="simpleCleanCache" class="model-btn">🗑️ 清理缓存</button>' +
      '</div>' +
      '<pre id="simpleToolResult" class="simple-tool-result"></pre>';

    var resultEl = body.querySelector("#simpleToolResult");

    body.querySelector("#simpleDiagnostics").addEventListener("click", async function () {
      resultEl.textContent = "诊断中...";
      try {
        var data = await api("/api/diagnostics", { method: "GET" });
        resultEl.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        resultEl.textContent = "诊断失败：" + e.message;
      }
    });

    body.querySelector("#simpleBackup").addEventListener("click", async function () {
      resultEl.textContent = "备份中...";
      try {
        var data = await api("/api/backup", { method: "POST" });
        resultEl.textContent = data.message || "备份完成";
        if (window.showToast) showToast("备份完成", "success");
      } catch (e) {
        resultEl.textContent = "备份失败：" + e.message;
      }
    });

    body.querySelector("#simpleRestore").addEventListener("click", async function () {
      if (!confirm("恢复备份将覆盖当前配置，确认？")) return;
      resultEl.textContent = "恢复中...";
      try {
        var data = await api("/api/restore", { method: "POST" });
        resultEl.textContent = data.message || "恢复完成";
        if (window.showToast) showToast("恢复完成", "success");
        await refreshStatus();
      } catch (e) {
        resultEl.textContent = "恢复失败：" + e.message;
      }
    });

    body.querySelector("#simpleCleanCache").addEventListener("click", async function () {
      resultEl.textContent = "清理中...";
      try {
        var data = await api("/api/clean-cache", { method: "POST" });
        resultEl.textContent = data.message || "缓存已清理";
        if (window.showToast) showToast("缓存已清理", "success");
      } catch (e) {
        resultEl.textContent = "清理失败：" + e.message;
      }
    });
  }

  /* ── Channels / Multi-API ───────────────────────────────── */
  function loadChannelsFromConfig() {
    if (state.config && state.config.channels) state.channels = state.config.channels || [];
    if (state.config && state.config.agentChannels) state.agentChannels = state.config.agentChannels || {};
  }

  /* ── Provider models for dropdown ───────────────────────── */
  async function fetchProviders() {
    try {
      var data = await api("/api/providers", { method: "GET" });
      state.providers = data.providers || [];
    } catch (e) {
      state.providers = [];
    }
  }

  function getProviderModels(providerId) {
    var p = state.providers.find(function (x) { return x.id === providerId; });
    return p && p.models ? p.models : [];
  }

  function modelCapabilitiesLabel(modelId) {
    var cats = panelCache.models || [];
    for (var ci = 0; ci < cats.length; ci++) {
      var models = cats[ci].models || [];
      for (var mi = 0; mi < models.length; mi++) {
        if (models[mi].id === modelId || models[mi].model === modelId) {
          var caps = models[mi].capabilities || [];
          if (caps.length) return " (" + caps.join("+") + ")";
        }
      }
    }
    for (var pi = 0; pi < state.providers.length; pi++) {
      var pModels = state.providers[pi].models || [];
      for (var mj = 0; mj < pModels.length; mj++) {
        if (pModels[mj].id === modelId && pModels[mj].capabilities) {
          return " (" + pModels[mj].capabilities.join("+") + ")";
        }
      }
    }
    return "";
  }

  function populateWorkModelSelect() {
    var select = $("chatModelSelect");
    if (!select) return;
    var agentId = state.agent;
    var channelId = state.agentChannels[agentId];
    var channel = channelId ? state.channels.find(function (c) { return c.id === channelId; }) : null;
    var models = channel ? getProviderModels(channel.providerId) : [];
    if (!models.length) { select.style.display = "none"; return; }
    select.style.display = "";
    select.innerHTML = "";
    for (var i = 0; i < models.length; i++) {
      var m = models[i];
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name + modelCapabilitiesLabel(m.id);
      select.appendChild(opt);
    }
    var saved = state.chatModel;
    if (saved && models.some(function (m) { return m.id === saved; })) {
      select.value = saved;
    } else if (channel && channel.model) {
      select.value = channel.model;
    }
  }

  function populateSimpleModelSelect(agentId) {
    var selectId = "simpleModel" + agentId.charAt(0).toUpperCase() + agentId.slice(1);
    var select = $(selectId);
    if (!select) return;
    var channelId = state.agentChannels[agentId];
    var channel = channelId ? state.channels.find(function (c) { return c.id === channelId; }) : null;
    var models = channel ? getProviderModels(channel.providerId) : [];
    if (!models.length) { select.style.display = "none"; return; }
    select.style.display = "";
    select.innerHTML = "";
    for (var i = 0; i < models.length; i++) {
      var m = models[i];
      var opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name + modelCapabilitiesLabel(m.id);
      select.appendChild(opt);
    }
    var saved = state.simpleChatModel[agentId] || null;
    if (saved && models.some(function (m) { return m.id === saved; })) {
      select.value = saved;
    } else if (channel && channel.model) {
      select.value = channel.model;
    }
  }

  function renderChannelSelect(selectId, currentChannelId) {
    var html = '<select id="' + selectId + '" class="channel-select">';
    html += '<option value="">-- 未选择 --</option>';
    for (var i = 0; i < state.channels.length; i++) {
      var c = state.channels[i];
      html += '<option value="' + esc(c.id) + '"' + (c.id === currentChannelId ? " selected" : "") + ">" + esc(c.name || c.providerName + " - " + (c.model || "")) + "</option>";
    }
    html += "</select>";
    return html;
  }

  function reconcileAgentChannel(agentId) {
    var channelId = state.agentChannels[agentId] || "";
    // If agent has a channel set, and it exists in channels list, done
    if (channelId && state.channels.some(function (c) { return c.id === channelId; })) return;
    // If agent has legacy config but no channel, try to find or create one
    if (state.config && state.config.agentModels) {
      var model = state.config.agentModels[agentId];
      if (model && model.apiKey) {
        // Check if a matching channel already exists
        var match = state.channels.find(function (c) {
          return c.providerId === model.providerId && c.model === model.model;
        });
        if (match) {
          state.agentChannels[agentId] = match.id;
        }
      }
    }
  }

  async function saveAgentChannel(agentId, channelId) {
    try {
      await api("/api/config", { body: { scope: agentId, channelId: channelId || null } });
      state.agentChannels[agentId] = channelId || null;
      if (window.showToast) showToast((agentId === "hermes" ? "Hermes" : "OpenClaw") + " 通道已更新", "success");
      refreshStatus();
    } catch (e) {
      if (window.showToast) showToast("保存失败：" + e.message, "error");
    }
  }

  function showCreateChannelDialog() {
    var overlay = document.createElement("div");
    overlay.className = "config-overlay";
    overlay.innerHTML =
      '<div class="config-dialog">' +
      '<h3 class="config-dialog-title">创建 API 通道</h3>' +
      '<div class="config-dialog-body">' +
      '<label class="cfg-label">通道名称 <span class="cfg-hint">（便于识别，如"我的 OpenAI"）</span></label>' +
      '<input type="text" id="chan-name" class="cfg-input" placeholder="例如：我的 OpenAI" spellcheck="false" />' +
      '<label class="cfg-label">API Key</label>' +
      '<input type="password" id="chan-apikey" class="cfg-input" placeholder="sk-..." spellcheck="false" />' +
      '<label class="cfg-label">Base URL</label>' +
      '<input type="text" id="chan-baseurl" class="cfg-input" placeholder="https://api.openai.com/v1" spellcheck="false" />' +
      '<label class="cfg-label">模型名 <span class="cfg-hint">（可选，作为默认模型，也可在对话界面选择）</span></label>' +
      '<input type="text" id="chan-model" class="cfg-input" placeholder="gpt-4o" spellcheck="false" />' +
      '<label class="cfg-label">供应商 ID <span class="cfg-hint">（可选，如 openai）</span></label>' +
      '<input type="text" id="chan-provider" class="cfg-input" placeholder="openai" spellcheck="false" />' +
      '<label class="cfg-label">供应商名称</label>' +
      '<input type="text" id="chan-provider-name" class="cfg-input" placeholder="OpenAI" spellcheck="false" />' +
      '</div>' +
      '<div class="config-dialog-actions">' +
      '<button id="chan-create" class="model-btn accent">创建</button>' +
      '<button id="chan-cancel" class="model-btn">取消</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector("#chan-cancel").addEventListener("click", function () { overlay.remove(); });
    overlay.querySelector("#chan-create").addEventListener("click", async function () {
      var name = overlay.querySelector("#chan-name").value.trim();
      var apiKey = overlay.querySelector("#chan-apikey").value.trim();
      var baseUrl = overlay.querySelector("#chan-baseurl").value.trim();
      var model = overlay.querySelector("#chan-model").value.trim();
      var provider = overlay.querySelector("#chan-provider").value.trim();
      var providerName = overlay.querySelector("#chan-provider-name").value.trim();
      if (!name) { if (window.showToast) showToast("请输入通道名称", "error"); return; }
      if (!apiKey || !baseUrl) { if (window.showToast) showToast("请输入 API Key 和 Base URL", "error"); return; }
      var btn = overlay.querySelector("#chan-create");
      btn.disabled = true;
      btn.textContent = "创建中...";
      try {
        await api("/api/channels", { body: { name: name, apiKey: apiKey, baseUrl: baseUrl, model: model, providerId: provider, providerName: providerName } });
        if (window.showToast) showToast("通道已创建", "success");
        overlay.remove();
        await refreshStatus();
        loadChannelsFromConfig();
        var modelsEl = $("panel-models");
        if (modelsEl) renderModelsPanel(modelsEl);
      } catch (e) {
        if (window.showToast) showToast("创建失败：" + e.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "创建";
      }
    });
  }

  /* ── Launcher env info ─────────────────────────────────────── */
  async function loadLauncherEnv() {
    try {
      var data = await api("/api/config", { method: "GET" });
      state.config = data;
      state.statuses = data.status || {};
      loadChannelsFromConfig();
      state.envRoot = data.root || data.portable && data.portable.root || "";
      var envEl = $("launcherEnv");
      if (envEl) envEl.textContent = "便携目录：" + state.envRoot;
    } catch (e) {
      var envEl = $("launcherEnv");
      if (envEl) envEl.textContent = "环境读取失败：" + e.message;
    }
    await fetchProviders();
    populateWorkModelSelect();
    populateSimpleModelSelect("openclaw");
    populateSimpleModelSelect("hermes");
  }

  /* ── File helpers ──────────────────────────────────────────── */
  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error || new Error("读取文件失败")); };
      reader.readAsDataURL(file);
    });
  }

  function isTextFile(file) {
    var name = file.name.toLowerCase();
    var textExts = [".txt", ".md", ".json", ".csv", ".log", ".xml", ".html", ".js", ".ts", ".py", ".java", ".go", ".rs", ".c", ".cpp", ".h", ".css"];
    if (file.type.startsWith("text/")) return true;
    for (var i = 0; i < textExts.length; i++) { if (name.endsWith(textExts[i])) return true; }
    return false;
  }

  async function fileToAttachment(file) {
    if (file.size > 2_000_000) throw new Error(file.name + " 超过 2MB");
    if (file.type.startsWith("image/")) {
      return { kind: "image", name: file.name, type: file.type, size: file.size, dataUrl: await readFileAsDataUrl(file) };
    }
    if (isTextFile(file)) {
      return { kind: "text", name: file.name, type: file.type || "text/plain", size: file.size, text: (await file.text()).slice(0, 120000) };
    }
    throw new Error(file.name + " 暂不支持，请使用图片或文本类文件");
  }

  function renderAttachments() {
    var bar = $("chatAttachments");
    if (!bar) return;
    var items = state.attachments || [];
    if (!items.length) { bar.innerHTML = ""; bar.classList.remove("has-files"); return; }
    bar.classList.add("has-files");
    var html = "";
    for (var i = 0; i < items.length; i++) {
      html += '<span class="attach-chip">' + esc(items[i].name) + ' <button type="button" data-remove-idx="' + i + '" class="chip-remove">✕</button></span>';
    }
    bar.innerHTML = html;
  }

  /* ── Chat message rendering ────────────────────────────────── */
  function renderContent(text) {
    text = String(text || "");
    if (window.renderContent) return window.renderContent(text);
    return esc(text);
  }

  function updatePresetBar() {
    var bar = $("chatPresetBar");
    if (!bar) return;
    if (state.activePreset) {
      bar.style.display = "flex";
      bar.innerHTML =
        '<span class="preset-bar-label">🧠 ' + esc(state.activePreset.name) + '</span>' +
        '<button id="clearPresetBtn" class="preset-bar-clear">清除</button>';
      var clearBtn = bar.querySelector("#clearPresetBtn");
      if (clearBtn) {
        clearBtn.addEventListener("click", function () {
          state.activePreset = null;
          localStorage.removeItem("activePreset_" + state.agent);
          if (window.showToast) showToast("已清除智能体预设", "info");
          updatePresetBar();
          var pEl = document.getElementById("panel-presets");
          if (pEl) renderPresetsPanel(pEl);
        });
      }
    } else {
      bar.style.display = "none";
      bar.innerHTML = "";
    }
  }

  /* ── Bubble HTML builder (used by incremental renderChat) ──── */
  function buildBubbleHtml(idx, m) {
    var role = m.role === "user" ? "user" : "assistant";
    var label = role === "user" ? "你" : (state.agent === "hermes" ? "Hermes" : "OpenClaw");
    var content = "";
    if (typeof m.content === "string") {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = m.content.map(function(p) { return typeof p === "string" ? p : p.text || ""; }).join(" ");
    }
    var rendered = renderContent(content);
    var attHtml = "";
    if (m.attachments && m.attachments.length) {
      var names = [];
      for (var j = 0; j < m.attachments.length; j++) names.push(m.attachments[j].name);
      attHtml = '<div class="chat-attachments">附件：' + esc(names.join("、")) + "</div>";
    }
    return '<div class="chat-bubble-modern ' + role + ' fade-in">' +
      '<div class="bubble-meta"><span class="bubble-label">' + label + '</span></div>' +
      '<div class="bubble-content">' + rendered + attHtml + '</div>' +
      '<div class="bubble-actions"><button class="bubble-copy" data-copy="' + idx + '" title="复制">📋</button></div>' +
      "</div>";
  }

  function renderChat() {
    var box = $("chatMessages");
    if (!box) return;
    var chatPanel = $("panel-chat");
    if (chatPanel && !chatPanel.classList.contains("active")) return; // skip if not visible
    updatePresetBar();
    var msgs = state.messages || [];
    var prevCount = state._chatRendered || 0;

    // Full clear
    if (!msgs.length) {
      box.innerHTML = '<div class="chat-empty">没有消息。输入内容开始对话。</div>';
      state._chatRendered = 0;
      return;
    }

    // If count decreased (clear/reset), full re-render
    if (msgs.length < prevCount) {
      state._chatRendered = 0;
      prevCount = 0;
    }

    // Incremental: append new bubbles
    if (msgs.length > prevCount) {
      for (var i = prevCount; i < msgs.length; i++) {
        box.insertAdjacentHTML('beforeend', buildBubbleHtml(i, msgs[i]));
      }
      var emptyEl = box.querySelector(".chat-empty");
      if (emptyEl) emptyEl.remove();
    }

    // In-place update of last assistant content (SSE streaming)
    if (msgs.length > 0) {
      var lastMsg = msgs[msgs.length - 1];
      if (lastMsg.role === "assistant" && typeof lastMsg.content === "string" && lastMsg.content) {
        var bubbles = box.querySelectorAll(".chat-bubble-modern");
        var lastBubble = bubbles[bubbles.length - 1];
        if (lastBubble && lastBubble.classList.contains("assistant")) {
          var contentEl = lastBubble.querySelector(".bubble-content");
          if (contentEl) {
            var newHtml = renderContent(lastMsg.content);
            if (contentEl.innerHTML !== newHtml) {
              contentEl.innerHTML = newHtml;
            }
          }
        }
      }
    }

    // Loading indicator: only show when no assistant message is being streamed
    var loadingEl = document.getElementById("chat-loading-dots");
    if (state.loading) {
      var hasStreaming = msgs.length > 0 && msgs[msgs.length - 1].role === "assistant";
      if (!hasStreaming && !loadingEl) {
        var div = document.createElement("div");
        div.id = "chat-loading-dots";
        div.className = "chat-bubble-modern assistant fade-in";
        div.innerHTML = '<div class="bubble-content"><span class="thinking-dots"><span>.</span><span>.</span><span>.</span></span></div>';
        box.appendChild(div);
      } else if (hasStreaming && loadingEl) {
        loadingEl.remove();
      }
    } else {
      if (loadingEl) loadingEl.remove();
    }

    state._chatRendered = msgs.length;
    box.scrollTop = box.scrollHeight;
  }

  /* ── Send message ──────────────────────────────────────────── */
  async function sendMessage(text) {
    if (state.loading) {
      if (state.abortController) { state.abortController.abort(); state.abortController = null; }
      state.loading = false;
    }
    var attachments = state.attachments || [];
    if (!text && !attachments.length) return;

    state.attachments = [];
    renderAttachments();

    state.messages = (state.messages || []).concat([
      { role: "user", content: text || "请分析附件。", attachments: attachments.map(function (a) { return { name: a.name, kind: a.kind }; }) }
    ]);
    state.loading = true;
    state.abortController = new AbortController();
    renderChat();

    var body = { agentId: state.agent, message: text, attachments: attachments };
    if (state.activePreset && state.activePreset.systemPrompt) {
      body.systemPrompt = state.activePreset.systemPrompt;
    }
    var modelSelect = $("chatModelSelect");
    if (modelSelect && modelSelect.value) body.model = modelSelect.value;

    var streamed = false;
    try {
      var response = await fetch("/api/agent-chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: state.abortController.signal
      });
      if (response.ok && response.body) {
        streamed = true;
        state.messages = state.messages.concat([{ role: "assistant", content: "" }]);
        var msgIdx = state.messages.length - 1;
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buf = "", fullContent = "";
        while (true) {
          var result = await reader.read();
          if (result.done) break;
          buf += decoder.decode(result.value, { stream: true });
          var lines = buf.split("\n");
          buf = lines.pop() || "";
          for (var li = 0; li < lines.length; li++) {
            var l = lines[li].trim();
            if (!l.startsWith("data: ")) continue;
            var d = l.slice(6).trim();
            if (d === "[DONE]") continue;
            try {
              var p = JSON.parse(d);
              if (p.error) throw new Error(p.error);
              if (p.content) {
                fullContent += p.content;
                state.messages[msgIdx].content = fullContent;
                renderChat();
              }
            } catch (pe) { if (pe.message) throw pe; }
          }
        }
        if (!fullContent) throw new Error("模型返回内容为空。");
        if (state.rawMode) {
          state.lastRawReqRes = { req: body, res: { content: fullContent, model: body.model || "default" } };
        }
      }
    } catch (e) {
      if (e.name === "AbortError") { streamed = true; }
    }

    if (!streamed) {
      try {
        var result = await api("/api/agent-chat", { body: body });
        state.messages = state.messages.concat([
          { role: "assistant", content: result.content }
        ]);
        if (state.rawMode) {
          state.lastRawReqRes = { req: body, res: result };
        }
      } catch (e) {
        state.messages = state.messages.concat([
          { role: "assistant", content: "发送失败：" + e.message }
        ]);
      }
    }

    state.loading = false;
    state.abortController = null;
    renderChat();

    // Raw mode: show last exchange
    if (state.rawMode && state.lastRawReqRes) {
      renderRawBlock(state.lastRawReqRes.req, state.lastRawReqRes.res);
      state.lastRawReqRes = null;
    }

    var input = $("chatInput");
    if (input) { input.value = ""; input.style.height = ""; }
  }

  /* ── Load chat history ─────────────────────────────────────── */
  async function loadChat() {
    try {
      var result = await api("/simple-chat?agent=" + state.agent, { method: "GET" });
      state.messages = result.messages || [];
    } catch (e) {
      state.messages = [];
    }
    renderChat();
  }

  function clearChat() {
    if (state.abortController) { state.abortController.abort(); state.abortController = null; }
    state.loading = false;
    state.messages = [];
    state.attachments = [];
    renderChat();
    renderAttachments();
    api("/api/agent-chat", { body: { agentId: state.agent, reset: true } }).catch(function () {});
  }

  /* ── Panel data cache ──────────────────────────────────────── */
  var panelCache = {};

  async function loadPresets() {
    if (panelCache.presets) return panelCache.presets;
    try {
      var data = await api("/api/presets", { method: "GET" });
      panelCache.presets = data.presets || [];
    } catch (e) {
      panelCache.presets = [];
    }
    return panelCache.presets;
  }

  /* ── Custom Presets ────────────────────────────────────────── */
  var customPresetsCache = null;

  async function loadCustomPresetsForce() {
    customPresetsCache = null;
    return loadCustomPresets();
  }

  async function loadCustomPresets() {
    if (customPresetsCache) return customPresetsCache;
    try {
      var data = await api("/api/custom-presets", { method: "GET" });
      customPresetsCache = data.presets || [];
    } catch (e) {
      customPresetsCache = [];
    }
    return customPresetsCache;
  }

  async function saveCustomPreset(data) {
    var result = await api("/api/custom-presets", { method: "POST", body: data });
    customPresetsCache = null;
    return result;
  }

  async function deleteCustomPresetApi(id) {
    await api("/api/custom-presets/" + id, { method: "DELETE" });
    customPresetsCache = null;
  }

  function showCustomPresetDialog(editData) {
    var isEdit = !!editData;
    var overlay = document.createElement("div");
    overlay.className = "config-overlay";
    var emojis = ["🤖", "🦊", "🐱", "🐶", "🐼", "🦄", "👾", "🤠", "🧙", "🦸", "🧑‍💻", "🎨", "📊", "🔧", "🛡️", "🎯"];
    var emojiOpts = emojis.map(function (e) { return '<option value="' + e + '"' + (editData && editData.icon === e ? " selected" : "") + ">" + e + "</option>"; }).join("");

    // Build model select options from all channels
    var modelOpts = '<option value="">不指定</option>';
    for (var ci = 0; ci < state.channels.length; ci++) {
      var ch = state.channels[ci];
      var providerModels = getProviderModels(ch.providerId);
      for (var mi = 0; mi < providerModels.length; mi++) {
        var mm = providerModels[mi];
        var sel = editData && editData.modelId === mm.id ? " selected" : "";
        modelOpts += '<option value="' + esc(mm.id) + '"' + sel + ">" + esc(ch.providerName || ch.name) + " - " + esc(mm.name) + "</option>";
      }
    }

    overlay.innerHTML =
      '<div class="config-dialog">' +
      '<h3 class="config-dialog-title">' + (isEdit ? "编辑" : "创建") + ' 自定义智能体</h3>' +
      '<div class="config-dialog-body">' +
      '<label class="cfg-label">名称</label>' +
      '<input type="text" id="cp-name" class="cfg-input" value="' + esc(editData ? editData.name : "") + '" placeholder="智能体名称" spellcheck="false" />' +
      '<label class="cfg-label">图标</label>' +
      '<select id="cp-icon" class="cfg-input cfg-select">' + emojiOpts + '</select>' +
      '<label class="cfg-label">描述</label>' +
      '<input type="text" id="cp-desc" class="cfg-input" value="' + esc(editData ? editData.description : "") + '" placeholder="简短描述（可选）" spellcheck="false" />' +
      '<label class="cfg-label">系统提示词</label>' +
      '<textarea id="cp-prompt" class="cfg-input cfg-textarea" rows="6" placeholder="设定角色、行为规则、输出格式..." spellcheck="false">' + esc(editData ? editData.systemPrompt : "") + '</textarea>' +
      '<label class="cfg-label">能力标签 <span class="cfg-hint">（逗号分隔，如：code_review, debug）</span></label>' +
      '<input type="text" id="cp-skills" class="cfg-input" value="' + esc(editData && editData.skills ? editData.skills.join(", ") : "") + '" placeholder="code_review, data_analysis" spellcheck="false" />' +
      '<label class="cfg-label">关联模型 <span class="cfg-hint">（可选，选中后自动切换）</span></label>' +
      '<select id="cp-model" class="cfg-input cfg-select">' + modelOpts + '</select>' +
      '</div>' +
      '<div class="config-dialog-actions">' +
      '<button id="cp-save" class="model-btn accent">保存</button>' +
      '<button id="cp-cancel" class="model-btn">取消</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector("#cp-cancel").addEventListener("click", function () { overlay.remove(); });
    overlay.querySelector("#cp-save").addEventListener("click", async function () {
      var name = overlay.querySelector("#cp-name").value.trim();
      var prompt = overlay.querySelector("#cp-prompt").value.trim();
      if (!name) { if (window.showToast) showToast("请输入名称", "error"); return; }
      if (!prompt) { if (window.showToast) showToast("请输入系统提示词", "error"); return; }
      var skillsStr = overlay.querySelector("#cp-skills").value.trim();
      var skillsList = skillsStr ? skillsStr.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
      var payload = {
        id: editData ? editData.id : null,
        name: name,
        icon: overlay.querySelector("#cp-icon").value,
        description: overlay.querySelector("#cp-desc").value.trim(),
        systemPrompt: prompt,
        skills: skillsList,
        modelId: overlay.querySelector("#cp-model").value || null,
      };
      try {
        await saveCustomPreset(payload);
        if (window.showToast) showToast(isEdit ? "智能体已更新" : "智能体已创建", "success");
        overlay.remove();
        var el = document.getElementById("panel-presets");
        if (el) renderPresetsPanel(el);
      } catch (e) {
        if (window.showToast) showToast("保存失败：" + e.message, "error");
      }
    });
  }

  async function loadModels() {
    if (panelCache.models) return panelCache.models;
    try {
      var data = await api("/api/models/marketplace", { method: "GET" });
      panelCache.models = data.categories || [];
    } catch (e) {
      panelCache.models = [];
    }
    return panelCache.models;
  }

  /* ── Presets panel ─────────────────────────────────────────── */
  function capabilityTags(caps) {
    var map = { text: "📝文本", voice: "🗣️语音", image: "🖼️识图", multimodal: "🔄多模态", document: "📄文档" };
    return (caps || []).map(function (c) { return map[c] || c; }).join(" ");
  }

  function stars(n) {
    var s = "";
    for (var i = 0; i < 5; i++) s += i < n ? "★" : "☆";
    return s;
  }

  function renderPresetsPanel(el) {
    var presets = panelCache.presets || [];
    loadCustomPresets().then(function (customPresets) {
      var allBuiltIn = presets;
      var allCustom = customPresets || [];

      function presetCard(p, isCustom) {
        var active = state.activePreset && state.activePreset.id === p.id;
        var actions = '';
        if (isCustom) {
          actions =
            '<button class="preset-edit" data-custom-edit="' + esc(p.id) + '">&#x270F;&#xFE0F;</button>' +
            '<button class="preset-delete" data-custom-delete="' + esc(p.id) + '">&#x1F5D1;</button>';
        }
        var modelLabel = p.modelId ? modelCapabilitiesLabel(p.modelId) : '';
        return '<div class="preset-card fade-in' + (active ? ' preset-active' : '') + '">' +
          '<div class="preset-icon">' + (p.icon || "&#x1F916;") + '</div>' +
          '<div class="preset-body">' +
          '<div class="preset-name">' + esc(p.name) + modelLabel + '</div>' +
          '<div class="preset-desc">' + esc(p.description) + '</div>' +
          '<div class="preset-skills">' +
          (p.skills || []).map(function (s) { return '<span class="skill-tag">' + esc(s) + '</span>'; }).join("") +
          '</div>' +
          '<div class="preset-actions">' +
          '<button class="preset-use accent" data-preset-id="' + esc(p.id) + '">' + (active ? '使用中' : '使用') + '</button>' +
          actions +
          '</div>' +
          '</div>' +
          '</div>';
      }

      var html =
        '<div class="panel-section-head">' +
        '<h2>预置智能体</h2>' +
        '<p>选择一个智能体即注入对应角色设定与技能配置，点击即可开始对话。</p>' +
        '</div>';

      if (allBuiltIn.length) {
        html +=
          '<div class="panel-section-head" style="margin-top:0;border:none;padding:8px 16px 4px"><h3 style="font-size:13px;color:var(--muted)">内置智能体</h3></div>' +
          '<div class="preset-grid">' + allBuiltIn.map(function (p) { return presetCard(p, false); }).join("") + '</div>';
      }

      if (allCustom.length) {
        html +=
          '<div class="panel-section-head" style="margin-top:12px;border:none;padding:8px 16px 4px"><h3 style="font-size:13px;color:var(--muted)">自定义智能体</h3></div>' +
          '<div class="preset-grid">' + allCustom.map(function (p) { return presetCard(p, true); }).join("") + '</div>';
      }

      html +=
        '<div style="padding:12px 16px">' +
        '<button id="createCustomPresetBtn" class="model-btn accent">&#x2795; 创建自定义智能体</button>' +
        '</div>';

      el.innerHTML = html;

      // Wire built-in and custom preset use
      el.querySelectorAll(".preset-use").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.dataset.presetId;
          var p = allBuiltIn.find(function (x) { return x.id === id; }) || allCustom.find(function (x) { return x.id === id; });
          if (!p) return;
          state.activePreset = p;
          localStorage.setItem("activePreset_" + state.agent, p.id);
          if (p.modelId) {
            state.chatModel = p.modelId;
            var modelSelect = $("chatModelSelect");
            if (modelSelect) modelSelect.value = p.modelId;
          }
          if (window.showToast) showToast("已启用智能体：「" + p.name + "」", "success");
          renderPresetsPanel(el);
        });
      });

      // Wire custom preset edit
      el.querySelectorAll(".preset-edit").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.dataset.customEdit;
          var p = allCustom.find(function (x) { return x.id === id; });
          if (p) showCustomPresetDialog(p);
        });
      });

      // Wire custom preset delete
      el.querySelectorAll(".preset-delete").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          var id = btn.dataset.customDelete;
          if (!confirm("确认删除此自定义智能体？")) return;
          try {
            await deleteCustomPresetApi(id);
            if (window.showToast) showToast("已删除", "info");
            renderPresetsPanel(el);
          } catch (e) {
            if (window.showToast) showToast("删除失败：" + e.message, "error");
          }
        });
      });

      // Wire create button
      var createBtn = el.querySelector("#createCustomPresetBtn");
      if (createBtn) {
        createBtn.addEventListener("click", function () {
          showCustomPresetDialog(null);
        });
      }
    });
  }

  /* ── Models panel ──────────────────────────────────────────── */
  function isModelConfigured(modelMarketEntry) {
    if (!state.config || !state.config.agentModels) return false;
    var agentModel = state.config.agentModels[state.agent];
    if (!agentModel || !agentModel.apiKey) return false;
    return agentModel.providerId === modelMarketEntry.providerId;
  }

  function findModelById(mid) {
    var cats = panelCache.models || [];
    for (var ci = 0; ci < cats.length; ci++) {
      var models = cats[ci].models || [];
      for (var mi = 0; mi < models.length; mi++) {
        if (models[mi].id === mid) return models[mi];
      }
    }
    return null;
  }

  function showModelConfigDialog(m) {
    var providerId = m.providerId || "";
    var providerName = m.provider || "";
    // Find the provider in providers.json
    var provider = state.providers.find(function (p) { return p.id === providerId; });
    if (!provider) {
      // Try matching by name
      provider = state.providers.find(function (p) { return p.name === providerName; });
    }
    if (!provider) {
      if (window.showToast) showToast("未找到服务商信息", "error");
      return;
    }

    // Check if a channel for this provider already exists
    var existingChannel = state.channels.find(function (ch) { return ch.providerId === provider.id; });
    var existingApiKey = existingChannel ? existingChannel.apiKey || "" : "";
    var existingBaseUrl = existingChannel ? existingChannel.baseUrl || provider.baseUrl || "" : provider.baseUrl || "";
    var selectedModels = existingChannel && existingChannel.models ? existingChannel.models : (provider.models || []).map(function (mm) { return mm.id; });

    var availableModels = provider.models || [];
    var modelsHtml = "";
    for (var mi = 0; mi < availableModels.length; mi++) {
      var mm = availableModels[mi];
      var caps = mm.capabilities ? mm.capabilities.join("+") : "text";
      var checked = selectedModels.indexOf(mm.id) >= 0 ? " checked" : "";
      modelsHtml +=
        '<label class="cfg-model-checkbox">' +
        '<input type="checkbox" value="' + esc(mm.id) + '"' + checked + ' /> ' +
        '<span>' + esc(mm.name) + '</span>' +
        '<span class="cfg-model-caps">' + esc(caps) + '</span>' +
        '</label>';
    }

    var overlay = document.createElement("div");
    overlay.className = "config-overlay";
    overlay.innerHTML =
      '<div class="config-dialog">' +
      '<h3 class="config-dialog-title">配置 ' + esc(providerName) + '</h3>' +
      '<div class="config-dialog-body">' +
      '<div class="cfg-provider-name">服务商：' + esc(providerName) + (existingChannel ? ' <span class="cfg-badge configured">已配置</span>' : '') + '</div>' +
      '<label class="cfg-label">API Key <button class="toggle-key-btn" data-target="cfg-apikey">显示</button></label>' +
      '<input type="password" id="cfg-apikey" class="cfg-input" value="' + esc(existingApiKey) + '" placeholder="sk-..." spellcheck="false" />' +
      '<label class="cfg-label">Base URL <span class="cfg-hint">（API 地址，可修改）</span></label>' +
      '<input type="text" id="cfg-baseurl" class="cfg-input" value="' + esc(existingBaseUrl) + '" spellcheck="false" />' +
      '<label class="cfg-label">可用模型 <span class="cfg-hint">（勾选后在对话框可选择）</span></label>' +
      '<div class="cfg-models-list">' + modelsHtml + '</div>' +
      '</div>' +
      '<div class="config-dialog-actions">' +
      '<button id="cfg-test" class="model-btn">测试连接</button>' +
      '<button id="cfg-save" class="model-btn accent">保存</button>' +
      '<button id="cfg-cancel" class="model-btn">取消</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    var apiKeyInput = overlay.querySelector("#cfg-apikey");
    var baseUrlInput = overlay.querySelector("#cfg-baseurl");

    function getSelectedModels() {
      var checks = overlay.querySelectorAll(".cfg-models-list input[type=checkbox]:checked");
      var ids = [];
      for (var ci = 0; ci < checks.length; ci++) ids.push(checks[ci].value);
      return ids;
    }

    function getDialogPayload() {
      return {
        scope: "shared",
        providerId: provider.id,
        providerName: providerName,
        apiKey: apiKeyInput.value.trim(),
        baseUrl: baseUrlInput.value.trim() || provider.baseUrl || "",
        model: getSelectedModels()[0] || "",
        models: getSelectedModels(),
        protocol: provider.protocol || "openai-compatible"
      };
    }

    // Show/hide key toggle
    var toggleBtn = overlay.querySelector(".toggle-key-btn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        var isPassword = apiKeyInput.type === "password";
        apiKeyInput.type = isPassword ? "text" : "password";
        toggleBtn.textContent = isPassword ? "隐藏" : "显示";
      });
    }

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) overlay.remove();
    });

    overlay.querySelector("#cfg-cancel").addEventListener("click", function () {
      overlay.remove();
    });

    // Test connection
    overlay.querySelector("#cfg-test").addEventListener("click", async function () {
      var payload = getDialogPayload();
      if (!payload.apiKey || !payload.baseUrl || !payload.model) {
        if (window.showToast) showToast("请先填写 API Key 和 Base URL，并至少勾选一个模型", "error");
        return;
      }
      var btn = overlay.querySelector("#cfg-test");
      btn.textContent = "测试中...";
      btn.disabled = true;
      try {
        var result = await api("/api/test-provider", { body: payload });
        if (window.showToast) showToast(result.ok ? "✅ 连接成功" : "❌ " + result.message, result.ok ? "success" : "error");
      } catch (e) {
        if (window.showToast) showToast("测试失败：" + e.message, "error");
      } finally {
        btn.textContent = "测试连接";
        btn.disabled = false;
      }
    });

    overlay.querySelector("#cfg-save").addEventListener("click", async function () {
      var btn = overlay.querySelector("#cfg-save");
      var apiKey = apiKeyInput.value.trim();
      if (!apiKey) {
        if (window.showToast) showToast("请输入 API Key", "error");
        return;
      }
      if (btn.disabled) return;
      btn.disabled = true;
      btn.textContent = "保存中...";

      try {
        var payload = getDialogPayload();
        var channelId = existingChannel ? existingChannel.id : null;

        if (channelId) {
          // Update existing channel in-place
          await api("/api/channels/" + channelId, { method: "PUT", body: payload });
          var channelResult = { id: channelId };
        } else {
          // Create new channel
          var channelResult = await api("/api/channels", {
            body: {
              name: providerName + " 通道",
              providerId: payload.providerId,
              providerName: payload.providerName,
              apiKey: payload.apiKey,
              baseUrl: payload.baseUrl,
              model: payload.model,
              models: payload.models,
              protocol: payload.protocol,
            }
          });
        }

        // Switch the current agent to this channel
        await api("/api/config", { body: { scope: state.agent, channelId: channelResult.id } });
        if (window.showToast) showToast("配置已保存并分配给 " + (state.agent === "hermes" ? "Hermes" : "OpenClaw"), "success");
        overlay.remove();
        refreshStatus().then(function () {
          var modelsEl = $("panel-models");
          if (modelsEl) renderModelsPanel(modelsEl);
          populateWorkModelSelect();
          populateSimpleModelSelect("openclaw");
          populateSimpleModelSelect("hermes");
        });
      } catch (e) {
        if (window.showToast) showToast("保存失败：" + e.message, "error");
      } finally {
        btn.disabled = false;
        btn.textContent = "保存配置";
      }
    });
  }

  function renderModelsPanel(el) {
    var categories = panelCache.models || [];
    if (!categories.length) {
      el.innerHTML = '<div class="panel-placeholder">暂无可用的模型数据。</div>';
      return;
    }
    loadChannelsFromConfig();
    var html =
      '<div class="panel-section-head">' +
      '<h2>API 配置 · 模型市场</h2>' +
      '<p>管理 API 通道，每个 Agent 可选择不同通道。模型市场提供参考信息。</p>' +
      '</div>';

    // ── Agent channel selectors ──
    html += '<div class="channels-section">';
    html += '<h3 style="margin:0 0 8px;font-size:14px">通道选择</h3>';
    for (var ai = 0; ai < AGENT_LIST.length; ai++) {
      var aid = AGENT_LIST[ai];
      var aName = aid === "hermes" ? "Hermes" : "OpenClaw";
      var currentChannelId = state.agentChannels[aid] || "";
      html +=
        '<div class="channel-agent-row">' +
        '<span class="channel-agent-label">' + aName + '</span>' +
        renderChannelSelect("chan-select-" + aid, currentChannelId) +
        '</div>';
    }
    html += '</div>';

    // ── Channel management ──
    html += '<div class="channels-section">';
    html += '<h3 style="margin:0 0 8px;font-size:14px">通道管理</h3>';
    html += '<button id="createChannelBtn" class="model-btn accent" style="margin-bottom:8px">+ 创建通道</button>';
    if (state.channels.length) {
      html += '<div class="channel-list">';
      for (var ci = 0; ci < state.channels.length; ci++) {
        var ch = state.channels[ci];
        var usedBy = [];
        for (var aii = 0; aii < AGENT_LIST.length; aii++) {
          if (state.agentChannels[AGENT_LIST[aii]] === ch.id) usedBy.push(AGENT_LIST[aii] === "hermes" ? "Hermes" : "OpenClaw");
        }
        html +=
          '<div class="channel-card">' +
          '<div class="channel-card-name">' + esc(ch.name) + '</div>' +
          '<div class="channel-card-detail">' + esc(ch.providerName || ch.providerId || "-") + ' · ' + esc(ch.model || "-") + '</div>' +
          '<div class="channel-card-detail" style="font-size:11px;color:var(--muted)">' + esc(ch.baseUrl || "") + '</div>' +
          (usedBy.length ? '<div class="channel-card-usedby">使用于：' + usedBy.join("、") + '</div>' : '') +
          '<button class="channel-del-btn" data-channel-id="' + esc(ch.id) + '">删除</button>' +
          '</div>';
      }
      html += '</div>';
    } else {
      html += '<div class="muted" style="font-size:13px;padding:4px 0">暂无通道。点击"创建通道"添加 API 配置。</div>';
    }
    html += '</div>';

    // ── Current config (legacy fallback) ──
    var agentName = state.agent === "hermes" ? "Hermes" : "OpenClaw";
    var agentModel = state.config && state.config.agentModels && state.config.agentModels[state.agent];
    var hasConfig = agentModel && agentModel.apiKey && agentModel.apiKey !== "";
    html += '<div class="panel-body">';
    html += '<div class="current-config-bar">' +
      '当前 ' + agentName + ' 模型：<strong>' + (agentModel && agentModel.providerName ? esc(agentModel.providerName) : "未配置") + ' / ' + (agentModel && agentModel.model ? esc(agentModel.model) : "-") + '</strong>' +
      ' <span class="cfg-badge ' + (hasConfig ? "configured" : "unconfigured") + '">' + (hasConfig ? "已配置" : "未配置") + '</span>';
    if (hasConfig) {
      html += ' <button class="cfg-del-btn" data-action="clear-key">删除 Key</button>';
    }
    html += '</div></div>';

    // ── Model Market ──
    for (var ci = 0; ci < categories.length; ci++) {
      var cat = categories[ci];
      var vpnNote = cat.vpnNotice ? '<div class="vpn-notice">🌐 ' + esc(cat.vpnNotice) + '</div>' : "";
      html +=
        '<div class="model-category">' +
        '<h3 class="category-title">' + esc(cat.name) + '</h3>' +
        vpnNote +
        '<div class="model-grid">';

      var models = cat.models || [];
      for (var mi = 0; mi < models.length; mi++) {
        var m = models[mi];
        var configured = isModelConfigured(m);
        html +=
          '<div class="model-card fade-in' + (configured ? ' configured' : '') + '">' +
          '<div class="model-card-head">' +
          '<div class="model-name">' + esc(m.name) + '</div>' +
          '<div class="model-provider">' + esc(m.provider) + '</div>' +
          '</div>' +
          '<div class="model-tags">' + capabilityTags(m.capabilities) + '</div>' +
          '<div class="model-card-status">' +
          '<span class="cfg-badge ' + (configured ? "configured" : "unconfigured") + '">' + (configured ? "已配置" : "未配置") + '</span>' +
          '</div>' +
          '<div class="model-pricing">' + esc(m.pricing) + '</div>' +
          '<div class="model-value">性价比：' + stars(m.valueRating || 0) + '</div>' +
          '<div class="model-desc">' + esc(m.description) + '</div>' +
          '<div class="model-actions">' +
          '<a href="' + esc(m.registerUrl || "#") + '" target="_blank" class="model-btn" rel="noopener">注册</a>' +
          '<button class="model-btn cfg-btn" data-action="configure-model" data-mid="' + esc(m.id) + '">配置</button>' +
          '<a href="' + esc(m.topUpUrl || "#") + '" target="_blank" class="model-btn accent" rel="noopener">充值</a>' +
          '</div>' +
          '</div>';
      }
      html += "</div></div>";
    }
    el.innerHTML = html;

    // Wire channel selectors
    for (var ai = 0; ai < AGENT_LIST.length; ai++) {
      (function (agentId) {
        var sel = document.getElementById("chan-select-" + agentId);
        if (!sel) return;
        sel.addEventListener("change", function () {
          saveAgentChannel(agentId, sel.value || null);
        });
      })(AGENT_LIST[ai]);
    }

    // Wire create channel button
    var createBtn = el.querySelector("#createChannelBtn");
    if (createBtn) {
      createBtn.addEventListener("click", function () {
        showCreateChannelDialog();
      });
    }

    // Wire delete channel buttons
    var delBtns = el.querySelectorAll(".channel-del-btn");
    for (var dbi = 0; dbi < delBtns.length; dbi++) {
      (function (btn) {
        btn.addEventListener("click", async function () {
          var channelId = btn.dataset.channelId;
          if (!channelId) return;
          if (!confirm("确认删除此通道？")) return;
          try {
            await api("/api/channels/" + channelId, { method: "DELETE" });
            if (window.showToast) showToast("通道已删除", "success");
            await refreshStatus();
            loadChannelsFromConfig();
            renderModelsPanel(el);
          } catch (e) {
            if (window.showToast) showToast("删除失败：" + e.message, "error");
          }
        });
      })(delBtns[dbi]);
    }

    // Wire clear-key button
    var clearBtn = el.querySelector('[data-action="clear-key"]');
    if (clearBtn) {
      clearBtn.addEventListener("click", async function () {
        if (!confirm("确认清除 " + agentName + " 的 API Key 和模型配置？")) return;
        try {
          await api("/api/config/clear-key", { body: { scope: state.agent } });
          if (window.showToast) showToast("Key 已清除", "success");
          refreshStatus().then(function () { renderModelsPanel(el); });
        } catch (e) {
          if (window.showToast) showToast("清除失败：" + e.message, "error");
        }
      });
    }

    // Wire configure-model buttons
    var cfgBtns = el.querySelectorAll('[data-action="configure-model"]');
    for (var ci = 0; ci < cfgBtns.length; ci++) {
      (function (btn) {
        btn.addEventListener("click", function () {
          var mid = btn.dataset.mid;
          var m = findModelById(mid);
          if (m) showModelConfigDialog(m);
        });
      })(cfgBtns[ci]);
    }
  }

  /* ── Permissions panel ─────────────────────────────────────── */
  function renderPermissionsPanel(el) {
    var mode = state.config && state.config.permissions && state.config.permissions.mode
      ? state.config.permissions.mode : "safe";
    el.innerHTML =
      '<div class="panel-section-head">' +
      '<h2>🔒 权限范围</h2>' +
      '<p>默认限制在工作区，需要更多能力时再开启。</p>' +
      '</div>' +
      '<div class="panel-body">' +
      '<div class="mode-grid">' +
      '<label class="mode-card" data-mode="safe">' +
      '<input type="radio" name="permMode" value="safe"' + (mode === "safe" ? " checked" : "") + ' />' +
      '<span>安全模式</span>' +
      '<small>只访问工作区、配置、记忆和日志。</small>' +
      '</label>' +
      '<label class="mode-card" data-mode="workspace">' +
      '<input type="radio" name="permMode" value="workspace"' + (mode === "workspace" ? " checked" : "") + ' />' +
      '<span>工作区模式</span>' +
      '<small>允许访问用户额外指定的本地文件夹。</small>' +
      '</label>' +
      '<label class="mode-card" data-mode="advanced">' +
      '<input type="radio" name="permMode" value="advanced"' + (mode === "advanced" ? " checked" : "") + ' />' +
      '<span>高级模式</span>' +
      '<small>允许命令执行、浏览器自动化和 MCP 工具，高风险操作前提示。</small>' +
      '</label>' +
      '</div>' +
      '<div class="button-row"><button id="permSaveBtn" class="accent">保存权限设置</button></div>' +
      '<p id="permResult" class="result"></p>' +
      '</div>';
    // Wire save button
    var saveBtn = el.querySelector("#permSaveBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async function () {
        var checked = el.querySelector('input[name="permMode"]:checked');
        if (!checked) return;
        var modeVal = checked.value;
        try {
          await api("/api/config", { body: { permissions: { mode: modeVal } } });
          var res = el.querySelector("#permResult");
          if (res) res.textContent = "权限设置已保存。";
          if (window.showToast) showToast("权限已保存", "success");
          refreshStatus();
        } catch (e) {
          var res = el.querySelector("#permResult");
          if (res) res.textContent = "保存失败：" + e.message;
        }
      });
    }
  }

  /* ── Diagnostics panel ─────────────────────────────────────── */
  function renderDiagnosticsPanel(el) {
    el.innerHTML =
      '<div class="panel-section-head">' +
      '<h2>🔍 诊断中心</h2>' +
      '<p>用于检查端口占用、缺少运行时、Agent 安装状态等。</p>' +
      '</div>' +
      '<div class="panel-body">' +
      '<div class="button-row"><button id="diagRunBtn" class="accent">一键检测</button></div>' +
      '<pre id="diagResult" class="diagnostics">尚未检测。</pre>' +
      '</div>';
    var runBtn = el.querySelector("#diagRunBtn");
    if (runBtn) {
      runBtn.addEventListener("click", async function () {
        var pre = el.querySelector("#diagResult");
        if (pre) pre.textContent = "正在检测...";
        try {
          var result = await api("/api/diagnostics", { method: "GET" });
          if (pre) pre.textContent = JSON.stringify(result, null, 2);
        } catch (e) {
          if (pre) pre.textContent = "检测失败：" + e.message;
        }
      });
    }
  }

  /* ── Maintenance panel ─────────────────────────────────────── */
  function renderMaintenancePanel(el) {
    el.innerHTML =
      '<div class="panel-section-head">' +
      '<h2>🛠 维护</h2>' +
      '<p>备份用户数据，清理缓存。不会删除 Agent 程序和运行时。</p>' +
      '</div>' +
      '<div class="panel-body">' +
      '<div class="button-row">' +
      '<button id="maintBackupBtn" class="accent">备份配置和数据</button>' +
      '<button id="maintRestoreBtn">一键还原</button>' +
      '<button id="maintCleanBtn">清理缓存</button>' +
      '</div>' +
      '<div class="notice update-note">' +
      '<strong>备份逻辑</strong>' +
      '<p>每次新备份成功后，只保留最新一份备份，旧备份自动删除。一键还原使用最新备份恢复全部配置和数据。</p>' +
      '</div>' +
      '<p id="maintResult" class="result"></p>' +
      '</div>';

    var backupBtn = el.querySelector("#maintBackupBtn");
    var restoreBtn = el.querySelector("#maintRestoreBtn");
    var cleanBtn = el.querySelector("#maintCleanBtn");
    var resEl = el.querySelector("#maintResult");

    function setRes(msg) { if (resEl) resEl.textContent = msg; }

    if (backupBtn) {
      backupBtn.addEventListener("click", async function () {
        setRes("正在备份...");
        try {
          var result = await api("/api/backup", { method: "POST" });
          setRes("备份完成：" + result.backupPath);
          if (window.showToast) showToast("备份完成", "success");
        } catch (e) {
          setRes("备份失败：" + e.message);
          if (window.showToast) showToast("备份失败：" + e.message, "error");
        }
      });
    }

    if (restoreBtn) {
      restoreBtn.addEventListener("click", async function () {
        if (!confirm("确认使用最新备份还原？还原会先停止两个 Agent，并恢复配置、数据、Agent 和启动器。")) return;
        setRes("正在还原，请不要中断...");
        try {
          var result = await api("/api/restore", { method: "POST" });
          setRes(result.message);
          if (window.showToast) showToast("还原完成", "success");
        } catch (e) {
          setRes("还原失败：" + e.message);
          if (window.showToast) showToast("还原失败：" + e.message, "error");
        }
      });
    }

    if (cleanBtn) {
      cleanBtn.addEventListener("click", async function () {
        if (!confirm("确认清理 Agent 的缓存？用户配置和记忆不会删除。")) return;
        setRes("正在清理...");
        try {
          await api("/api/clean-cache", { method: "POST" });
          setRes("缓存已清理。");
          if (window.showToast) showToast("缓存已清理", "success");
        } catch (e) {
          setRes("清理失败：" + e.message);
        }
      });
    }
  }

  /* ── History panel ──────────────────────────────────────────── */
  async function loadSessions() {
    try {
      var data = await api("/api/chat-sessions?agent=" + state.agent, { method: "GET" });
      return data.sessions || [];
    } catch (e) { return []; }
  }

  async function loadSession(sessionId) {
    return await api("/api/chat-sessions/" + sessionId + "?agent=" + state.agent, { method: "GET" });
  }

  async function deleteSession(sessionId) {
    await api("/api/chat-sessions/" + sessionId + "?agent=" + state.agent, { method: "DELETE" });
  }

  function renderHistoryPanel(el) {
    el.innerHTML = '<div class="panel-placeholder">加载历史会话...</div>';
    loadSessions().then(function (sessions) {
      if (!sessions.length) {
        el.innerHTML = '<div class="panel-section-head"><h2>📋 历史会话</h2><p>暂无历史会话。清空对话时会自动保存当前会话到历史列表。</p></div><div class="panel-placeholder">暂无历史会话</div>';
        return;
      }
      var html =
        '<div class="panel-section-head">' +
        '<h2>📋 历史会话</h2>' +
        '<p>共 ' + sessions.length + ' 条历史记录。点击加载历史对话，清空对话时自动保存。</p>' +
        '</div>' +
        '<div class="history-list">';
      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        var date = new Date(parseInt(s.timestamp, 10));
        var dateStr = date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
        html +=
          '<div class="history-item fade-in" data-sid="' + esc(s.id) + '">' +
          '<div class="history-item-head">' +
          '<span class="history-date">' + esc(dateStr) + '</span>' +
          '<span class="history-count">' + s.count + ' 条消息</span>' +
          '</div>' +
          '<div class="history-preview">' + esc(s.preview || "(无文本)") + '</div>' +
          '<div class="history-actions">' +
          '<button class="history-load accent" data-sid="' + esc(s.id) + '">加载</button>' +
          '<button class="history-del" data-sid="' + esc(s.id) + '">删除</button>' +
          '</div>' +
          '</div>';
      }
      html += '</div>';
      el.innerHTML = html;

      el.querySelectorAll(".history-load").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var sid = btn.dataset.sid;
          loadSession(sid).then(function (data) {
            state.messages = data.messages || [];
            renderChat();
            // Switch to chat panel
            var chatLink = document.querySelector('[data-panel="chat"]');
            if (chatLink) chatLink.click();
            if (window.showToast) showToast("已加载历史会话", "info");
          }).catch(function (e) {
            if (window.showToast) showToast("加载失败：" + e.message, "error");
          });
        });
      });

      el.querySelectorAll(".history-del").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var sid = btn.dataset.sid;
          if (!confirm("确认删除此历史会话？")) return;
          deleteSession(sid).then(function () {
            renderHistoryPanel(el);
            if (window.showToast) showToast("已删除", "info");
          }).catch(function (e) {
            if (window.showToast) showToast("删除失败：" + e.message, "error");
          });
        });
      });
    });
  }

  /* ── Skill Market ──────────────────────────────────────────── */
  function renderSkillsPanel(el) {
    var activeTab = "market";
    var cache = { market: null, local: null };
    var searchQuery = "";
    function switchTab(tab) {
      activeTab = tab;
      render();
    }
    function render() {
      var html = '<div class="skills-header">' +
        '<button class="skills-tab' + (activeTab === "market" ? " active" : "") + '" onclick="renderSkillsTab(\'market\')">📦 在线市场</button>' +
        '<button class="skills-tab' + (activeTab === "local" ? " active" : "") + '" onclick="renderSkillsTab(\'local\')">📋 已安装</button>' +
        '</div>' +
        '<div class="skills-search"><input type="text" id="skillsSearchInput" class="skills-search-input" placeholder="🔍 搜索技能名称、描述..." value="' + esc(searchQuery) + '" oninput="window.skillsSearchInputChanged &amp;&amp; skillsSearchInputChanged()"></div>' +
        '<div id="skillsBody">';
      if (activeTab === "market") {
        html += '<div class="skill-empty">加载中...</div>';
      } else {
        html += '<div class="skill-empty">加载中...</div>';
      }
      el.innerHTML = html + '</div>';
      var input = document.getElementById("skillsSearchInput");
      if (input) {
        (function(inp) {
          inp.addEventListener("input", function() {
            searchQuery = inp.value;
            if (activeTab === "market") renderMarket();
            else renderLocal();
          });
        })(input);
      }
      if (activeTab === "market") loadMarket();
      else loadLocal();
    }
    window.renderSkillsTab = function(tab) { switchTab(tab); };
    function matchesSearch(skill) {
      if (!searchQuery) return true;
      var q = searchQuery.toLowerCase();
      var fields = (skill.displayName || skill.name || "") + " " +
        (skill.description || "") + " " +
        (skill.descriptionCn || "") + " " +
        (skill.id || "") + " " +
        (skill.author && skill.author.name || "");
      return fields.toLowerCase().indexOf(q) !== -1;
    }
    function loadMarket() {
      api("/api/skills/market", { method: "GET" }).then(function(data) {
        cache.market = data;
        renderMarket();
      }).catch(function(e) {
        var body = document.getElementById("skillsBody");
        if (body) body.innerHTML = '<div class="skill-empty">❌ 加载失败: ' + e.message + '</div>';
      });
    }
    function renderMarket() {
      var body = document.getElementById("skillsBody");
      if (!body) return;
      var data = cache.market;
      if (!data || !data.skills || !data.skills.length) {
        body.innerHTML = '<div class="skill-empty">暂无可用技能。</div>';
        return;
      }
      var filtered = data.skills.filter(matchesSearch);
      if (!filtered.length) {
        body.innerHTML = '<div class="skill-empty">没有匹配的技能。</div>';
        return;
      }
      var html = '<div class="skills-grid">';
      for (var i = 0; i < filtered.length; i++) {
        var s = filtered[i];
        var descHtml = s.descriptionCn && s.descriptionCn !== s.description
          ? '<div class="skill-card-desc" title="' + esc(s.description || "") + '">' + esc(s.descriptionCn) + '<br><span class="skill-desc-orig">' + esc(s.description || "") + '</span></div>'
          : '<div class="skill-card-desc" title="' + esc(s.description || "") + '">' + esc(s.description || "") + '</div>';
        html += '<div class="skill-card">' +
          '<div class="skill-card-head">' +
          '<div class="skill-card-icon">🧩</div>' +
          '<div class="skill-card-info">' +
          '<div class="skill-card-name">' + esc(s.displayName || s.name) + '</div>' +
          '<div class="skill-card-meta"><span>v' + (s.version || "1.0") + '</span><span>' + esc(s.author && s.author.name ? s.author.name : "") + '</span></div>' +
          '</div></div>' +
          descHtml +
          '<div class="skill-card-actions">' +
          '<button class="skill-btn primary" onclick="installSkill(\'' + esc(s.id) + '\',\'' + esc(s.installUrl || "") + '\',\'' + esc(s.displayName || s.name) + '\',\'' + esc(s.description || "") + '\',\'' + esc(s.version || "1.0") + '\')">📥 安装</button>' +
          '</div></div>';
      }
      html += '</div>';
      body.innerHTML = html;
    }
    function loadLocal() {
      api("/api/skills/local", { method: "GET" }).then(function(data) {
        cache.local = data;
        renderLocal();
      }).catch(function(e) {
        var body = document.getElementById("skillsBody");
        if (body) body.innerHTML = '<div class="skill-empty">❌ 加载失败: ' + e.message + '</div>';
      });
    }
    function renderLocal() {
      var body = document.getElementById("skillsBody");
      if (!body) return;
      var data = cache.local;
      if (!data || !data.skills || !data.skills.length) {
        body.innerHTML = '<div class="skill-empty">尚未安装任何技能。</div>';
        return;
      }
      var filtered = data.skills.filter(matchesSearch);
      if (!filtered.length) {
        body.innerHTML = '<div class="skill-empty">没有匹配的技能。</div>';
        return;
      }
      var html = '<div class="skills-grid">';
      for (var i = 0; i < filtered.length; i++) {
        var s = filtered[i];
        var badge = s.disabled ? '<span class="skill-badge disabled">已禁用</span>' : (s.builtIn ? '<span class="skill-badge installed">内置</span>' : '<span class="skill-badge installed">已安装</span>');
        var actions = '';
        if (s.builtIn) {
          actions = '<button class="skill-btn ' + (s.disabled ? 'primary' : '') + '" onclick="toggleSkill(\'' + esc(s.id) + '\')">' + (s.disabled ? '启用' : '禁用') + '</button>';
        } else {
          actions = '<button class="skill-btn ' + (s.disabled ? 'primary' : '') + '" onclick="toggleSkill(\'' + esc(s.id) + '\')">' + (s.disabled ? '启用' : '禁用') + '</button>' +
            '<button class="skill-btn danger" onclick="deleteSkillConfirm(\'' + esc(s.id) + '\')">删除</button>';
        }
        html += '<div class="skill-card">' +
          '<div class="skill-card-head">' +
          '<div class="skill-card-icon">🧩</div>' +
          '<div class="skill-card-info">' +
          '<div class="skill-card-name">' + esc(s.name) + ' ' + badge + '</div>' +
          '<div class="skill-card-meta"><span>v' + (s.version || "1.0") + '</span><span>' + esc(s.author || "") + '</span></div>' +
          '</div></div>' +
          '<div class="skill-card-desc">' + esc(s.description || "") + '</div>' +
          '<div class="skill-card-actions">' + actions + '</div></div>';
      }
      html += '</div>';
      body.innerHTML = html;
    }
    window.installSkill = function(skillId, installUrl, displayName, description, version) {
      api("/api/skills/install", { method: "POST", body: JSON.stringify({ skillId: skillId, installUrl: installUrl, displayName: displayName, description: description, version: version }) }).then(function(data) {
        if (data.ok) {
          if (window.showToast) showToast("技能已安装", "success");
          loadLocal();
        } else {
          if (window.showToast) showToast("安装失败: " + (data.error || "未知错误"), "error");
        }
      }).catch(function(e) {
        if (window.showToast) showToast("安装失败: " + e.message, "error");
      });
    };
    window.toggleSkill = function(skillId) {
      api("/api/skills/" + skillId + "/toggle", { method: "POST" }).then(function(data) {
        if (data.ok) {
          if (window.showToast) showToast(data.disabled ? "已禁用" : "已启用", "info");
          loadLocal();
        }
      }).catch(function(e) {
        if (window.showToast) showToast("操作失败: " + e.message, "error");
      });
    };
    window.deleteSkillConfirm = function(skillId) {
      if (!confirm("确定删除此技能？")) return;
      api("/api/skills/" + skillId + "/delete", { method: "POST" }).then(function(data) {
        if (data.ok) {
          if (window.showToast) showToast("技能已删除", "info");
          loadLocal();
        }
      }).catch(function(e) {
        if (window.showToast) showToast("删除失败: " + e.message, "error");
      });
    };
    render();
  }

  /* ── Panel switching ───────────────────────────────────────── */
  window.onPanelSwitch = function (panelId) {
    var el = document.getElementById("panel-" + panelId);
    if (!el) return;
    if (panelId === "chat") { renderChat(); return; }
    if (panelId === "presets") {
      el.innerHTML = '<div class="panel-placeholder">加载预置智能体...</div>';
      Promise.all([loadPresets(), loadCustomPresets()]).then(function () { renderPresetsPanel(el); });
      return;
    }
    if (panelId === "models") {
      el.innerHTML = '<div class="panel-placeholder">加载模型市场...</div>';
      if (!state.config) {
        refreshStatus().then(function () {
          loadChannelsFromConfig();
          return loadModels();
        }).then(function () { renderModelsPanel(el); });
      } else {
        loadChannelsFromConfig();
        loadModels().then(function () { renderModelsPanel(el); });
      }
      return;
    }
    if (panelId === "permissions") {
      el.innerHTML = '<div class="panel-placeholder">加载权限设置...</div>';
      if (!state.config) { refreshStatus().then(function () { renderPermissionsPanel(el); }); }
      else { renderPermissionsPanel(el); }
      return;
    }
    if (panelId === "diagnostics") { renderDiagnosticsPanel(el); return; }
    if (panelId === "maintenance") { renderMaintenancePanel(el); return; }
    if (panelId === "history") { renderHistoryPanel(el); return; }
    if (panelId === "skills") {
      el.innerHTML = '<div class="panel-placeholder">加载技能市场...</div>';
      renderSkillsPanel(el);
      return;
    }
    if (panelId === "files") {
      el.innerHTML = '<div class="panel-placeholder">📁 加载文件列表...</div>';
      renderFilesPanel(el);
      return;
    }
    if (panelId === "logs") {
      el.innerHTML = '<div class="panel-placeholder">📜 加载日志...</div>';
      renderLogsPanel(el);
      return;
    }
    if (panelId === "explorer") {
      el.innerHTML = '<div class="panel-placeholder">🔌 加载 API 探索...</div>';
      renderExplorerPanel(el);
      return;
    }
    el.innerHTML = '<div class="panel-placeholder"></div>';
  };

  /* ── Pro: File Browser ─────────────────────────────────────── */
  async function fetchFileList(agentId, dirPath) {
    return api("/api/agent/" + agentId + "/files?path=" + encodeURIComponent(dirPath || ""), { method: "GET" });
  }

  async function fetchFileContent(agentId, filePath) {
    return api("/api/agent/" + agentId + "/files/read?path=" + encodeURIComponent(filePath), { method: "GET" });
  }

  function renderFilesPanel(el) {
    var aid = state.agent;
    var currentPath = state.fileCurrentPath[aid] || "";
    var cacheKey = aid + ":" + currentPath;
    el.innerHTML =
      '<div class="pro-panel">' +
        '<div class="pro-panel-head">' +
          '<h2>📁 文件管理器 <span class="pro-agent-badge">' + aid + '</span></h2>' +
          '<div class="pro-panel-actions">' +
            '<button class="pro-btn" id="fileRefreshBtn" title="刷新">⟳</button>' +
          '</div>' +
        '</div>' +
        '<div class="file-breadcrumb" id="fileBreadcrumb"></div>' +
        '<div class="file-grid" id="fileGrid">' +
          '<div class="panel-placeholder">加载中...</div>' +
        '</div>' +
      '</div>';

    loadFileList(aid, currentPath);

    var refreshBtn = el.querySelector("#fileRefreshBtn");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function () {
        loadFileList(aid, state.fileCurrentPath[aid] || "");
      });
    }

    // Breadcrumb click delegation
    var crumb = el.querySelector("#fileBreadcrumb");
    if (crumb) {
      crumb.addEventListener("click", function (e) {
        var item = e.target.closest("[data-path]");
        if (item) loadFileList(aid, item.dataset.path);
      });
    }

    // File grid click delegation
    var grid = el.querySelector("#fileGrid");
    if (grid) {
      grid.addEventListener("click", function (e) {
        var item = e.target.closest("[data-file-path]");
        if (!item) return;
        var fpath = item.dataset.filePath;
        var ftype = item.dataset.fileType;
        if (ftype === "dir") {
          loadFileList(aid, fpath);
        } else {
          previewFile(aid, fpath, item.dataset.fileName);
        }
      });
    }
  }

  async function loadFileList(agentId, dirPath) {
    state.fileCurrentPath[agentId] = dirPath || "";
    var grid = document.getElementById("fileGrid");
    var crumb = document.getElementById("fileBreadcrumb");
    if (!grid) return;
    grid.innerHTML = '<div class="panel-placeholder">加载中...</div>';
    try {
      var data = await fetchFileList(agentId, dirPath);
      var entries = data.entries || [];
      state.fileListCache[agentId + ":" + (dirPath || "")] = entries;

      // Breadcrumb
      if (crumb) {
        var parts = (dirPath || "").replace(/\\/g, "/").split("/").filter(Boolean);
        var html = '<span class="crumb-root" data-path="">📁 根目录</span>';
        var cumulative = "";
        for (var bi = 0; bi < parts.length; bi++) {
          cumulative += (cumulative ? "/" : "") + parts[bi];
          html += '<span class="crumb-sep">›</span>';
          html += '<span class="crumb-item" data-path="' + esc(cumulative) + '">' + esc(parts[bi]) + '</span>';
        }
        crumb.innerHTML = html;
      }

      // File listing
      if (!entries.length) {
        grid.innerHTML = '<div class="file-empty">📂 空目录</div>';
        return;
      }
      var html = "";
      for (var fi = 0; fi < entries.length; fi++) {
        var e = entries[fi];
        var icon = e.type === "dir" ? "📁" : "📄";
        var sizeStr = e.size != null ? formatFileSize(e.size) : "";
        html += '<div class="file-row" data-file-path="' + esc(e.path) + '" data-file-type="' + esc(e.type) + '" data-file-name="' + esc(e.name) + '">' +
          '<span class="file-icon">' + icon + '</span>' +
          '<span class="file-name">' + esc(e.name) + '</span>' +
          '<span class="file-size">' + sizeStr + '</span>' +
        '</div>';
      }
      grid.innerHTML = html;
    } catch (err) {
      grid.innerHTML = '<div class="file-empty">❌ 加载失败: ' + esc(err.message) + '</div>';
    }
  }

  function formatFileSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  async function previewFile(agentId, filePath, fileName) {
    try {
      var data = await fetchFileContent(agentId, filePath);
      var content = data.content || "";
      var isText = data.text || false;
      if (!isText) {
        if (window.showToast) showToast("二进制文件无法预览", "info");
        return;
      }
      var previewHtml =
        '<div class="file-preview-overlay" id="filePreviewOverlay">' +
          '<div class="file-preview-modal">' +
            '<div class="file-preview-head">' +
              '<span>📄 ' + esc(fileName) + '</span>' +
              '<button class="icon-btn" id="filePreviewClose">✕</button>' +
            '</div>' +
            '<pre class="file-preview-body">' + esc(content.slice(0, 50000)) + '</pre>' +
          '</div>' +
        '</div>';
      var existing = document.getElementById("filePreviewOverlay");
      if (existing) existing.remove();
      document.body.insertAdjacentHTML("beforeend", previewHtml);
      document.getElementById("filePreviewClose").addEventListener("click", function () {
        var ov = document.getElementById("filePreviewOverlay");
        if (ov) ov.remove();
      });
      document.getElementById("filePreviewOverlay").addEventListener("click", function (e) {
        if (e.target === this) this.remove();
      });
    } catch (err) {
      if (window.showToast) showToast("读取失败: " + err.message, "error");
    }
  }

  /* ── Pro: Real-time Log Viewer ─────────────────────────────── */
  function renderLogsPanel(el) {
    var aid = state.agent;
    el.innerHTML =
      '<div class="pro-panel">' +
        '<div class="pro-panel-head">' +
          '<h2>📜 实时日志 <span class="pro-agent-badge">' + aid + '</span></h2>' +
          '<div class="pro-panel-actions">' +
            '<button class="pro-btn" id="logAutoScroll" title="自动滚动">⬇ 自动滚动</button>' +
            '<button class="pro-btn" id="logClearBtn" title="清空">✕</button>' +
          '</div>' +
        '</div>' +
        '<div class="log-terminal" id="logTerminal">' +
          '<div class="panel-placeholder">连接日志流...</div>' +
        '</div>' +
      '</div>';

    loadLogContent(aid);

    var clearBtn = el.querySelector("#logClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var term = document.getElementById("logTerminal");
        if (term) term.innerHTML = "";
      });
    }
  }

  var logEventSource = null;

  function loadLogContent(agentId) {
    // Close any existing stream
    if (logEventSource) {
      logEventSource.close();
      logEventSource = null;
    }

    // Load initial log content via REST
    api("/api/agent/" + agentId + "/logs", { method: "GET" }).then(function (data) {
      var term = document.getElementById("logTerminal");
      if (!term) return;
      var logText = data.log || "";
      term.innerHTML = '<pre class="log-pre">' + esc(logText) + '</pre>';

      // Connect to SSE stream for live updates
      var es = new EventSource("/api/agent/" + agentId + "/logs/stream");
      logEventSource = es;
      es.onmessage = function (e) {
        var term = document.getElementById("logTerminal");
        if (!term) { es.close(); logEventSource = null; return; }
        var pre = term.querySelector(".log-pre");
        if (!pre) {
          term.innerHTML = '<pre class="log-pre">' + esc(e.data) + '</pre>';
          pre = term.querySelector(".log-pre");
        } else {
          pre.textContent += e.data;
          // Keep last 50000 chars
          if (pre.textContent.length > 50000) {
            pre.textContent = pre.textContent.slice(-50000);
          }
        }
        // Auto-scroll
        var autoScrollBtn = document.getElementById("logAutoScroll");
        var autoScroll = !autoScrollBtn || autoScrollBtn.classList.contains("active");
        if (autoScroll) {
          term.scrollTop = term.scrollHeight;
        }
      };
      es.onerror = function () {
        // Reconnect is automatic for EventSource
      };
    }).catch(function (err) {
      var term = document.getElementById("logTerminal");
      if (term) term.innerHTML = '<div class="file-empty">❌ 加载失败: ' + esc(err.message) + '</div>';
    });
  }

  /* ── Pro: API Explorer ─────────────────────────────────────── */
  function renderExplorerPanel(el) {
    var aid = state.agent;
    el.innerHTML =
      '<div class="pro-panel">' +
        '<div class="pro-panel-head">' +
          '<h2>🔌 API 探索 <span class="pro-agent-badge">' + aid + '</span></h2>' +
        '</div>' +
        '<div class="explorer-form">' +
          '<div class="explorer-row">' +
            '<label>端点</label>' +
            '<select id="explorerEndpoint" class="explorer-input explorer-select">' +
              '<option value="/api/chat">/api/chat</option>' +
              '<option value="/api/chat/stream">/api/chat/stream</option>' +
              '<option value="/api/status">/api/status</option>' +
              '<option value="/api/tools">/api/tools</option>' +
              '<option value="/api/config">/api/config</option>' +
              '<option value="/api/memory">/api/memory</option>' +
            '</select>' +
          '</div>' +
          '<div class="explorer-row">' +
            '<label>方法</label>' +
            '<select id="explorerMethod" class="explorer-input explorer-select">' +
              '<option value="GET">GET</option>' +
              '<option value="POST" selected>POST</option>' +
            '</select>' +
          '</div>' +
          '<div class="explorer-row">' +
            '<label>请求体 (JSON)</label>' +
            '<textarea id="explorerBody" class="explorer-input explorer-textarea" rows="6" spellcheck="false">' + JSON.stringify({ messages: [{ role: "user", content: "你好" }] }, null, 2) + '</textarea>' +
          '</div>' +
          '<div class="explorer-row">' +
            '<button class="pro-btn pro-btn-primary" id="explorerSendBtn">▶ 发送</button>' +
          '</div>' +
          '<div class="explorer-row">' +
            '<label>响应</label>' +
            '<pre id="explorerResponse" class="explorer-response">点击发送查看响应</pre>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById("explorerSendBtn").addEventListener("click", function () {
      sendExplorerRequest(aid);
    });
  }

  async function sendExplorerRequest(agentId) {
    var endpoint = document.getElementById("explorerEndpoint").value;
    var method = document.getElementById("explorerMethod").value;
    var bodyText = document.getElementById("explorerBody").value;
    var responseEl = document.getElementById("explorerResponse");
    if (!responseEl) return;
    responseEl.textContent = "发送中...";
    responseEl.className = "explorer-response";

    var status = state.statuses[agentId];
    if (!status || !status.running || !status.ports || !status.ports.port) {
      responseEl.textContent = "❌ Agent " + agentId + " 未运行";
      responseEl.className = "explorer-response error";
      return;
    }

    var targetUrl = "/" + agentId + "/api" + endpoint;
    try {
      var opts = { method: method };
      if (method === "POST" && bodyText) {
        opts.body = (function () { try { return JSON.parse(bodyText); } catch (e) { throw new Error("JSON 格式错误: " + e.message); } })();
      }
      var data = await api(targetUrl, opts);
      responseEl.textContent = JSON.stringify(data, null, 2);
      responseEl.className = "explorer-response success";
    } catch (err) {
      responseEl.textContent = "❌ " + err.message;
      responseEl.className = "explorer-response error";
    }
  }

  /* ── Pro: Raw Mode ──────────────────────────────────────────── */
  function renderRawBlock(req, res) {
    var container = document.getElementById("chatMessages");
    if (!container || !state.rawMode) return;

    // Remove previous raw block if exists
    var prev = container.querySelector(".raw-block");
    if (prev) prev.remove();

    var html =
      '<div class="raw-block">' +
        '<div class="raw-head" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">' +
          '📄 原始请求/响应 <span class="raw-toggle-label">点击折叠</span>' +
        '</div>' +
        '<div class="raw-body">' +
          '<div class="raw-section">' +
            '<div class="raw-section-title">→ 请求</div>' +
            '<pre class="raw-json">' + esc(typeof req === "string" ? req : JSON.stringify(req, null, 2)) + '</pre>' +
          '</div>' +
          '<div class="raw-section">' +
            '<div class="raw-section-title">← 响应</div>' +
            '<pre class="raw-json">' + esc(typeof res === "string" ? res : JSON.stringify(res, null, 2)) + '</pre>' +
          '</div>' +
        '</div>' +
      '</div>';
    container.insertAdjacentHTML("beforeend", html);
    container.scrollTop = container.scrollHeight;
  }

  /* ── Init ──────────────────────────────────────────────────── */
  function init() {
    window.addEventListener("hashchange", function () { navigate(location.hash); });

    var select = $("workAgentSelect");
    if (select) {
      select.addEventListener("change", function () {
        var agent = select.value;
        state.agent = agent;
        setAgent(agent);
        localStorage.setItem("lastAgent", agent);
        // Reload chat for new agent
        loadChat();
        // Restore per-agent preset
        var savedPresetId = localStorage.getItem("activePreset_" + agent);
        if (savedPresetId) {
          loadPresets().then(function () {
            var p = (panelCache.presets || []).find(function (x) { return x.id === savedPresetId; });
            if (p) { state.activePreset = p; updatePresetBar(); }
            else { localStorage.removeItem("activePreset_" + agent); }
          });
        } else {
          state.activePreset = null;
          updatePresetBar();
        }
        // Re-render currently active panel
        var activePanel = document.querySelector("#workContent .panel-wrap.active");
        if (activePanel) {
          var panelId = activePanel.id.replace("panel-", "");
          if (panelId !== "chat") window.onPanelSwitch(panelId);
        }
        refreshStatus();
      });
    }

    // Simple mode: per-panel agent action delegation
    var simpleChatArea = $("simpleChatArea");
    if (simpleChatArea) {
      simpleChatArea.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action]");
        if (!btn) return;
        var agentId = btn.dataset.agent;
        if (agentId !== "openclaw" && agentId !== "hermes") return;
        btn.disabled = true;
        agentAction(btn.dataset.action, agentId).catch(function (err) {
          if (window.showToast) showToast("操作失败：" + err.message, "error");
        }).then(function () {
          btn.disabled = false;
        });
      });

      // Simple mode: nav buttons (API 配置 / 维护)
      simpleChatArea.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-nav]");
        if (!btn) return;
        var agentId = btn.dataset.agent;
        var targetPanel = btn.dataset.nav;
        if (targetPanel === "config") targetPanel = "models";
        location.hash = "#work/" + agentId;
        setTimeout(function () {
          if (window.switchPanel) window.switchPanel(targetPanel);
        }, 50);
      });

      // Simple mode: clear chat
      simpleChatArea.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-clear]");
        if (!btn) return;
        var agentId = btn.dataset.clear;
        if (agentId !== "openclaw" && agentId !== "hermes") return;
        var msgs = state.simpleChats[agentId] || [];
        if (msgs.length && !confirm("确认清空 " + (agentId === "hermes" ? "Hermes" : "OpenClaw") + " 的对话？")) return;
        clearSimpleChat(agentId);
      });

      // Simple mode: form submissions
      simpleChatArea.addEventListener("submit", function (e) {
        var form = e.target.closest("[data-simple-form]");
        if (!form) return;
        e.preventDefault();
        var agentId = form.dataset.simpleForm;
        if (agentId !== "openclaw" && agentId !== "hermes") return;
        var input = form.querySelector(".chat-input-auto");
        if (!input) return;
        var text = input.value.trim();
        if (!text) return;
        sendSimpleMessage(agentId, text);
        input.value = "";
        input.style.height = "";
      });

      // Simple mode: auto-resize textareas
      simpleChatArea.addEventListener("input", function (e) {
        var ta = e.target.closest(".chat-input-auto");
        if (!ta) return;
        ta.style.height = "";
        ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
      });

      // Simple mode: Enter to send
      simpleChatArea.addEventListener("keydown", function (e) {
        var ta = e.target.closest(".chat-input-auto");
        if (!ta) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          var agentId = ta.closest("[data-simple-form]")?.dataset?.simpleForm;
          if (agentId) {
            sendSimpleMessage(agentId, ta.value.trim());
            ta.value = "";
            ta.style.height = "";
          }
        }
      });

      // Simple mode: copy bubbles
      simpleChatArea.addEventListener("click", function (e) {
        var btn = e.target.closest(".bubble-copy");
        if (!btn) return;
        var agentId = btn.dataset.agent;
        var idx = parseInt(btn.dataset.copy, 10);
        var msgs = state.simpleChats[agentId];
        if (msgs && msgs[idx] && navigator.clipboard) {
          var text = typeof msgs[idx].content === "string" ? msgs[idx].content : "";
          navigator.clipboard.writeText(text).then(function () {
            btn.textContent = "✅";
            setTimeout(function () { btn.textContent = "📋"; }, 2000);
          });
        }
      });
    }

    // Work mode: action buttons delegation
    var workActionsEl = $("workAgentActions");
    if (workActionsEl) {
      workActionsEl.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action]");
        if (!btn) return;
        btn.disabled = true;
        agentAction(btn.dataset.action, state.agent).catch(function (err) {
          if (window.showToast) showToast("操作失败：" + err.message, "error");
        }).then(function () {
          btn.disabled = false;
        });
      });
    }

    // Raw mode toggle
    var rawToggle = $("chatRawToggle");
    if (rawToggle) {
      rawToggle.addEventListener("click", function () {
        state.rawMode = !state.rawMode;
        rawToggle.classList.toggle("active", state.rawMode);
        rawToggle.title = state.rawMode ? "原始模式已开启" : "原始模式（显示完整请求/响应）";
      });
    }

    // Model select change handlers
    var chatModelSelect = $("chatModelSelect");
    if (chatModelSelect) {
      chatModelSelect.addEventListener("change", function () {
        state.chatModel = chatModelSelect.value || null;
      });
    }
    ["openclaw", "hermes"].forEach(function (aid) {
      var sel = $("simpleModel" + aid.charAt(0).toUpperCase() + aid.slice(1));
      if (sel) {
        sel.addEventListener("change", function () {
          state.simpleChatModel[aid] = sel.value || null;
        });
      }
    });

    if (location.hash && location.hash !== "#" && location.hash !== "") {
      navigate(location.hash);
    } else {
      navigate("#home");
    }

    loadLauncherEnv().then(function () {
      if (state.mode === "work" || state.mode === "pro") {
        loadChat();
        refreshStatus();
        // Restore active preset from localStorage after presets are loaded
        var savedPresetId = localStorage.getItem("activePreset_" + state.agent);
        if (savedPresetId) {
          loadPresets().then(function () {
            var p = (panelCache.presets || []).find(function (x) { return x.id === savedPresetId; });
            if (p) { state.activePreset = p; updatePresetBar(); }
            else { localStorage.removeItem("activePreset_" + state.agent); }
          });
        }
      }
    });
    setInterval(function () {
      if (state.mode === "work" || state.mode === "pro") refreshStatus();
    }, 5000);

    var closeBtn = $("closeLog");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        var dialog = $("logDialog");
        if (dialog) dialog.close();
      });
    }

    /* ── Chat form bindings ────────────────────────────────── */
    var form = $("chatForm");
    var input = $("chatInput");
    var fileInput = $("chatFileInput");

    if (form && input) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text && (!state.attachments || !state.attachments.length)) return;
        sendMessage(text);
      });

      input.addEventListener("input", function () {
        input.style.height = "";
        input.style.height = Math.min(input.scrollHeight, 200) + "px";
      });

      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          form.dispatchEvent(new Event("submit"));
        }
      });
    }

    if (fileInput) {
      fileInput.addEventListener("change", async function () {
        var files = fileInput.files;
        if (!files || !files.length) return;
        try {
          for (var i = 0; i < files.length; i++) {
            if ((state.attachments || []).length >= 4) break;
            state.attachments = (state.attachments || []).concat([await fileToAttachment(files[i])]);
          }
          renderAttachments();
        } catch (e) {
          if (window.showToast) showToast(e.message, "error");
        }
        fileInput.value = "";
      });
    }

    var attachBar = $("chatAttachments");
    if (attachBar) {
      attachBar.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-remove-idx]");
        if (!btn) return;
        var idx = parseInt(btn.dataset.removeIdx, 10);
        state.attachments = (state.attachments || []).filter(function (_, i) { return i !== idx; });
        renderAttachments();
      });
    }

    var msgBox = $("chatMessages");
    if (msgBox) {
      msgBox.addEventListener("click", function (e) {
        var btn = e.target.closest(".bubble-copy");
        if (!btn) return;
        var idx = parseInt(btn.dataset.copy, 10);
        var m = state.messages[idx];
        if (m && navigator.clipboard) {
          var text = typeof m.content === "string" ? m.content : "";
          navigator.clipboard.writeText(text).then(function () {
            btn.textContent = "✅";
            setTimeout(function () { btn.textContent = "📋"; }, 2000);
          });
        }
      });
    }

    var newBtn = $("chatNewBtn");
    if (newBtn) {
      newBtn.addEventListener("click", function () {
        if (state.messages.length && !confirm("新建对话将清空当前内容，确认？")) return;
        clearChat();
      });
    }

    var clearBtn = $("chatClearBtn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        if (state.messages.length && !confirm("确认清空对话？")) return;
        clearChat();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.workspaceAPI = api;
  window.workspaceState = state;
})();
