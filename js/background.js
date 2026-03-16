const BLACKLIST_KEY = 'blackList'
const BLACKLIST_DATA_KEY = 'blackListData'
const BLACKLIST_DATA_VERSION = 2
const BLACKLIST_CONFLICT_STRATEGY = 'latest-write-wins'
const DEFAULT_BLACKLIST = ['pornhub.com', 'bilibili.com', 'weibo.com']

const MEDIA_DEFAULT_MINUTES_KEY = 'mediaAutoStopDefaultMinutes'
const MEDIA_NOTIFICATION_KEY = 'mediaAutoStopNotification'
const MEDIA_ALARM_NAME = 'mediaAutoStopAlarm'
const DEFAULT_MEDIA_SETTINGS = {
  [MEDIA_DEFAULT_MINUTES_KEY]: 30,
  [MEDIA_NOTIFICATION_KEY]: true
}

const HISTORY_SEARCH_MAX_RESULTS = 5000
const HISTORY_SWEEP_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const HISTORY_DOMAIN_SWEEP_COOLDOWN_MS = 5 * 60 * 1000

let blackListData = null
let blackList = [...DEFAULT_BLACKLIST]
const lastDomainSweepAt = new Map()

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const normalizeDomainPattern = (inputValue) => {
  if (typeof inputValue !== 'string') return ''

  let value = inputValue.trim().toLowerCase()
  if (!value) return ''

  value = value.replace(/^[a-z]+:\/\//, '')
  value = value.split('/')[0]
  value = value.split('?')[0]
  value = value.split('#')[0]
  value = value.replace(/:\d+$/, '')
  value = value.replace(/^\.+/, '').replace(/\.+$/, '')

  if (!value) return ''

  const labels = value.split('.').filter(Boolean)
  if (labels.length < 2) return ''

  if (labels[0] === 'www' && labels[1] !== '*') {
    labels.shift()
  }
  if (labels[0] === '*' && labels.length >= 3) {
    labels.shift()
  }

  const valid = labels.every((label) => {
    if (label === '*') return true
    if (!/^[a-z0-9-]+$/.test(label)) return false
    if (label.startsWith('-') || label.endsWith('-')) return false
    return true
  })

  if (!valid) return ''

  return labels.join('.')
}

const cloneBlacklistData = (data) => JSON.parse(JSON.stringify(data))

const createBlacklistDataFromList = (list, timestamp = Date.now()) => {
  const entries = {}
  list.forEach((pattern) => {
    const normalized = normalizeDomainPattern(pattern)
    if (!normalized) return
    entries[normalized] = {
      active: true,
      updatedAt: timestamp
    }
  })

  return {
    version: BLACKLIST_DATA_VERSION,
    strategy: BLACKLIST_CONFLICT_STRATEGY,
    updatedAt: timestamp,
    orderUpdatedAt: timestamp,
    entries,
    order: Object.keys(entries)
  }
}

const sanitizeBlacklistData = (raw, fallbackList = []) => {
  const safe = {
    version: BLACKLIST_DATA_VERSION,
    strategy: BLACKLIST_CONFLICT_STRATEGY,
    updatedAt: 0,
    orderUpdatedAt: 0,
    entries: {},
    order: []
  }

  if (raw && typeof raw === 'object') {
    safe.updatedAt = Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0
    safe.orderUpdatedAt = Number.isFinite(raw.orderUpdatedAt) ? Number(raw.orderUpdatedAt) : safe.updatedAt

    if (raw.entries && typeof raw.entries === 'object') {
      Object.keys(raw.entries).forEach((key) => {
        const normalizedPattern = normalizeDomainPattern(key)
        if (!normalizedPattern) return

        const item = raw.entries[key]
        if (!item || typeof item !== 'object') return

        const nextEntry = {
          active: Boolean(item.active),
          updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : 0
        }
        const existing = safe.entries[normalizedPattern]
        if (!existing || nextEntry.updatedAt >= existing.updatedAt) {
          safe.entries[normalizedPattern] = nextEntry
        }
      })
    }

    if (Array.isArray(raw.order)) {
      const uniqueOrder = []
      raw.order.forEach((pattern) => {
        const normalizedPattern = normalizeDomainPattern(pattern)
        if (!normalizedPattern) return
        if (uniqueOrder.includes(normalizedPattern)) return
        uniqueOrder.push(normalizedPattern)
      })
      safe.order = uniqueOrder
    }
  }

  fallbackList.forEach((pattern) => {
    const normalizedPattern = normalizeDomainPattern(pattern)
    if (!normalizedPattern) return
    if (safe.entries[normalizedPattern]) return
    safe.entries[normalizedPattern] = { active: true, updatedAt: 0 }
    safe.order.push(normalizedPattern)
  })

  return safe
}

const deriveActiveBlacklist = (data) => {
  const activeSet = new Set(
    Object.keys(data.entries).filter((pattern) => data.entries[pattern].active)
  )
  const ordered = []

  data.order.forEach((pattern) => {
    if (!activeSet.has(pattern)) return
    ordered.push(pattern)
    activeSet.delete(pattern)
  })

  const remain = [...activeSet].sort((a, b) => a.localeCompare(b))
  return [...ordered, ...remain]
}

const mergeBlacklistData = (base, incoming) => {
  const safeBase = sanitizeBlacklistData(base)
  const safeIncoming = sanitizeBlacklistData(incoming)
  const allPatterns = new Set([
    ...Object.keys(safeBase.entries),
    ...Object.keys(safeIncoming.entries)
  ])
  const mergedEntries = {}

  allPatterns.forEach((pattern) => {
    const baseEntry = safeBase.entries[pattern]
    const incomingEntry = safeIncoming.entries[pattern]
    if (!baseEntry) {
      mergedEntries[pattern] = incomingEntry
      return
    }
    if (!incomingEntry) {
      mergedEntries[pattern] = baseEntry
      return
    }

    if (incomingEntry.updatedAt >= baseEntry.updatedAt) {
      mergedEntries[pattern] = incomingEntry
      return
    }

    mergedEntries[pattern] = baseEntry
  })

  const primaryOrder = safeIncoming.orderUpdatedAt >= safeBase.orderUpdatedAt ? safeIncoming.order : safeBase.order
  const secondaryOrder = primaryOrder === safeIncoming.order ? safeBase.order : safeIncoming.order
  const mergedOrder = []

  ;[...primaryOrder, ...secondaryOrder].forEach((pattern) => {
    if (!mergedEntries[pattern] || !mergedEntries[pattern].active) return
    if (mergedOrder.includes(pattern)) return
    mergedOrder.push(pattern)
  })

  Object.keys(mergedEntries)
    .filter((pattern) => mergedEntries[pattern].active && !mergedOrder.includes(pattern))
    .sort((a, b) => a.localeCompare(b))
    .forEach((pattern) => {
      mergedOrder.push(pattern)
    })

  return {
    version: BLACKLIST_DATA_VERSION,
    strategy: BLACKLIST_CONFLICT_STRATEGY,
    updatedAt: Math.max(safeBase.updatedAt, safeIncoming.updatedAt),
    orderUpdatedAt: Math.max(safeBase.orderUpdatedAt, safeIncoming.orderUpdatedAt),
    entries: mergedEntries,
    order: mergedOrder
  }
}

const getSyncStorage = (keys) => new Promise((resolve) => {
  chrome.storage.sync.get(keys, (result) => {
    resolve(result || {})
  })
})

const setSyncStorage = (patch) => new Promise((resolve) => {
  chrome.storage.sync.set(patch, () => {
    resolve()
  })
})

const updateBlacklistCache = (data) => {
  blackListData = data
  blackList = deriveActiveBlacklist(data)
}

const persistBlacklistData = async (data) => {
  const activeList = deriveActiveBlacklist(data)
  await setSyncStorage({
    [BLACKLIST_DATA_KEY]: data,
    [BLACKLIST_KEY]: activeList
  })
  updateBlacklistCache(data)
}

const getStoredBlacklistData = async () => {
  const result = await getSyncStorage([BLACKLIST_DATA_KEY, BLACKLIST_KEY])
  const storedLegacy = Array.isArray(result[BLACKLIST_KEY]) ? result[BLACKLIST_KEY] : []
  const normalizedLegacy = storedLegacy
    .map(normalizeDomainPattern)
    .filter(Boolean)
  const uniqueLegacy = [...new Set(normalizedLegacy)]

  if (!result[BLACKLIST_DATA_KEY]) {
    const initialList = uniqueLegacy.length > 0 ? uniqueLegacy : DEFAULT_BLACKLIST
    const initialData = createBlacklistDataFromList(initialList)
    await persistBlacklistData(initialData)
    return initialData
  }

  const currentData = sanitizeBlacklistData(result[BLACKLIST_DATA_KEY], uniqueLegacy)
  const activeList = deriveActiveBlacklist(currentData)
  const normalizedStoredLegacy = [...new Set(uniqueLegacy)]
  const needsLegacySync = JSON.stringify(activeList) !== JSON.stringify(normalizedStoredLegacy)
  if (needsLegacySync) {
    await persistBlacklistData(currentData)
    return currentData
  }

  updateBlacklistCache(currentData)
  return currentData
}

const ensureBlacklistInStorage = async () => {
  await getStoredBlacklistData()
}

const ensureMediaSettingsInStorage = () => {
  chrome.storage.sync.get([MEDIA_DEFAULT_MINUTES_KEY, MEDIA_NOTIFICATION_KEY], (result) => {
    const patch = {}

    if (typeof result[MEDIA_DEFAULT_MINUTES_KEY] !== 'number') {
      patch[MEDIA_DEFAULT_MINUTES_KEY] = DEFAULT_MEDIA_SETTINGS[MEDIA_DEFAULT_MINUTES_KEY]
    }
    if (typeof result[MEDIA_NOTIFICATION_KEY] !== 'boolean') {
      patch[MEDIA_NOTIFICATION_KEY] = DEFAULT_MEDIA_SETTINGS[MEDIA_NOTIFICATION_KEY]
    }

    if (Object.keys(patch).length > 0) {
      chrome.storage.sync.set(patch)
    }
  })
}

const mutateBlacklistData = async (mutator) => {
  const latest = await getStoredBlacklistData()
  const draft = cloneBlacklistData(latest)
  mutator(draft)
  const merged = mergeBlacklistData(latest, draft)
  await persistBlacklistData(merged)
  return merged
}

const getBlacklistList = async () => {
  const data = await getStoredBlacklistData()
  return deriveActiveBlacklist(data)
}

const addBlacklistPattern = async (rawPattern) => {
  const pattern = normalizeDomainPattern(rawPattern)
  if (!pattern) {
    throw new Error('请输入有效域名，例如 weibo.com 或 *.example.com')
  }

  const updatedData = await mutateBlacklistData((draft) => {
    const now = Date.now()
    const existing = draft.entries[pattern]
    if (existing && existing.active) {
      throw new Error('该域名已在过滤列表中。')
    }

    draft.entries[pattern] = { active: true, updatedAt: now }
    draft.order = draft.order.filter((item) => item !== pattern)
    draft.order.push(pattern)
    draft.updatedAt = now
    draft.orderUpdatedAt = now
  })

  return deriveActiveBlacklist(updatedData)
}

const removeBlacklistPattern = async (rawPattern) => {
  const pattern = normalizeDomainPattern(rawPattern)
  if (!pattern) {
    throw new Error('请输入有效域名。')
  }

  const updatedData = await mutateBlacklistData((draft) => {
    const now = Date.now()
    const existing = draft.entries[pattern]
    if (!existing || !existing.active) {
      throw new Error('该域名不在过滤列表中。')
    }

    draft.entries[pattern] = { active: false, updatedAt: now }
    draft.order = draft.order.filter((item) => item !== pattern)
    draft.updatedAt = now
    draft.orderUpdatedAt = now
  })

  return deriveActiveBlacklist(updatedData)
}

const reorderBlacklistPatterns = async (nextOrder) => {
  if (!Array.isArray(nextOrder)) {
    throw new Error('排序数据无效。')
  }

  const updatedData = await mutateBlacklistData((draft) => {
    const now = Date.now()
    const activeList = deriveActiveBlacklist(draft)
    const activeSet = new Set(activeList)
    const normalizedOrder = []

    nextOrder.forEach((pattern) => {
      const normalizedPattern = normalizeDomainPattern(pattern)
      if (!normalizedPattern) return
      if (!activeSet.has(normalizedPattern)) return
      if (normalizedOrder.includes(normalizedPattern)) return
      normalizedOrder.push(normalizedPattern)
    })

    activeList.forEach((pattern) => {
      if (normalizedOrder.includes(pattern)) return
      normalizedOrder.push(pattern)
    })

    draft.order = normalizedOrder
    draft.updatedAt = now
    draft.orderUpdatedAt = now
  })

  return deriveActiveBlacklist(updatedData)
}

const getPatternMatcher = (pattern) => {
  if (!pattern.includes('*')) {
    return (hostname) => hostname === pattern || hostname.endsWith(`.${pattern}`)
  }

  const labels = pattern.split('.').map((label) => {
    if (label === '*') return '[^.]+'
    return escapeRegex(label)
  })
  const regex = new RegExp(`(^|\\.)${labels.join('\\.')}$`)
  return (hostname) => regex.test(hostname)
}

const isDomainMatch = (url, pattern) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    const normalizedPattern = normalizeDomainPattern(pattern)
    if (!normalizedPattern) return false
    const matcher = getPatternMatcher(normalizedPattern)
    return matcher(hostname)
  } catch {
    return false
  }
}

