const BLACKLIST_KEY = 'blackList'
const DEFAULT_BLACKLIST = ['pornhub.com', 'bilibili.com', 'weibo.com']
const MEDIA_DEFAULT_MINUTES_KEY = 'mediaAutoStopDefaultMinutes'
const THEME_PREFERENCE_KEY = 'popupThemePreference'
const THEME_PREFERENCE_CYCLE = ['system', 'dark', 'light']

const container = document.getElementById('blacklist')
const listCount = document.getElementById('listCount')
const pendingCount = document.getElementById('pendingCount')
const status = document.getElementById('status')
const input = document.getElementById('newDomain')
const addButton = document.getElementById('addDomain')
const cleanNowButton = document.getElementById('cleanNow')
const mediaMinutesInput = document.getElementById('mediaMinutes')
const mediaTimerToggle = document.getElementById('mediaTimerToggle')
const mediaTimerStatus = document.getElementById('mediaTimerStatus')
const themeToggle = document.getElementById('themeToggle')
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')
let mediaCountdownIntervalId = null
let currentBlacklist = []
let currentDomainPendingMap = {}
let currentThemePreference = 'system'

const getResolvedTheme = (preference = currentThemePreference) => {
  if (preference === 'dark' || preference === 'light') {
    return preference
  }

  return systemThemeQuery.matches ? 'dark' : 'light'
}

const getThemeToggleLabel = (preference) => {
  if (preference === 'dark') return '主题：深色'
  if (preference === 'light') return '主题：浅色'
  return '主题：跟随系统'
}

const applyThemePreference = (preference = 'system') => {
  currentThemePreference = preference
  document.documentElement.dataset.theme = getResolvedTheme(preference)

  if (!themeToggle) return

  const resolvedTheme = getResolvedTheme(preference)
  const nextPreference = THEME_PREFERENCE_CYCLE[(THEME_PREFERENCE_CYCLE.indexOf(preference) + 1) % THEME_PREFERENCE_CYCLE.length]
  const nextThemeText = nextPreference === 'system'
    ? `跟随系统（当前${resolvedTheme === 'dark' ? '深色' : '浅色'}）`
    : nextPreference === 'dark'
      ? '深色'
      : '浅色'

  themeToggle.textContent = getThemeToggleLabel(preference)
  themeToggle.setAttribute('aria-pressed', String(resolvedTheme === 'dark'))
  themeToggle.setAttribute('aria-label', `当前${themeToggle.textContent}，点击切换到${nextThemeText}`)
  themeToggle.title = `点击切换到${nextThemeText}`
}

const loadThemePreference = () => {
  chrome.storage.sync.get([THEME_PREFERENCE_KEY], (result) => {
    const storedPreference = result[THEME_PREFERENCE_KEY]
    const preference = THEME_PREFERENCE_CYCLE.includes(storedPreference) ? storedPreference : 'system'
    applyThemePreference(preference)
  })
}

const cycleThemePreference = () => {
  const currentIndex = THEME_PREFERENCE_CYCLE.indexOf(currentThemePreference)
  const nextPreference = THEME_PREFERENCE_CYCLE[(currentIndex + 1) % THEME_PREFERENCE_CYCLE.length]

  themeToggle.disabled = true
  chrome.storage.sync.set({ [THEME_PREFERENCE_KEY]: nextPreference }, () => {
    themeToggle.disabled = false
    applyThemePreference(nextPreference)
  })
}

const setStatus = (message, type = '') => {
  status.textContent = message
  status.className = 'history-popup__status'
  if (type) {
    status.classList.add(`history-popup__status--${type}`)
  }
}

const setMediaTimerStatus = (message, type = '') => {
  mediaTimerStatus.textContent = message
  mediaTimerStatus.className = 'history-popup__inline-status'
  if (type) {
    mediaTimerStatus.classList.add(`history-popup__inline-status--${type}`)
  }
}

