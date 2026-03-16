const BLACKLIST_KEY = 'blackList'
const DEFAULT_BLACKLIST = ['pornhub.com', 'bilibili.com', 'weibo.com']
const MEDIA_DEFAULT_MINUTES_KEY = 'mediaAutoStopDefaultMinutes'

const container = document.getElementById('blacklist')
const listCount = document.getElementById('listCount')
const status = document.getElementById('status')
const input = document.getElementById('newDomain')
const addButton = document.getElementById('addDomain')
const cleanNowButton = document.getElementById('cleanNow')
const mediaMinutesInput = document.getElementById('mediaMinutes')
const mediaTimerToggle = document.getElementById('mediaTimerToggle')
const mediaTimerStatus = document.getElementById('mediaTimerStatus')
let mediaCountdownIntervalId = null

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

const isDomainMatch = (url, domain) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === domain || hostname.endsWith(`.${domain}`)
  } catch {
    return false
  }
}

const searchMatchedHistoryByDomain = (domain) => new Promise((resolve) => {
  chrome.history.search({
    text: domain,
    startTime: 0,
    maxResults: 1000
  }, (historyItems) => {
    const matched = historyItems.filter((item) => item.url && isDomainMatch(item.url, domain))
    resolve(matched)
  })
})

const deleteHistoryUrl = (url) => new Promise((resolve) => {
  chrome.history.deleteUrl({ url }, () => {
    resolve()
  })
})

const cleanupLocally = async () => {
  const domains = await new Promise((resolve) => {
    getBlacklist((blackList) => {
      resolve(blackList)
    })
  })

  if (!domains.length) {
    return { removedCount: 0, domainCount: 0 }
  }

  let removedCount = 0
  for (const domain of domains) {
    const matchedItems = await searchMatchedHistoryByDomain(domain)
    const uniqueUrls = [...new Set(matchedItems.map((item) => item.url))]
    await Promise.all(uniqueUrls.map(deleteHistoryUrl))
    removedCount += uniqueUrls.length
  }

  return { removedCount, domainCount: domains.length }
}

const renderBlacklist = (blackList) => {
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

    const domainText = document.createElement('span')
    domainText.className = 'history-popup__domain'
    domainText.textContent = domain

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn--danger'
    button.dataset.domain = domain
    button.textContent = '删除'

    item.appendChild(domainText)
    item.appendChild(button)
    container.appendChild(item)
  })
}

const refreshBlacklist = () => {
  getBlacklist((blackList) => {
    renderBlacklist(blackList)
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

  chrome.runtime.sendMessage({ type: 'RUN_CLEANUP_NOW' }, (response) => {
    if (chrome.runtime.lastError) {
      cleanupLocally()
        .then(({ removedCount, domainCount }) => {
          setStatus(`后台不可用，已本地清理 ${removedCount} 条（${domainCount} 个域名）。`, 'success')
        })
        .catch((error) => {
          setStatus(`清理失败：${error && error.message ? error.message : '未知错误'}`, 'error')
        })
        .finally(() => {
          setCleanupLoading(false)
        })
      return
    }

    if (!response || !response.ok) {
      setStatus(`清理失败：${response && response.error ? response.error : '未知错误'}`, 'error')
      setCleanupLoading(false)
      return
    }

    const { removedCount, domainCount } = response
    setStatus(`清理完成：已删除 ${removedCount} 条历史记录（${domainCount} 个域名）。`, 'success')
    setCleanupLoading(false)
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

  container.addEventListener('click', (e) => {
    if (e.target.tagName !== 'BUTTON') return
    removeDomain(e.target.dataset.domain)
  })
})
