(() => {
  if (window.__arrowPagerInjected) return;
  window.__arrowPagerInjected = true;

  const TEXT_HINTS = {
    prev: [
      "上一页",
      "上一頁",
      "上一章",
      "上一张",
      "上一张",
      "上一張",
      "前一页",
      "上一",
      "prev",
      "previous",
      "older",
      "back"
    ],
    next: [
      "下一页",
      "下一頁",
      "下一章",
      "下一张",
      "下一張",
      "后一页",
      "下一",
      "next",
      "newer",
      "forward"
    ]
  };

  const ATTR_HINTS = {
    prev: ["prev", "previous", "older", "back"],
    next: ["next", "newer", "forward"]
  };

  const PAGINATION_SELECTORS = [
    "nav[aria-label*='pagination' i]",
    "nav[role='navigation']",
    ".pagination",
    "#pagination",
    "[class*='pagination' i]",
    "[id*='pagination' i]"
  ];
  const PAGE_PARAM_CANDIDATES = ["page", "p", "pg", "pageno", "pn", "pageNo", "pageIndex"];

  const CLICKABLE_SELECTOR =
    "a[href], button, [role='button'], [onclick], input[type='button'], input[type='submit']";
  const STORAGE_KEY = "arrowPagerSettings";
  const DEFAULT_SETTINGS = {
    enabled: true,
    showToast: false,
    cooldownMs: 0,
    toastDurationMs: 1200,
    doubleTapOnly: false,
    globalPrev: "",
    globalNext: "",
    siteRules: []
  };
  let settings = DEFAULT_SETTINGS;
  let lastTriggerTs = 0;
  let lastPointerTarget = null;
  let lastPointerTs = 0;
  let lastArrowKey = null;
  let lastArrowTs = 0;
  const POINTER_WINDOW_MS = 2000;
  const DOUBLE_TAP_MS = 400;
  const MEDIA_CONTAINER_STRONG_SELECTOR =
    ".bpx-player, .bpx-player-control-wrap, .bpx-player-control-entity, .bpx-player-ctrl-btn, " +
    ".bilibili-player, .video-player, .video-js, .vjs-control-bar, .jwplayer, .plyr, .dplayer, .artplayer, " +
    "[data-player]";
  const MEDIA_CONTAINER_SOFT_SELECTOR = "[class*='player' i], [id*='player' i]";

  function isEditable(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (!tag) return false;
    if (target.isContentEditable) return true;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function recordPointerTarget(event) {
    if (!event) return;
    lastPointerTarget = event.target || null;
    lastPointerTs = Date.now();
  }

  function resolveEventTarget(target) {
    if (!target || target === window || target.nodeType === Node.DOCUMENT_NODE) {
      return document.activeElement;
    }
    if (!target.tagName) return document.activeElement;
    return target;
  }

  function isPlayerElement(el, selector) {
    if (!el) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (el.matches?.(selector)) return true;
    if (el.closest?.(selector)) return true;
    return false;
  }

  function isStrongPlayerElement(el) {
    return isPlayerElement(el, MEDIA_CONTAINER_STRONG_SELECTOR);
  }

  function isSoftPlayerElement(el) {
    return isPlayerElement(el, MEDIA_CONTAINER_SOFT_SELECTOR);
  }

  function isAnyPlayerElement(el) {
    return isStrongPlayerElement(el) || isSoftPlayerElement(el);
  }

  function hasStrongPlayerContainer() {
    return Boolean(document.querySelector(MEDIA_CONTAINER_STRONG_SELECTOR));
  }

  function hasActiveMediaPlayback() {
    const media = Array.from(document.querySelectorAll("video, audio"));
    for (const m of media) {
      if (!isVisible(m)) continue;
      if (m.paused === false && !m.ended) return true;
    }
    return false;
  }

  function isMediaContext(target) {
    const el = resolveEventTarget(target) || target;
    if (!el) return false;
    const tag = el.tagName;
    if (!tag) {
      if (
        lastPointerTarget &&
        Date.now() - lastPointerTs < POINTER_WINDOW_MS &&
        (lastPointerTarget.closest?.("video, audio") || isAnyPlayerElement(lastPointerTarget))
      ) {
        return true;
      }
      return hasStrongPlayerContainer() && hasActiveMediaPlayback();
    }

    const isBody = tag === "BODY" || tag === "HTML";
    if (tag === "VIDEO" || tag === "AUDIO") return true;
    if (el.matches?.("input[type='range'], [role='slider'], [role='progressbar']")) {
      return true;
    }
    if (el.closest?.("video, audio")) return true;

    if (isAnyPlayerElement(el)) return true;

    if (isBody) {
      if (
        lastPointerTarget &&
        Date.now() - lastPointerTs < POINTER_WINDOW_MS &&
        (lastPointerTarget.closest?.("video, audio") || isAnyPlayerElement(lastPointerTarget))
      ) {
        return true;
      }
      if (hasStrongPlayerContainer() && hasActiveMediaPlayback()) return true;
    }

    return false;
  }

  function normalize(text) {
    return (text || "").trim().toLowerCase();
  }

  function normalizeSettings(raw) {
    if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };
    return {
      enabled: raw.enabled !== false,
      showToast: Boolean(raw.showToast),
      cooldownMs: Math.max(0, Number(raw.cooldownMs) || 0),
      toastDurationMs: Math.max(500, Math.min(5000, Number(raw.toastDurationMs) || 1200)),
      doubleTapOnly: Boolean(raw.doubleTapOnly),
      globalPrev: String(raw.globalPrev || ""),
      globalNext: String(raw.globalNext || ""),
      siteRules: Array.isArray(raw.siteRules) ? raw.siteRules : []
    };
  }

  function loadSettings() {
    if (!chrome?.storage?.sync) return;
    chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (res) => {
      settings = normalizeSettings(res[STORAGE_KEY]);
    });
  }

  function watchSettings() {
    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes[STORAGE_KEY]) {
        settings = normalizeSettings(changes[STORAGE_KEY].newValue);
      }
    });
  }

  function elementScore(el, direction) {
    let score = 0;
    const text = normalize(el.textContent);
    const aria = normalize(el.getAttribute("aria-label"));
    const title = normalize(el.getAttribute("title"));
    const rel = normalize(el.getAttribute("rel"));
    const id = normalize(el.id);
    const cls = normalize(el.className);
    const href = normalize(el.getAttribute("href"));

    const haystacks = [text, aria, title, rel, id, cls];
    const textHints = TEXT_HINTS[direction];
    const attrHints = ATTR_HINTS[direction];

    for (const h of textHints) {
      for (const s of haystacks) {
        if (s.includes(h)) score += 3;
      }
    }

    for (const h of attrHints) {
      if (rel.includes(h)) score += 6;
      if (id.includes(h)) score += 2;
      if (cls.includes(h)) score += 2;
      if (aria.includes(h)) score += 3;
      if (title.includes(h)) score += 2;
    }

    if (el.tagName === "A") score += 1;
    if (el.tagName === "BUTTON") score += 1;
    if (el.tagName === "A" && href.startsWith("javascript:")) score -= 4;

    return score;
  }

  function getCandidates(root = document) {
    return Array.from(root.querySelectorAll(CLICKABLE_SELECTOR));
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (Number(style.opacity) === 0) return false;
    return true;
  }

  function isInViewport(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    return rect.bottom >= 0 && rect.right >= 0 && rect.top <= vh && rect.left <= vw;
  }

  function findBestIn(root, direction) {
    const candidates = getCandidates(root);
    let best = null;
    let bestScore = 0;

    for (const el of candidates) {
      const score = elementScore(el, direction);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return { element: best, score: bestScore };
  }

  function parseSelectors(value) {
    return String(value || "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function normalizePattern(pattern) {
    const raw = String(pattern || "").trim();
    if (!raw) return "";
    if (raw.includes("://")) {
      try {
        return new URL(raw).hostname.toLowerCase();
      } catch {
        return raw.toLowerCase();
      }
    }
    return raw.toLowerCase();
  }

  function matchPattern(pattern, hostname) {
    const normalized = normalizePattern(pattern);
    if (!normalized) return false;
    if (normalized.startsWith("re:")) {
      try {
        const re = new RegExp(normalized.slice(3), "i");
        return re.test(hostname);
      } catch {
        return false;
      }
    }
    if (normalized.includes("*")) {
      const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regexText = "^" + escaped.replace(/\\\*/g, ".*") + "$";
      try {
        return new RegExp(regexText, "i").test(hostname);
      } catch {
        return false;
      }
    }
    if (hostname === normalized) return true;
    if (hostname.endsWith("." + normalized)) return true;
    return hostname.includes(normalized);
  }

  function isSiteDisabled() {
    if (settings.enabled === false) return true;
    const hostname = window.location.hostname.toLowerCase();
    for (const rule of settings.siteRules || []) {
      if (!rule || rule.enabled === false) continue;
      if (!matchPattern(rule?.pattern, hostname)) continue;
      if (rule.disable === true) return true;
    }
    return false;
  }

  function showToast(message, tone = "info") {
    if (!settings.showToast) return;
    const existing = document.getElementById("arrowPagerToast");
    const toast = existing || document.createElement("div");
    toast.id = "arrowPagerToast";
    toast.textContent = message;
    toast.setAttribute("data-tone", tone);
    const baseTransform = "translate(-50%, -50%)";
    const initTransform = `${baseTransform} translateY(6px) scale(0.96)`;
    const showTransform = `${baseTransform} translateY(0) scale(1)`;
    const hideTransform = `${baseTransform} translateY(-6px) scale(0.98)`;
    const enterDuration = 220;
    const exitDuration = 260;
    const displayDuration = Math.max(500, (settings.toastDurationMs || 1200));

    if (!existing) {
      toast.style.position = "fixed";
      toast.style.left = "50%";
      toast.style.top = "50%";
      toast.style.transform = initTransform;
      toast.style.padding = "14px 22px";
      toast.style.minWidth = "160px";
      toast.style.textAlign = "center";
      toast.style.borderRadius = "999px";
      toast.style.fontSize = "16px";
      toast.style.lineHeight = "1.2";
      toast.style.letterSpacing = "0.01em";
      toast.style.fontFamily = "system-ui, -apple-system, Segoe UI, sans-serif";
      toast.style.color = "#fff";
      toast.style.background = "rgba(20, 20, 24, 0.88)";
      toast.style.boxShadow = "0 16px 36px rgba(0, 0, 0, 0.28)";
      toast.style.zIndex = "2147483647";
      toast.style.transition = `opacity ${enterDuration}ms ease, transform ${enterDuration}ms ease`;
      toast.style.opacity = "0";
      toast.style.pointerEvents = "none";
      toast.style.willChange = "opacity, transform";
      document.documentElement.appendChild(toast);
    } else {
      toast.style.transition = "none";
      toast.style.opacity = "0";
      toast.style.transform = initTransform;
      void toast.offsetHeight;
      toast.style.transition = `opacity ${enterDuration}ms ease, transform ${enterDuration}ms ease`;
    }

    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = showTransform;
    });

    const accent = "rgba(255, 122, 89, 0.95)";
    const accentDeep = "rgba(255, 90, 46, 0.95)";
    if (tone === "warn") {
      toast.style.background = accentDeep;
    } else if (tone === "ok") {
      toast.style.background = accent;
    } else {
      toast.style.background = accentDeep;
    }

    window.clearTimeout(toast._arrowPagerTimer);
    window.clearTimeout(toast._arrowPagerCleanup);
    toast._arrowPagerTimer = window.setTimeout(() => {
      toast.style.transition = `opacity ${exitDuration}ms ease, transform ${exitDuration}ms ease`;
      requestAnimationFrame(() => {
        toast.style.opacity = "0";
        toast.style.transform = hideTransform;
      });
      toast._arrowPagerCleanup = window.setTimeout(() => {
        toast.style.opacity = "0";
      }, exitDuration + 30);
    }, displayDuration);
  }

  function findByCustom(direction) {
    const hostname = window.location.hostname.toLowerCase();
    const selectors = [];
    for (const rule of settings.siteRules || []) {
      if (rule && rule.enabled === false) continue;
      const pattern = rule?.pattern;
      if (!matchPattern(pattern, hostname)) continue;
      const list = parseSelectors(rule?.[direction]);
      selectors.push(...list);
    }
    const globalSelectors = parseSelectors(
      direction === "prev" ? settings.globalPrev : settings.globalNext
    );
    selectors.push(...globalSelectors);

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && isVisible(el) && !isLikelyDisabled(el)) return el;
      } catch {
        continue;
      }
    }
    return null;
  }

  function findByRel(direction) {
    const rel = direction === "next" ? "next" : "prev";
    const link = document.querySelector(`a[rel~='${rel}']`);
    if (link) return link;
    return document.querySelector(`link[rel~='${rel}']`);
  }

  function findInPagination(direction) {
    for (const selector of PAGINATION_SELECTORS) {
      const container = document.querySelector(selector);
      if (!container) continue;
      const { element, score } = findBestIn(container, direction);
      if (element && score >= 2) return element;
    }
    return null;
  }

  function findBestGlobal(direction) {
    const { element, score } = findBestIn(document, direction);
    if (element && score >= 3) return element;
    return null;
  }

  function isLikelyDisabled(el) {
    if (!el) return true;
    if (el.disabled) return true;
    const ariaDisabled = el.getAttribute("aria-disabled");
    if (ariaDisabled && ariaDisabled.toLowerCase() === "true") return true;
    const cls = normalize(el.className);
    if (cls.includes("disabled") || cls.includes("inactive")) return true;
    return false;
  }

  function isJavascriptHref(href) {
    return /^\s*javascript:/i.test(href || "");
  }

  function clickElement(el) {
    if (!el) return false;
    if (isLikelyDisabled(el)) return false;

    if (el.tagName === "LINK") {
      const href = el.getAttribute("href");
      if (href) {
        window.location.href = href;
        return true;
      }
      return false;
    }

    if (el.tagName === "A") {
      const href = el.getAttribute("href");
      if (isJavascriptHref(href)) {
        const original = href;
        try {
          el.setAttribute("href", "#");
          const evt = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            view: window
          });
          return el.dispatchEvent(evt);
        } finally {
          if (original !== null) el.setAttribute("href", original);
        }
      }
    }

    if (el.focus && isInViewport(el)) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
    el.click();
    return true;
  }

  function urlNextPrev(direction) {
    const url = new URL(window.location.href);

    for (const key of PAGE_PARAM_CANDIDATES) {
      if (!url.searchParams.has(key)) continue;
      const value = url.searchParams.get(key);
      const num = Number(value);
      if (!Number.isFinite(num)) continue;
      const nextNum = direction === "next" ? num + 1 : num - 1;
      if (nextNum <= 0) return false;
      url.searchParams.set(key, String(nextNum));
      window.location.href = url.toString();
      return true;
    }

    const pathMatch = url.pathname.match(/(.*?)(\d+)([^\d]*)$/);
    if (pathMatch) {
      const prefix = pathMatch[1];
      const num = Number(pathMatch[2]);
      const suffix = pathMatch[3];
      if (Number.isFinite(num)) {
        const nextNum = direction === "next" ? num + 1 : num - 1;
        if (nextNum > 0) {
          url.pathname = `${prefix}${nextNum}${suffix}`;
          window.location.href = url.toString();
          return true;
        }
      }
    }

    return false;
  }

  function getCurrentPageNumber() {
    const url = new URL(window.location.href);
    for (const key of PAGE_PARAM_CANDIDATES) {
      if (!url.searchParams.has(key)) continue;
      const value = url.searchParams.get(key);
      const num = Number(value);
      if (Number.isFinite(num) && num > 0) return num;
    }
    const pathMatch = url.pathname.match(/(.*?)(\d+)([^\d]*)$/);
    if (pathMatch) {
      const num = Number(pathMatch[2]);
      if (Number.isFinite(num) && num > 0) return num;
    }
    return null;
  }

  function getPageNumberFromUrlString(urlString) {
    if (!urlString) return null;
    let url;
    try {
      url = new URL(urlString, window.location.href);
    } catch {
      return null;
    }
    for (const key of PAGE_PARAM_CANDIDATES) {
      if (!url.searchParams.has(key)) continue;
      const value = url.searchParams.get(key);
      const num = Number(value);
      if (Number.isFinite(num) && num > 0) return num;
    }
    const pathMatch = url.pathname.match(/(.*?)(\d+)([^\d]*)$/);
    if (pathMatch) {
      const num = Number(pathMatch[2]);
      if (Number.isFinite(num) && num > 0) return num;
    }
    return null;
  }

  function getPageNumberFromElement(el) {
    if (!el) return null;
    const tag = el.tagName;
    if (tag === "A" || tag === "LINK") {
      const href = el.getAttribute("href");
      const fromHref = getPageNumberFromUrlString(href);
      if (Number.isFinite(fromHref)) return fromHref;
    }
    const dataAttrs = ["data-page", "data-page-number", "data-page-index", "data-index", "data-pn"];
    for (const key of dataAttrs) {
      const raw = el.getAttribute?.(key);
      if (!raw) continue;
      const num = Number(raw);
      if (Number.isFinite(num) && num > 0) return num;
    }
    const aria = el.getAttribute?.("aria-label") || "";
    const text = el.textContent || "";
    const combined = `${aria} ${text}`;
    const match = combined.match(/(\d{1,6})/);
    if (match) {
      const num = Number(match[1]);
      if (Number.isFinite(num) && num > 0) return num;
    }
    return null;
  }

  function getExpectedPageNumber(direction, el) {
    const fromEl = getPageNumberFromElement(el);
    if (Number.isFinite(fromEl)) return fromEl;
    const current = getCurrentPageNumber();
    if (Number.isFinite(current)) {
      const next = current + (direction === "next" ? 1 : -1);
      if (next > 0) return next;
    }
    return null;
  }

  function formatPageHint(pageOverride) {
    const num = Number.isFinite(pageOverride) ? pageOverride : getCurrentPageNumber();
    return Number.isFinite(num) ? `第 ${num} 页` : "";
  }

  function buildToastMessage(actionLabel, pageOverride) {
    const hint = formatPageHint(pageOverride);
    return hint ? `${hint} · ${actionLabel}` : actionLabel;
  }

  function trigger(direction) {
    const customEl = findByCustom(direction);
    if (clickElement(customEl)) {
      showToast(
        buildToastMessage(direction === "next" ? "下一页" : "上一页", getExpectedPageNumber(direction, customEl)),
        "ok"
      );
      return true;
    }

    const relEl = findByRel(direction);
    if (clickElement(relEl)) {
      showToast(
        buildToastMessage(direction === "next" ? "下一页" : "上一页", getExpectedPageNumber(direction, relEl)),
        "ok"
      );
      return true;
    }

    const paginationEl = findInPagination(direction);
    if (clickElement(paginationEl)) {
      showToast(
        buildToastMessage(
          direction === "next" ? "下一页" : "上一页",
          getExpectedPageNumber(direction, paginationEl)
        ),
        "ok"
      );
      return true;
    }

    const best = findBestGlobal(direction);
    if (clickElement(best)) {
      showToast(
        buildToastMessage(direction === "next" ? "下一页" : "上一页", getExpectedPageNumber(direction, best)),
        "ok"
      );
      return true;
    }

    if (urlNextPrev(direction)) {
      showToast(
        buildToastMessage(direction === "next" ? "下一页" : "上一页", getExpectedPageNumber(direction, null)),
        "ok"
      );
      return true;
    }

    const pageHint = formatPageHint(getCurrentPageNumber());
    const reason = isSiteDisabled()
      ? "本站在禁用列表中"
      : "未找到翻页目标";
    showToast(
      pageHint ? `${pageHint} · ${reason}` : reason,
      "warn"
    );
    return false;
  }

  function isDoubleTap(key) {
    if (!settings.doubleTapOnly) return true;
    const now = Date.now();
    const sameKey = lastArrowKey === key && (now - lastArrowTs) <= DOUBLE_TAP_MS;
    lastArrowKey = key;
    lastArrowTs = now;
    return sameKey;
  }

  window.addEventListener(
    "keydown",
    (event) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isEditable(event.target)) return;
      if (isMediaContext(event.target)) return;
      if (isSiteDisabled()) return;
      if (settings.cooldownMs > 0 && Date.now() - lastTriggerTs < settings.cooldownMs) {
        return;
      }

      if (event.key === "ArrowLeft") {
        if (!isDoubleTap("ArrowLeft")) return;
        if (trigger("prev")) {
          lastTriggerTs = Date.now();
          event.preventDefault();
        }
      } else if (event.key === "ArrowRight") {
        if (!isDoubleTap("ArrowRight")) return;
        if (trigger("next")) {
          lastTriggerTs = Date.now();
          event.preventDefault();
        }
      }
    },
    true
  );

  window.addEventListener("pointermove", recordPointerTarget, true);
  window.addEventListener("mousemove", recordPointerTarget, true);
  window.addEventListener("touchstart", recordPointerTarget, true);

  loadSettings();
  watchSettings();
})();