const formatRemainingTime = (totalSeconds) => {
  const safeSeconds = Math.max(0, totalSeconds)
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const clearMediaCountdownInterval = () => {
  if (!mediaCountdownIntervalId) return
  window.clearInterval(mediaCountdownIntervalId)
  mediaCountdownIntervalId = null
}

const applyMediaTimerState = (isRunning, remainingTime = 0) => {
  clearMediaCountdownInterval()

  if (!isRunning) {
    mediaTimerToggle.dataset.mode = 'start'
    mediaTimerToggle.textContent = '开始倒计时'
    mediaMinutesInput.disabled = false
    setMediaTimerStatus('倒计时未启动')
    return
  }

  let currentSeconds = Math.max(0, remainingTime)
  mediaTimerToggle.dataset.mode = 'stop'
  mediaTimerToggle.textContent = '停止倒计时'
  mediaMinutesInput.disabled = true
  setMediaTimerStatus(`倒计时进行中：${formatRemainingTime(currentSeconds)}`, 'running')

  mediaCountdownIntervalId = window.setInterval(() => {
    currentSeconds -= 1
    if (currentSeconds <= 0) {
      clearMediaCountdownInterval()
      applyMediaTimerState(false)
      return
    }
    setMediaTimerStatus(`倒计时进行中：${formatRemainingTime(currentSeconds)}`, 'running')
  }, 1000)
}

const normalizeDomain = (inputValue) => {
  const raw = inputValue.trim().toLowerCase()
  if (!raw) return ''

  const withProtocol = raw.includes('://') ? raw : `https://${raw}`

  try {
    return new URL(withProtocol).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const getBlacklist = (callback) => {
  chrome.storage.sync.get([BLACKLIST_KEY], (result) => {
    const stored = result[BLACKLIST_KEY]
    callback(Array.isArray(stored) ? stored : [])
  })
}

const setBlacklist = (blackList, callback) => {
  chrome.storage.sync.set({ [BLACKLIST_KEY]: blackList }, () => {
    callback()
  })
}

const requestCleanupNowWithRetry = (retryCount = 1) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'RUN_CLEANUP_NOW' }, (response) => {
      if (chrome.runtime.lastError) {
        if (retryCount > 0) {
          window.setTimeout(() => {
            requestCleanupNowWithRetry(retryCount - 1).then(resolve).catch(reject)
          }, 150)
          return
        }

        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      if (!response || !response.ok) {
        reject(new Error(response && response.error ? response.error : '未知错误'))
        return
      }

      resolve(response)
    })
  })
}

const requestPendingCleanupSummaryWithRetry = (retryCount = 1) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_PENDING_CLEANUP_SUMMARY' }, (response) => {
      if (chrome.runtime.lastError) {
        if (retryCount > 0) {
          window.setTimeout(() => {
            requestPendingCleanupSummaryWithRetry(retryCount - 1).then(resolve).catch(reject)
          }, 150)
          return
        }

        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      if (!response || !response.ok) {
        reject(new Error(response && response.error ? response.error : '未知错误'))
        return
      }

      resolve(response)
    })
  })
}

const getDomainPendingCountText = (domain, domainPendingMap) => {
  const count = domainPendingMap[domain]
  return Number.isInteger(count) && count >= 0 ? String(count) : '...'
}

const renderBlacklist = (blackList, domainPendingMap = currentDomainPendingMap) => {
  currentBlacklist = [...blackList]
  container.innerHTML = ''
  listCount.textContent = String(blackList.length)

  if (blackList.length === 0) {
    const emptyState = document.createElement('div')
    emptyState.className = 'history-popup__empty'
    emptyState.textContent = '暂无过滤域名，添加后将自动清理对应网站历史记录。'
    container.appendChild(emptyState)
    return
  }

  blackList.forEach((domain) => {
    const item = document.createElement('div')
    item.className = 'history-popup__item'

    const domainWrap = document.createElement('div')
    domainWrap.className = 'history-popup__domain-wrap'

    const domainText = document.createElement('span')
    domainText.className = 'history-popup__domain'
    domainText.textContent = domain

    const pendingBadge = document.createElement('span')
    pendingBadge.className = 'history-popup__domain-pending'
    pendingBadge.textContent = `待清理 ${getDomainPendingCountText(domain, domainPendingMap)}`

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn--danger'
    button.dataset.domain = domain
    button.textContent = '删除'

    domainWrap.appendChild(domainText)
    domainWrap.appendChild(pendingBadge)
    item.appendChild(domainWrap)
    item.appendChild(button)
    container.appendChild(item)
  })
}

const refreshPendingCleanupCount = () => {
  pendingCount.textContent = '...'
  requestPendingCleanupSummaryWithRetry(1)
    .then(({ pendingCount: count, domainPendingMap }) => {
      pendingCount.textContent = String(count)
      currentDomainPendingMap = domainPendingMap || {}
      renderBlacklist(currentBlacklist, currentDomainPendingMap)
    })
    .catch(() => {
      pendingCount.textContent = '-'
      currentDomainPendingMap = {}
      renderBlacklist(currentBlacklist, currentDomainPendingMap)
    })
}

const refreshBlacklist = () => {
  getBlacklist((blackList) => {
    currentDomainPendingMap = {}
    renderBlacklist(blackList, currentDomainPendingMap)
    refreshPendingCleanupCount()
  })
}

const ensureBlacklistInStorage = (callback) => {
  chrome.storage.sync.get([BLACKLIST_KEY], (result) => {
    if (Array.isArray(result[BLACKLIST_KEY])) {
      callback()
      return
    }

    setBlacklist([...DEFAULT_BLACKLIST], callback)
  })
}