const isInjectableUrl = (url) => {
  return url &&
    !url.startsWith('chrome://') &&
    !url.startsWith('chrome-extension://') &&
    !url.startsWith('chrome-search://') &&
    !url.startsWith('chrome-devtools://') &&
    !url.startsWith('devtools://') &&
    !url.startsWith('about:') &&
    !url.startsWith('edge://') &&
    !url.startsWith('brave://')
}

const setMediaBadge = (isRunning) => {
  if (!isRunning) {
    chrome.action.setBadgeText({ text: '' })
    return
  }

  chrome.action.setBadgeText({ text: 'ON' })
  chrome.action.setBadgeBackgroundColor({ color: '#d9480f' })
}

const getMediaAlarm = () => new Promise((resolve) => {
  chrome.alarms.get(MEDIA_ALARM_NAME, (alarm) => {
    resolve(alarm || null)
  })
})

const clearMediaAlarm = () => new Promise((resolve) => {
  chrome.alarms.clear(MEDIA_ALARM_NAME, () => {
    resolve()
  })
})

const searchHistoryInWindow = (text = '') => new Promise((resolve) => {
  const startTime = Date.now() - HISTORY_SWEEP_WINDOW_MS
  chrome.history.search({
    text,
    startTime,
    maxResults: HISTORY_SEARCH_MAX_RESULTS
  }, (historyItems) => {
    resolve(Array.isArray(historyItems) ? historyItems : [])
  })
})

