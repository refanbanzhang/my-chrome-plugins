const BLACKLIST_KEY = 'blackList'
const BLACKLIST_DATA_KEY = 'blackListData'
const MEDIA_DEFAULT_MINUTES_KEY = 'mediaAutoStopDefaultMinutes'
const THEME_PREFERENCE_KEY = 'popupThemePreference'
const LANGUAGE_PREFERENCE_KEY = 'popupLanguagePreference'
const THEME_PREFERENCE_CYCLE = ['system', 'dark', 'light']
const SYNC_STATUS = {
  SYNCED: 'synced',
  SYNCING: 'syncing',
  OFFLINE: 'offline'
}

const FALLBACK_MESSAGES = {
  popupDocumentTitle: '微博助手·历史清理·媒体停播',
  popupTitle: '助手控制台',
  popupSubtitle: '媒体定时停止 + 历史记录自动清理',
  syncStatusSynced: '同步状态：已同步',
  syncStatusSyncing: '同步状态：同步中',
  syncStatusOffline: '同步状态：离线',
  themeSystem: '主题：跟随系统',
  themeDark: '主题：深色',
  themeLight: '主题：浅色',
  themeSwitchTo: '点击切换到 $1',
  languageChinese: '中文',
  languageEnglish: 'English',
  languageSwitchTo: '点击切换到 $1',
  logoAlt: '微博助手 logo',
  arrowSectionTitle: '箭头翻页',
  arrowSectionTip: '打开“箭头键翻页规则”页面，配置站点级上一页/下一页选择器。',
  openArrowSettingsButton: '打开翻页设置',
  mediaSectionTitle: '媒体自动停止',
  mediaSectionTip: '倒计时结束后，自动停止所有标签页中的音视频播放。',
  mediaPresetLabel: '快捷预设',
  mediaPresetMinutes: '$1m',
  mediaMinutesPlaceholder: '分钟',
  mediaMinutesAria: '媒体倒计时分钟数',
  mediaStartButton: '开始倒计时',
  mediaStopButton: '停止倒计时',
  mediaTimerIdle: '倒计时未启动',
  mediaTimerRunning: '倒计时进行中：$1',
  mediaTimerStartedToast: '倒计时已启动。',
  mediaTimerStoppedToast: '倒计时已停止。',
  mediaMinutesRangeError: '请输入 1-1440 之间的分钟数',
  mediaStatusFetchFailed: '状态获取失败：$1',
  mediaStartFailed: '启动失败：$1',
  mediaStopFailed: '停止失败：$1',
  historySectionTitle: '历史记录过滤',
  historySectionTip: '命中下列域名时，将自动清理对应浏览历史。',
  metaFilterList: '过滤列表',
  metaPendingList: '待清理记录',
  cleanNowButton: '立即清理',
  cleanNowLoading: '清理中...',
  addDomainButton: '添加',
  newDomainPlaceholder: '例如：weibo.com 或 *.example.com',
  newDomainAria: '新增过滤域名',
  blacklistEmpty: '暂无过滤域名，添加后将自动清理对应网站历史记录。',
  pendingBadge: '待清理 $1',
  deleteAction: '删除',
  dragHandle: '::',
  invalidDomain: '请输入有效域名，例如 weibo.com 或 *.example.com',
  domainExists: '该域名已在过滤列表中。',
  domainAdded: '已添加到过滤列表。',
  domainRemoved: '已移除该域名。',
  sortSaved: '排序已更新。',
  cleanupRunning: '正在清理，请稍候...',
  cleanupSuccess: '清理完成：已删除 $1 条历史记录（$2 个域名）。',
  cleanupFailed: '清理失败：$1',
  unknownError: '未知错误'
}

const container = document.getElementById('blacklist')
const listCount = document.getElementById('listCount')
const pendingCount = document.getElementById('pendingCount')
const input = document.getElementById('newDomain')
const addButton = document.getElementById('addDomain')
const cleanNowButton = document.getElementById('cleanNow')
const mediaMinutesInput = document.getElementById('mediaMinutes')
const mediaTimerToggle = document.getElementById('mediaTimerToggle')
const mediaTimerStatus = document.getElementById('mediaTimerStatus')
const openArrowSettingsButton = document.getElementById('openArrowSettings')
const languageToggle = document.getElementById('languageToggle')
const themeToggle = document.getElementById('themeToggle')
const syncStatus = document.getElementById('syncStatus')
const toastContainer = document.getElementById('toastContainer')
const mediaPresetButtons = Array.from(document.querySelectorAll('.history-popup__preset-btn'))
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)')

