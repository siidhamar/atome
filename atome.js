const fs = require('fs');
const path = require('path');
const axios = require('axios');
const chalk = require('chalk');
const readlineSync = require('readline-sync');
const Table = require('cli-table3');

// Pastikan Ctrl+C (SIGINT) langsung menghentikan proses seketika
process.on('SIGINT', () => {
    process.stdout.write('\n' + chalk.yellow.bold('[!] Program dihentikan pengguna (Ctrl+C).\n'));
    process.exit(0);
});

process.on('SIGTERM', () => {
    process.exit(0);
});

// ==========================================
// CONFIGURATION
// ==========================================
const BASE_URL = 'https://www.atome.id';
const TURNSTILE_SITEKEY = '0x4AAAAAAAQKJWZXdJ8SD_jy';
let REFERRAL_URL = 'https://www.atome.id/s/zEGC6INJ3';

let REFERRAL_CONFIG = {
    referralUrl: REFERRAL_URL,
    type: 'card_share',
    targetId: 'U5B781632564F120443B29E10',
    campaignId: 'RP33025584413433996043547975184',
    channel: 'mgm_sharing_page',
    location: 'CARD_MGM_BASIC',
    shareContentId: 'RPSC33032123727297034869922619531'
};

async function resolveAndParseReferral(inputUrl) {
    let currentUrl = (inputUrl || '').trim();
    if (!currentUrl) {
        currentUrl = 'https://www.atome.id/s/zEGC6INJ3';
    }
    if (!currentUrl.startsWith('http')) {
        currentUrl = 'https://' + currentUrl;
    }

    try {
        const res = await axios.get(currentUrl, {
            maxRedirects: 0,
            validateStatus: (s) => s >= 200 && s < 400,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36'
            }
        });
        if (res.headers && res.headers.location) {
            currentUrl = res.headers.location.startsWith('http')
                ? res.headers.location
                : new URL(res.headers.location, currentUrl).toString();
        }
    } catch (e) {
        if (e.response && e.response.headers && e.response.headers.location) {
            currentUrl = e.response.headers.location.startsWith('http')
                ? e.response.headers.location
                : new URL(e.response.headers.location, currentUrl).toString();
        }
    }

    let parsedUrl;
    try {
        parsedUrl = new URL(currentUrl);
    } catch {
        parsedUrl = new URL('https://www.atome.id/en-id/mgm/card/RPSC33032123727297034869922619531?type=card_share&uid=U5B781632564F120443B29E10&campaignId=RP33025584413433996043547975184&channel=mgm_sharing_page&shareContentId=RPSC33032123727297034869922619531&location=CARD_MGM_BASIC');
    }

    const sp = parsedUrl.searchParams;
    const type = sp.get('type') || 'card_share';
    const uid = sp.get('uid') || 'U5B781632564F120443B29E10';
    const campaignId = sp.get('campaignId') || 'RP33025584413433996043547975184';
    const channel = sp.get('channel') || 'mgm_sharing_page';
    const location = sp.get('location') || 'CARD_MGM_BASIC';

    let shareContentId = sp.get('shareContentId');
    if (!shareContentId) {
        const cardMatch = parsedUrl.pathname.match(/\/card\/([^/?]+)/);
        if (cardMatch) {
            shareContentId = cardMatch[1];
        }
    }

    return {
        referralUrl: currentUrl,
        type,
        targetId: uid,
        campaignId,
        channel,
        location,
        shareContentId: shareContentId || ''
    };
}

// 1. Baca Capsolver Key
let CAPSOLVER_KEY = '';
const capsolverFile = path.join(__dirname, 'capsolver.txt');
if (fs.existsSync(capsolverFile)) {
    CAPSOLVER_KEY = fs.readFileSync(capsolverFile, 'utf-8').trim();
}

// 2. Baca Konfigurasi dari configruparupa_v2.json jika ada
let LITENSI_KEY = '';
let LITENSI_SERVICE = 'ot';
let LITENSI_COUNTRY = '6'; // 6 = Indonesia
let LITENSI_OPERATOR = 'any';
let LITENSI_MAX_PRICE = '';

let DEHUYZ_SESSION = '';
let DEHUYZ_CSRF = '';
let DEHUYZ_SERVICE_ID = 51; // 51 = Atome di dehuyzotp.shop

// Cek litensi.txt
const litensiFile = path.join(__dirname, 'litensi.txt');
if (fs.existsSync(litensiFile)) {
    LITENSI_KEY = fs.readFileSync(litensiFile, 'utf-8').trim();
}

const configRupaPath = path.join(__dirname, 'configruparupa_v2.json');
if (fs.existsSync(configRupaPath)) {
    try {
        const rawCfg = JSON.parse(fs.readFileSync(configRupaPath, 'utf8'));
        const cfg = Array.isArray(rawCfg) ? rawCfg[0] : rawCfg;
        if (cfg.litensi_api_key) LITENSI_KEY = cfg.litensi_api_key;
        if (cfg.litensi_service) LITENSI_SERVICE = cfg.litensi_service;
        if (cfg.litensi_country) LITENSI_COUNTRY = String(cfg.litensi_country);
        if (cfg.litensi_operator) LITENSI_OPERATOR = cfg.litensi_operator;
        if (cfg.litensi_max_price !== undefined) LITENSI_MAX_PRICE = String(cfg.litensi_max_price);

        if (cfg.dehuyzotp_session) DEHUYZ_SESSION = cfg.dehuyzotp_session;
        if (cfg.dehuyzotp_csrf) DEHUYZ_CSRF = cfg.dehuyzotp_csrf;
        if (cfg.dehuyzotp_service_id) DEHUYZ_SERVICE_ID = cfg.dehuyzotp_service_id;
    } catch (e) {}
}

