// float-window.js
// 自动悬浮窗逻辑，访问hkexnews.hk PDF页面时自动弹出结果，无需点击扩展

(function() {
    // 日志工具
    function log(...args) {
        if (window.loguru) {
            window.loguru.info('[悬浮窗]', ...args);
        } else {
            console.log('[悬浮窗]', ...args);
        }
    }

    // 判断当前页面是否为目标PDF
    function isTargetPDF() {
        return window.location.href.includes('hkexnews.hk') && window.location.href.endsWith('.pdf');
    }

    // 创建悬浮窗DOM
    function createFloatWindow() {
        if (document.getElementById('hkex-float-window')) return;
        const floatDiv = document.createElement('div');
        floatDiv.id = 'hkex-float-window';
        floatDiv.style.cssText = `
            position: fixed;
            bottom: 32px;
            right: 32px;
            z-index: 999999;
            background: #fff;
            border: 1px solid #dee2e6;
            box-shadow: 0 4px 16px rgba(0,0,0,0.16);
            border-radius: 8px;
            width: 420px;
            max-height: 80vh;
            overflow-y: auto;
            font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
        `;
        floatDiv.innerHTML = `
            <div style="padding: 16px; border-bottom: 1px solid #eee; background: #f8f9fa; font-weight: bold;">港股招股书信息提取</div>
            <div id="hkex-float-loading" style="padding: 24px; text-align: center; color: #888;">正在自动提取信息...</div>
            <div id="hkex-float-content" style="display:none;"></div>
            <div id="hkex-float-error" style="color: #dc3545; display:none; padding: 12px;"></div>
            <div style="padding: 8px; text-align: right; border-top: 1px solid #eee; background: #f8f9fa;">
                <button id="hkex-float-close" style="background:#0d6efd;color:#fff;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;">关闭</button>
            </div>
        `;
        document.body.appendChild(floatDiv);
        document.getElementById('hkex-float-close').onclick = function() {
            floatDiv.style.display = 'none';
            sessionStorage.setItem('hkex-float-window-hide', '1');
        };
    }

    // 渲染结果
    function renderResult(data) {
        document.getElementById('hkex-float-loading').style.display = 'none';
        document.getElementById('hkex-float-content').style.display = '';
        document.getElementById('hkex-float-error').style.display = 'none';
        document.getElementById('hkex-float-content').innerHTML = data;
    }
    function renderError(msg) {
        document.getElementById('hkex-float-loading').style.display = 'none';
        document.getElementById('hkex-float-content').style.display = 'none';
        document.getElementById('hkex-float-error').style.display = '';
        document.getElementById('hkex-float-error').textContent = msg;
    }

    // 自动提取信息
    async function autoExtract() {
        try {
            log('自动提取信息...');
            // 保证content script已初始化
            if (!window.prospectusExtractor) {
                if (typeof initializeExtractor === 'function') {
                    await initializeExtractor();
                }
            }
            if (!window.prospectusExtractor) {
                throw new Error('提取器未初始化');
            }
            const result = await window.prospectusExtractor.extractProspectusInfo();
            if (!result) throw new Error('未提取到内容');
            // 使用popup同款渲染逻辑
            renderResult(formatResultHTML(result));
        } catch (e) {
            log('自动提取失败', e);
            renderError('自动提取失败：' + (e.message || e));
        }
    }

    // 格式化结果为HTML（复用popup逻辑，简化版）
    function formatResultHTML(data) {
        let html = '<div class="results-container">';
        if (!data || !data.company) {
            html += '<div style="color:#dc3545;">未能提取到任何信息</div>';
            return html + '</div>';
        }
        html += '<div class="section"><h3>公司基本信息</h3>';
        html += `<div><b>英文名称：</b>${data.company.name || '未找到'}</div>`;
        html += `<div><b>中文名称：</b>${data.company.chineseName || '未找到'}</div>`;
        html += `<div><b>公司类型：</b>${data.company.type || '未确定'}</div>`;
        html += `<div><b>行业信息：</b>${data.company.industry || '未找到'}</div>`;
        html += '</div>';
        html += '<div class="section"><h3>专业服务机构</h3>';
        if (data.professionals?.sponsors?.length > 0) {
            html += '<div><b>保荐人：</b>' + data.professionals.sponsors.map(s=>s.name).join('，') + '</div>';
        }
        if (data.professionals?.auditors?.length > 0) {
            html += '<div><b>审计师：</b>' + data.professionals.auditors.map(a=>a.name).join('，') + '</div>';
        }
        if (data.professionals?.industryConsultants?.length > 0) {
            html += '<div><b>行业顾问：</b>' + data.professionals.industryConsultants.map(i=>i.name).join('，') + '</div>';
        }
        html += '</div>';
        if (data.metadata) {
            html += `<div class="section"><b>提取时间：</b>${new Date(data.metadata.extractTime).toLocaleString()}</div>`;
        }
        html += '</div>';
        return html;
    }

    // 主流程
    function main() {
        if (!isTargetPDF()) return;
        if (sessionStorage.getItem('hkex-float-window-hide') === '1') return;
        createFloatWindow();
        autoExtract();
    }

    // 页面 ready 后自动运行
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', main);
    } else {
        main();
    }

    // 保证切换 hash 或 history 也能触发
    window.addEventListener('hashchange', main);
    window.addEventListener('popstate', main);

    // 保证悬浮窗不会被意外移除
    const observer = new MutationObserver(() => {
        if (isTargetPDF() && !document.getElementById('hkex-float-window')) {
            main();
        }
    });
    observer.observe(document.body, {childList: true, subtree: true});
})();
