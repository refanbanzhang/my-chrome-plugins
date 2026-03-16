const BLACKLIST_KEY = 'blackList'
const DEFAULT_BLACKLIST = ['pornhub.com', 'bilibili.com', 'weibo.com']
let blackList = [...DEFAULT_BLACKLIST]

const isDomainMatch = (url, domain) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return hostname === domain || hostname.endsWith(`.${domain}`)
  } catch {
    return false
  }
}

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

const cleanupHistoryForDomain = async (domain) => {
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

  let removedCount = 0
  for (const domain of domains) {
    removedCount += await cleanupHistoryForDomain(domain)
  }

  return { removedCount, domainCount: domains.length }
}

const removeHistoryFromBlackList = (url) => {
  try {
    if (!url) return

    const blacklistedDomain = blackList.find((domain) => isDomainMatch(url, domain))
    if (!blacklistedDomain) return

    cleanupHistoryForDomain(blacklistedDomain).catch((error) => {
      console.error('自动清理历史记录失败:', error)
    })
  } catch (error) {
    console.error('删除历史记录时出错:', error)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureBlacklistInStorage()
})

chrome.runtime.onStartup.addListener(() => {
  ensureBlacklistInStorage()
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

chrome.runtime.onMessage.addListener((message, _, sendResponse) => {
  if (!message || message.type !== 'RUN_CLEANUP_NOW') {
    return
  }

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
})

ensureBlacklistInStorage()
