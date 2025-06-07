// background.js - 港股招股书信息提取器后台脚本
console.log('[HKEX-Background] Service Worker 启动');

// 监听扩展安装
chrome.runtime.onInstalled.addListener((details) => {
    console.log('[HKEX-Background] 扩展已安装，详情:', details);
    if (details.reason === 'install') {
        // 首次安装时打开欢迎页
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome page.html')
        });
    }
});

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[HKEX-Background] 收到消息:', request);
    
    if (request.action === 'checkPageStatus') {
        handleCheckPageStatus(request, sender, sendResponse);
        return true; // 保持消息通道开放
    }
    
    if (request.action === 'injectContentScript') {
        handleInjectContentScript(request, sender, sendResponse);
        return true;
    }
    
    if (request.action === 'downloadPDF') {
        handleDownloadPDF(request, sender, sendResponse);
        return true;
    }
});

// 检查页面状态
async function handleCheckPageStatus(request, sender, sendResponse) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            sendResponse({ success: false, error: '无法获取当前标签页' });
            return;
        }
        
        const isHKEXPage = tab.url && (
            tab.url.includes('hkexnews.hk') || 
            tab.url.includes('www1.hkexnews.hk')
        );
        
        sendResponse({
            success: true,
            data: {
                url: tab.url,
                isHKEXPage: isHKEXPage,
                isPDFPage: tab.url && tab.url.includes('.pdf')
            }
        });
        
    } catch (error) {
        console.error('[HKEX-Background] 检查页面状态失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 手动注入内容脚本
async function handleInjectContentScript(request, sender, sendResponse) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            sendResponse({ success: false, error: '无法获取当前标签页' });
            return;
        }
        
        // 注入内容脚本
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: [
                'lib/pdf.min.js',
                'utils/logger.js', 
                'utils/parser.js',
                'utils/extractor.js',
                'content-scripts/content.js'
            ]
        });
        
        console.log('[HKEX-Background] 内容脚本注入成功');
        sendResponse({ success: true });
        
    } catch (error) {
        console.error('[HKEX-Background] 注入内容脚本失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 处理PDF下载请求
function handleDownloadPDF(request, sender, sendResponse) {
    try {
        const { url, filename } = request;
        
        if (!url || !url.includes('.pdf')) {
            throw new Error('无效的PDF URL');
        }
        
        // 使用Chrome下载API下载文件
        chrome.downloads.download({
            url: url,
            filename: filename || 'hkex_prospectus.pdf',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                console.error('[HKEX-Background] 下载失败:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
                console.log('[HKEX-Background] 下载已开始, ID:', downloadId);
                sendResponse({ success: true, downloadId });
            }
        });
        
    } catch (error) {
        console.error('[HKEX-Background] 处理下载请求失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}
