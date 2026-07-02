/**
 * 高一选科填报系统 - 前端逻辑
 */

// ===== 全局状态 =====
let currentUser = null;      // { name, idCard }
let studentInfo = null;      // { name, class, canWuhua, phyGrade, chemGrade }
let existingSubmission = null; // { choice, submittedAt } 或 null
let selectedChoice = null;   // 当前选中的组合
let statusData = null;       // { counts, limits }
let refreshTimer = null;     // 自动刷新计时器
let countdownTimer = null;   // 倒计时计时器

// ===== API 调用 =====
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  return res.json();
}

// ===== 屏幕切换 =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== Toast 提示 =====
function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = 'toast show' + (type !== 'info' ? ' ' + type : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ===== 登录 =====
async function handleLogin() {
  const name = document.getElementById('input-name').value.trim();
  const idCard = document.getElementById('input-idcard').value.trim();

  if (!name) {
    showToast('请输入姓名', 'error');
    return;
  }
  if (!idCard) {
    showToast('请输入身份证号', 'error');
    return;
  }

  const btn = document.getElementById('btn-login');
  btn.disabled = true;
  btn.textContent = '验证中...';

  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ name, idCard })
    });

    if (result.success) {
      currentUser = { name, idCard };
      studentInfo = result.student;
      existingSubmission = result.submission;
      enterSelectScreen();
    } else {
      showToast(result.message, 'error');
    }
  } catch (err) {
    showToast('网络错误，请重试', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '登 录';
  }
}

// ===== 进入选科页面 =====
function enterSelectScreen() {
  // 显示学生信息
  document.getElementById('display-name').textContent = studentInfo.name + ' 同学';
  document.getElementById('display-class').textContent = studentInfo.class + '班';

  // 显示已填报信息
  const banner = document.getElementById('modify-banner');
  if (existingSubmission) {
    banner.style.display = 'block';
    document.getElementById('current-choice').textContent = existingSubmission.choice;
  } else {
    banner.style.display = 'none';
  }

  // 重置选择
  selectedChoice = null;

  // 物化技权限：如果学生不可选物化技，禁用该卡片
  const wuhuaCard = document.querySelector('[data-choice="物化技"]');
  const wuhuaNote = document.getElementById('note-物化技');
  if (!studentInfo.canWuhua) {
    wuhuaCard.classList.add('disabled');
    wuhuaNote.style.display = 'flex';
    wuhuaNote.innerHTML = '<span class="lock-icon">🔒</span><span>你的物理/化学等第不满足要求，不可选择此组合</span>';
  } else {
    wuhuaCard.classList.remove('disabled');
    wuhuaNote.style.display = 'flex';
    wuhuaNote.innerHTML = '<span class="lock-icon">✅</span><span>你的物化等第满足要求，可以选择此组合</span>';
  }

  // 如果已有填报，预选
  if (existingSubmission) {
    selectedChoice = existingSubmission.choice;
  }

  updateChoiceUI();
  loadStatus();
  showScreen('screen-select');

  // 启动自动刷新
  startAutoRefresh();
}

// ===== 加载人数状态 =====
async function loadStatus() {
  try {
    const result = await api('/api/status');
    if (result.success) {
      statusData = result;
      updateStatusUI();
    }
  } catch (err) {
    console.error('加载状态失败:', err);
  }
}

// ===== 更新人数显示 =====
function updateStatusUI() {
  if (!statusData) return;
  const { counts, limits } = statusData;

  ['政史地', '生地技', '物化技'].forEach(choice => {
    const count = counts[choice] || 0;
    const limit = limits[choice];
    const percent = Math.min(100, (count / limit) * 100);

    const bar = document.getElementById('bar-' + choice);
    const text = document.getElementById('count-' + choice);
    if (bar) bar.style.width = percent + '%';
    if (text) text.textContent = count + ' / ' + limit;

    // 满额标红
    const card = document.querySelector('[data-choice="' + choice + '"]');
    if (card) {
      if (count >= limit) {
        card.classList.add('full');
      } else {
        card.classList.remove('full');
      }
    }
  });
}

// ===== 选择科目组合 =====
function selectChoice(choice) {
  // 物化技权限检查
  if (choice === '物化技' && !studentInfo.canWuhua) {
    showToast('你无权限填报', 'error');
    return;
  }

  // 满额检查
  if (statusData) {
    const count = statusData.counts[choice] || 0;
    const limit = statusData.limits[choice];
    // 如果是修改且选择的是已选的组合，不算满额
    if (!(existingSubmission && existingSubmission.choice === choice) && count >= limit) {
      showToast('该科目已满，请另外选择', 'error');
      return;
    }
  }

  selectedChoice = choice;
  updateChoiceUI();
}

// ===== 更新选择UI =====
function updateChoiceUI() {
  ['政史地', '生地技', '物化技'].forEach(choice => {
    const card = document.querySelector('[data-choice="' + choice + '"]');
    const radio = document.getElementById('radio-' + choice);
    if (selectedChoice === choice) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });

  // 更新提交按钮
  const btn = document.getElementById('btn-submit');
  if (selectedChoice) {
    btn.disabled = false;
    if (existingSubmission && selectedChoice === existingSubmission.choice) {
      btn.textContent = '选择未变化';
      btn.disabled = true;
    } else if (existingSubmission) {
      btn.textContent = '确认修改';
    } else {
      btn.textContent = '确认选择';
    }
  } else {
    btn.disabled = true;
    btn.textContent = '请先选择科目组合';
  }
}