let mediaCountdownIntervalId = null
let currentBlacklist = []
let currentDomainPendingMap = {}
let currentThemePreference = 'system'
let draggingDomain = ''
let currentSyncStatus = SYNC_STATUS.SYNCED
let currentLanguagePreference = 'auto'
let activeLocale = 'zh_CN'
const localeMessagesCache = {}

const ensureSubstitutionsArray = (substitutions) => {
  if (Array.isArray(substitutions)) return substitutions
  if (typeof substitutions === 'undefined' || substitutions === null) return []
  return [substitutions]
}

const formatFallbackMessage = (template, substitutions) => {
  const values = ensureSubstitutionsArray(substitutions)
  return template.replace(/\$(\d)/g, (_, indexText) => {
    const index = Number.parseInt(indexText, 10) - 1
    return typeof values[index] !== 'undefined' ? String(values[index]) : ''
  })
}

const normalizeLanguagePreference = (preference) => {
  if (preference === 'en' || preference === 'zh_CN') return preference
  return 'auto'
}

const resolveLocale = (preference = currentLanguagePreference) => {
  if (preference === 'en' || preference === 'zh_CN') {
    return preference
  }
  return chrome.i18n.getUILanguage().toLowerCase().startsWith('en') ? 'en' : 'zh_CN'
}

const normalizeLocaleMessages = (rawMessages) => {
  const result = {}
  if (!rawMessages || typeof rawMessages !== 'object') return result

  Object.entries(rawMessages).forEach(([key, entry]) => {
    if (entry && typeof entry.message === 'string') {
      result[key] = entry.message
    }
  })
  return result
}

