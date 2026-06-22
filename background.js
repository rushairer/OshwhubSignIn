const SIGN_IN_URL = 'https://oshwhub.com/sign_in'
const PROFILE_API_URL = 'https://oshwhub.com/api/users/getSignInProfile'
const TAB_LOAD_TIMEOUT_MS = 25000
const TAB_SETTLE_DELAY_MS = 600
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

function getStrategyLabel(reason) {
    switch (reason) {
        case 'already_signed_in':
            return '今日已签到 / 直接返回'
        case 'signed_in':
            return '写死坐标成功'
        case 'signed_in_by_inference':
            return '标签推算成功'
        case 'api_signed_in':
            return 'API 实时确认'
        case 'cached_signed_in':
            return '本地缓存'
        case 'not_logged_in':
            return '未登录 / 需要手动登录'
        case 'auth_redirect':
            return '登录跳转 / 已保留页面'
        case 'sign_in_page_unavailable':
            return '签到页跳转 / 已保留页面'
        case 'tab_load_timeout':
            return '页面超时 / 已保留页面'
        default:
            return '-'
    }
}

function safeParseUrl(url) {
    if (!url) return null
    try {
        return new URL(url)
    } catch {
        return null
    }
}

function normalizePath(pathname = '') {
    return pathname.replace(/\/+$/, '') || '/'
}

function isOshwHubUrl(url) {
    const parsed = safeParseUrl(url)
    if (!parsed) return false
    const hostname = parsed.hostname.toLowerCase()
    return hostname === 'oshwhub.com' || hostname.endsWith('.oshwhub.com')
}

function isSignInPageUrl(url) {
    const parsed = safeParseUrl(url)
    if (!parsed) return false
    return parsed.hostname.toLowerCase() === 'oshwhub.com' && normalizePath(parsed.pathname) === '/sign_in'
}

function isLikelyAuthUrl(url) {
    const parsed = safeParseUrl(url)
    if (!parsed) return false

    const hostname = parsed.hostname.toLowerCase()
    const pathname = normalizePath(parsed.pathname).toLowerCase()
    const fullUrl = parsed.href.toLowerCase()

    if (hostname !== 'oshwhub.com' && !hostname.endsWith('.oshwhub.com')) {
        return true
    }

    return [
        '/login',
        '/user/login',
        '/users/login',
        '/account/login',
        '/passport/login',
    ].some(path => pathname === path || pathname.startsWith(`${path}/`))
        || pathname.includes('/oauth')
        || pathname.includes('/auth')
        || pathname.includes('/passport')
        || fullUrl.includes('redirect') && fullUrl.includes('login')
}

function createTabLoadError(message, reason, url) {
    const error = new Error(message)
    error.reason = reason
    error.url = url || ''
    return error
}

async function revealTab(tabId) {
    if (!tabId) return
    try {
        await chrome.tabs.update(tabId, { active: true })
    } catch (error) {
        console.warn('切换到标签页失败:', error)
    }
}

async function getCurrentTabUrl(tabId, fallbackUrl = '') {
    try {
        const currentTab = await chrome.tabs.get(tabId)
        return currentTab?.url || fallbackUrl
    } catch {
        return fallbackUrl
    }
}

async function hasValidSessionCookie() {
    const cookie = await chrome.cookies.get({
        url: 'https://oshwhub.com',
        name: 'oshwhub_session',
    })

    if (!cookie) return false
    if (typeof cookie.expirationDate === 'number' && cookie.expirationDate <= Date.now() / 1000) {
        return false
    }

    return true
}

// 检查登录状态
async function checkLoginStatus() {
    try {
        const hasCookie = await hasValidSessionCookie()
        if (!hasCookie) return false

        // cookie 存在不代表服务端 session 仍有效；用资料接口再确认一次，避免打开签到页后被登录跳转卡住。
        const profile = await getSignInProfile()
        return profile !== null
    } catch (error) {
        console.error('检查登录状态失败:', error)
        return false
    }
}

