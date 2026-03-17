const SIGN_IN_URL = 'https://oshwhub.com/sign_in'
const PROFILE_API_URL = 'https://oshwhub.com/api/users/getSignInProfile'
const FALLBACK_POINTS = [
    { x: 175, y: 430, source: 'fixed-center' },
    { x: 168, y: 426, source: 'fixed-nearby' },
    { x: 182, y: 434, source: 'fixed-nearby' },
    { x: 160, y: 431, source: 'fixed-nearby' },
    { x: 190, y: 429, source: 'fixed-nearby' },
    { x: 172, y: 438, source: 'fixed-nearby' },
]

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

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

// 获取签到资料
async function getSignInProfile() {
    try {
        const response = await fetch(PROFILE_API_URL)
        const data = await response.json()
        return data?.result || null
    } catch (error) {
        console.error('获取签到资料失败:', error)
        return null
    }
}

// 检查签到状态
async function checkSignInStatus() {
    const profile = await getSignInProfile()
    return profile?.isTodaySignIn || false
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

function setBadge(text, color) {
    chrome.action.setBadgeText({ text })
    chrome.action.setBadgeBackgroundColor({ color })
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener)
            reject(new Error('页面加载超时'))
        }, timeoutMs)

        function listener(updatedTabId, changeInfo) {
            if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout)
                chrome.tabs.onUpdated.removeListener(listener)
                resolve()
            }
        }

        chrome.tabs.onUpdated.addListener(listener)
    })
}

async function clickPoint(tabId, point) {
    const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: ({ x, y, source }) => {
            const target = document.elementFromPoint(x, y)
            if (!target) {
                return { ok: false, x, y, source, error: 'elementFromPoint returned null' }
            }

            const events = [
                ['pointerdown', PointerEvent],
                ['mousedown', MouseEvent],
                ['pointerup', PointerEvent],
                ['mouseup', MouseEvent],
                ['click', MouseEvent],
            ]

            for (const [type, Ctor] of events) {
                target.dispatchEvent(new Ctor(type, {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clientX: x,
                    clientY: y,
                    pointerType: 'mouse',
                    isPrimary: true,
                    button: 0,
                    buttons: 1,
                    view: window,
                }))
            }

            if (typeof target.click === 'function') {
                target.click()
            }

            return {
                ok: true,
                source,
                x,
                y,
                tag: target.tagName,
                className: target.className || '',
                text: (target.innerText || target.textContent || '').trim().slice(0, 80),
            }
        },
        args: [point],
    })

    return result
}

async function inferLabelPoint(tabId) {
    const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
            const needles = ['立即签到', '+1积分']
            const allElements = Array.from(document.querySelectorAll('body *'))

            const candidate = allElements.find((el) => {
                const text = (el.innerText || el.textContent || '').trim()
                return needles.some((needle) => text.includes(needle))
            })

            if (!candidate) {
                return { ok: false, reason: 'no_candidate' }
            }

            let clickable = candidate
            for (let i = 0; i < 4 && clickable; i++) {
                if (typeof clickable.click === 'function') break
                clickable = clickable.parentElement
            }
            clickable = clickable || candidate

            const rect = clickable.getBoundingClientRect()
            return {
                ok: true,
                source: 'label-inference',
                x: Math.round(rect.left + rect.width / 2),
                y: Math.round(rect.top + rect.height / 2),
                tag: clickable.tagName,
                className: clickable.className || '',
                text: (clickable.innerText || clickable.textContent || '').trim().slice(0, 120),
            }
        },
    })

    return result
}

async function verifySignIn(maxAttempts = 5) {
    for (let i = 0; i < maxAttempts; i++) {
        const profile = await getSignInProfile()
        if (profile?.isTodaySignIn) {
            await saveSignInStatus(true)
            setBadge('已签到', '#00FF00')
            return { ok: true, profile, attempts: i + 1 }
        }
        await delay(1000)
    }

    return { ok: false }
}