const loadLocaleMessages = async (locale) => {
  if (localeMessagesCache[locale]) return localeMessagesCache[locale]

  try {
    const response = await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`))
    if (!response.ok) throw new Error(`Failed to load locale: ${locale}`)
    const rawMessages = await response.json()
    localeMessagesCache[locale] = normalizeLocaleMessages(rawMessages)
    return localeMessagesCache[locale]
  } catch (error) {
    localeMessagesCache[locale] = {}
    return localeMessagesCache[locale]
  }
}

const getMessageFromLocaleCache = (locale, key, args) => {
  const localeMessages = localeMessagesCache[locale]
  if (!localeMessages) return ''
  const template = localeMessages[key]
  if (!template) return ''
  return formatFallbackMessage(template, args)
}

const t = (key, substitutions = []) => {
  const args = ensureSubstitutionsArray(substitutions).map((value) => String(value))

  const activeMessage = getMessageFromLocaleCache(activeLocale, key, args)
  if (activeMessage) return activeMessage

  const localized = chrome.i18n.getMessage(key, args)
  if (localized && currentLanguagePreference === 'auto') return localized

  const zhFallbackFromLocale = getMessageFromLocaleCache('zh_CN', key, args)
  if (zhFallbackFromLocale) return zhFallbackFromLocale

  const fallback = FALLBACK_MESSAGES[key]
  if (fallback) return formatFallbackMessage(fallback, args)
  return key
}

const applyI18nToPage = () => {
  document.title = t('popupDocumentTitle')

  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const key = element.getAttribute('data-i18n')
    if (!key) return
    element.textContent = t(key)
  })

  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const key = element.getAttribute('data-i18n-placeholder')
    if (!key) return
    element.setAttribute('placeholder', t(key))
  })

  document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    const key = element.getAttribute('data-i18n-aria-label')
    if (!key) return
    element.setAttribute('aria-label', t(key))
  })

  document.querySelectorAll('[data-i18n-alt]').forEach((element) => {
    const key = element.getAttribute('data-i18n-alt')
    if (!key) return
    element.setAttribute('alt', t(key))
  })
}

const showToast = (message, type = 'info') => {
  if (!toastContainer || !message) return

  const toast = document.createElement('div')
  toast.className = `history-popup__toast history-popup__toast--${type}`
  toast.textContent = message
  toastContainer.appendChild(toast)

  window.setTimeout(() => {
    toast.remove()
  }, 2600)
}

const setSyncStatus = (status) => {
  currentSyncStatus = status
  syncStatus.className = 'history-popup__sync-status'

  if (status === SYNC_STATUS.SYNCING) {
    syncStatus.classList.add('history-popup__sync-status--syncing')
    syncStatus.textContent = t('syncStatusSyncing')
    return
  }

  if (status === SYNC_STATUS.OFFLINE) {
    syncStatus.classList.add('history-popup__sync-status--offline')
    syncStatus.textContent = t('syncStatusOffline')
    return
  }

  syncStatus.textContent = t('syncStatusSynced')
}

const markSyncing = () => {
  if (!navigator.onLine) {
    setSyncStatus(SYNC_STATUS.OFFLINE)
    return
  }
  setSyncStatus(SYNC_STATUS.SYNCING)
}

const markSynced = () => {
  if (!navigator.onLine) {
    setSyncStatus(SYNC_STATUS.OFFLINE)
    return
  }
  setSyncStatus(SYNC_STATUS.SYNCED)
}

const getResolvedTheme = (preference = currentThemePreference) => {
  if (preference === 'dark' || preference === 'light') {
    return preference
  }
  return systemThemeQuery.matches ? 'dark' : 'light'
}

const getThemeToggleLabel = (preference) => {
  if (preference === 'dark') return t('themeDark')
  if (preference === 'light') return t('themeLight')
  return t('themeSystem')
}

const applyThemePreference = (preference = 'system') => {
  currentThemePreference = preference
  document.documentElement.dataset.theme = getResolvedTheme(preference)

  const currentLabel = getThemeToggleLabel(preference)
  const nextPreference = THEME_PREFERENCE_CYCLE[(THEME_PREFERENCE_CYCLE.indexOf(preference) + 1) % THEME_PREFERENCE_CYCLE.length]
  const nextLabel = getThemeToggleLabel(nextPreference).split(/[:：]/).slice(-1)[0].trim()
  const resolvedTheme = getResolvedTheme(preference)

  themeToggle.textContent = currentLabel
  themeToggle.setAttribute('aria-pressed', String(resolvedTheme === 'dark'))
  themeToggle.setAttribute('aria-label', `${currentLabel}，${t('themeSwitchTo', nextLabel)}`)
  themeToggle.title = t('themeSwitchTo', nextLabel)
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

const getLanguageLabel = (locale) => (locale === 'en' ? t('languageEnglish') : t('languageChinese'))

const updateLanguageToggle = () => {
  if (!languageToggle) return
  const nextLocale = activeLocale === 'en' ? 'zh_CN' : 'en'
  const nextLocaleLabel = getLanguageLabel(nextLocale)

  languageToggle.textContent = getLanguageLabel(activeLocale)
  languageToggle.setAttribute('aria-label', t('languageSwitchTo', nextLocaleLabel))
  languageToggle.title = t('languageSwitchTo', nextLocaleLabel)
}

const applyLanguagePreference = async (preference = 'auto') => {
  currentLanguagePreference = normalizeLanguagePreference(preference)
  activeLocale = resolveLocale(currentLanguagePreference)
  document.documentElement.lang = activeLocale === 'en' ? 'en' : 'zh-CN'

  await Promise.all([loadLocaleMessages(activeLocale), loadLocaleMessages('zh_CN')])
  applyI18nToPage()
  applyPresetLabels()
  applyThemePreference(currentThemePreference)
  updateLanguageToggle()
  setSyncStatus(currentSyncStatus)
  renderBlacklist(currentBlacklist, currentDomainPendingMap)
  setCleanupLoading(cleanNowButton.disabled)
  refreshMediaTimerStatus()
}

const loadLanguagePreference = async () => {
  return new Promise((resolve) => {
    chrome.storage.sync.get([LANGUAGE_PREFERENCE_KEY], async (result) => {
      const storedPreference = normalizeLanguagePreference(result[LANGUAGE_PREFERENCE_KEY])
      await applyLanguagePreference(storedPreference)
      resolve()
    })
  })
}

const cycleLanguagePreference = () => {
  if (!languageToggle) return
  const nextLocale = activeLocale === 'en' ? 'zh_CN' : 'en'

  languageToggle.disabled = true
  chrome.storage.sync.set({ [LANGUAGE_PREFERENCE_KEY]: nextLocale }, async () => {
    languageToggle.disabled = false
    await applyLanguagePreference(nextLocale)
  })
}

const sendMessageWithRetry = (message, retryCount = 1) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        if (retryCount > 0) {
          window.setTimeout(() => {
            sendMessageWithRetry(message, retryCount - 1).then(resolve).catch(reject)
          }, 150)
          return
        }

        reject(new Error(chrome.runtime.lastError.message))
        return
      }

      if (!response || !response.ok) {
        reject(new Error(response && response.error ? response.error : t('unknownError')))
        return
      }

      resolve(response)
    })
  })
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

const setMediaTimerStatus = (message, type = '') => {
  mediaTimerStatus.textContent = message
  mediaTimerStatus.className = 'history-popup__inline-status'
  if (type) {
    mediaTimerStatus.classList.add(`history-popup__inline-status--${type}`)
  }
}

const applyMediaTimerState = (isRunning, remainingTime = 0) => {
  clearMediaCountdownInterval()

  if (!isRunning) {
    mediaTimerToggle.dataset.mode = 'start'
    mediaTimerToggle.textContent = t('mediaStartButton')
    mediaMinutesInput.disabled = false
    setMediaTimerStatus(t('mediaTimerIdle'))
    return
  }

  let currentSeconds = Math.max(0, remainingTime)
  mediaTimerToggle.dataset.mode = 'stop'
  mediaTimerToggle.textContent = t('mediaStopButton')
  mediaMinutesInput.disabled = true
  setMediaTimerStatus(t('mediaTimerRunning', formatRemainingTime(currentSeconds)), 'running')

  mediaCountdownIntervalId = window.setInterval(() => {
    currentSeconds -= 1
    if (currentSeconds <= 0) {
      clearMediaCountdownInterval()
      applyMediaTimerState(false)
      return
    }
    setMediaTimerStatus(t('mediaTimerRunning', formatRemainingTime(currentSeconds)), 'running')
  }, 1000)
}

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

const getDomainPendingCountText = (pattern, domainPendingMap) => {
  const count = domainPendingMap[pattern]
  return Number.isInteger(count) && count >= 0 ? String(count) : '...'
}

const renderBlacklist = (blackList, domainPendingMap = currentDomainPendingMap) => {
  currentBlacklist = [...blackList]
  container.innerHTML = ''
  listCount.textContent = String(blackList.length)

  if (blackList.length === 0) {
    const emptyState = document.createElement('div')
    emptyState.className = 'history-popup__empty'
    emptyState.textContent = t('blacklistEmpty')
    container.appendChild(emptyState)
    return
  }

  blackList.forEach((pattern) => {
    const item = document.createElement('div')
    item.className = 'history-popup__item'
    item.dataset.domain = pattern
    item.draggable = true

    const domainWrap = document.createElement('div')
    domainWrap.className = 'history-popup__domain-wrap'

    const drag = document.createElement('span')
    drag.className = 'history-popup__drag'
    drag.textContent = t('dragHandle')

    const domainText = document.createElement('span')
    domainText.className = 'history-popup__domain'
    domainText.textContent = pattern

    const pendingBadge = document.createElement('span')
    pendingBadge.className = 'history-popup__domain-pending'
    pendingBadge.textContent = t('pendingBadge', getDomainPendingCountText(pattern, domainPendingMap))

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn btn--danger'
    button.dataset.action = 'delete'
    button.dataset.domain = pattern
    button.textContent = t('deleteAction')

    domainWrap.appendChild(drag)
    domainWrap.appendChild(domainText)
    domainWrap.appendChild(pendingBadge)
    item.appendChild(domainWrap)
    item.appendChild(button)
    container.appendChild(item)
  })
}

const refreshPendingCleanupCount = () => {
  pendingCount.textContent = '...'
  sendMessageWithRetry({ type: 'GET_PENDING_CLEANUP_SUMMARY' }, 1)
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
  sendMessageWithRetry({ type: 'BLACKLIST_GET' }, 1)
    .then(({ list }) => {
      currentDomainPendingMap = {}
      renderBlacklist(list || [], currentDomainPendingMap)
      refreshPendingCleanupCount()
      markSynced()
    })
    .catch((error) => {
      showToast(error && error.message ? error.message : t('unknownError'), 'error')
      setSyncStatus(SYNC_STATUS.OFFLINE)
    })
}

const addDomain = () => {
  const pattern = normalizeDomainPattern(input.value)
  if (!pattern) {
    showToast(t('invalidDomain'), 'error')
    return
  }

  markSyncing()
  sendMessageWithRetry({ type: 'BLACKLIST_ADD', pattern }, 1)
    .then(({ list }) => {
      input.value = ''
      showToast(t('domainAdded'), 'success')
      currentDomainPendingMap = {}
      renderBlacklist(list || [], currentDomainPendingMap)
      refreshPendingCleanupCount()
      markSynced()
    })
    .catch((error) => {
      showToast(error && error.message ? error.message : t('domainExists'), 'error')
      setSyncStatus(navigator.onLine ? SYNC_STATUS.SYNCED : SYNC_STATUS.OFFLINE)
    })
}

const removeDomain = (pattern) => {
  markSyncing()
  sendMessageWithRetry({ type: 'BLACKLIST_REMOVE', pattern }, 1)
    .then(({ list }) => {
      showToast(t('domainRemoved'), 'success')
      currentDomainPendingMap = {}
      renderBlacklist(list || [], currentDomainPendingMap)
      refreshPendingCleanupCount()
      markSynced()
    })
    .catch((error) => {
      showToast(error && error.message ? error.message : t('unknownError'), 'error')
      setSyncStatus(navigator.onLine ? SYNC_STATUS.SYNCED : SYNC_STATUS.OFFLINE)
    })
}

const reorderBlacklist = (nextOrder) => {
  markSyncing()
  sendMessageWithRetry({ type: 'BLACKLIST_REORDER', order: nextOrder }, 1)
    .then(({ list }) => {
      currentDomainPendingMap = {}
      renderBlacklist(list || [], currentDomainPendingMap)
      refreshPendingCleanupCount()
      showToast(t('sortSaved'), 'success')
      markSynced()
    })
    .catch((error) => {
      showToast(error && error.message ? error.message : t('unknownError'), 'error')
      refreshBlacklist()
    })
}

const setCleanupLoading = (isLoading) => {
  cleanNowButton.disabled = isLoading
  cleanNowButton.textContent = isLoading ? t('cleanNowLoading') : t('cleanNowButton')
}

const runCleanupNow = () => {
  setCleanupLoading(true)
  showToast(t('cleanupRunning'))

  sendMessageWithRetry({ type: 'RUN_CLEANUP_NOW' }, 1)
    .then(({ removedCount, domainCount }) => {
      showToast(t('cleanupSuccess', [removedCount, domainCount]), 'success')
    })
    .catch((error) => {
      showToast(t('cleanupFailed', error && error.message ? error.message : t('unknownError')), 'error')
    })
    .finally(() => {
      setCleanupLoading(false)
      refreshPendingCleanupCount()
    })
}

const refreshMediaTimerStatus = () => {
  sendMessageWithRetry({ type: 'MEDIA_AUTO_STOP_STATUS' }, 1)
    .then((response) => {
      applyMediaTimerState(response.isRunning, response.remainingTime)
    })
    .catch((error) => {
      const message = t('mediaStatusFetchFailed', error && error.message ? error.message : t('unknownError'))
      setMediaTimerStatus(message, 'error')
      showToast(message, 'error')
    })
}

const startMediaTimer = () => {
  const minutes = Number.parseInt(mediaMinutesInput.value, 10)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
    const message = t('mediaMinutesRangeError')
    setMediaTimerStatus(message, 'error')
    showToast(message, 'error')
    return
  }

  mediaTimerToggle.disabled = true
  chrome.storage.sync.set({ [MEDIA_DEFAULT_MINUTES_KEY]: minutes }, () => {
    sendMessageWithRetry({ type: 'MEDIA_AUTO_STOP_START', minutes }, 1)
      .then((response) => {
        applyMediaTimerState(true, response.remainingTime)
        showToast(t('mediaTimerStartedToast'), 'success')
      })
      .catch((error) => {
        const message = t('mediaStartFailed', error && error.message ? error.message : t('unknownError'))
        setMediaTimerStatus(message, 'error')
        showToast(message, 'error')
      })
      .finally(() => {
        mediaTimerToggle.disabled = false
      })
  })
}

const stopMediaTimer = () => {
  mediaTimerToggle.disabled = true
  sendMessageWithRetry({ type: 'MEDIA_AUTO_STOP_STOP' }, 1)
    .then(() => {
      applyMediaTimerState(false)
      showToast(t('mediaTimerStoppedToast'), 'success')
    })
    .catch((error) => {
      const message = t('mediaStopFailed', error && error.message ? error.message : t('unknownError'))
      setMediaTimerStatus(message, 'error')
      showToast(message, 'error')
    })
    .finally(() => {
      mediaTimerToggle.disabled = false
    })
}

const applyPresetLabels = () => {
  mediaPresetButtons.forEach((button) => {
    const minutes = Number.parseInt(button.dataset.minutes || '0', 10)
    button.textContent = t('mediaPresetMinutes', minutes)
  })
}

const openArrowSettings = () => {
  if (chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
    chrome.runtime.openOptionsPage()
    return
  }

  window.open(chrome.runtime.getURL('arrow-options.html'), '_blank')
}

const clearDragState = () => {
  container.querySelectorAll('.history-popup__item').forEach((item) => {
    item.classList.remove('dragging')
    item.classList.remove('drop-target')
  })
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadLanguagePreference()
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

  setSyncStatus(navigator.onLine ? SYNC_STATUS.SYNCED : SYNC_STATUS.OFFLINE)
  window.addEventListener('online', () => {
    if (currentSyncStatus === SYNC_STATUS.OFFLINE) {
      markSynced()
    }
  })
  window.addEventListener('offline', () => {
    setSyncStatus(SYNC_STATUS.OFFLINE)
  })

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return
    if (!changes[BLACKLIST_DATA_KEY] && !changes[BLACKLIST_KEY]) return
    markSynced()
  })

  chrome.storage.sync.get([MEDIA_DEFAULT_MINUTES_KEY], (result) => {
    const minutes = Number.parseInt(result[MEDIA_DEFAULT_MINUTES_KEY], 10)
    mediaMinutesInput.value = Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : 30
  })

  refreshBlacklist()

  addButton.addEventListener('click', addDomain)
  cleanNowButton.addEventListener('click', runCleanupNow)
  if (openArrowSettingsButton) {
    openArrowSettingsButton.addEventListener('click', openArrowSettings)
  }
  if (languageToggle) {
    languageToggle.addEventListener('click', cycleLanguagePreference)
  }
  themeToggle.addEventListener('click', cycleThemePreference)
  mediaTimerToggle.addEventListener('click', () => {
    if (mediaTimerToggle.dataset.mode === 'stop') {
      stopMediaTimer()
      return
    }
    startMediaTimer()
  })

  mediaPresetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const minutes = Number.parseInt(button.dataset.minutes || '0', 10)
      if (!Number.isInteger(minutes) || minutes <= 0) return
      mediaMinutesInput.value = String(minutes)
      startMediaTimer()
    })
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      addDomain()
    }
  })

  container.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="delete"]')
    if (!button) return
    removeDomain(button.dataset.domain)
  })

  container.addEventListener('dragstart', (event) => {
    const item = event.target.closest('.history-popup__item')
    if (!item || !item.dataset.domain) return
    if (event.target.closest('button')) return

    draggingDomain = item.dataset.domain
    item.classList.add('dragging')
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', draggingDomain)
    }
  })

  container.addEventListener('dragover', (event) => {
    if (!draggingDomain) return
    event.preventDefault()

    const targetItem = event.target.closest('.history-popup__item')
    clearDragState()
    if (!targetItem || targetItem.dataset.domain === draggingDomain) return
    targetItem.classList.add('drop-target')
  })

  container.addEventListener('drop', (event) => {
    if (!draggingDomain) return
    event.preventDefault()

    const targetItem = event.target.closest('.history-popup__item')
    if (!targetItem || !targetItem.dataset.domain || targetItem.dataset.domain === draggingDomain) {
      clearDragState()
      draggingDomain = ''
      return
    }

    const fromIndex = currentBlacklist.indexOf(draggingDomain)
    const toIndex = currentBlacklist.indexOf(targetItem.dataset.domain)
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      clearDragState()
      draggingDomain = ''
      return
    }

    const nextOrder = [...currentBlacklist]
    const [moved] = nextOrder.splice(fromIndex, 1)
    nextOrder.splice(toIndex, 0, moved)

    currentBlacklist = [...nextOrder]
    renderBlacklist(currentBlacklist, currentDomainPendingMap)
    reorderBlacklist(nextOrder)
    draggingDomain = ''
  })

  container.addEventListener('dragend', () => {
    clearDragState()
    draggingDomain = ''
  })
})