const searchMatchedHistoryByPattern = async (pattern) => {
  const allItems = await searchHistoryInWindow('')
  return allItems.filter((item) => item.url && isDomainMatch(item.url, pattern))
}

const getMatchedCleanupStatsForPatterns = async (patterns) => {
  const allItems = await searchHistoryInWindow('')
  const uniqueUrls = new Set()
  const patternUrlSets = {}

  patterns.forEach((pattern) => {
    patternUrlSets[pattern] = new Set()
  })

  allItems.forEach((item) => {
    if (!item || !item.url) return

    let matched = false
    patterns.forEach((pattern) => {
      if (!isDomainMatch(item.url, pattern)) return
      patternUrlSets[pattern].add(item.url)
      matched = true
    })

    if (matched) {
      uniqueUrls.add(item.url)
    }
  })

  const domainPendingMap = {}
  patterns.forEach((pattern) => {
    domainPendingMap[pattern] = patternUrlSets[pattern].size
  })

  return { uniqueUrls, domainPendingMap }
}

const deleteHistoryUrl = (url) => new Promise((resolve) => {
  chrome.history.deleteUrl({ url }, () => {
    resolve()
  })
})

const cleanupHistoryForPattern = async (pattern, options = {}) => {
  const { force = false } = options
  const now = Date.now()

  if (!force) {
    const lastSweep = lastDomainSweepAt.get(pattern) || 0
    if (now - lastSweep < HISTORY_DOMAIN_SWEEP_COOLDOWN_MS) {
      return 0
    }
    lastDomainSweepAt.set(pattern, now)
  }

  const matchedItems = await searchMatchedHistoryByPattern(pattern)
  const uniqueUrls = [...new Set(matchedItems.map((item) => item.url))]
  await Promise.all(uniqueUrls.map(deleteHistoryUrl))
  return uniqueUrls.length
}

