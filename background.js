// 检查登录状态
async function checkLoginStatus() {
    try {
        const cookie = await chrome.cookies.get({
            url: 'https://oshwhub.com',
            name: 'oshwhub_session',
        })
        return cookie !== null && cookie.expirationDate > Date.now() / 1000
    } catch (error) {
        console.error('检查登录状态失败:', error)
        return false
    }
}

// 检查签到状态
async function checkSignInStatus() {
    try {
        const response = await fetch(
            'https://oshwhub.com/api/users/getSignInProfile'
        )
        const data = await response.json()
        return data?.result?.isTodaySignIn || false
    } catch (error) {
        console.error('检查签到状态失败:', error)
        return false
    }
}

// 保存今天的签到状态
async function saveSignInStatus(status) {
    const today = new Date().toLocaleDateString('en-CA', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    await chrome.storage.local.set({ [today]: status })
}

// 获取今天的签到状态
async function getTodaySignInStatus() {
    const today = new Date().toLocaleDateString('en-CA', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
    const result = await chrome.storage.local.get(today)
    return result[today] || false
}

// 检查签到
async function checkSignIn() {
    const isLoggedIn = await checkLoginStatus()
    if (!isLoggedIn) {
        chrome.action.setBadgeText({ text: '未登录' })
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
        return
    }

    const todaySignedIn = await getTodaySignInStatus()
    if (todaySignedIn) {
        chrome.action.setBadgeText({ text: '已签到' })
        chrome.action.setBadgeBackgroundColor({ color: '#00FF00' })
        return
    } else {
        chrome.action.setBadgeText({ text: '未签到' })
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })

        // 发送通知
        chrome.notifications.create({
            type: 'basic',
            iconUrl: chrome.runtime.getURL('icon.png'),
            title: '立创开源硬件平台签到提醒',
            message: `今天还没有签到哟，快去签到吧！`,
        })
    }

    const isSignedIn = await checkSignInStatus()
    if (isSignedIn) {
        await saveSignInStatus(true)
        chrome.action.setBadgeText({ text: '已签到' })
        chrome.action.setBadgeBackgroundColor({ color: '#00FF00' })
    } else {
        chrome.action.setBadgeText({ text: '未签到' })
        chrome.action.setBadgeBackgroundColor({ color: '#FF0000' })
    }
}

// 设置定时检查
chrome.alarms.create('checkSignIn', {
    periodInMinutes: 0.1,
})

// 监听定时器
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkSignIn') {
        checkSignIn()
    }
})

// 插件安装或更新时初始化
chrome.runtime.onInstalled.addListener(() => {
    checkSignIn()
})

// 添加消息监听器
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'checkLoginStatus':
            checkLoginStatus().then(sendResponse)
            return true
        case 'getTodaySignInStatus':
            getTodaySignInStatus().then(sendResponse)
            return true
        case 'checkSignInStatus':
            checkSignInStatus().then(sendResponse)
            return true
        case 'saveSignInStatus':
            saveSignInStatus(request.status).then(() => sendResponse(true))
            return true
        default:
            sendResponse(false)
    }
})
