(() => {
  const STORAGE_KEY = "arrowPagerSettings";
  const DEFAULT_SETTINGS = {
    enabled: true,
    showToast: false,
    cooldownMs: 0,
    toastDurationMs: 1200,
    doubleTapOnly: false,
    prefetchEnabled: true,
    globalPrev: "",
    globalNext: "",
    siteRules: []
  };

  const storage = chrome?.storage?.sync || chrome?.storage?.local;

  const globalPrev = document.getElementById("globalPrev");
  const globalNext = document.getElementById("globalNext");
  const enabledToggle = document.getElementById("enabledToggle");
  const showToastToggle = document.getElementById("showToastToggle");
  const cooldownMsInput = document.getElementById("cooldownMs");
  const toastDurationMsInput = document.getElementById("toastDurationMs");
  const doubleTapOnlyToggle = document.getElementById("doubleTapOnly");
  const prefetchEnabledToggle = document.getElementById("prefetchEnabledToggle");
  const rulesContainer = document.getElementById("rules");
  const addRuleButton = document.getElementById("addRule");
  const addCurrentSiteButton = document.getElementById("addCurrentSite");
  const saveButton = document.getElementById("save");
  const status = document.getElementById("status");
  const template = document.getElementById("ruleTemplate");
  const exportBtn = document.getElementById("exportBtn");
  const importFile = document.getElementById("importFile");
  const restoreDefaultsButton = document.getElementById("restoreDefaults");

  let saveTimer = null;

  function setStatus(text, flash = false) {
    status.textContent = text;
    status.classList.toggle("saved", flash);
    if (flash) {
      setTimeout(() => status.classList.remove("saved"), 1200);
    }
  }

  function createId() {
    return `rule_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  }

  function createRuleElement(rule) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = rule.id;

    const pattern = node.querySelector("input.pattern");
    const enabled = node.querySelector(".enabled");
    const disable = node.querySelector(".disable");
    const prev = node.querySelector(".prev");
    const next = node.querySelector(".next");
    const remove = node.querySelector(".remove");

    pattern.value = rule.pattern || "";
    enabled.checked = rule.enabled !== false;
    disable.checked = rule.disable === true;
    prev.value = rule.prev || "";
    next.value = rule.next || "";

    const markDirty = () => scheduleSave();
    pattern.addEventListener("input", markDirty);
    prev.addEventListener("input", markDirty);
    next.addEventListener("input", markDirty);
    enabled.addEventListener("change", markDirty);
    disable.addEventListener("change", markDirty);

    remove.addEventListener("click", () => {
      node.remove();
      scheduleSave();
    });

    node.addEventListener("dragstart", (e) => {
      node.classList.add("dragging");
      e.dataTransfer.setData("text/plain", node.dataset.id);
      e.dataTransfer.effectAllowed = "move";
    });
    node.addEventListener("dragend", () => node.classList.remove("dragging"));
    node.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      rulesContainer.querySelectorAll(".rule").forEach((r) => r.classList.remove("drag-over"));
      if (node !== e.currentTarget) node.classList.add("drag-over");
    });
    node.addEventListener("dragleave", () => node.classList.remove("drag-over"));
    node.addEventListener("drop", (e) => {
      e.preventDefault();
      node.classList.remove("drag-over");
      const fromId = e.dataTransfer.getData("text/plain");
      const from = rulesContainer.querySelector(`.rule[data-id="${fromId}"]`);
      if (from && from !== node) {
        const all = Array.from(rulesContainer.querySelectorAll(".rule"));
        const fromIdx = all.indexOf(from);
        const toIdx = all.indexOf(node);
        if (fromIdx < toIdx) node.after(from);
        else node.before(from);
        scheduleSave();
      }
    });

    return node;
  }

  function renderRules(rules) {
    rulesContainer.innerHTML = "";
    rulesContainer.removeAttribute("role");
    if (!rules.length) {
      rulesContainer.removeAttribute("aria-label");
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "还没有站点规则。点击“添加站点规则”开始配置。";
      rulesContainer.appendChild(empty);
      return;
    }
    rulesContainer.setAttribute("role", "list");
    rulesContainer.setAttribute("aria-label", "站点规则列表，可拖拽排序");
    for (const rule of rules) {
      rulesContainer.appendChild(createRuleElement(rule));
    }
  }

  function getRulesFromUI() {
    const nodes = Array.from(rulesContainer.querySelectorAll(".rule"));
    return nodes.map((node) => ({
      id: node.dataset.id || createId(),
      pattern: node.querySelector(".pattern").value.trim(),
      enabled: node.querySelector(".enabled").checked,
      disable: node.querySelector(".disable").checked,
      prev: node.querySelector(".prev").value.trim(),
      next: node.querySelector(".next").value.trim()
    }));
  }

  function getSettingsFromUI() {
    return {
      enabled: enabledToggle.checked,
      showToast: showToastToggle.checked,
      cooldownMs: Math.max(0, Number(cooldownMsInput.value) || 0),
      toastDurationMs: Math.max(500, Math.min(5000, Number(toastDurationMsInput?.value) || 1200)),
      doubleTapOnly: Boolean(doubleTapOnlyToggle?.checked),
      prefetchEnabled: Boolean(prefetchEnabledToggle?.checked),
      globalPrev: globalPrev.value.trim(),
      globalNext: globalNext.value.trim(),
      siteRules: getRulesFromUI()
    };
  }

  function scheduleSave() {
    setStatus("未保存");
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(saveSettings, 300);
  }

  function saveSettings() {
    if (!storage) return;
    const nextSettings = getSettingsFromUI();
    storage.set({ [STORAGE_KEY]: nextSettings }, () => {
      setStatus("已保存", true);
    });
  }

  function normalizeSettings(raw) {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    return {
      enabled: raw.enabled !== false,
      showToast: Boolean(raw.showToast),
      cooldownMs: Math.max(0, Number(raw.cooldownMs) || 0),
      toastDurationMs: Math.max(500, Math.min(5000, Number(raw.toastDurationMs) || 1200)),
      doubleTapOnly: Boolean(raw.doubleTapOnly),
      prefetchEnabled: raw.prefetchEnabled !== false,
      globalPrev: String(raw.globalPrev || ""),
      globalNext: String(raw.globalNext || ""),
      siteRules: Array.isArray(raw.siteRules) ? raw.siteRules : []
    };
  }

  function loadSettings() {
    if (!storage) return;
    storage.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (res) => {
      const s = normalizeSettings(res[STORAGE_KEY]);
      enabledToggle.checked = s.enabled !== false;
      showToastToggle.checked = Boolean(s.showToast);
      cooldownMsInput.value = String(s.cooldownMs || 0);
      if (toastDurationMsInput) toastDurationMsInput.value = String(s.toastDurationMs ?? 1200);
      if (doubleTapOnlyToggle) doubleTapOnlyToggle.checked = Boolean(s.doubleTapOnly);
      if (prefetchEnabledToggle) prefetchEnabledToggle.checked = s.prefetchEnabled !== false;
      globalPrev.value = s.globalPrev;
      globalNext.value = s.globalNext;
      renderRules(s.siteRules);
      setStatus("已保存");
    });
  }

  function restoreDefaults() {
    if (!confirm("确定要恢复为默认设置吗？当前配置将被覆盖。")) return;
    enabledToggle.checked = DEFAULT_SETTINGS.enabled;
    showToastToggle.checked = DEFAULT_SETTINGS.showToast;
    cooldownMsInput.value = String(DEFAULT_SETTINGS.cooldownMs);
    if (toastDurationMsInput) toastDurationMsInput.value = String(DEFAULT_SETTINGS.toastDurationMs);
    if (doubleTapOnlyToggle) doubleTapOnlyToggle.checked = DEFAULT_SETTINGS.doubleTapOnly;
    if (prefetchEnabledToggle) prefetchEnabledToggle.checked = DEFAULT_SETTINGS.prefetchEnabled;
    globalPrev.value = DEFAULT_SETTINGS.globalPrev;
    globalNext.value = DEFAULT_SETTINGS.globalNext;
    renderRules(DEFAULT_SETTINGS.siteRules);
    saveSettings();
  }

  function exportConfig() {
    const data = getSettingsFromUI();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `arrow-pager-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("已导出", true);
  }

  function importConfig(file) {
    if (!file || !file.name) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        const s = normalizeSettings(raw);
        enabledToggle.checked = s.enabled !== false;
        showToastToggle.checked = Boolean(s.showToast);
        cooldownMsInput.value = String(s.cooldownMs || 0);
        if (toastDurationMsInput) toastDurationMsInput.value = String(s.toastDurationMs ?? 1200);
        if (doubleTapOnlyToggle) doubleTapOnlyToggle.checked = Boolean(s.doubleTapOnly);
        if (prefetchEnabledToggle) prefetchEnabledToggle.checked = s.prefetchEnabled !== false;
        globalPrev.value = s.globalPrev;
        globalNext.value = s.globalNext;
        renderRules(s.siteRules);
        scheduleSave();
        setStatus("已导入，请保存", true);
      } catch (e) {
        setStatus("导入失败：无效的 JSON");
      }
    };
    reader.readAsText(file);
  }

  function addCurrentSiteRule() {
    if (!chrome?.tabs?.query) {
      setStatus("需要「标签页」权限才能获取当前站点");
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      let hostname = "";
      if (tab?.url) {
        try {
          hostname = new URL(tab.url).hostname;
        } catch {}
      }
      const current = getRulesFromUI();
      current.push({
        id: createId(),
        pattern: hostname || "example.com",
        prev: "",
        next: "",
        enabled: true,
        disable: false
      });
      renderRules(current);
      scheduleSave();
      setStatus(hostname ? `已添加规则：${hostname}` : "已添加空规则，请填写域名", true);
    });
  }

  addRuleButton.addEventListener("click", () => {
    const current = getRulesFromUI();
    current.push({ id: createId(), pattern: "", prev: "", next: "", enabled: true, disable: false });
    renderRules(current);
    scheduleSave();
  });

  if (addCurrentSiteButton) addCurrentSiteButton.addEventListener("click", addCurrentSiteRule);
  if (exportBtn) exportBtn.addEventListener("click", exportConfig);
  if (importFile) importFile.addEventListener("change", (e) => { importConfig(e.target.files?.[0]); e.target.value = ""; });
  if (restoreDefaultsButton) restoreDefaultsButton.addEventListener("click", restoreDefaults);

  saveButton.addEventListener("click", saveSettings);
  globalPrev.addEventListener("input", scheduleSave);
  globalNext.addEventListener("input", scheduleSave);
  enabledToggle.addEventListener("change", scheduleSave);
  showToastToggle.addEventListener("change", scheduleSave);
  cooldownMsInput.addEventListener("input", scheduleSave);
  if (toastDurationMsInput) toastDurationMsInput.addEventListener("input", scheduleSave);
  if (doubleTapOnlyToggle) doubleTapOnlyToggle.addEventListener("change", scheduleSave);
  if (prefetchEnabledToggle) prefetchEnabledToggle.addEventListener("change", scheduleSave);

  loadSettings();
})();