const LITENSI_BASE = 'https://litensi.id/api/sms/handler_api.php';
const DEHUYZ_BASE = 'https://dehuyzotp.shop';

// ==========================================
// DASHBOARD & TABLE STATE MANAGER
// ==========================================
let isDashboardActive = false;

const dashboardState = {
    totalAccounts: 0,
    maxThreads: 0,
    provider: 'litensi',
    balance: '-',
    service: 'ot',
    completedCount: 0,
    successCount: 0,
    failCount: 0,
    workers: {},     // { [workerId]: { workerId, accountIndex, phone, step, status, startTime } }
    successList: [], // [ { phone, status, time } ]
    recentLogs: []   // max 4 baris log penting
};

function renderDashboard() {
    if (!isDashboardActive) return;

    let output = '';

    // Header
    output += chalk.cyan.bold('\n========================================================================\n');
    output += chalk.cyan.bold('             ATOME AUTO REGISTRATION BOT - LIVE DASHBOARD               \n');
    output += chalk.cyan.bold('========================================================================\n');
    output += ` ${chalk.gray('Provider:')} ${chalk.white.bold(dashboardState.provider.toUpperCase())}  |  ` +
              `${chalk.gray('Service:')} ${chalk.white(dashboardState.service)}  |  ` +
              `${chalk.gray('Target UID:')} ${chalk.cyan(REFERRAL_CONFIG.targetId)}  |  ` +
              `${chalk.gray('Saldo Litensi:')} ${chalk.yellow('Rp ' + dashboardState.balance)}  |  ` +
              `${chalk.gray('Threads:')} ${chalk.white(dashboardState.maxThreads)}\n`;

    // Summary Counter
    const sDone = chalk.cyan(`Selesai: ${dashboardState.completedCount}/${dashboardState.totalAccounts}`);
    const sOk = chalk.green.bold(`✅ Sukses: ${dashboardState.successCount}`);
    const sFail = chalk.red.bold(`❌ Gagal: ${dashboardState.failCount}`);
    output += ` ${sDone}  |  ${sOk}  |  ${sFail}\n\n`;

    // Table 1: Status Live Worker
    output += chalk.white.bold('▶ STATUS THREAD AKTIF:\n');
    const workerTable = new Table({
        head: [chalk.cyan('Thread'), chalk.cyan('Akun'), chalk.cyan('Nomor HP'), chalk.cyan('Tahap Saat Ini'), chalk.cyan('Durasi')],
        colWidths: [10, 10, 18, 30, 10],
        style: { head: [], border: ['grey'] }
    });

    for (let w = 1; w <= dashboardState.maxThreads; w++) {
        const item = dashboardState.workers[w];
        if (!item) {
            workerTable.push([`T${w}`, '-', '-', chalk.gray('Menunggu...'), '-']);
        } else {
            const elapsed = Math.floor((Date.now() - item.startTime) / 1000) + 's';
            let stepText = item.step;
            if (item.status === 'success') stepText = chalk.green.bold(item.step);
            else if (item.status === 'error') stepText = chalk.red(item.step);
            else stepText = chalk.yellow(item.step);

            workerTable.push([`T${w}`, String(item.accountIndex), item.phone || '-', stepText, elapsed]);
        }
    }
    output += workerTable.toString() + '\n\n';

    // Table 2: Nomor HP yang Sukses
    output += chalk.white.bold(`▶ DAFTAR NOMOR SUKSES REGISTRASI (${dashboardState.successList.length}):\n`);
    if (dashboardState.successList.length === 0) {
        output += chalk.gray(' (Belum ada nomor yang berhasil terdaftar)\n\n');
    } else {
        const successTable = new Table({
            head: [chalk.green('No'), chalk.green('Nomor HP'), chalk.green('Status Akun'), chalk.green('Waktu')],
            colWidths: [6, 20, 18, 14],
            style: { head: [], border: ['grey'] }
        });
        dashboardState.successList.slice(-10).forEach((s, idx) => {
            successTable.push([idx + 1, chalk.green.bold(s.phone), s.status, s.time]);
        });
        output += successTable.toString() + '\n';
        if (dashboardState.successList.length > 10) {
            output += chalk.gray(` ...dan ${dashboardState.successList.length - 10} nomor lainnya (tersimpan di berhasil_atome.txt)\n`);
        }
        output += '\n';
    }

    // Log Singkat Terakhir
    if (dashboardState.recentLogs.length > 0) {
        output += chalk.white.bold('▶ LOG AKTIVITAS TERAKHIR:\n');
        output += dashboardState.recentLogs.map(l => chalk.gray(' • ') + chalk.white(l)).join('\n') + '\n';
    }

    // Render ke terminal
    console.clear();
    process.stdout.write(output);
}

function updateWorkerState(workerId, { accountIndex, phone, step, status }) {
    if (!dashboardState.workers[workerId]) {
        dashboardState.workers[workerId] = {
            workerId,
            accountIndex: accountIndex || '-',
            phone: phone || '-',
            step: step || 'Inisialisasi',
            status: status || 'running',
            startTime: Date.now()
        };
    }
    const w = dashboardState.workers[workerId];
    if (accountIndex !== undefined) w.accountIndex = accountIndex;
    if (phone !== undefined) w.phone = phone;
    if (step !== undefined) {
        w.step = step;
        w.startTime = Date.now();
    }
    if (status !== undefined) w.status = status;
    renderDashboard();
}

function addSuccessAccount(phone, status) {
    dashboardState.successList.push({
        phone,
        status,
        time: new Date().toLocaleTimeString('id-ID', { hour12: false })
    });
    dashboardState.successCount++;
    dashboardState.completedCount++;
    renderDashboard();
}