const cleanupNow = async () => {
  const patterns = await getBlacklistList()
  if (!patterns.length) {
    return { removedCount: 0, domainCount: 0 }
  }

  const { uniqueUrls } = await getMatchedCleanupStatsForPatterns(patterns)
  await Promise.all([...uniqueUrls].map(deleteHistoryUrl))
  const removedCount = uniqueUrls.size

  return { removedCount, domainCount: patterns.length }
}

const getPendingCleanupSummary = async () => {
  const patterns = await getBlacklistList()
  if (!patterns.length) {
    return { pendingCount: 0, domainPendingMap: {} }
  }

  const { uniqueUrls, domainPendingMap } = await getMatchedCleanupStatsForPatterns(patterns)
  return { pendingCount: uniqueUrls.size, domainPendingMap }
}

const stopAllMediaPlayback = async () => {
  const tabs = await chrome.tabs.query({})
  let pausedCount = 0

  await Promise.all(tabs.map(async (tab) => {
    if (!tab.id || !tab.url || !isInjectableUrl(tab.url)) {
      return
    }

    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          let paused = 0
          document.querySelectorAll('video, audio').forEach((media) => {
            if (!media.paused) {
              media.pause()
              paused += 1
            }
          })
          return paused
        }
      })

      const currentTabPaused = (results && results[0] && results[0].result) || 0
      if (currentTabPaused > 0) {
        pausedCount += currentTabPaused
      }
    } catch (error) {
      console.error(`向标签页 ${tab.id} 注入脚本失败:`, error)
    }
  }))

  return { pausedCount }
}

