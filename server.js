/**
 * 高一选科填报系统 - 服务端
 * 使用 Node.js 内置模块，无需安装任何依赖
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'wflz2026';
const DATA_DIR = path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// ==================== 数据加载 ====================

const students = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'students.json'), 'utf-8'));
// 以 idCard 为 key 建立查找表
const studentById = new Map(students.map(s => [s.idCard, s]));
// 以 name+idCard 联合建立查找表（更安全）
const studentByKey = new Map(students.map(s => [`${s.name}|${s.idCard}`, s]));

const LIMITS = { '政史地': 86, '生地技': 84, '物化技': 36 };
const CHOICES = ['政史地', '生地技', '物化技'];

// ==================== 数据持久化 ====================

function loadSubmissions() {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, 'submissions.json'), 'utf-8');
    const data = JSON.parse(raw);
    // 确保结构完整
    if (!data.submissions) data.submissions = {};
    return data;
  } catch {
    return { submissions: {} };
  }
}

function saveSubmissions(data) {
  fs.writeFileSync(path.join(DATA_DIR, 'submissions.json'), JSON.stringify(data, null, 2));
}

function calcCounts(submissions) {
  const counts = { '政史地': 0, '生地技': 0, '物化技': 0 };
  for (const key in submissions) {
    const choice = submissions[key].choice;
    if (counts[choice] !== undefined) counts[choice]++;
  }
  return counts;
}

// ==================== 时间控制 ====================

function loadSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { openTime: '', closeTime: '', isActive: false };
  }
}

function saveSettings(settings) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

/**
 * 检查当前是否在填报时间内
 * @returns {{ isOpen: boolean, reason: string, openTime: string, closeTime: string, secondsUntilOpen: number, secondsUntilClose: number }}
 */
function checkTime() {
  const settings = loadSettings();
  const now = new Date();

  // 未启用时间限制 → 始终开放
  if (!settings.isActive) {
    return { isOpen: true, reason: '', openTime: '', closeTime: '' };
  }

  // 解析时间
  const openTime = settings.openTime ? new Date(settings.openTime) : null;
  const closeTime = settings.closeTime ? new Date(settings.closeTime) : null;

  // 未设置完整时间 → 开放
  if (!openTime || !closeTime) {
    return { isOpen: true, reason: '', openTime: settings.openTime, closeTime: settings.closeTime };
  }

  // 未到开放时间
  if (now < openTime) {
    const diff = Math.floor((openTime - now) / 1000);
    return {
      isOpen: false,
      reason: '填报暂未开放',
      openTime: settings.openTime,
      closeTime: settings.closeTime,
      secondsUntilOpen: diff,
      secondsUntilClose: 0
    };
  }

  // 已过截止时间
  if (now > closeTime) {
    return {
      isOpen: false,
      reason: '填报已结束',
      openTime: settings.openTime,
      closeTime: settings.closeTime,
      secondsUntilOpen: 0,
      secondsUntilClose: 0
    };
  }

  // 在开放时间内
  const diff = Math.floor((closeTime - now) / 1000);
  return {
    isOpen: true,
    reason: '',
    openTime: settings.openTime,
    closeTime: settings.closeTime,
    secondsUntilOpen: 0,
    secondsUntilClose: diff
  };
}