// ===== 确认提交 =====
function confirmSubmit() {
  if (!selectedChoice) return;

  // 物化技二次确认
  if (selectedChoice === '物化技' && !studentInfo.canWuhua) {
    showToast('你无权限填报', 'error');
    return;
  }

  // 弹窗确认
  const modalBody = document.getElementById('modal-body-text');
  let bodyText = '你确认选择【<strong style="color:#1890ff;font-size:18px">' + selectedChoice + '</strong>】吗？';

  if (existingSubmission && existingSubmission.choice !== selectedChoice) {
    bodyText = '你当前已选择【' + existingSubmission.choice + '】，确认修改为【<strong style="color:#1890ff;font-size:18px">' + selectedChoice + '</strong>】吗？';
  }

  modalBody.innerHTML = bodyText;
  document.getElementById('modal-confirm').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-confirm').style.display = 'none';
}

// ===== 执行提交 =====
async function doSubmit() {
  closeModal();

  if (!selectedChoice || !currentUser) return;

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = '提交中...';

  try {
    const result = await api('/api/submit', {
      method: 'POST',
      body: JSON.stringify({
        name: currentUser.name,
        idCard: currentUser.idCard,
        choice: selectedChoice
      })
    });

    if (result.success) {
      // 更新状态
      existingSubmission = {
        choice: selectedChoice,
        submittedAt: new Date().toISOString()
      };
      statusData.counts = result.counts;
      updateStatusUI();

      // 显示结果页
      showResult(selectedChoice, result.isModify);
      stopAutoRefresh();
    } else {
      showToast(result.message, 'error');
      // 刷新状态（可能人数已变）
      loadStatus();
      btn.disabled = false;
      updateChoiceUI();
    }
  } catch (err) {
    showToast('网络错误，请重试', 'error');
    btn.disabled = false;
    updateChoiceUI();
  }
}

// ===== 显示结果页 =====
function showResult(choice, isModify) {
  document.getElementById('result-title').textContent = isModify ? '修改成功' : '填报成功';
  document.getElementById('result-choice-name').textContent = choice;

  // 格式化时间
  const now = new Date();
  const timeStr = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0') + ' ' +
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0');
  document.getElementById('result-time').textContent = '提交时间：' + timeStr;

  showScreen('screen-result');
}

// ===== 跳转到选科页（修改） =====
function goToSelect() {
  enterSelectScreen();
}

// ===== 退出登录 =====
function logout() {
  stopAutoRefresh();
  currentUser = null;
  studentInfo = null;
  existingSubmission = null;
  selectedChoice = null;
  statusData = null;

  // 清空输入
  document.getElementById('input-name').value = '';
  document.getElementById('input-idcard').value = '';

  showScreen('screen-login');
}

// ===== 自动刷新人数 =====
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(loadStatus, 10000); // 每10秒刷新
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

function stopAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

// ===== 时间检查 =====
async function checkOpenTime() {
  try {
    const res = await fetch('/api/timecheck');
    const data = await res.json();
    return data;
  } catch (err) {
    return { isOpen: true }; // 网络故障时默认开放
  }
}

// 格式化倒计时
function formatCountdown(seconds) {
  if (seconds <= 0) return '即将开放';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  let parts = [];
  if (d > 0) parts.push(d + '天');
  parts.push(String(h).padStart(2, '0') + '时');
  parts.push(String(m).padStart(2, '0') + '分');
  parts.push(String(s).padStart(2, '0') + '秒');
  return parts.join(' ');
}

// 格式化显示时间
function formatDateTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 显示关闭屏幕
function showClosedScreen(timeCheck) {
  const icon = document.getElementById('closed-icon');
  const title = document.getElementById('closed-title');
  const subtitle = document.getElementById('closed-subtitle');
  const openEl = document.getElementById('closed-open');
  const closeEl = document.getElementById('closed-close');
  const countdownBox = document.getElementById('closed-countdown-box');

  if (timeCheck.reason === '填报已结束') {
    icon.textContent = '🔒';
    title.textContent = '填报已结束';
    subtitle.textContent = '选科填报已截止，如需修改请联系管理员';
    countdownBox.style.display = 'none';
  } else {
    icon.textContent = '⏰';
    title.textContent = '填报暂未开放';
    subtitle.textContent = '请等待开放时间到达后再进行填报';
    countdownBox.style.display = 'block';
    startCountdown(timeCheck.secondsUntilOpen);
  }

  openEl.textContent = formatDateTime(timeCheck.openTime);
  closeEl.textContent = formatDateTime(timeCheck.closeTime);

  showScreen('screen-closed');
}

// 倒计时
function startCountdown(seconds) {
  stopCountdown();
  let remaining = seconds;
  updateCountdown(remaining);
  countdownTimer = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      stopCountdown();
      location.reload(); // 倒计时结束，刷新页面
    } else {
      updateCountdown(remaining);
    }
  }, 1000);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function updateCountdown(seconds) {
  document.getElementById('countdown-digits').textContent = formatCountdown(seconds);
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async function() {
  // 首先检查填报时间
  const timeCheck = await checkOpenTime();
  if (!timeCheck.isOpen) {
    showClosedScreen(timeCheck);
    return;
  }
  // 回车键登录
  document.getElementById('input-idcard').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('input-name').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') document.getElementById('input-idcard').focus();
  });

  showScreen('screen-login');
});