const syncMediaCountdownState = async () => {
  const alarm = await getMediaAlarm()
  const now = Date.now()

  if (!alarm || !alarm.scheduledTime) {
    setMediaBadge(false)
    return
  }

  if (alarm.scheduledTime <= now) {
    await handleMediaCountdownEnd()
    return
  }

  setMediaBadge(true)
}

const startMediaCountdown = async (minutes) => {
  const safeMinutes = Number(minutes)
  if (!Number.isInteger(safeMinutes) || safeMinutes < 1 || safeMinutes > 1440) {
    throw new Error(chrome.i18n.getMessage('mediaMinutesRangeError') || '请输入 1-1440 之间的分钟数')
  }

  const endTime = Date.now() + safeMinutes * 60 * 1000
  await clearMediaAlarm()
  chrome.alarms.create(MEDIA_ALARM_NAME, { when: endTime })
  setMediaBadge(true)

  return {
    isRunning: true,
    remainingTime: safeMinutes * 60
  }
}

const stopMediaCountdown = async () => {
  await clearMediaAlarm()
  setMediaBadge(false)
  return { isRunning: false, remainingTime: 0 }
}

const getMediaCountdownStatus = async () => {
  const alarm = await getMediaAlarm()
  if (!alarm || !alarm.scheduledTime) {
    setMediaBadge(false)
    return { isRunning: false, remainingTime: 0 }
  }

  const remainingTime = Math.max(0, Math.floor((alarm.scheduledTime - Date.now()) / 1000))
  if (remainingTime <= 0) {
    await handleMediaCountdownEnd()
    return { isRunning: false, remainingTime: 0 }
  }

  setMediaBadge(true)
  return { isRunning: true, remainingTime }
}

const handleMediaCountdownEnd = async () => {
  const { pausedCount } = await stopAllMediaPlayback()
  await stopMediaCountdown()

  chrome.storage.sync.get([MEDIA_NOTIFICATION_KEY], (result) => {
    if (!result[MEDIA_NOTIFICATION_KEY]) return

    const title = chrome.i18n.getMessage('mediaNotificationTitle') || '媒体自动停止'
    const withMediaMessage = chrome.i18n.getMessage('mediaNotificationStoppedSome', String(pausedCount))
    const withoutMediaMessage = chrome.i18n.getMessage('mediaNotificationStoppedNone') || '倒计时结束，未发现正在播放的媒体'

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'img/icon-128.png',
      title,
      message: pausedCount > 0 ? withMediaMessage : withoutMediaMessage
    })
  })
}