function addFailAccount() {
    dashboardState.failCount++;
    dashboardState.completedCount++;
    renderDashboard();
}

function addRecentLog(text) {
    const time = new Date().toLocaleTimeString('id-ID', { hour12: false });
    dashboardState.recentLogs.push(`[${time}] ${text}`);
    if (dashboardState.recentLogs.length > 4) {
        dashboardState.recentLogs.shift();
    }
    renderDashboard();
}

// Fallback logger jika dashboard belum aktif
function now() {
    return new Date().toLocaleTimeString('id-ID', { hour12: false });
}

function logger(step, text, type = 'info', workerId = null) {
    if (isDashboardActive) {
        addRecentLog(`[${step}] ${text}`);
        return;
    }

    const timeStr = chalk.gray(`[${now()}]`);
    const prefix = workerId ? `[T${workerId}|${step}]` : `[${step}]`;
    const stepStr = chalk.cyan(prefix.padEnd(16, ' '));

    let icon = '• ';
    let msgColor = chalk.white;

    switch (type) {
        case 'start': icon = '🚀'; msgColor = chalk.white.bold; break;
        case 'key': icon = '🔑'; msgColor = chalk.yellow; break;
        case 'captcha': icon = '🤖'; msgColor = chalk.yellow; break;
        case 'sms': icon = '📩'; msgColor = chalk.magenta; break;
        case 'otp': icon = '📲'; msgColor = chalk.cyan; break;
        case 'success': icon = '✅'; msgColor = chalk.green.bold; break;
        case 'celebrate': icon = '🎉'; msgColor = chalk.green.bold; break;
        case 'warn': icon = '⚠️ '; msgColor = chalk.yellow; break;
        case 'error': icon = '❌'; msgColor = chalk.red.bold; break;
    }

    console.log(`${timeStr} ${icon} ${stepStr} ${msgColor(text)}`);
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function normalizePhone(raw) {
    let p = String(raw).replace(/\D/g, '');
    if (p.startsWith('62')) p = p.slice(2);
    if (p.startsWith('0')) p = p.slice(1);
    return p;
}

function extractOtpCode(text) {
    if (!text) return null;
    const t = String(text);

    const standalone = t.match(/(?:^|[\s>])(\d{4,6})(?:[\s<]|$)/);
    if (standalone) return standalone[1];

    const keyword = t.match(/(?:kode|code|otp|verif(?:ikasi|ication)?|konfirmasi|activation)\s*[:#]?\s*(\d{4,6})/i);
    if (keyword) return keyword[1];

    const all = [...t.matchAll(/\b(\d{4,6})\b/g)].map(m => m[1]).filter(c => !/^(.?)\1{3,5}$/.test(c));
    if (all.length) return all[0];

    return null;
}

// ==========================================
// LITENSI SMS ACTIVATION CLIENT
// ==========================================
async function litensiRequest(action, params = {}) {
    const res = await axios.get(LITENSI_BASE, {
        params: {
            action,
            ...params
        },
        timeout: 20000
    });
    return { text: String(res.data), status: res.status };
}

async function litensiGetBalance(apiKey) {
    const r = await litensiRequest('getBalance', { api_key: apiKey });
    return r.text.trim();
}

async function litensiGetNumber(apiKey, service = LITENSI_SERVICE, country = LITENSI_COUNTRY, operator = LITENSI_OPERATOR, maxPrice = LITENSI_MAX_PRICE, retries = 3, workerId = null) {
    for (let i = 0; i < retries; i++) {
        let params = { api_key: apiKey, service, country, operator };
        if (maxPrice) params.maxPrice = maxPrice;

        let r = await litensiRequest('getNumber', params);
        let text = r.text.trim();
        if (text.startsWith('ACCESS_NUMBER:')) {
            const parts = text.split(':');
            return { ok: true, activationId: parts[1], phone: parts[2], raw: text };
        }
        // Jika NO_NUMBERS dan maxPrice ada, coba tanpa filter maxPrice
        if (text === 'NO_NUMBERS' && maxPrice) {
            delete params.maxPrice;
            r = await litensiRequest('getNumber', params);
            text = r.text.trim();
            if (text.startsWith('ACCESS_NUMBER:')) {
                const parts = text.split(':');
                return { ok: true, activationId: parts[1], phone: parts[2], raw: text };
            }
        }
        if (i < retries - 1) {
            const wait = 3000 + i * 2000;
            if (isDashboardActive) {
                updateWorkerState(workerId, { step: `Retry No (${i + 1}/${retries})...` });
            }
            await delay(wait);
        } else {
            return { ok: false, error: text, raw: text };
        }
    }
    return { ok: false, error: 'NO_NUMBERS', raw: 'NO_NUMBERS' };
}

async function litensiGetStatus(apiKey, activationId) {
    const r = await litensiRequest('getStatus', { api_key: apiKey, id: activationId });
    const text = r.text.trim();
    if (text.startsWith('STATUS_OK:')) {
        return { ok: true, code: text.split(':')[1], raw: text };
    }
    return { ok: false, status: text, raw: text };
}

async function litensiSetStatus(apiKey, activationId, status) {
    const r = await litensiRequest('setStatus', { api_key: apiKey, id: activationId, status });
    return r.text.trim();
}

async function litensiWaitForSms(apiKey, activationId, { attempts = 36, intervalMs = 5000, workerId = null } = {}) {
    for (let i = 0; i < attempts; i++) {
        if (isDashboardActive && workerId) {
            updateWorkerState(workerId, { step: `Menunggu OTP (${i * 5}s)` });
        }
        const check = await litensiGetStatus(apiKey, activationId);
        if (check.ok && check.code) {
            const code = extractOtpCode(check.code);
            return code ? { code, raw: check.raw } : { code: check.code, raw: check.raw };
        }
        if (check.status === 'STATUS_CANCEL' || check.status === 'NO_ACTIVATION') return null;
        await delay(intervalMs);
    }
    return null;
}

// ==========================================
// DEHUYZOTP.SHOP API CLIENT (FALLBACK)
// ==========================================
function dehuyzotpHeaders(session, csrf) {
    return {
        'Host': 'dehuyzotp.shop',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'X-Csrf-Token': csrf,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        'Sec-Ch-Ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
        'Content-Type': 'application/json',
        'Sec-Ch-Ua-Mobile': '?0',
        'Accept': '*/*',
        'Origin': 'https://dehuyzotp.shop',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': 'https://dehuyzotp.shop/dashboard',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',
        'Priority': 'u=1, i',
        'Cookie': `wh_session=${session}; wh_csrf=${csrf}`
    };
}

async function dehuyzotpOrder(session, csrf, serviceId = DEHUYZ_SERVICE_ID) {
    const url = `${DEHUYZ_BASE}/dashboard/orders`;
    const res = await axios.post(url, { ServiceID: Number(serviceId) }, {
        headers: dehuyzotpHeaders(session, csrf),
        timeout: 20000
    });
    return { ok: res.data && res.data.ok === true, token: res.data ? res.data.token : null, raw: res.data };
}

async function dehuyzotpList(session, csrf) {
    const url = `${DEHUYZ_BASE}/dashboard/orders`;
    const res = await axios.get(url, {
        headers: dehuyzotpHeaders(session, csrf),
        timeout: 20000
    });
    const data = res.data;
    return { ok: Array.isArray(data), orders: Array.isArray(data) ? data : [], raw: data };
}

async function dehuyzotpCancel(session, csrf, token) {
    const url = `${DEHUYZ_BASE}/dashboard/orders/${token}`;
    const res = await axios.delete(url, {
        headers: dehuyzotpHeaders(session, csrf),
        timeout: 20000
    });
    return { ok: res.data && res.data.ok === true, raw: res.data };
}

async function dehuyzotpWaitForSms(session, csrf, token, { attempts = 36, intervalMs = 5000, workerId = null } = {}) {
    for (let i = 0; i < attempts; i++) {
        if (isDashboardActive && workerId) {
            updateWorkerState(workerId, { step: `Menunggu OTP (${i * 5}s)` });
        }
        const list = await dehuyzotpList(session, csrf);
        if (!list.ok) {
            await delay(intervalMs);
            continue;
        }
        const order = list.orders.find(o => o.Token === token);
        if (!order) {
            await delay(intervalMs);
            continue;
        }
        if (order.State === 'success' && order.OTPValue) {
            const code = extractOtpCode(String(order.OTPValue));
            return code ? { code, raw: order.OTPValue } : { code: String(order.OTPValue).trim(), raw: order.OTPValue };
        }
        if (order.State === 'cancelled' || order.State === 'expired') {
            return null;
        }
        await delay(intervalMs);
    }
    return null;
}

// ==========================================
// CAPSOLVER TURNSTILE SOLVER
// ==========================================
async function solveTurnstile(siteKey, websiteUrl, apiKey = CAPSOLVER_KEY, workerId = null) {
    if (!apiKey) {
        throw new Error('API Key Capsolver tidak ditemukan! Pastikan file capsolver.txt terisi.');
    }

    if (isDashboardActive && workerId) {
        updateWorkerState(workerId, { step: 'Solve Turnstile...' });
    }

    const createTaskRes = await axios.post('https://api.capsolver.com/createTask', {
        clientKey: apiKey,
        task: {
            type: 'AntiTurnstileTaskProxyLess',
            websiteURL: websiteUrl,
            websiteKey: siteKey
        }
    });

    if (createTaskRes.data.errorId && createTaskRes.data.errorId !== 0) {
        throw new Error(`Capsolver createTask gagal: ${createTaskRes.data.errorDescription || JSON.stringify(createTaskRes.data)}`);
    }

    const taskId = createTaskRes.data.taskId;
    const startTime = Date.now();
    while (Date.now() - startTime < 120000) {
        await delay(2000);

        const resultRes = await axios.post('https://api.capsolver.com/getTaskResult', {
            clientKey: apiKey,
            taskId: taskId
        });

        if (resultRes.data.errorId && resultRes.data.errorId !== 0) {
            throw new Error(`Capsolver getTaskResult error: ${resultRes.data.errorDescription || JSON.stringify(resultRes.data)}`);
        }

        if (resultRes.data.status === 'ready') {
            const token = resultRes.data.solution?.token;
            return token;
        }
    }

    throw new Error('Timeout: Capsolver gagal menyelesaikan captcha dalam 120 detik.');
}

// ==========================================
// ATOME API CLIENT
// ==========================================
function getAtomeHeaders(clientConfig, cookieMap) {
    const cookieHeader = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
    return {
        'Host': 'www.atome.id',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'X-User-Agent': `ApaylaterWeb (PC; ; ; ) uuid/${clientConfig.uuid} adid/${clientConfig.adid} version/5.2.1`,
        'Accept-Language': 'en-id',
        'Sec-Ch-Ua': '"Not A(Brand";v="99", "Chromium";v="154"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Device-Id': clientConfig.uuid,
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'Request-Starttime': Date.now().toString(),
        'Origin': 'https://www.atome.id',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Referer': REFERRAL_CONFIG.referralUrl || REFERRAL_URL,
        'Accept-Encoding': 'gzip, deflate, br',
        'Priority': 'u=1, i',
        'Cookie': cookieHeader
    };
}

function updateCookiesFromResponse(headers, cookieMap) {
    const setCookies = headers['set-cookie'] || [];
    setCookies.forEach(sc => {
        const parts = sc.split(';')[0].split('=');
        if (parts.length >= 2) {
            cookieMap[parts[0].trim()] = parts.slice(1).join('=').trim();
        }
    });
}

async function referralBinding(mobileNumber, clientConfig, cookieMap) {
    const cleanNumber = normalizePhone(mobileNumber);
    const payload = {
        type: REFERRAL_CONFIG.type || 'card_share',
        targetId: REFERRAL_CONFIG.targetId,
        mobileNumber: cleanNumber,
        campaignId: REFERRAL_CONFIG.campaignId,
        channel: REFERRAL_CONFIG.channel || 'mgm_sharing_page',
        autoRegistration: true,
        dvToken: 'JT_1bmc0QOUagUkBvd6MuFbi37zIMizeHf_QSEsraaTGqb',
        location: REFERRAL_CONFIG.location || 'CARD_MGM_BASIC',
        powToken: 'ed4a1aba0e9d9e3ed258c6545097368937f7fa0c196c0200ccfdba0907900193b2939cffc59d7aae75a51c2f3c95ddc2410eb1374aa0a0f83c0acb13153d5c854648931c82cb02b84095ea1307ee641469628a663df8ec25fdddd3e1b5485788078c8345463a96b7bd8de6f9248346d8f4e4288d58696d4c706c90509b3f693eb9befacd08d0318f5a04e14aa41a07598'
    };

    try {
        const response = await axios.post(`${BASE_URL}/api/public/referrals/binding`, payload, {
            headers: getAtomeHeaders(clientConfig, cookieMap),
            timeout: 30000
        });

        updateCookiesFromResponse(response.headers, cookieMap);
        return response.data;
    } catch (error) {
        if (error.response) {
            updateCookiesFromResponse(error.response.headers, cookieMap);
            if (error.response.data) return error.response.data;
        }
        throw error;
    }
}

async function requestOtpw(token, otpType = 'SMS', captchaToken = '', clientConfig, cookieMap) {
    const payload = {
        token: token,
        type: otpType,
        captchaToken: captchaToken
    };

    if (captchaToken) {
        payload.captchaType = 'CF';
    }

    try {
        const response = await axios.post(`${BASE_URL}/api/security-verification/otpw`, payload, {
            headers: getAtomeHeaders(clientConfig, cookieMap),
            timeout: 30000
        });

        updateCookiesFromResponse(response.headers, cookieMap);
        return response.data;
    } catch (error) {
        if (error.response) {
            updateCookiesFromResponse(error.response.headers, cookieMap);
            if (error.response.data) return error.response.data;
        }
        throw error;
    }
}

async function verifyOtp(token, otpCode, clientConfig, cookieMap) {
    const payload = {
        token: token,
        otp: String(otpCode).trim()
    };

    try {
        const response = await axios.post(`${BASE_URL}/api/security-verification/otp/verification`, payload, {
            headers: getAtomeHeaders(clientConfig, cookieMap),
            timeout: 30000
        });

        updateCookiesFromResponse(response.headers, cookieMap);
        return response.data;
    } catch (error) {
        if (error.response) {
            updateCookiesFromResponse(error.response.headers, cookieMap);
            if (error.response.data) return error.response.data;
        }
        throw error;
    }
}

// ==========================================
// REGISTRATION PIPELINE PER AKUN
// ==========================================
async function registerSingleAccount({ providerMode = 'litensi', manualPhone = '', otpChannel = 'SMS', workerId = 1, accountIndex = 1, totalAccounts = 1 }) {
    const clientConfig = {
        uuid: generateUUID(),
        adid: generateUUID()
    };

    const cookieMap = {
        '_atome_webAdvertisingId': clientConfig.adid,
        '_atome_webDeviceId': clientConfig.uuid
    };

    const isAuto = providerMode === 'litensi' || providerMode === 'dehuyzotp';
    const maxPhoneAttempts = isAuto ? 5 : 1;
    let phoneAttempt = 0;

    while (phoneAttempt < maxPhoneAttempts) {
        phoneAttempt++;
        let phoneNumber = manualPhone;
        let litensiActivationId = null;
        let dehuyzToken = null;

        // 1. Order Nomor HP Otomatis
        if (providerMode === 'litensi') {
            updateWorkerState(workerId, { accountIndex, phone: '-', step: `Order No (${LITENSI_SERVICE})` });
            const order = await litensiGetNumber(LITENSI_KEY, LITENSI_SERVICE, LITENSI_COUNTRY, LITENSI_OPERATOR, LITENSI_MAX_PRICE, 3, workerId);

            if (!order || !order.ok) {
                updateWorkerState(workerId, { step: `Gagal Order No (${order?.error || 'ERR'})`, status: 'error' });
                await delay(3000);
                continue;
            }

            litensiActivationId = order.activationId;
            phoneNumber = order.phone;
            updateWorkerState(workerId, { phone: phoneNumber, step: 'Kirim Binding' });

        } else if (providerMode === 'dehuyzotp') {
            updateWorkerState(workerId, { accountIndex, phone: '-', step: 'Order No (Dehuyz)' });
            const orderRes = await dehuyzotpOrder(DEHUYZ_SESSION, DEHUYZ_CSRF, DEHUYZ_SERVICE_ID);
            if (!orderRes.ok || !orderRes.token) {
                updateWorkerState(workerId, { step: 'Gagal Order Dehuyz', status: 'error' });
                await delay(3000);
                continue;
            }
            dehuyzToken = orderRes.token;

            // Ambil nomor dari list orders
            let orderItem = null;
            for (let li = 0; li < 10; li++) {
                const list = await dehuyzotpList(DEHUYZ_SESSION, DEHUYZ_CSRF);
                if (list.ok) {
                    const match = list.orders.find(o => o.Token === dehuyzToken);
                    if (match && match.Phone) {
                        orderItem = match;
                        break;
                    }
                }
                await delay(1000);
            }

            if (!orderItem || !orderItem.Phone) {
                updateWorkerState(workerId, { step: 'Gagal Ambil No Dehuyz', status: 'error' });
                await dehuyzotpCancel(DEHUYZ_SESSION, DEHUYZ_CSRF, dehuyzToken).catch(() => {});
                continue;
            }

            phoneNumber = orderItem.Phone;
            updateWorkerState(workerId, { phone: phoneNumber, step: 'Kirim Binding' });
        }

        // 2. Eksekusi Referral Binding
        const cleanNumber = normalizePhone(phoneNumber);
        updateWorkerState(workerId, { phone: cleanNumber, step: 'Request Binding...' });
        const bindRes = await referralBinding(cleanNumber, clientConfig, cookieMap);

        if (bindRes.code !== 'NEED_SECURITY_VERIFICATION') {
            if (bindRes.code === 'SUCCESS' || bindRes.code === 'REGISTRATION_COMPLETE') {
                const statusUser = bindRes.data?.isNewUser ? 'Akun Baru' : 'Akun Terdaftar';
                updateWorkerState(workerId, { step: 'Sukses (Langsung)', status: 'success' });
                if (litensiActivationId) await litensiSetStatus(LITENSI_KEY, litensiActivationId, 6).catch(() => {});

                // Catat log
                const resultFile = path.join(__dirname, 'berhasil_atome.txt');
                fs.appendFileSync(resultFile, `${cleanNumber}|${new Date().toISOString()}|status:${statusUser}|code:${bindRes.code}\n`);
                addSuccessAccount(cleanNumber, statusUser);

                return { success: true, phone: phoneNumber, code: bindRes.code };
            }

            updateWorkerState(workerId, { step: `Binding: ${bindRes.code}`, status: 'error' });
            
            // Cancel nomor agar saldo tidak hangus
            if (litensiActivationId) await litensiSetStatus(LITENSI_KEY, litensiActivationId, 8).catch(() => {});
            if (dehuyzToken) await dehuyzotpCancel(DEHUYZ_SESSION, DEHUYZ_CSRF, dehuyzToken).catch(() => {});
            
            await delay(2000);
            continue;
        }

        const securityToken = bindRes.extra?.token;
        if (!securityToken) {
            updateWorkerState(workerId, { step: 'Token Tidak Ditemukan', status: 'error' });
            if (litensiActivationId) await litensiSetStatus(LITENSI_KEY, litensiActivationId, 8).catch(() => {});
            if (dehuyzToken) await dehuyzotpCancel(DEHUYZ_SESSION, DEHUYZ_CSRF, dehuyzToken).catch(() => {});
            continue;
        }

        // 3. Trigger awal OTPW
        updateWorkerState(workerId, { step: 'Trigger Kirim OTP...' });
        const initOtpRes = await requestOtpw(securityToken, otpChannel, '', clientConfig, cookieMap);

        let nextToken = null;
        if (initOtpRes.code === 'NEED_CAPTCHA') {
            updateWorkerState(workerId, { step: 'Bypass Turnstile...' });

            // Solve Turnstile via Capsolver
            const captchaToken = await solveTurnstile(TURNSTILE_SITEKEY, BASE_URL, CAPSOLVER_KEY, workerId);

            // Kirim OTPW dengan Captcha Token
            updateWorkerState(workerId, { step: 'Kirim OTP (with Token)...' });
            const otpFinalRes = await requestOtpw(securityToken, otpChannel, captchaToken, clientConfig, cookieMap);

            if (otpFinalRes.code === 'SUCCESS') {
                updateWorkerState(workerId, { step: 'OTP Terkirim' });
                nextToken = otpFinalRes.data?.token || securityToken;
            } else {
                updateWorkerState(workerId, { step: 'Gagal Kirim OTP', status: 'error' });
                if (litensiActivationId) await litensiSetStatus(LITENSI_KEY, litensiActivationId, 8).catch(() => {});
                if (dehuyzToken) await dehuyzotpCancel(DEHUYZ_SESSION, DEHUYZ_CSRF, dehuyzToken).catch(() => {});
                continue;
            }
        } else if (initOtpRes.code === 'SUCCESS') {
            updateWorkerState(workerId, { step: 'OTP Terkirim Langsung' });
            nextToken = initOtpRes.data?.token || securityToken;
        } else {
            updateWorkerState(workerId, { step: 'Gagal Req OTP', status: 'error' });
            if (litensiActivationId) await litensiSetStatus(LITENSI_KEY, litensiActivationId, 8).catch(() => {});
            if (dehuyzToken) await dehuyzotpCancel(DEHUYZ_SESSION, DEHUYZ_CSRF, dehuyzToken).catch(() => {});
            continue;
        }

        // 4. Menunggu / Input Kode OTP
        let otpCode = null;

        if (providerMode === 'litensi') {
            updateWorkerState(workerId, { step: 'Menunggu SMS OTP...' });
            const smsRes = await litensiWaitForSms(LITENSI_KEY, litensiActivationId, { attempts: 36, intervalMs: 5000, workerId });
            if (!smsRes || !smsRes.code) {
                updateWorkerState(workerId, { step: 'OTP Timeout (Cancel No)', status: 'error' });
                await litensiSetStatus(LITENSI_KEY, litensiActivationId, 8).catch(() => {});
                continue; // Coba nomor berikutnya
            }
            otpCode = smsRes.code;
            updateWorkerState(workerId, { step: `OTP: ${otpCode}` });

        } else if (providerMode === 'dehuyzotp') {
            updateWorkerState(workerId, { step: 'Menunggu SMS OTP...' });
            const smsRes = await dehuyzotpWaitForSms(DEHUYZ_SESSION, DEHUYZ_CSRF, dehuyzToken, { attempts: 30, intervalMs: 5000, workerId });
            if (!smsRes || !smsRes.code) {
                updateWorkerState(workerId, { step: 'OTP Timeout (Cancel No)', status: 'error' });
                await dehuyzotpCancel(DEHUYZ_SESSION, DEHUYZ_CSRF, dehuyzToken).catch(() => {});
                continue;
            }
            otpCode = smsRes.code;
            updateWorkerState(workerId, { step: `OTP: ${otpCode}` });

        } else {
            // Manual Mode
            console.log('');
            otpCode = readlineSync.question(chalk.yellow(`👉 [T${workerId}] Masukkan Kode OTP yang diterima: `)).trim();
            if (!otpCode) {
                updateWorkerState(workerId, { step: 'OTP Kosong', status: 'error' });
                return { success: false, phone: phoneNumber };
            }
        }

        // 5. Verifikasi Kode OTP
        updateWorkerState(workerId, { step: `Verifikasi OTP [${otpCode}]...` });
        const verifyRes = await verifyOtp(nextToken, otpCode, clientConfig, cookieMap);

        if (verifyRes.code !== 'SUCCESS') {
            updateWorkerState(workerId, { step: 'Verif OTP Gagal', status: 'error' });
            if (litensiActivationId) await litensiSetStatus(LITENSI_KEY, litensiActivationId, 8).catch(() => {});
            if (dehuyzToken) await dehuyzotpCancel(DEHUYZ_SESSION, DEHUYZ_CSRF, dehuyzToken).catch(() => {});
            continue;
        }

        // Selesaikan status di Litensi (status 6 = selesai)
        if (litensiActivationId) {
            await litensiSetStatus(LITENSI_KEY, litensiActivationId, 6).catch(() => {});
        }

        // 6. Finalisasi Registrasi / Binding
        updateWorkerState(workerId, { step: 'Finalisasi Binding...' });
        const finalBindRes = await referralBinding(cleanNumber, clientConfig, cookieMap);

        if (finalBindRes.code === 'SUCCESS' || finalBindRes.code === 'REGISTRATION_COMPLETE') {
            const statusUser = finalBindRes.data?.isNewUser ? 'Akun Baru' : 'Akun Terdaftar';
            updateWorkerState(workerId, { step: `Sukses (${statusUser})`, status: 'success' });

            // Simpan hasil ke file berhasil_atome.txt
            const resultFile = path.join(__dirname, 'berhasil_atome.txt');
            const logData = `${cleanNumber}|${new Date().toISOString()}|status:${statusUser}|code:${finalBindRes.code}\n`;
            fs.appendFileSync(resultFile, logData);

            addSuccessAccount(cleanNumber, statusUser);
            addRecentLog(`[T${workerId}] Registrasi Berhasil: ${cleanNumber} (${statusUser})`);

            return { success: true, phone: cleanNumber, status: statusUser };
        } else {
            updateWorkerState(workerId, { step: `Final: ${finalBindRes.message || 'Gagal'}`, status: 'error' });
        }
    }

    addFailAccount();
    return { success: false, phone: manualPhone };
}

// ==========================================
// MAIN RUNNER
// ==========================================
(async () => {
    console.clear();
    console.log(chalk.cyan.bold('===================================================='));
    console.log(chalk.cyan.bold('     ATOME MULTI-THREAD REGISTRATION BOT (LITENSI)  '));
    console.log(chalk.cyan.bold('====================================================\n'));

    try {
        // 0. Cek / Input Link Referral
        let defaultRef = 'https://www.atome.id/s/zEGC6INJ3';
        if (configRupaPath && fs.existsSync(configRupaPath)) {
            try {
                const rawCfg = JSON.parse(fs.readFileSync(configRupaPath, 'utf8'));
                const cfg = Array.isArray(rawCfg) ? rawCfg[0] : rawCfg;
                if (cfg.referral && cfg.referral.includes('atome')) defaultRef = cfg.referral;
            } catch (e) {}
        }

        const inputRef = readlineSync.question(chalk.yellow(`[?] Masukkan Link Referral Atome [Default: ${defaultRef}]: `)).trim();
        const refUrl = inputRef || defaultRef;

        logger('Referral', `Mengecek dan resolve link referral...`, 'info');
        REFERRAL_CONFIG = await resolveAndParseReferral(refUrl);
        REFERRAL_URL = REFERRAL_CONFIG.referralUrl;
        logger('Referral', `Target UID: ${REFERRAL_CONFIG.targetId} | Campaign: ${REFERRAL_CONFIG.campaignId}`, 'key');

        // 1. Cek API Key Capsolver
        if (!CAPSOLVER_KEY) {
            CAPSOLVER_KEY = readlineSync.question(chalk.yellow('[?] Masukkan Capsolver API Key: ')).trim();
            if (CAPSOLVER_KEY) {
                fs.writeFileSync(capsolverFile, CAPSOLVER_KEY);
            }
        }
        logger('Config', `Capsolver Key: ${CAPSOLVER_KEY ? CAPSOLVER_KEY.substring(0, 10) + '...' : 'TIDAK ADA'}`, 'key');

        // 2. Cek Koneksi Litensi
        let hasLitensi = Boolean(LITENSI_KEY && LITENSI_KEY.length > 5);
        if (!hasLitensi) {
            const inputLitensi = readlineSync.question(chalk.yellow('[?] Masukkan Litensi API Key (kosongkan jika pakai manual/dehuyz): ')).trim();
            if (inputLitensi) {
                LITENSI_KEY = inputLitensi;
                hasLitensi = true;
                fs.writeFileSync(litensiFile, LITENSI_KEY);
            }
        }

        if (hasLitensi) {
            try {
                const bal = await litensiGetBalance(LITENSI_KEY);
                if (bal.startsWith('ACCESS_BALANCE:')) {
                    const balanceNominal = bal.split(':')[1];
                    dashboardState.balance = balanceNominal;
                    logger('Litensi', `Litensi Terkoneksi. Saldo: Rp ${balanceNominal} (Service: ${LITENSI_SERVICE})`, 'key');
                } else {
                    logger('Litensi', `Respon Saldo Litensi: ${bal}`, 'warn');
                }
            } catch (e) {
                logger('Litensi', `Gagal cek saldo: ${e.message}`, 'warn');
            }
        } else {
            logger('Litensi', 'Litensi API Key tidak terdeteksi.', 'warn');
        }

        // Cek DehuyzOTP
        const hasDehuyz = Boolean(DEHUYZ_SESSION && DEHUYZ_CSRF);

        // 3. Pilihan Mode Provider
        const modeOptions = [];
        const modeKeys = [];

        if (hasLitensi) {
            modeOptions.push('Otomatis Litensi (Order No HP & SMS OTP Otomatis)');
            modeKeys.push('litensi');
        }
        if (hasDehuyz) {
            modeOptions.push('Otomatis DehuyzOTP');
            modeKeys.push('dehuyzotp');
        }
        modeOptions.push('Manual (Input No HP & OTP Sendiri)');
        modeKeys.push('manual');

        const modeIndex = readlineSync.keyInSelect(modeOptions, chalk.yellow('[?] Pilih Mode Registrasi:'), { cancel: false });
        const selectedMode = modeKeys[modeIndex];

        let manualPhone = '';
        let otpChannel = 'SMS';
        let repeatCount = 1;

        if (selectedMode !== 'manual') {
            const countInput = readlineSync.question(chalk.yellow('\n[?] Jumlah akun yang ingin didaftarkan [Default: 1]: ')).trim();
            if (countInput && !isNaN(Number(countInput)) && Number(countInput) > 0) {
                repeatCount = Number(countInput);
            }
        } else {
            manualPhone = readlineSync.question(chalk.yellow('\n[?] Masukkan Nomor HP [Contoh: 81280608095]: ')).trim();
            const channels = ['SMS', 'WA', 'VOICE'];
            const chIndex = readlineSync.keyInSelect(channels, chalk.yellow('[?] Pilih Channel OTP:'), { cancel: false });
            otpChannel = channels[chIndex];
        }

        // 4. Hitung Thread Worker (Maksimal 10 Thread secara asynchronous)
        const maxThreads = selectedMode === 'manual' ? 1 : Math.min(repeatCount, 10);
        
        // Setup state dashboard
        dashboardState.totalAccounts = repeatCount;
        dashboardState.maxThreads = maxThreads;
        dashboardState.provider = selectedMode;
        dashboardState.service = LITENSI_SERVICE;
        
        // Aktifkan tampilan dashboard tabel interaktif
        isDashboardActive = selectedMode !== 'manual';
        renderDashboard();

        // Timer refresh live dashboard setiap 1 detik untuk update timer durasi
        let dashboardInterval = null;
        if (isDashboardActive) {
            dashboardInterval = setInterval(renderDashboard, 1000);
        }

        let currentIndex = 0;
        const sharedResults = new Array(repeatCount);

        async function runWorker(workerId) {
            while (currentIndex < repeatCount) {
                const i = currentIndex++;
                updateWorkerState(workerId, { accountIndex: i + 1, phone: '-', step: 'Memulai Akun...' });

                const res = await registerSingleAccount({
                    providerMode: selectedMode,
                    manualPhone: manualPhone,
                    otpChannel: otpChannel,
                    workerId: workerId,
                    accountIndex: i + 1,
                    totalAccounts: repeatCount
                });

                sharedResults[i] = res;

                if (currentIndex < repeatCount) {
                    updateWorkerState(workerId, { step: 'Jeda 1.5s...' });
                    await delay(1500);
                } else {
                    updateWorkerState(workerId, { step: 'Selesai (Idle)', status: 'success' });
                }
            }
        }

        const workers = [];
        for (let w = 1; w <= maxThreads; w++) {
            workers.push(runWorker(w));
        }

        await Promise.all(workers);

        if (dashboardInterval) {
            clearInterval(dashboardInterval);
        }

        // Render hasil akhir dashboard
        renderDashboard();

        // 5. Ringkasan Akhir
        let successCount = 0;
        let failCount = 0;

        for (const r of sharedResults) {
            if (r && r.success) {
                successCount++;
            } else {
                failCount++;
            }
        }

        console.log(chalk.cyan.bold('\n========================================================================'));
        console.log(chalk.cyan.bold('                          SUMMARY AKHIR                                 '));
        console.log(chalk.cyan.bold('========================================================================'));
        console.log(`  ${chalk.green.bold(`✅ Berhasil: ${successCount}`)}  |  ${chalk.red.bold(`❌ Gagal: ${failCount}`)}  |  ${chalk.gray(`Total Target: ${repeatCount}`)}`);
        console.log(chalk.gray('  File log: berhasil_atome.txt\n'));

    } catch (err) {
        if (isDashboardActive) {
            isDashboardActive = false;
        }
        logger('Error', `Terjadi kesalahan fatal: ${err.message}`, 'error');
    }
})();