// 获取签到资料
async function getSignInProfile() {
    try {
        const response = await fetch(PROFILE_API_URL, { credentials: 'include' })
        if (!response.ok) return null

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

function getTodayKey(date = new Date()) {
    return date.toLocaleDateString('en-CA', {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })
}

function isLastDayOfMonth(date = new Date()) {
    return date.getDate() === new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

function getGiftReminderItems(date = new Date()) {
    const items = []

    if (date.getDay() === 0) {
        items.push({ type: 'weekly', label: '周好礼', reason: '今天是周日' })
    }

    if (isLastDayOfMonth(date)) {
        items.push({ type: 'monthly', label: '月好礼', reason: '今天是本月最后一天' })
    }

    return items
}

function getGiftReminderMessage(items) {
    if (items.length === 1) {
        return `${items[0].reason}，签到完成啦，记得领取${items[0].label}！`
    }

    return '今天既是周日，也是本月最后一天，签到完成啦，记得领取周好礼和月好礼！'
}

async function notifyGiftReminderIfNeeded(date = new Date()) {
    const items = getGiftReminderItems(date)
    if (items.length === 0) return []

    const today = getTodayKey(date)
    const keysByType = items.reduce((acc, item) => {
        acc[item.type] = `giftReminder:${today}:${item.type}`
        return acc
    }, {})
    const sentStatus = await chrome.storage.local.get(Object.values(keysByType))
    const pendingItems = items.filter(item => !sentStatus[keysByType[item.type]])

    if (pendingItems.length === 0) return []

    await chrome.notifications.create(`giftReminder:${today}:${pendingItems.map(item => item.type).join('-')}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.png'),
        title: '签到完成，别忘了领取好礼',
        message: getGiftReminderMessage(pendingItems),
    })

    const updates = pendingItems.reduce((acc, item) => {
        acc[keysByType[item.type]] = true
        return acc
    }, {})
    await chrome.storage.local.set(updates)

    return pendingItems.map(item => item.type)
}

// 保存今天的签到状态；签到完成后如遇周日/月末，则提醒领取周好礼/月好礼。
async function saveSignInStatus(status) {
    const now = new Date()
    const today = getTodayKey(now)
    await chrome.storage.local.set({ [today]: status })

    if (status) {
        await notifyGiftReminderIfNeeded(now)
    }
}

// 获取今天的签到状态
async function getTodaySignInStatus() {
    const today = getTodayKey()
    const result = await chrome.storage.local.get(today)
    return result[today] || false
}

function setBadge(text, color) {
    chrome.action.setBadgeText({ text })
    chrome.action.setBadgeBackgroundColor({ color })
}

async function waitForTabComplete(tabId, timeoutMs = TAB_LOAD_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let latestUrl = ''
        let settleTimer = null
        let settled = false

        const cleanup = () => {
            clearTimeout(timeout)
            clearTimeout(settleTimer)
            chrome.tabs.onUpdated.removeListener(listener)
            chrome.tabs.onRemoved.removeListener(removedListener)
        }

        const finish = (tab) => {
            if (settled) return
            settled = true
            latestUrl = tab?.url || latestUrl
            cleanup()
            resolve({ url: latestUrl, tab })
        }

        const fail = (error) => {
            if (settled) return
            settled = true
            cleanup()
            reject(error)
        }

        const timeout = setTimeout(() => {
            fail(createTabLoadError('页面加载超时', 'tab_load_timeout', latestUrl))
        }, timeoutMs)

        function listener(updatedTabId, changeInfo, tab) {
            if (updatedTabId !== tabId) return

            if (changeInfo.url || tab?.url) {
                latestUrl = changeInfo.url || tab.url
            }

            if (changeInfo.status === 'loading') {
                clearTimeout(settleTimer)
            }

            if (changeInfo.status === 'complete') {
                clearTimeout(settleTimer)
                latestUrl = tab?.url || latestUrl
                settleTimer = setTimeout(() => finish(tab), TAB_SETTLE_DELAY_MS)
            }
        }

        function removedListener(removedTabId) {
            if (removedTabId === tabId) {
                fail(createTabLoadError('标签页已被关闭', 'tab_closed', latestUrl))
            }
        }

        chrome.tabs.onUpdated.addListener(listener)
        chrome.tabs.onRemoved.addListener(removedListener)

        chrome.tabs.get(tabId).then((tab) => {
            latestUrl = tab?.url || latestUrl
            if (tab?.status === 'complete') {
                settleTimer = setTimeout(() => finish(tab), TAB_SETTLE_DELAY_MS)
            }
        }).catch((error) => {
            fail(createTabLoadError(String(error), 'tab_closed', latestUrl))
        })
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
                return { ok: false, reason: 'no_candidate', source: 'label-inference' }
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

async function handleAuthRequired(tabId, url, reason = 'auth_redirect', error = null) {
    await revealTab(tabId)
    setBadge('未登录', '#FF0000')
    return {
        ok: false,
        reason: 'not_logged_in',
        strategyLabel: getStrategyLabel(reason),
        error: error ? String(error) : undefined,
        loginUrl: url || '',
        clickResults: [],
    }
}

async function performSignIn() {
    const isLoggedIn = await checkLoginStatus()
    if (!isLoggedIn) {
        setBadge('未登录', '#FF0000')
        return { ok: false, reason: 'not_logged_in', strategyLabel: getStrategyLabel('not_logged_in') }
    }

    const beforeProfile = await getSignInProfile()
    if (beforeProfile?.isTodaySignIn) {
        await saveSignInStatus(true)
        setBadge('已签到', '#00FF00')
        return {
            ok: true,
            reason: 'already_signed_in',
            strategyLabel: getStrategyLabel('already_signed_in'),
            profile: beforeProfile,
            clickResults: [],
        }
    }

    const tab = await chrome.tabs.create({
        url: SIGN_IN_URL,
        active: false,
    })
    let shouldCloseTab = true

    try {
        const loadInfo = await waitForTabComplete(tab.id)
        await delay(1500)

        const currentUrl = await getCurrentTabUrl(tab.id, loadInfo?.url)
        if (!isSignInPageUrl(currentUrl)) {
            const freshProfile = await getSignInProfile()

            if (!freshProfile || isLikelyAuthUrl(currentUrl)) {
                shouldCloseTab = false
                return await handleAuthRequired(tab.id, currentUrl, 'auth_redirect')
            }

            if (freshProfile.isTodaySignIn) {
                await saveSignInStatus(true)
                setBadge('已签到', '#00FF00')
                return {
                    ok: true,
                    reason: 'already_signed_in',
                    strategyLabel: getStrategyLabel('api_signed_in'),
                    profile: freshProfile,
                    clickResults: [],
                }
            }

            shouldCloseTab = false
            await revealTab(tab.id)
            setBadge('未签到', '#FF0000')
            return {
                ok: false,
                reason: 'sign_in_page_unavailable',
                strategyLabel: getStrategyLabel('sign_in_page_unavailable'),
                profile: freshProfile,
                loginUrl: currentUrl,
                clickResults: [],
            }
        }

        const clickResults = []

        // 第 1 层：写死坐标优先
        for (const point of FALLBACK_POINTS) {
            const result = await clickPoint(tab.id, point)
            clickResults.push(result)
            await delay(800)
        }

        const fixedVerify = await verifySignIn(5)
        if (fixedVerify.ok) {
            return {
                ok: true,
                reason: 'signed_in',
                strategyLabel: getStrategyLabel('signed_in'),
                profile: fixedVerify.profile,
                clickResults,
            }
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
                return {
                    ok: true,
                    reason: 'signed_in_by_inference',
                    strategyLabel: getStrategyLabel('signed_in_by_inference'),
                    profile: inferredVerify.profile,
                    clickResults,
                }
            }
        }

        setBadge('未签到', '#FF0000')
        return {
            ok: false,
            reason: 'sign_in_not_confirmed',
            strategyLabel: '固定点 + 标签推算均未确认',
            profile: await getSignInProfile(),
            clickResults,
        }
    } catch (error) {
        console.error('执行签到失败:', error)
        const currentUrl = await getCurrentTabUrl(tab?.id, error?.url)

        if (error?.reason === 'tab_load_timeout') {
            shouldCloseTab = false
            await revealTab(tab.id)
            setBadge('异常', '#FF0000')
            return {
                ok: false,
                reason: 'tab_load_timeout',
                strategyLabel: getStrategyLabel('tab_load_timeout'),
                error: String(error),
                loginUrl: currentUrl,
                profile: await getSignInProfile(),
                clickResults: [],
            }
        }

        if (isLikelyAuthUrl(currentUrl)) {
            shouldCloseTab = false
            return await handleAuthRequired(tab.id, currentUrl, 'auth_redirect', error)
        }

        setBadge('异常', '#FF0000')
        return {
            ok: false,
            reason: 'exception',
            strategyLabel: '执行异常',
            error: String(error),
            profile: await getSignInProfile(),
            clickResults: [],
        }
    } finally {
        if (shouldCloseTab && tab?.id) {
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

    const isSignedIn = await checkSignInStatus()
    if (isSignedIn) {
        await saveSignInStatus(true)
        setBadge('已签到', '#00FF00')
        return { ok: true, reason: 'api_signed_in' }
    }

    setBadge('未签到', '#FF0000')
    chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icon.png'),
        title: '立创开源硬件平台签到提醒',
        message: '今天还没有签到哟，快去签到吧！',
    })

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
        case 'getSignInProfile':
            getSignInProfile().then(sendResponse)
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
            func: () => {
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