const removeHistoryFromBlackList = (url) => {
  try {
    if (!url) return

    const blacklistedPattern = blackList.find((pattern) => isDomainMatch(url, pattern))
    if (!blacklistedPattern) return

    deleteHistoryUrl(url).catch((error) => {
      console.error('删除当前历史记录失败:', error)
    })

    cleanupHistoryForPattern(blacklistedPattern).catch((error) => {
      console.error('自动清理历史记录失败:', error)
    })
  } catch (error) {
    console.error('删除历史记录时出错:', error)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureBlacklistInStorage().catch((error) => {
    console.error('初始化黑名单配置失败:', error)
  })
  ensureMediaSettingsInStorage()
  syncMediaCountdownState().catch((error) => {
    console.error('同步媒体倒计时状态失败:', error)
  })
})

chrome.runtime.onStartup.addListener(() => {
  ensureBlacklistInStorage().catch((error) => {
    console.error('初始化黑名单配置失败:', error)
  })
  ensureMediaSettingsInStorage()
  syncMediaCountdownState().catch((error) => {
    console.error('同步媒体倒计时状态失败:', error)
  })
})

chrome.tabs.onActivated.addListener((tab) => {
  chrome.tabs.get(tab.tabId, (currentTab) => {
    removeHistoryFromBlackList(currentTab && currentTab.url)
  })
})

chrome.history.onVisited.addListener((historyItem) => {
  removeHistoryFromBlackList(historyItem && historyItem.url)
})

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return
  if (!changes[BLACKLIST_DATA_KEY] && !changes[BLACKLIST_KEY]) return

  getStoredBlacklistData().catch((error) => {
    console.error('同步黑名单缓存失败:', error)
  })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm || alarm.name !== MEDIA_ALARM_NAME) return

  handleMediaCountdownEnd().catch((error) => {
    console.error('媒体倒计时结束处理失败:', error)
  })
})

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (!message || !message.type) {
    return
  }

  if (message.type === 'BLACKLIST_GET') {
    getBlacklistList()
      .then((list) => {
        sendResponse({
          ok: true,
          list,
          strategy: BLACKLIST_CONFLICT_STRATEGY
        })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '获取黑名单失败'
        })
      })

    return true
  }

  if (message.type === 'BLACKLIST_ADD') {
    addBlacklistPattern(message.pattern)
      .then((list) => {
        sendResponse({ ok: true, list })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '新增黑名单失败'
        })
      })

    return true
  }

  if (message.type === 'BLACKLIST_REMOVE') {
    removeBlacklistPattern(message.pattern)
      .then((list) => {
        sendResponse({ ok: true, list })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '删除黑名单失败'
        })
      })

    return true
  }

  if (message.type === 'BLACKLIST_REORDER') {
    reorderBlacklistPatterns(message.order)
      .then((list) => {
        sendResponse({ ok: true, list })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '排序黑名单失败'
        })
      })

    return true
  }

  if (message.type === 'RUN_CLEANUP_NOW') {
    cleanupNow()
      .then(({ removedCount, domainCount }) => {
        sendResponse({
          ok: true,
          removedCount,
          domainCount
        })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '清理失败'
        })
      })

    return true
  }

  if (message.type === 'GET_PENDING_CLEANUP_SUMMARY') {
    getPendingCleanupSummary()
      .then(({ pendingCount, domainPendingMap }) => {
        sendResponse({
          ok: true,
          pendingCount,
          domainPendingMap
        })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '获取待清理记录失败'
        })
      })

    return true
  }

  if (message.type === 'MEDIA_AUTO_STOP_START') {
    startMediaCountdown(message.minutes)
      .then((status) => {
        sendResponse({ ok: true, ...status })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '启动倒计时失败'
        })
      })

    return true
  }

  if (message.type === 'MEDIA_AUTO_STOP_STOP') {
    stopMediaCountdown()
      .then((status) => {
        sendResponse({ ok: true, ...status })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '停止倒计时失败'
        })
      })

    return true
  }

  if (message.type === 'MEDIA_AUTO_STOP_STATUS') {
    getMediaCountdownStatus()
      .then((status) => {
        sendResponse({ ok: true, ...status })
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error && error.message ? error.message : '获取倒计时状态失败',
          isRunning: false,
          remainingTime: 0
        })
      })

    return true
  }
})

ensureBlacklistInStorage().catch((error) => {
  console.error('初始化黑名单配置失败:', error)
})
ensureMediaSettingsInStorage()
syncMediaCountdownState().catch((error) => {
  console.error('同步媒体倒计时状态失败:', error)
})
