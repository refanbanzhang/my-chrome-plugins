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
  const PREFETCH_AHEAD_COUNT = 10;
  const PREFETCH_PRERENDER_COUNT = 1;
  const PREFETCH_MAX_CONCURRENT = 1;
  const PREFETCH_MAX_RETRIES_PER_URL = 1;
  const PREFETCH_HISTORY_SESSION_KEY = "__arrowPagerPrefetchHistoryV1";
  const PREFETCH_HISTORY_STORAGE_PREFIX = "__arrowPagerPrefetchHistoryV1:";
  const PREFETCH_HISTORY_STORAGE_TTL_MS = 6 * 60 * 60 * 1000;
  const PREFETCH_HISTORY_MAX_SIZE = 240;
  const PREFETCH_TIMEOUT_MS = 8000;
  const PREFETCH_BASE_INTERVAL_MS = 1600;
  const PREFETCH_HIDDEN_RETRY_MS = 2000;
  const PREFETCH_ERROR_BACKOFF_MS = 60000;
  const PREFETCH_RATE_LIMIT_BACKOFF_MS = 180000;
  const SPECULATION_RULE_SCRIPT_ID = "arrowPagerSpeculationRules";

  const CLICKABLE_SELECTOR =
    "a[href], button, [role='button'], [onclick], input[type='button'], input[type='submit']";
  const STORAGE_KEY = "arrowPagerSettings";
  const DEFAULT_SETTINGS = {
    enabled: true,
    showToast: false,
    cooldownMs: 0,
    toastDurationMs: 1200,
    doubleTapOnly: false,
    softNavigationOnly: true,
    hardNavigateFallback: false,
    prefetchEnabled: true,
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
  let prefetchQueue = [];
  let activePrefetchCount = 0;
  let prefetchScheduled = false;
  let prefetchPumpTimer = 0;
  let prefetchBackoffUntil = 0;
  let prefetchConsecutiveErrors = 0;
  let speculationRulesScript = null;
  let speculationRulesSerialized = "";
  const prefetchedPageUrls = new Set();
  const queuedPrefetchUrls = new Set();
  const inflightPrefetchUrls = new Set();
  const prefetchRetryCounts = new Map();
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

  function persistPrefetchHistory() {
    try {
      const urls = Array.from(prefetchedPageUrls);
      const sliced = urls.slice(Math.max(0, urls.length - PREFETCH_HISTORY_MAX_SIZE));
      sessionStorage.setItem(PREFETCH_HISTORY_SESSION_KEY, JSON.stringify(sliced));

      const storageKey = `${PREFETCH_HISTORY_STORAGE_PREFIX}${window.location.origin}`;
      if (chrome?.storage?.local?.set) {
        chrome.storage.local.set({
          [storageKey]: {
            updatedAt: Date.now(),
            urls: sliced
          }
        });
      }
    } catch {
      // Ignore sessionStorage failures.
    }
  }

  function rememberPrefetchedUrls(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return;
    let changed = false;
    for (const raw of urls) {
      const normalized = normalizePrefetchUrl(raw);
      if (!normalized) continue;
      if (prefetchedPageUrls.has(normalized)) {
        prefetchedPageUrls.delete(normalized);
      } else {
        changed = true;
      }
      prefetchedPageUrls.add(normalized);
      while (prefetchedPageUrls.size > PREFETCH_HISTORY_MAX_SIZE) {
        const oldest = prefetchedPageUrls.values().next().value;
        if (!oldest) break;
        prefetchedPageUrls.delete(oldest);
        changed = true;
      }
    }
    if (changed) persistPrefetchHistory();
  }

  function hydratePrefetchHistory() {
    try {
      const raw = sessionStorage.getItem(PREFETCH_HISTORY_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      rememberPrefetchedUrls(parsed);
    } catch {
      // Ignore malformed history entries.
    }

    const storageKey = `${PREFETCH_HISTORY_STORAGE_PREFIX}${window.location.origin}`;
    if (!chrome?.storage?.local?.get) return;
    chrome.storage.local.get([storageKey], (res) => {
      const entry = res?.[storageKey];
      if (!entry || typeof entry !== "object") return;
      const updatedAt = Number(entry.updatedAt) || 0;
      if (!updatedAt || (Date.now() - updatedAt) > PREFETCH_HISTORY_STORAGE_TTL_MS) {
        if (chrome?.storage?.local?.remove) {
          chrome.storage.local.remove(storageKey);
        }
        return;
      }
      const urls = Array.isArray(entry.urls) ? entry.urls : [];
      rememberPrefetchedUrls(urls);
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
      softNavigationOnly: raw.softNavigationOnly !== false,
      hardNavigateFallback: raw.hardNavigateFallback === true,
      prefetchEnabled: raw.prefetchEnabled !== false,
      globalPrev: String(raw.globalPrev || ""),
      globalNext: String(raw.globalNext || ""),
      siteRules: Array.isArray(raw.siteRules) ? raw.siteRules : []
    };
  }

  function loadSettings() {
    if (!chrome?.storage?.sync) {
      scheduleForwardPrefetch();
      return;
    }
    chrome.storage.sync.get({ [STORAGE_KEY]: DEFAULT_SETTINGS }, (res) => {
      settings = normalizeSettings(res[STORAGE_KEY]);
      scheduleForwardPrefetch();
    });
  }

  function watchSettings() {
    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      if (changes[STORAGE_KEY]) {
        settings = normalizeSettings(changes[STORAGE_KEY].newValue);
        if (!isPrefetchEnabled()) {
          prefetchQueue = [];
          queuedPrefetchUrls.clear();
          prefetchRetryCounts.clear();
          clearSpeculationRules();
          clearPrefetchPumpTimer();
        }
        scheduleForwardPrefetch();
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

  function findRelAnchor(direction) {
    const rel = direction === "next" ? "next" : "prev";
    const anchors = Array.from(document.querySelectorAll(`a[rel~='${rel}'][href]`));
    for (const anchor of anchors) {
      if (!isVisible(anchor)) continue;
      if (isLikelyDisabled(anchor)) continue;
      return anchor;
    }
    return null;
  }

  function findRelLink(direction) {
    const rel = direction === "next" ? "next" : "prev";
    return document.querySelector(`link[rel~='${rel}'][href]`);
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

  function hasHardNavigationCandidate(direction) {
    const candidates = [
      findByCustom(direction),
      findInPagination(direction),
      findBestGlobal(direction),
      findRelAnchor(direction)
    ];

    for (const el of candidates) {
      if (!el) continue;
      if (isLikelyDisabled(el)) continue;
      if (isSoftNavigableElement(el)) continue;
      return true;
    }
    return false;
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

  function isSoftNavigableElement(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (!tag) return false;

    if (tag === "LINK") return false;
    if (tag === "BUTTON") return true;
    if (tag === "INPUT") {
      const type = normalize(el.getAttribute("type"));
      return type === "button" || type === "submit";
    }

    const role = normalize(el.getAttribute?.("role"));
    if (role === "button") return true;

    if (tag !== "A") return true;

    if (el.hasAttribute?.("onclick")) return true;
    const href = (el.getAttribute?.("href") || "").trim();
    if (!href) return true;
    if (isJavascriptHref(href)) return true;
    if (href === "#" || href.startsWith("#")) return true;

    const classHint = normalize(el.className);
    const idHint = normalize(el.id);
    const attrs = (el.getAttributeNames?.() || []).map((name) => normalize(name));
    const hintText = `${classHint} ${idHint} ${attrs.join(" ")}`;
    if (
      hintText.includes("router") ||
      hintText.includes("ajax") ||
      hintText.includes("pjax") ||
      hintText.includes("turbo") ||
      hintText.includes("spa")
    ) {
      return true;
    }

    return false;
  }

  function isPrefetchEnabled() {
    return settings.prefetchEnabled !== false;
  }

  function normalizePrefetchUrl(urlString) {
    if (!urlString) return null;
    let url;
    try {
      url = new URL(urlString, window.location.href);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    if (url.origin !== window.location.origin) return null;
    url.hash = "";
    return url.toString();
  }

  function getSameOriginUrlFromElement(el) {
    if (!el) return null;
    const href = el.getAttribute?.("href");
    if (!href || isJavascriptHref(href)) return null;
    return normalizePrefetchUrl(href);
  }

  function collectNextUrlsFromPagination(limit) {
    const current = getCurrentPageNumber();
    const numbered = new Map();
    const loose = [];
    const containers = new Set();

    for (const selector of PAGINATION_SELECTORS) {
      const list = document.querySelectorAll(selector);
      for (const node of list) containers.add(node);
    }

    for (const container of containers) {
      const links = container.querySelectorAll("a[href], link[rel~='next']");
      for (const el of links) {
        const normalizedUrl = getSameOriginUrlFromElement(el);
        if (!normalizedUrl) continue;

        const pageNum = getPageNumberFromElement(el);
        if (Number.isFinite(pageNum)) {
          if (Number.isFinite(current) && pageNum <= current) continue;
          if (!numbered.has(pageNum)) numbered.set(pageNum, normalizedUrl);
        } else {
          loose.push(normalizedUrl);
        }
      }
    }

    const urls = [];
    if (numbered.size > 0) {
      const pages = Array.from(numbered.keys()).sort((a, b) => a - b);
      for (const pageNum of pages) {
        if (Number.isFinite(current) && pageNum > current + limit) continue;
        urls.push(numbered.get(pageNum));
        if (urls.length >= limit) return urls;
      }
    }

    for (const url of loose) {
      urls.push(url);
      if (urls.length >= limit) break;
    }

    return urls;
  }

  function buildSequentialNextUrls(limit) {
    const base = new URL(window.location.href);
    base.hash = "";

    for (const key of PAGE_PARAM_CANDIDATES) {
      if (!base.searchParams.has(key)) continue;
      const value = base.searchParams.get(key);
      const current = Number(value);
      if (!Number.isFinite(current) || current <= 0) continue;

      const urls = [];
      for (let i = 1; i <= limit; i += 1) {
        const next = new URL(base.toString());
        next.searchParams.set(key, String(current + i));
        urls.push(next.toString());
      }
      return urls;
    }

    const pathMatch = base.pathname.match(/(.*?)(\d+)([^\d]*)$/);
    if (!pathMatch) return [];
    const prefix = pathMatch[1];
    const current = Number(pathMatch[2]);
    const suffix = pathMatch[3];
    if (!Number.isFinite(current) || current <= 0) return [];

    const urls = [];
    for (let i = 1; i <= limit; i += 1) {
      const next = new URL(base.toString());
      next.pathname = `${prefix}${current + i}${suffix}`;
      urls.push(next.toString());
    }
    return urls;
  }

  function collectForwardPrefetchUrls(limit = PREFETCH_AHEAD_COUNT) {
    const candidates = [];
    const relNextUrl =
      getSameOriginUrlFromElement(findRelAnchor("next")) ||
      getSameOriginUrlFromElement(findRelLink("next"));
    if (relNextUrl) candidates.push(relNextUrl);
    candidates.push(...collectNextUrlsFromPagination(limit));
    candidates.push(...buildSequentialNextUrls(limit));

    const currentUrl = normalizePrefetchUrl(window.location.href);
    const deduped = [];
    const seen = new Set();

    for (const candidate of candidates) {
      const normalized = normalizePrefetchUrl(candidate);
      if (!normalized) continue;
      if (normalized === currentUrl) continue;
      if (
        prefetchedPageUrls.has(normalized) ||
        queuedPrefetchUrls.has(normalized) ||
        inflightPrefetchUrls.has(normalized)
      ) {
        continue;
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      deduped.push(normalized);
      if (deduped.length >= limit) break;
    }

    return deduped;
  }

  function getPrefetchIntervalMs() {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return PREFETCH_BASE_INTERVAL_MS;
    if (connection.saveData) return 3000;
    const type = String(connection.effectiveType || "").toLowerCase();
    if (type.includes("slow-2g")) return 4500;
    if (type.includes("2g")) return 4000;
    if (type.includes("3g")) return 2600;
    return PREFETCH_BASE_INTERVAL_MS;
  }

  function clearPrefetchPumpTimer() {
    if (!prefetchPumpTimer) return;
    window.clearTimeout(prefetchPumpTimer);
    prefetchPumpTimer = 0;
  }

  function supportsSpeculationRules() {
    try {
      return (
        typeof HTMLScriptElement !== "undefined" &&
        typeof HTMLScriptElement.supports === "function" &&
        HTMLScriptElement.supports("speculationrules")
      );
    } catch {
      return false;
    }
  }

  function clearSpeculationRules() {
    if (speculationRulesScript?.parentNode) {
      speculationRulesScript.parentNode.removeChild(speculationRulesScript);
    } else {
      const existing = document.getElementById(SPECULATION_RULE_SCRIPT_ID);
      if (existing?.parentNode) existing.parentNode.removeChild(existing);
    }
    speculationRulesScript = null;
    speculationRulesSerialized = "";
  }

  function getOrCreateSpeculationRulesScript() {
    if (speculationRulesScript && speculationRulesScript.isConnected) {
      return speculationRulesScript;
    }

    const existing = document.getElementById(SPECULATION_RULE_SCRIPT_ID);
    if (existing) {
      speculationRulesScript = existing;
      return speculationRulesScript;
    }

    const parent = document.head || document.documentElement;
    if (!parent) return null;

    const script = document.createElement("script");
    script.id = SPECULATION_RULE_SCRIPT_ID;
    script.type = "speculationrules";
    parent.appendChild(script);
    speculationRulesScript = script;
    return speculationRulesScript;
  }

  function canUsePrerender() {
    if (document.visibilityState !== "visible") return false;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!connection) return true;
    if (connection.saveData) return false;
    const type = String(connection.effectiveType || "").toLowerCase();
    if (type.includes("slow-2g") || type.includes("2g")) return false;
    return true;
  }

  function applySpeculationRules(urls) {
    const result = { applied: false, prerenderedUrl: null };
    if (!supportsSpeculationRules()) return result;
    if (!Array.isArray(urls) || urls.length === 0) {
      clearSpeculationRules();
      return result;
    }

    const prerenderCount = canUsePrerender() ? PREFETCH_PRERENDER_COUNT : 0;
    const prerenderUrls = prerenderCount > 0 ? urls.slice(0, prerenderCount) : [];
    const prefetchUrls = urls.slice(prerenderUrls.length);
    const coveredUrls = [...prerenderUrls, ...prefetchUrls];

    const rules = {};
    if (prerenderUrls.length > 0) {
      rules.prerender = [{ urls: prerenderUrls, eagerness: "immediate" }];
    }
    if (prefetchUrls.length > 0) {
      rules.prefetch = [{ urls: prefetchUrls, eagerness: "immediate" }];
    }

    if (Object.keys(rules).length === 0) {
      clearSpeculationRules();
      return result;
    }

    const serialized = JSON.stringify(rules);
    if (serialized === speculationRulesSerialized) {
      rememberPrefetchedUrls(coveredUrls);
      return { applied: true, prerenderedUrl: prerenderUrls[0] || null };
    }

    const script = getOrCreateSpeculationRulesScript();
    if (!script) return result;
    script.textContent = serialized;
    speculationRulesSerialized = serialized;
    rememberPrefetchedUrls(coveredUrls);
    return { applied: true, prerenderedUrl: prerenderUrls[0] || null };
  }

  function schedulePrefetchPump(delayMs = 0) {
    if (prefetchPumpTimer) return;
    prefetchPumpTimer = window.setTimeout(() => {
      prefetchPumpTimer = 0;
      consumePrefetchQueue();
    }, Math.max(0, delayMs));
  }

  async function prefetchDocument(url) {
    if (typeof window.fetch !== "function") return { ok: false, rateLimited: false };

    let controller = null;
    let timeoutId = 0;
    if (typeof AbortController === "function") {
      controller = new AbortController();
      timeoutId = window.setTimeout(() => controller.abort(), PREFETCH_TIMEOUT_MS);
    }

    try {
      const response = await window.fetch(url, {
        method: "GET",
        credentials: "include",
        mode: "same-origin",
        cache: "force-cache",
        signal: controller ? controller.signal : undefined
      });
      if (response?.status === 429 || response?.status === 403) {
        return { ok: false, rateLimited: true };
      }
      if (!response?.ok) {
        return { ok: false, rateLimited: false };
      }
      return { ok: true, rateLimited: false };
    } catch {
      return { ok: false, rateLimited: false };
    } finally {
      if (timeoutId) window.clearTimeout(timeoutId);
    }
  }

  function consumePrefetchQueue() {
    if (activePrefetchCount >= PREFETCH_MAX_CONCURRENT) return;
    if (prefetchQueue.length === 0) return;
    if (document.visibilityState === "hidden") {
      schedulePrefetchPump(PREFETCH_HIDDEN_RETRY_MS);
      return;
    }

    const now = Date.now();
    if (prefetchBackoffUntil > now) {
      schedulePrefetchPump(prefetchBackoffUntil - now);
      return;
    }

    const nextUrl = prefetchQueue.shift();
    if (!nextUrl) return;
    queuedPrefetchUrls.delete(nextUrl);
    inflightPrefetchUrls.add(nextUrl);
    activePrefetchCount += 1;

    prefetchDocument(nextUrl)
      .then((result) => {
        if (result.rateLimited) {
          prefetchBackoffUntil = Date.now() + PREFETCH_RATE_LIMIT_BACKOFF_MS;
          prefetchConsecutiveErrors = 0;
          prefetchQueue = [];
          queuedPrefetchUrls.clear();
          return;
        }
        if (!result.ok) {
          const retries = prefetchRetryCounts.get(nextUrl) || 0;
          if (retries < PREFETCH_MAX_RETRIES_PER_URL) {
            prefetchRetryCounts.set(nextUrl, retries + 1);
            if (!queuedPrefetchUrls.has(nextUrl)) {
              queuedPrefetchUrls.add(nextUrl);
              prefetchQueue.push(nextUrl);
            }
          }
          prefetchConsecutiveErrors += 1;
          if (prefetchConsecutiveErrors >= 2) {
            prefetchBackoffUntil = Date.now() + PREFETCH_ERROR_BACKOFF_MS;
            prefetchConsecutiveErrors = 0;
          }
          return;
        }
        prefetchedPageUrls.add(nextUrl);
        prefetchRetryCounts.delete(nextUrl);
        prefetchConsecutiveErrors = 0;
      })
      .finally(() => {
        inflightPrefetchUrls.delete(nextUrl);
        activePrefetchCount -= 1;
        clearPrefetchPumpTimer();
        schedulePrefetchPump(getPrefetchIntervalMs());
      });
  }

  function enqueuePrefetch(urls) {
    if (!Array.isArray(urls) || urls.length === 0) return;
    const accepted = [];
    for (const url of urls) {
      if (!url) continue;
      if (prefetchedPageUrls.has(url) || queuedPrefetchUrls.has(url) || inflightPrefetchUrls.has(url)) continue;
      queuedPrefetchUrls.add(url);
      prefetchQueue.push(url);
      accepted.push(url);
    }
    rememberPrefetchedUrls(accepted);
    clearPrefetchPumpTimer();
    schedulePrefetchPump(200);
  }

  function scheduleForwardPrefetch() {
    if (prefetchScheduled) return;
    prefetchScheduled = true;

    const run = () => {
      prefetchScheduled = false;
      if (isSiteDisabled()) {
        clearSpeculationRules();
        return;
      }
      if (!isPrefetchEnabled()) {
        clearSpeculationRules();
        return;
      }
      if (Date.now() < prefetchBackoffUntil) {
        clearSpeculationRules();
        return;
      }
      const urls = collectForwardPrefetchUrls(PREFETCH_AHEAD_COUNT);
      const speculation = applySpeculationRules(urls);
      const fetchFallbackUrls = speculation.applied ? [] : urls;
      enqueuePrefetch(fetchFallbackUrls);
    };

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 1200 });
    } else {
      window.setTimeout(run, 120);
    }
  }

  function scheduleForwardPrefetchSoon() {
    if (!isPrefetchEnabled()) return;
    window.setTimeout(() => {
      scheduleForwardPrefetch();
    }, 260);
  }

  function clickElement(el) {
    if (!el) return false;
    if (isLikelyDisabled(el)) return false;
    if (settings.softNavigationOnly !== false && !isSoftNavigableElement(el)) return false;

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

  function triggerSuccess(direction, targetEl) {
    showToast(
      buildToastMessage(direction === "next" ? "下一页" : "上一页", getExpectedPageNumber(direction, targetEl)),
      "ok"
    );
    scheduleForwardPrefetchSoon();
    return true;
  }

  function trigger(direction) {
    const customEl = findByCustom(direction);
    if (clickElement(customEl)) {
      return triggerSuccess(direction, customEl);
    }

    const paginationEl = findInPagination(direction);
    if (clickElement(paginationEl)) {
      return triggerSuccess(direction, paginationEl);
    }

    const best = findBestGlobal(direction);
    if (clickElement(best)) {
      return triggerSuccess(direction, best);
    }

    // `link[rel=next/prev]` in <head> is a metadata hint, not an interactive control.
    // Use only visible anchor rel targets for navigation to maximize site-native, no-refresh flips.
    const relAnchor = findRelAnchor(direction);
    if (clickElement(relAnchor)) {
      return triggerSuccess(direction, relAnchor);
    }

    if (settings.hardNavigateFallback && urlNextPrev(direction)) {
      return triggerSuccess(direction, null);
    }

    const pageHint = formatPageHint(getCurrentPageNumber());
    const reason = isSiteDisabled()
      ? "本站在禁用列表中"
      : hasHardNavigationCandidate(direction)
        ? "仅检测到硬跳转链接（已按无刷新策略跳过）"
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    clearPrefetchPumpTimer();
    schedulePrefetchPump(300);
  });

  hydratePrefetchHistory();
  loadSettings();
  watchSettings();
})();
