// content.js - 港股招股书信息提取
console.log('[HKEX-Content] 内容脚本加载');

// 创建全局实例
window.prospectusExtractor = null;
// 缓存本地准备好的数据，避免自动调用AI
window.hkexPreparedData = null;

// 初始化函数
async function initializeExtractor() {
    try {
        console.log('[HKEX-Content] 开始初始化提取器');
        // 检查是否为PDF页面
        if (!window.location.href.includes('.pdf')) {
            console.warn('[HKEX-Content] 当前页面不是PDF文档');
            return;
        }
        // 检查PDF.js是否已加载
        if (typeof pdfjsLib === 'undefined') {
            console.error('[HKEX-Content] PDF.js库未加载');
            return;
        }
        // 设置PDF.js工作线程
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
        // 创建提取器实例
        window.prospectusExtractor = new window.HKEXProspectusExtractor();
        // 使用配置文件中的API设置
        if (window.prospectusExtractor.parser && window.HKEXConfig) {
            window.prospectusExtractor.parser.configureAI(window.HKEXConfig.ai);
            console.log('[HKEX-Content] AI配置完成');
        } else {
            console.warn('[HKEX-Content] 未找到配置信息');
        }
        // 自动准备本地可获得的所有数据，缓存到 window.hkexPreparedData
        try {
            // 只做本地章节、文本等准备，不调用AI
            const sections = await window.prospectusExtractor.extractAllRequiredSections();
            window.hkexPreparedData = sections;
            console.log('[HKEX-Content] 本地章节数据已准备:', window.hkexPreparedData);
        } catch (e) {
            window.hkexPreparedData = null;
            console.warn('[HKEX-Content] 本地章节数据准备失败:', e);
        }
        console.log('[HKEX-Content] 提取器初始化完成');
    } catch (error) {
        console.error('[HKEX-Content] 初始化提取器失败:', error);
    }
}

// 监听来自popup的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[HKEX-Content] 收到消息:', request);
    // 添加ping响应
    if (request.action === 'ping') {
        sendResponse({ 
            success: true, 
            message: 'Content script ready',
            isPDF: window.location.href.includes('.pdf'),
            isHKEX: window.location.href.includes('hkexnews.hk')
        });
        return true;
    }
    // 新增：获取本地准备好的章节数据，不调用AI
    if (request.action === 'getPreparedData') {
        sendResponse({
            success: !!window.hkexPreparedData,
            data: window.hkexPreparedData
        });
        return true;
    }
    if (request.action === 'extractInfo') {
        handleExtractInfo(sendResponse);
        return true; // 保持消息通道开放
    }
    if (request.action === 'getFormattedText') {
        handleGetFormattedText(sendResponse);
        return true;
    }
    if (request.action === 'getChineseVersion') {
        handleGetChineseVersion(sendResponse);
        return true;
    }
});

// 处理信息提取请求
async function handleExtractInfo(sendResponse) {
    try {
        console.log('[HKEX-Content] 开始提取信息');
        
        // 确保提取器已初始化
        if (!window.prospectusExtractor) {
            await initializeExtractor();
            
            if (!window.prospectusExtractor) {
                throw new Error('提取器初始化失败');
            }
        }
        
        // 提取信息
        const result = await window.prospectusExtractor.extractProspectusInfo();
        
        console.log('[HKEX-Content] 信息提取完成:', result);
        sendResponse({ success: true, data: result });
    } catch (error) {
        console.error('[HKEX-Content] 提取信息失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 处理获取格式化文本请求
function handleGetFormattedText(sendResponse) {
    try {
        if (!window.prospectusExtractor) {
            throw new Error('提取器未初始化');
        }
        
        const formattedText = window.prospectusExtractor.formatOutputText();
        sendResponse({ success: true, data: formattedText });
    } catch (error) {
        console.error('[HKEX-Content] 获取格式化文本失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 处理获取中文版链接请求
async function handleGetChineseVersion(sendResponse) {
    try {
        if (!window.prospectusExtractor) {
            throw new Error('提取器未初始化');
        }
        
        const englishUrl = window.location.href;
        const chineseUrl = window.prospectusExtractor.generateChineseVersion(englishUrl);
        
        // 验证中文版链接
        const isValid = await window.prospectusExtractor.validateChineseVersion(chineseUrl);
        
        sendResponse({ 
            success: true, 
            data: {
                englishUrl,
                chineseUrl,
                isValid
            }
        });
    } catch (error) {
        console.error('[HKEX-Content] 获取中文版链接失败:', error);
        sendResponse({ success: false, error: error.message });
    }
}

// 页面加载完成后的初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtractor);
} else {
    initializeExtractor();
}

console.log('[HKEX-Content] 内容脚本已加载完成');

// 自动注入悬浮窗逻辑
try {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content-scripts/float-window.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
} catch (e) {
    console.error('[HKEX-Content] 注入悬浮窗失败', e);
}
