const statusElement = document.getElementById('status')
const signButton = document.getElementById('signButton')
const openPageButton = document.getElementById('openPageButton')

// 更新状态显示
function updateStatus(isLoggedIn, isSignedIn) {
  statusElement.classList.remove('signed', 'unsigned', 'not-logged-in')

  if (!isLoggedIn) {
    statusElement.textContent = '请先登录 OshwHub'
    statusElement.classList.add('not-logged-in')
    signButton.style.display = 'none'
    openPageButton.style.display = 'block'
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

    const result = await chrome.runtime.sendMessage({ action: 'performSignIn' })

    if (result?.ok) {
      statusElement.classList.remove('unsigned', 'not-logged-in')
      statusElement.classList.add('signed')
      statusElement.textContent = result.reason === 'already_signed_in' ? '今日已签到' : '签到成功'
      signButton.style.display = 'none'
      openPageButton.style.display = 'none'
      return
    }

    statusElement.classList.remove('signed', 'not-logged-in')
    statusElement.classList.add('unsigned')

    if (result?.reason === 'not_logged_in') {
      statusElement.textContent = '请先登录 OshwHub'
    } else {
      statusElement.textContent = '签到未确认，请打开签到页检查'
    }

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
    const [isLoggedIn, todaySignedIn] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'checkLoginStatus' }),
      chrome.runtime.sendMessage({ action: 'getTodaySignInStatus' })
    ])

    updateStatus(isLoggedIn, todaySignedIn)

    if (isLoggedIn && !todaySignedIn) {
      const isSignedIn = await chrome.runtime.sendMessage({ action: 'checkSignInStatus' })
      if (isSignedIn) {
        await chrome.runtime.sendMessage({ action: 'saveSignInStatus', status: true })
        updateStatus(true, true)
      }
    }
  } catch (error) {
    console.error('检查状态失败:', error)
    statusElement.textContent = '检查状态失败'
  }
}

signButton.addEventListener('click', performSignIn)

document.addEventListener('DOMContentLoaded', checkStatus)