// ==================== HTTP 工具函数 ====================

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  // 防止路径穿越
  filePath = path.normalize(filePath).replace(/^(\.\.[\/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    sendJSON(res, 403, { error: 'Forbidden' });
    return;
  }

  const ext = path.extname(fullPath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>404 - 页面未找到</h1>');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

// ==================== API 处理函数 ====================

// POST /api/login
// 验证姓名+身份证，返回学生信息和已有填报
function handleLogin(body) {
  // 时间校验
  const timeCheck = checkTime();
  if (!timeCheck.isOpen) {
    return { success: false, message: timeCheck.reason, timeCheck };
  }

  const { name, idCard } = body;
  if (!name || !idCard) {
    return { success: false, message: '请输入姓名和身份证号' };
  }

  const cleanName = String(name).trim();
  const cleanId = String(idCard).trim();

  const student = studentByKey.get(`${cleanName}|${cleanId}`);
  if (!student) {
    return { success: false, message: '姓名或身份证号不正确，请重新输入' };
  }

  // 检查是否已填报
  const data = loadSubmissions();
  const existing = data.submissions[cleanId];

  return {
    success: true,
    student: {
      name: student.name,
      class: student.class,
      canWuhua: student.canWuhua,
      phyGrade: student.phyGrade,
      chemGrade: student.chemGrade
    },
    submission: existing ? {
      choice: existing.choice,
      submittedAt: existing.submittedAt
    } : null
  };
}

// GET /api/status
// 返回各组合当前人数和上限
function handleStatus() {
  const data = loadSubmissions();
  const counts = calcCounts(data.submissions);
  return {
    success: true,
    counts,
    limits: LIMITS
  };
}

// POST /api/submit
// 提交或修改选科
function handleSubmit(body) {
  // 时间校验
  const timeCheck = checkTime();
  if (!timeCheck.isOpen) {
    return { success: false, message: timeCheck.reason, timeCheck };
  }

  const { name, idCard, choice } = body;

  // 1. 基本验证
  if (!name || !idCard || !choice) {
    return { success: false, message: '参数不完整' };
  }

  const cleanName = String(name).trim();
  const cleanId = String(idCard).trim();
  const cleanChoice = String(choice).trim();

  if (!CHOICES.includes(cleanChoice)) {
    return { success: false, message: '无效的科目组合' };
  }

  // 2. 身份验证
  const student = studentByKey.get(`${cleanName}|${cleanId}`);
  if (!student) {
    return { success: false, message: '身份验证失败' };
  }

  // 3. 物化技权限判定
  if (cleanChoice === '物化技' && !student.canWuhua) {
    return { success: false, message: '你无权限填报' };
  }

  // 4. 加载现有数据（同步操作，避免并发问题）
  const data = loadSubmissions();
  const existing = data.submissions[cleanId];

  // 5. 判定：已填报过 → 只能修改，不能重复填报
  if (existing && existing.choice === cleanChoice) {
    // 选择相同，无需修改
    return {
      success: true,
      message: '你的选择未发生变化',
      counts: calcCounts(data.submissions),
      limits: LIMITS
    };
  }

  // 6. 人数限制判定
  const counts = calcCounts(data.submissions);

  // 如果是修改，先减去原来组合的人数再检查
  if (existing) {
    counts[existing.choice]--;
  }

  if (counts[cleanChoice] >= LIMITS[cleanChoice]) {
    return {
      success: false,
      message: '该科目已满，请另外选择',
      counts: calcCounts(data.submissions),
      limits: LIMITS
    };
  }

  // 7. 保存
  data.submissions[cleanId] = {
    name: student.name,
    class: student.class,
    idCard: cleanId,
    choice: cleanChoice,
    submittedAt: new Date().toISOString(),
    phyGrade: student.phyGrade,
    chemGrade: student.chemGrade,
    canWuhua: student.canWuhua
  };

  saveSubmissions(data);

  const newCounts = calcCounts(data.submissions);
  return {
    success: true,
    message: existing ? '修改成功' : '填报成功',
    counts: newCounts,
    limits: LIMITS,
    isModify: !!existing
  };
}

// GET /api/admin?password=xxx
// 管理后台数据
function handleAdmin(query) {
  if (query.password !== ADMIN_PASSWORD) {
    return { success: false, message: '密码错误' };
  }

  const data = loadSubmissions();
  const counts = calcCounts(data.submissions);

  // 所有提交记录
  const submissions = Object.values(data.submissions).sort((a, b) => {
    return a.class.localeCompare(b.class) || a.name.localeCompare(b.name);
  });

  // 未提交学生
  const submittedIds = new Set(Object.keys(data.submissions));
  const unsubmitted = students
    .filter(s => !submittedIds.has(s.idCard))
    .map(s => ({ name: s.name, class: s.class, idCard: s.idCard }))
    .sort((a, b) => a.class.localeCompare(b.class) || a.name.localeCompare(b.name));

  return {
    success: true,
    counts,
    limits: LIMITS,
    submissions,
    unsubmitted,
    totalStudents: students.length,
    submittedCount: submissions.length
  };
}

// GET /api/settings?password=xxx
// 获取时间设置
function handleGetSettings(query) {
  if (query.password !== ADMIN_PASSWORD) {
    return { success: false, message: '密码错误' };
  }
  const settings = loadSettings();
  const timeCheck = checkTime();
  return { success: true, settings, timeCheck };
}

// POST /api/settings
// 更新时间设置
function handleUpdateSettings(body) {
  if (body.password !== ADMIN_PASSWORD) {
    return { success: false, message: '密码错误' };
  }

  const { openTime, closeTime, isActive } = body;
  const settings = loadSettings();

  if (openTime !== undefined) settings.openTime = String(openTime);
  if (closeTime !== undefined) settings.closeTime = String(closeTime);
  if (isActive !== undefined) settings.isActive = Boolean(isActive);

  saveSettings(settings);

  const timeCheck = checkTime();
  return { success: true, message: '设置已保存', settings, timeCheck };
}

// GET /api/timecheck
// 无需密码，返回当前时间状态
function handleTimeCheck() {
  return { success: true, ...checkTime() };
}

// ==================== 主服务器 ====================

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const query = Object.fromEntries(url.searchParams);

  // API 路由
  if (pathname.startsWith('/api/')) {
    try {
      if (pathname === '/api/login' && req.method === 'POST') {
        const body = await parseBody(req);
        const result = handleLogin(body);
        sendJSON(res, 200, result);
      } else if (pathname === '/api/status' && req.method === 'GET') {
        const result = handleStatus();
        sendJSON(res, 200, result);
      } else if (pathname === '/api/submit' && req.method === 'POST') {
        const body = await parseBody(req);
        const result = handleSubmit(body);
        sendJSON(res, 200, result);
      } else if (pathname === '/api/admin' && req.method === 'GET') {
        const result = handleAdmin(query);
        sendJSON(res, 200, result);
      } else if (pathname === '/api/settings' && req.method === 'GET') {
        const result = handleGetSettings(query);
        sendJSON(res, 200, result);
      } else if (pathname === '/api/settings' && req.method === 'POST') {
        const body = await parseBody(req);
        const result = handleUpdateSettings(body);
        sendJSON(res, 200, result);
      } else if (pathname === '/api/timecheck' && req.method === 'GET') {
        const result = handleTimeCheck();
        sendJSON(res, 200, result);
      } else {
        sendJSON(res, 404, { success: false, message: '接口不存在' });
      }
    } catch (err) {
      console.error(`[ERROR] ${pathname}:`, err.message);
      sendJSON(res, 500, { success: false, message: '服务器内部错误' });
    }
    return;
  }

  // 静态文件
  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log('========================================');
  console.log('  高一选科填报系统已启动');
  console.log(`  访问地址: http://localhost:${PORT}`);
  console.log(`  管理后台: http://localhost:${PORT}/admin.html`);
  console.log(`  管理密码: ${ADMIN_PASSWORD}`);
  console.log(`  学生总数: ${students.length}人`);
  console.log('========================================');
  console.log('按 Ctrl+C 停止服务');
});
