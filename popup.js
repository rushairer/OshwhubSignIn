const statusElement = document.getElementById('status')
const signButton = document.getElementById('signButton')
const openPageButton = document.getElementById('openPageButton')
const metaPanel = document.getElementById('metaPanel')
const totalPointElement = document.getElementById('totalPoint')
const monthDaysElement = document.getElementById('monthDays')
const latestSignInElement = document.getElementById('latestSignIn')
const strategyElement = document.getElementById('strategy')
const logsPanel = document.getElementById('logsPanel')
const logsContent = document.getElementById('logsContent')

function formatDateTime(value) {
  if (!value) return '-'
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('zh-CN', { hour12: false })
  } catch {
    return value
  }
}

function renderProfile(profile, strategy = '-') {
  if (!profile) {
    metaPanel.style.display = 'none'
    return
  }

  metaPanel.style.display = 'block'
  totalPointElement.textContent = profile.total_point ?? '-'
  monthDaysElement.textContent = profile.month_signIn_days ?? '-'
  latestSignInElement.textContent = formatDateTime(profile.latestSignInDate)
  strategyElement.textContent = strategy || '-'
}

function renderLogs(clickResults = []) {
  if (!clickResults || clickResults.length === 0) {
    logsPanel.style.display = 'none'
    return
  }

  const lines = clickResults.map((item, index) => {
    if (!item) return `${index + 1}. 空结果`
    if (item.ok === false) {
      return `${index + 1}. ${item.source || 'unknown'} → 失败：${item.error || item.reason || 'unknown error'}`
    }
    return `${index + 1}. ${item.source || 'unknown'} → (${item.x}, ${item.y}) → ${item.text || item.tag || 'no text'}`
  })

  logsPanel.style.display = 'block'
  logsContent.textContent = lines.join('\n')
}

// 更新状态显示
function updateStatus(isLoggedIn, isSignedIn) {
  statusElement.classList.remove('signed', 'unsigned', 'not-logged-in')

  if (!isLoggedIn) {
    statusElement.textContent = '请先登录 OshwHub'
    statusElement.classList.add('not-logged-in')
    signButton.style.display = 'none'
    openPageButton.style.display = 'block'
    metaPanel.style.display = 'none'
    logsPanel.style.display = 'none'
    return
  }

  if (isSignedIn) {
    statusElement.textContent = '今日已签到'
    statusElement.classList.add('signed')
    signButton.style.display = 'none'
    openPageButton.style.display = 'none'
  } else {
    statusElement.textContent = '今日未签到'
    statusElement.classList.add('unsigned')
    signButton.style.display = 'block'
    signButton.disabled = false
    signButton.textContent = '立即签到'
    openPageButton.style.display = 'block'
  }
}

async function performSignIn() {
  try {
    signButton.disabled = true
    signButton.textContent = '签到中...'
    statusElement.textContent = '正在执行签到...'
    logsPanel.style.display = 'none'

    const result = await chrome.runtime.sendMessage({ action: 'performSignIn' })

    if (result?.ok) {
      statusElement.classList.remove('unsigned', 'not-logged-in')
      statusElement.classList.add('signed')
      statusElement.textContent = result.reason === 'already_signed_in' ? '今日已签到' : '签到成功'
      signButton.style.display = 'none'
      openPageButton.style.display = 'none'
      renderProfile(result.profile, result.strategyLabel)
      renderLogs(result.clickResults)
      return
    }

    statusElement.classList.remove('signed', 'not-logged-in')
    statusElement.classList.add('unsigned')

    if (result?.reason === 'not_logged_in') {
      statusElement.textContent = '请先登录 OshwHub'
    } else {
      statusElement.textContent = '签到未确认，请打开签到页检查'
    }

    renderProfile(result?.profile, result?.strategyLabel)
    renderLogs(result?.clickResults)
    signButton.disabled = false
    signButton.textContent = '重试签到'
    openPageButton.style.display = 'block'
  } catch (error) {
    console.error('执行签到失败:', error)
    statusElement.classList.remove('signed', 'not-logged-in')
    statusElement.classList.add('unsigned')
    statusElement.textContent = '签到失败，请重试'
    signButton.disabled = false
    signButton.textContent = '重试签到'
    openPageButton.style.display = 'block'
  }
}

// 检查状态
async function checkStatus() {
  try {
    const [isLoggedIn, todaySignedIn, profile] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'checkLoginStatus' }),
      chrome.runtime.sendMessage({ action: 'getTodaySignInStatus' }),
      chrome.runtime.sendMessage({ action: 'getSignInProfile' })
    ])

    updateStatus(isLoggedIn, todaySignedIn)
    renderProfile(profile, todaySignedIn ? 'API / 本地缓存' : '-')

    if (isLoggedIn && !todaySignedIn) {
      const isSignedIn = await chrome.runtime.sendMessage({ action: 'checkSignInStatus' })
      if (isSignedIn) {
        await chrome.runtime.sendMessage({ action: 'saveSignInStatus', status: true })
        updateStatus(true, true)
        const freshProfile = await chrome.runtime.sendMessage({ action: 'getSignInProfile' })
        renderProfile(freshProfile, 'API 实时确认')
      }
    }
  } catch (error) {
    console.error('检查状态失败:', error)
    statusElement.textContent = '检查状态失败'
  }
}

signButton.addEventListener('click', performSignIn)

document.addEventListener('DOMContentLoaded', checkStatus)
