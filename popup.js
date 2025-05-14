// 更新状态显示
function updateStatus(isLoggedIn, isSignedIn) {
  const statusElement = document.getElementById('status');
  const signButton = document.getElementById('signButton');

  statusElement.classList.remove('signed', 'unsigned', 'not-logged-in');
  
  if (!isLoggedIn) {
    statusElement.textContent = '请先登录OshwHub';
    statusElement.classList.add('not-logged-in');
    signButton.style.display = 'block';
    return;
  }

  if (isSignedIn) {
    statusElement.textContent = '今日已签到';
    statusElement.classList.add('signed');
    signButton.style.display = 'none';
  } else {
    statusElement.textContent = '今日未签到';
    statusElement.classList.add('unsigned');
    signButton.style.display = 'block';
  }
}

// 检查状态
async function checkStatus() {
  try {
    const [isLoggedIn, todaySignedIn] = await Promise.all([
      chrome.runtime.sendMessage({ action: 'checkLoginStatus' }),
      chrome.runtime.sendMessage({ action: 'getTodaySignInStatus' })
    ]);

    updateStatus(isLoggedIn, todaySignedIn);

    if (isLoggedIn && !todaySignedIn) {
      const isSignedIn = await chrome.runtime.sendMessage({ action: 'checkSignInStatus' });
      if (isSignedIn) {
        await chrome.runtime.sendMessage({ action: 'saveSignInStatus', status: true });
        updateStatus(true, true);
      }
    }
  } catch (error) {
    console.error('检查状态失败:', error);
    document.getElementById('status').textContent = '检查状态失败';
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', checkStatus);