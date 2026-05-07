const express = require('express');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// --- 环境变量恢复 ---
const PORT = process.env.PORT || 8080;
const DEFAULT_SAVE_PATH = process.env.DEFAULT_SAVE_PATH || './download';
const API_KEY = process.env.API_KEY;
const HTTPS_PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;
const LOG_FILE = 'node.log';
const MAX_LOG_LINES = 1000;

// 确保根目录下的 tmp 存在
const BASE_TMP_PATH = path.resolve(__dirname, 'tmp');
if (!fs.existsSync(BASE_TMP_PATH)) fs.mkdirSync(BASE_TMP_PATH, { recursive: true });

// --- 日志系统 ---
const formatTimestamp = () => {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
};

const writeLog = (message) => {
    const timestamp = formatTimestamp();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    try {
        let logs = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf-8').split('\n').filter(l => l.trim()) : [];
        logs.push(logMessage);
        if (logs.length > MAX_LOG_LINES) logs = logs.slice(-MAX_LOG_LINES);
        fs.writeFileSync(LOG_FILE, logs.join('\n') + '\n', 'utf-8');
    } catch (e) { console.error('日志写入失败:', e.message); }
};

// --- 下载核心逻辑 ---
async function downloadWithPup(targetUrl, userCookie, saveDir, res) {
    const taskId = crypto.randomBytes(8).toString('hex');
    // 1. 在根目录 tmp 下创建独立任务文件夹
    const taskTmpPath = path.join(BASE_TMP_PATH, `task_${taskId}`);
    if (!fs.existsSync(taskTmpPath)) fs.mkdirSync(taskTmpPath, { recursive: true });

    // 2. 配置代理
    const browserArgs = [
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
    ];
    if (HTTPS_PROXY) {
        browserArgs.push(`--proxy-server=${HTTPS_PROXY}`);
        writeLog(`[${taskId}] 启用代理: ${HTTPS_PROXY}`);
    }

    const browser = await puppeteer.launch({
        headless: "new",
        // 优先使用环境变量指定的路径，如果没有则由 puppeteer 自己决定
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: browserArgs
    });


    try {
        const page = await browser.newPage();
        const client = await page.target().createCDPSession();
        
        // 设置下载到该任务的专属临时目录
        await client.send('Page.setDownloadBehavior', {
            behavior: 'allow',
            downloadPath: taskTmpPath,
        });

        const domain = new URL(targetUrl).hostname;
        const cookies = userCookie.split(';').map(p => {
            const [name, value] = p.trim().split('=');
            return { name, value, domain };
        });
        await page.setCookie(...cookies);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        writeLog(`[${taskId}] 开始访问并等待验证...`);
        page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});

        let finalFileName = null;
        for (let i = 0; i < 90; i++) {
            const files = fs.readdirSync(taskTmpPath);
            // 排除临时文件
            const readyFile = files.find(f => !f.endsWith('.crdownload') && !f.endsWith('.tmp') && !f.startsWith('.'));
            const isDownloading = files.some(f => f.endsWith('.crdownload'));

            if (readyFile) {
                finalFileName = readyFile;
                break;
            }

            if (i % 5 === 0) {
                const currentCookies = await page.cookies();
                if (currentCookies.some(c => c.name === 'c_token') && !isDownloading) {
                    writeLog(`[${taskId}] Token 已就绪，尝试触发下载...`);
                    page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
                }
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        if (finalFileName) {
            const oldPath = path.join(taskTmpPath, finalFileName);
            const newPath = path.join(saveDir, finalFileName);
            
            // 移动文件到最终目录
            fs.renameSync(oldPath, newPath);
            writeLog(`[${taskId}] 下载成功并归档: ${finalFileName}`);
            
            res.write(JSON.stringify({ type: 'complete', message: '文件下载成功。', filePath: newPath, fileName: finalFileName }) + '\n');
            res.end();
        } else {
            throw new Error("下载超时或验证失败");
        }

    } finally {
        // 清理本次任务的临时目录
        if (fs.existsSync(taskTmpPath)) {
            fs.rmSync(taskTmpPath, { recursive: true, force: true });
        }
        await browser.close();
    }
}

// --- 接口定义 ---
app.post('/download', async (req, res) => {
    const { url, cookie, save_path, api_key } = req.body;
    const clientIp = req.ip || req.connection.remoteAddress;

    writeLog(`收到下载请求 - IP: ${clientIp}, URL: ${url}`);

    if (!url || !cookie) return res.status(400).json({ message: '缺少必要参数：url 和 cookie。' });
    if (API_KEY && api_key !== API_KEY) return res.status(403).json({ message: '无效的 API Key。' });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const saveDir = save_path ? path.resolve(DEFAULT_SAVE_PATH, save_path) : path.resolve(DEFAULT_SAVE_PATH);
    if (!fs.existsSync(saveDir)) fs.mkdirSync(saveDir, { recursive: true });

    try {
        await downloadWithPup(url, cookie, saveDir, res);
    } catch (error) {
        writeLog(`下载失败 - 错误: ${error.message} - IP: ${clientIp}`);
        const errorData = JSON.stringify({ type: 'error', message: '文件下载失败。', error: error.message }) + '\n';
        if (!res.headersSent) {
            res.status(500).send(errorData);
        } else {
            res.write(errorData);
            res.end();
        }
    }
});

app.listen(PORT, () => {
    writeLog(`=========================================`);
    writeLog(`服务启动，监听端口 ${PORT}`);
    writeLog(`代理状态: ${HTTPS_PROXY || '未启用'}`);
    writeLog(`=========================================`);
});
