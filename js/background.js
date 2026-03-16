const BLACKLIST_KEY = 'blackList'
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
let blackList = [...DEFAULT_BLACKLIST]
const lastDomainSweepAt = new Map()

const isDomainMatch = (url, domain) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === domain || hostname.endsWith(`.${domain}`)
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

const ensureBlacklistInStorage = () => {
  chrome.storage.sync.get([BLACKLIST_KEY], (result) => {
    const stored = result[BLACKLIST_KEY]

    if (Array.isArray(stored)) {
      blackList = stored
      return
    }

    chrome.storage.sync.set({ [BLACKLIST_KEY]: DEFAULT_BLACKLIST }, () => {
      blackList = [...DEFAULT_BLACKLIST]
    })
  })
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

const getStoredBlacklist = () => new Promise((resolve) => {
  chrome.storage.sync.get([BLACKLIST_KEY], (result) => {
    const stored = result[BLACKLIST_KEY]
    if (Array.isArray(stored)) {
      blackList = stored
      resolve(stored)
      return
    }

    resolve([...blackList])
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

const searchMatchedHistoryByDomain = async (domain) => {
  const directItems = await searchHistoryInWindow(domain)
  const directMatched = directItems.filter((item) => item.url && isDomainMatch(item.url, domain))
  if (directMatched.length > 0) {
    return directMatched
  }

  // Fallback to broad scan: Chrome history text search may miss some URL forms.
  const allItems = await searchHistoryInWindow('')
  return allItems.filter((item) => item.url && isDomainMatch(item.url, domain))
}

const getMatchedCleanupStatsForDomains = async (domains) => {
  const allItems = await searchHistoryInWindow('')
  const uniqueUrls = new Set()
  const domainUrlSets = {}

  domains.forEach((domain) => {
    domainUrlSets[domain] = new Set()
  })

  allItems.forEach((item) => {
    if (!item || !item.url) return

    let matched = false
    domains.forEach((domain) => {
      if (!isDomainMatch(item.url, domain)) return
      domainUrlSets[domain].add(item.url)
      matched = true
    })

    if (matched) {
      uniqueUrls.add(item.url)
    }
  })

  const domainPendingMap = {}
  domains.forEach((domain) => {
    domainPendingMap[domain] = domainUrlSets[domain].size
  })

  return { uniqueUrls, domainPendingMap }
}

const deleteHistoryUrl = (url) => new Promise((resolve) => {
  chrome.history.deleteUrl({ url }, () => {
    resolve()
  })
})

const cleanupHistoryForDomain = async (domain, options = {}) => {
  const { force = false } = options
  const now = Date.now()

  if (!force) {
    const lastSweep = lastDomainSweepAt.get(domain) || 0
    if (now - lastSweep < HISTORY_DOMAIN_SWEEP_COOLDOWN_MS) {
      return 0
    }
    lastDomainSweepAt.set(domain, now)
  }

  const matchedItems = await searchMatchedHistoryByDomain(domain)
  const uniqueUrls = [...new Set(matchedItems.map((item) => item.url))]
  await Promise.all(uniqueUrls.map(deleteHistoryUrl))
  return uniqueUrls.length
}

const cleanupNow = async () => {
  const domains = await getStoredBlacklist()
  if (!domains.length) {
    return { removedCount: 0, domainCount: 0 }
  }

  const { uniqueUrls } = await getMatchedCleanupStatsForDomains(domains)
  await Promise.all([...uniqueUrls].map(deleteHistoryUrl))
  const removedCount = uniqueUrls.size

  return { removedCount, domainCount: domains.length }
}

const getPendingCleanupSummary = async () => {
  const domains = await getStoredBlacklist()
  if (!domains.length) {
    return { pendingCount: 0, domainPendingMap: {} }
  }

  const { uniqueUrls, domainPendingMap } = await getMatchedCleanupStatsForDomains(domains)

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
    throw new Error('请输入 1-1440 之间的分钟数')
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

    const message = pausedCount > 0
      ? `倒计时结束，已停止 ${pausedCount} 个媒体播放`
      : '倒计时结束，未发现正在播放的媒体'

    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'img/icon-128.png',
      title: '媒体自动停止',
      message
    })
  })
}

const removeHistoryFromBlackList = (url) => {
  try {
    if (!url) return

    const blacklistedDomain = blackList.find((domain) => isDomainMatch(url, domain))
    if (!blacklistedDomain) return

    deleteHistoryUrl(url).catch((error) => {
      console.error('删除当前历史记录失败:', error)
    })

    cleanupHistoryForDomain(blacklistedDomain).catch((error) => {
      console.error('自动清理历史记录失败:', error)
    })
  } catch (error) {
    console.error('删除历史记录时出错:', error)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureBlacklistInStorage()
  ensureMediaSettingsInStorage()
  syncMediaCountdownState().catch((error) => {
    console.error('同步媒体倒计时状态失败:', error)
  })
})

chrome.runtime.onStartup.addListener(() => {
  ensureBlacklistInStorage()
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

chrome.storage.onChanged.addListener((changes) => {
  if (changes[BLACKLIST_KEY]) {
    blackList = changes[BLACKLIST_KEY].newValue || []
  }
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

ensureBlacklistInStorage()
ensureMediaSettingsInStorage()
syncMediaCountdownState().catch((error) => {
  console.error('同步媒体倒计时状态失败:', error)
})