async function performSignIn() {
    const isLoggedIn = await checkLoginStatus()
    if (!isLoggedIn) {
        setBadge('未登录', '#FF0000')
        return { ok: false, reason: 'not_logged_in' }
    }

    const beforeProfile = await getSignInProfile()
    if (beforeProfile?.isTodaySignIn) {
        await saveSignInStatus(true)
        setBadge('已签到', '#00FF00')
        return { ok: true, reason: 'already_signed_in', profile: beforeProfile }
    }

    const tab = await chrome.tabs.create({
        url: SIGN_IN_URL,
        active: false,
    })

    try {
        await waitForTabComplete(tab.id)
        await delay(1500)

        const clickResults = []

        // 第 1 层：写死坐标优先
        for (const point of FALLBACK_POINTS) {
            const result = await clickPoint(tab.id, point)
            clickResults.push(result)
            await delay(800)
        }

        const fixedVerify = await verifySignIn(5)
        if (fixedVerify.ok) {
            return { ok: true, reason: 'signed_in', profile: fixedVerify.profile, clickResults }
        }

        // 第 2 层：标签位置推算，重试一次
        const inferredPoint = await inferLabelPoint(tab.id)
        clickResults.push(inferredPoint)

        if (inferredPoint?.ok) {
            const inferredClickResult = await clickPoint(tab.id, inferredPoint)
            clickResults.push(inferredClickResult)
            await delay(1200)

            const inferredVerify = await verifySignIn(5)
            if (inferredVerify.ok) {
                return { ok: true, reason: 'signed_in_by_inference', profile: inferredVerify.profile, clickResults }
            }
        }

        setBadge('未签到', '#FF0000')
        return { ok: false, reason: 'sign_in_not_confirmed', clickResults }
    } catch (error) {
        console.error('执行签到失败:', error)
        setBadge('异常', '#FF0000')
        return { ok: false, reason: 'exception', error: String(error) }
    } finally {
        if (tab?.id) {
            chrome.tabs.remove(tab.id).catch(() => {})
        }
    }
}

// 检查签到
async function checkSignIn() {
    const isLoggedIn = await checkLoginStatus()
    if (!isLoggedIn) {
        setBadge('未登录', '#FF0000')
        return { ok: false, reason: 'not_logged_in' }
    }

    const todaySignedIn = await getTodaySignInStatus()
    if (todaySignedIn) {
        setBadge('已签到', '#00FF00')
        return { ok: true, reason: 'cached_signed_in' }
    }

    setBadge('未签到', '#FF0000')
    chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.png'),
        title: '立创开源硬件平台签到提醒',
        message: '今天还没有签到哟，快去签到吧！',
    })

    const isSignedIn = await checkSignInStatus()
    if (isSignedIn) {
        await saveSignInStatus(true)
        setBadge('已签到', '#00FF00')
        return { ok: true, reason: 'api_signed_in' }
    }

    setBadge('未签到', '#FF0000')
    return { ok: false, reason: 'unsigned' }
}

chrome.alarms.create('checkSignIn', {
    periodInMinutes: 10,
})

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'checkSignIn') {
        checkSignIn()
    }
})

chrome.runtime.onInstalled.addListener(() => {
    checkSignIn()
})

chrome.runtime.onStartup.addListener(() => {
    checkSignIn()
})

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
        case 'checkSignIn':
            checkSignIn().then(sendResponse)
            return true
        case 'performSignIn':
            performSignIn().then(sendResponse)
            return true
        default:
            sendResponse(false)
    }
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (
        tab.url?.startsWith(SIGN_IN_URL) &&
        changeInfo.status === 'complete'
    ) {
        chrome.scripting.executeScript({
            target: { tabId },
            function: () => {
                const observer = new MutationObserver(() => {
                    chrome.runtime.sendMessage({ action: 'checkSignIn' })
                })

                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                })
            },
        })
    }
})
