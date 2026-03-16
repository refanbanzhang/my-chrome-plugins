const POST_ITEM_SELECTOR = '.vue-recycle-scroller__item-wrapper .vue-recycle-scroller__item-view'
const POST_CONTENT_SELECTOR = '.wbpro-feed-ogText div'
const EDITOR_TRIGGER_BUTTON_SELECTOR = '.woo-pop-wrap-main button'

const extractTextTokens = (htmlText) => {
  if (!htmlText) return null
  return htmlText.match(/[a-zA-Z]+|\d+/g)
}

const isPunchInPost = (item) => {
  const contentNode = item.querySelector(POST_CONTENT_SELECTOR)
  const tokens = extractTextTokens(contentNode && contentNode.innerHTML)
  if (!tokens || tokens.length < 4) return false

  const [key1, , br, key2] = tokens
  return key1 === 'f' && br === 'br' && key2 === 'dw'
}

/**
 * 获取最新一条打卡文本内容
 * @returns {string}
 */
const getNewestPost = () => {
  const postItems = Array.from(document.querySelectorAll(POST_ITEM_SELECTOR))
  const firstPunchInPost = postItems.find((item) => isPunchInPost(item))
  if (!firstPunchInPost) return ''

  const contentNode = firstPunchInPost.querySelector(POST_CONTENT_SELECTOR)
  const tokens = extractTextTokens(contentNode && contentNode.innerHTML)
  if (!tokens || tokens.length < 6) return ''

  const [key1, key1Value, , key2, key2Value, key2Target] = tokens
  const nextKey1Value = Number(key1Value) + 1
  const nextKey2Value = Number(key2Value) + 2

  if (Number.isNaN(nextKey1Value) || Number.isNaN(nextKey2Value)) {
    return ''
  }

  return `${key1} ${nextKey1Value}\n${key2} (${nextKey2Value}/${key2Target})`
}

/**
 * 将文本插入textarea中
 * @param {string} text
 * @returns {boolean}
 */
const insertTextarea = (text) => {
  const textarea = document.querySelector('textarea')
  if (!textarea) return false

  textarea.value = text
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  return true
}

document.addEventListener('click', (event) => {
  const button = event.target.closest(EDITOR_TRIGGER_BUTTON_SELECTOR)
  if (!button) return

  const text = getNewestPost()
  if (!text) {
    console.error('写入值不能为空')
    return
  }

  window.setTimeout(() => {
    if (!insertTextarea(text)) {
      console.error('未找到输入框，写入失败')
    }
  }, 10)
})