const addDomain = () => {
  const domain = normalizeDomain(input.value)
  if (!domain) {
    setStatus('请输入有效域名，例如 weibo.com', 'error')
    return
  }

  getBlacklist((blackList) => {
    if (blackList.includes(domain)) {
      setStatus('该域名已在过滤列表中。', 'error')
      return
    }

    setBlacklist([...blackList, domain], () => {
      input.value = ''
      setStatus('已添加到过滤列表。', 'success')
      refreshBlacklist()
    })
  })
}

const removeDomain = (domain) => {
  getBlacklist((blackList) => {
    const newList = blackList.filter((item) => item !== domain)
    setBlacklist(newList, () => {
      setStatus('已移除该域名。', 'success')
      refreshBlacklist()
    })
  })
}

const setCleanupLoading = (isLoading) => {
  cleanNowButton.disabled = isLoading
  cleanNowButton.textContent = isLoading ? '清理中...' : '立即清理'
}

const runCleanupNow = () => {
  setCleanupLoading(true)
  setStatus('正在清理，请稍候...')

  requestCleanupNowWithRetry(1)
    .then(({ removedCount, domainCount }) => {
      setStatus(`清理完成：已删除 ${removedCount} 条历史记录（${domainCount} 个域名）。`, 'success')
    })
    .catch((error) => {
      setStatus(`清理失败：${error && error.message ? error.message : '未知错误'}`, 'error')
    })
    .finally(() => {
      setCleanupLoading(false)
      refreshPendingCleanupCount()
    })
}

const refreshMediaTimerStatus = () => {
  chrome.runtime.sendMessage({ type: 'MEDIA_AUTO_STOP_STATUS' }, (response) => {
    if (chrome.runtime.lastError) {
      setMediaTimerStatus(`状态获取失败：${chrome.runtime.lastError.message}`, 'error')
      return
    }

    if (!response || !response.ok) {
      setMediaTimerStatus(`状态获取失败：${response && response.error ? response.error : '未知错误'}`, 'error')
      return
    }

    applyMediaTimerState(response.isRunning, response.remainingTime)
  })
}

const startMediaTimer = () => {
  const minutes = Number.parseInt(mediaMinutesInput.value, 10)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    setMediaTimerStatus('请输入 1-1440 之间的分钟数', 'error')
    return
  }

  mediaTimerToggle.disabled = true
  chrome.storage.sync.set({ [MEDIA_DEFAULT_MINUTES_KEY]: minutes }, () => {
    chrome.runtime.sendMessage({ type: 'MEDIA_AUTO_STOP_START', minutes }, (response) => {
      mediaTimerToggle.disabled = false

      if (chrome.runtime.lastError) {
        setMediaTimerStatus(`启动失败：${chrome.runtime.lastError.message}`, 'error')
        return
      }

      if (!response || !response.ok) {
        setMediaTimerStatus(`启动失败：${response && response.error ? response.error : '未知错误'}`, 'error')
        return
      }

      applyMediaTimerState(true, response.remainingTime)
    })
  })
}

const stopMediaTimer = () => {
  mediaTimerToggle.disabled = true
  chrome.runtime.sendMessage({ type: 'MEDIA_AUTO_STOP_STOP' }, (response) => {
    mediaTimerToggle.disabled = false

    if (chrome.runtime.lastError) {
      setMediaTimerStatus(`停止失败：${chrome.runtime.lastError.message}`, 'error')
      return
    }

    if (!response || !response.ok) {
      setMediaTimerStatus(`停止失败：${response && response.error ? response.error : '未知错误'}`, 'error')
      return
    }

    applyMediaTimerState(false)
  })
}

document.addEventListener('DOMContentLoaded', () => {
  loadThemePreference()

  if (typeof systemThemeQuery.addEventListener === 'function') {
    systemThemeQuery.addEventListener('change', () => {
      if (currentThemePreference === 'system') {
        applyThemePreference('system')
      }
    })
  } else if (typeof systemThemeQuery.addListener === 'function') {
    systemThemeQuery.addListener(() => {
      if (currentThemePreference === 'system') {
        applyThemePreference('system')
      }
    })
  }

  chrome.storage.sync.get([MEDIA_DEFAULT_MINUTES_KEY], (result) => {
    const minutes = Number.parseInt(result[MEDIA_DEFAULT_MINUTES_KEY], 10)
    mediaMinutesInput.value = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : 30
  })
  refreshMediaTimerStatus()

  ensureBlacklistInStorage(() => {
    refreshBlacklist()
  })

  addButton.addEventListener('click', addDomain)
  cleanNowButton.addEventListener('click', runCleanupNow)
  mediaTimerToggle.addEventListener('click', () => {
    if (mediaTimerToggle.dataset.mode === 'stop') {
      stopMediaTimer()
      return
    }
    startMediaTimer()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addDomain()
    }
  })
  themeToggle.addEventListener('click', cycleThemePreference)

  container.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return
    removeDomain(e.target.dataset.domain)
  })
})
