// popup.js - 港股招股书信息提取器弹窗
class Logger {
    constructor(name) {
        this.name = name;
    }
    
    info(message, data = null) {
        console.log(`[${this.name}] ${message}`, data || '');
    }
    
    error(message, error = null) {
        console.error(`[${this.name}] ${message}`, error || '');
    }
    
    warn(message, data = null) {
        console.warn(`[${this.name}] ${message}`, data || '');
    }
}

class PopupController {
    // 新增：静态方法用于本地存取数据
    static saveExtractedData(data) {
        if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ hkex_extractedData: data });
        } else {
            // 兼容性fallback
            localStorage.setItem('hkex_extractedData', JSON.stringify(data));
        }
    }
    static loadExtractedData(callback) {
        if (chrome && chrome.storage && chrome.storage.local) {
            chrome.storage.local.get(['hkex_extractedData'], (result) => {
                callback(result.hkex_extractedData || null);
            });
        } else {
            // 兼容性fallback
            const data = localStorage.getItem('hkex_extractedData');
            callback(data ? JSON.parse(data) : null);
        }
    }
    constructor() {
        this.logger = new Logger('HKEX-Popup');
        this.currentTab = null;
        this.isPageReady = false;
        this.extractedData = null;
        
        this.initializeElements();
        this.setupEventListeners();
        // 新增：加载本地缓存内容
        PopupController.loadExtractedData((cachedData) => {
            if (cachedData) {
                this.extractedData = cachedData;
                this.displayResults();
                if (this.elements.copyBtn) this.elements.copyBtn.disabled = false;
                if (this.elements.viewChineseBtn) this.elements.viewChineseBtn.disabled = false;
            }
        });
        this.checkPageStatus();
    }

    initializeElements() {
        this.elements = {
            status: document.getElementById('status'),
            extractBtn: document.getElementById('extract'),
            copyBtn: document.getElementById('copyText'),
            viewChineseBtn: document.getElementById('viewChinese'),
            results: document.getElementById('results'),
            loading: document.getElementById('loading')
        };
        
        // 检查必要元素是否存在
        const requiredElements = ['status', 'extractBtn', 'copyBtn', 'results'];
        for (const elementName of requiredElements) {
            if (!this.elements[elementName]) {
                this.logger.error(`缺少必要元素: ${elementName}`);
            }
        }
        
        // 如果loading元素不存在，创建一个
        if (!this.elements.loading) {
            this.createLoadingElement();
        }
    }

    createLoadingElement() {
        const loading = document.createElement('div');
        loading.id = 'loading';
        loading.className = 'loading';
        loading.style.display = 'none';
        loading.innerHTML = '<div class="spinner"></div><span>💦正在为您节省睡眠时间...请勿离开本界面</span>';
        
        // 插入到status元素后面
        if (this.elements.status && this.elements.status.parentNode) {
            this.elements.status.parentNode.insertBefore(loading, this.elements.status.nextSibling);
            this.elements.loading = loading;
        } else {
            // 如果找不到合适位置，添加到body
            document.body.appendChild(loading);
            this.elements.loading = loading;
        }
    }

    setupEventListeners() {
        if (this.elements.extractBtn) {
            this.elements.extractBtn.addEventListener('click', () => this.extractInfo());
        }
        if (this.elements.copyBtn) {
            this.elements.copyBtn.addEventListener('click', () => this.copyResults());
        }
        if (this.elements.viewChineseBtn) {
            this.elements.viewChineseBtn.addEventListener('click', () => this.downloadChinese());
        }
    }

    async checkPageStatus() {
        try {
            this.logger.info('检查页面状态');
            
            // 获取当前活动标签页
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            this.currentTab = tabs[0];
            
            if (!this.currentTab) {
                this.updateStatus('无法获取当前标签页', 'error');
                return;
            }

            this.logger.info('当前标签页URL:', this.currentTab.url);

            // 检查是否为PDF页面
            if (!this.currentTab.url.includes('.pdf')) {
                this.updateStatus('请在PDF招股书页面使用此扩展', 'error');
                return;
            }

            // 向content script发送ping消息
            this.sendMessageToContent('ping')
                .then(response => {
                    this.logger.info('收到ping回复:', response);
                    if (response && response.success) {
                        this.isPageReady = true;
                        this.updateStatus('招股书 PDF 载入完毕，点击下方一键提取', 'success');
                        if (this.elements.extractBtn) {
                            this.elements.extractBtn.disabled = false;
                        }
                    } else {
                        this.handlePageNotReady();
                    }
                })
                .catch(error => {
                    this.logger.error('页面检查失败:', error);
                    this.handlePageNotReady();
                });

        } catch (error) {
            this.logger.error('检查页面状态失败:', error);
            this.updateStatus('检查页面状态失败', 'error');
        }
    }

    handlePageNotReady() {
        this.logger.warn('页面未就绪，尝试注入content script');
        this.isPageReady = false;
        this.updateStatus('页面正在加载中，请稍候...', 'warning');
        
        // 尝试注入content script
        this.injectContentScript()
            .then(() => {
                // 等待一段时间后重新检查
                setTimeout(() => this.recheckPageStatus(), 2000);
            })
            .catch(error => {
                this.logger.error('注入content script失败:', error);
                this.updateStatus('页面加载失败，请刷新页面后重试', 'error');
            });
    }

    async injectContentScript() {
        try {
            await chrome.scripting.executeScript({
                target: { tabId: this.currentTab.id },
                files: ['content.js']
            });
            this.logger.info('Content script注入成功');
        } catch (error) {
            this.logger.error('注入content script失败:', error);
            throw error;
        }
    }

    async recheckPageStatus() {
        this.logger.info('重新检查页面状态');
        
        try {
            const response = await this.sendMessageToContent('ping');
            this.logger.info('重新检查收到回复:', response);
            
            if (response && response.success) {
                this.isPageReady = true;
                this.updateStatus('招股书 PDF 载入完毕，点击下方一键提取', 'success');
                if (this.elements.extractBtn) {
                    this.elements.extractBtn.disabled = false;
                }
            } else {
                this.updateStatus('页面仍未就绪，请手动刷新页面', 'error');
            }
        } catch (error) {
            this.logger.error('重新检查失败:', error);
            this.updateStatus('页面加载超时，请刷新页面后重试', 'error');
        }
    }

    async sendMessageToContent(action, data = {}) {
        return new Promise((resolve, reject) => {
            const message = { action, ...data };
            this.logger.info('发送消息:', message);
            
            chrome.tabs.sendMessage(this.currentTab.id, message, (response) => {
                if (chrome.runtime.lastError) {
                    this.logger.error('消息发送失败:', chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                } else {
                    this.logger.info('收到回复:', response);
                    resolve(response);
                }
            });
        });
    }

    // 提取信息的主要方法
    async extractInfo() {
        if (!this.isPageReady) {
            this.updateStatus('页面未就绪，请稍候...', 'warning');
            return;
        }

        try {
            this.showLoading(true);
            this.updateStatus('正在检查本地数据...', 'info');
            if (this.elements.extractBtn) {
                this.elements.extractBtn.disabled = true;
            }

            // 第一步：先请求本地准备好的章节数据
            const prepRes = await this.sendMessageToContent('getPreparedData');
            if (!prepRes || !prepRes.success || !prepRes.data) {
                this.updateStatus('本地章节数据未准备好，请刷新页面或稍后重试', 'error');
                this.showLoading(false);
                if (this.elements.extractBtn) this.elements.extractBtn.disabled = false;
                return;
            }

            // 本地数据准备好，才允许调用AI
            this.updateStatus('🐳DeepSeek-V3 提取中，预计花费 30s', 'success');
            this.startProgressBar(30);
            
            // 第二步：真正调用AI接口
            const response = await this.sendMessageToContent('extractInfo');
            if (response && response.success) {
                this.extractedData = response.data;
                // 新增：保存到本地缓存
                PopupController.saveExtractedData(this.extractedData);
                this.displayResults();
                this.updateStatus('🎉提取完成！', 'success');
                if (this.elements.copyBtn) {
                    this.elements.copyBtn.disabled = false;
                }
                if (this.elements.viewChineseBtn) {
                    this.elements.viewChineseBtn.disabled = false;
                }
            } else {
                throw new Error(response?.error || '信息提取失败');
            }
        } catch (error) {
            this.logger.error('提取信息失败:', error);
            this.updateStatus(`提取失败: ${error.message}`, 'error');
        } finally {
            this.finishProgressBar();
            this.showLoading(false);
            if (this.elements.extractBtn) {
                this.elements.extractBtn.disabled = false;
            }
        }
    }

    // 展示所有提取到的字段，包括公司信息、专业服务机构、所有法律顾问等
    // 若有字段缺失，友好提示
    // 注：如需新增字段，需同步parser和extractor
    displayResults() {
        // 临时日志，排查提取数据结构
        console.log('[Popup] extractedData:', this.extractedData);
        // 打印professionals结构，便于排查法律顾问结构
        if (this.extractedData && this.extractedData.professionals) {
            console.log('[Popup] professionals:', this.extractedData.professionals);
        }
        if (window.HKEXLogger) {
            window.HKEXLogger.prototype.info && window.HKEXLogger.prototype.info('[Popup] extractedData:', this.extractedData);
        }
        if (!this.extractedData) {
            this.elements.results.innerHTML = '<div class="no-data">没有提取到数据</div>';
            return;
        }

        const { company, professionals, metadata } = this.extractedData;
        let html = '<div class="results-container">';

        // 公司基本信息
        html += '<div class="section">';
        html += '<h3>公司基本信息</h3>';
        // 中文名称
        html += '<div class="subsection">';
        html += '<h3>公司中文名称</h3>';
        html += `<div class="company-item">${company?.companyChineseName || '未提取'}</div>`;
        html += '</div>';
        // 英文名称
        html += '<div class="subsection">';
        html += '<h3>公司英文名称</h3>';
        html += `<div class="company-item">${company?.companyName || '未提取'}</div>`;
        html += '</div>';
        // 公司类型
        html += '<div class="subsection">';
        html += '<h3>公司类型</h3>';
        html += `<div class="company-item">${company?.companyType || '未提取'}</div>`;
        html += '</div>';
        // 行业
        html += '<div class="subsection">';
        html += '<h3>行业</h3>';
        html += `<div class="company-item">${company?.industry || '未提取'}</div>`;
        html += '</div>';
        html += '</div>';

        // 专业服务机构
        html += '<div class="section">';
        html += '<h3>专业服务机构</h3>';
        // 保荐人
        html += '<div class="subsection">';
        html += '<h3>保荐人</h3>';
        if (professionals?.sponsors?.length > 0) {
            professionals.sponsors.forEach(sponsor => {
                html += `<div class="company-item">${sponsor.name || '未提取'}</div>`;
                if (sponsor.address) {
                    html += `<div class="company-address">${sponsor.address}</div>`;
                }
            });
        } else {
            html += '<div class="no-data">未提取到保荐人信息</div>';
        }
        html += '</div>';
        // 审计师/报告会计师
        html += '<div class="subsection">';
        html += '<h3>审计师/报告会计师</h3>';
        if (professionals?.auditors?.length > 0) {
            professionals.auditors.forEach(auditor => {
                html += `<div class="company-item">${auditor.name || '未提取'}</div>`;
                if (auditor.address) {
                    html += `<div class="company-address">${auditor.address}</div>`;
                }
            });
        } else {
            html += '<div class="no-data">未提取到审计师信息</div>';
        }
        html += '</div>';
        // 行业顾问
        html += '<div class="subsection">';
        html += '<h3>行业顾问</h3>';
        if (professionals?.industryConsultants?.length > 0) {
            professionals.industryConsultants.forEach(consultant => {
                html += `<div class="company-item">${consultant.name || '未提取'}</div>`;
                if (consultant.address) {
                    html += `<div class="company-address">${consultant.address}</div>`;
                }
            });
        } else {
            html += '<div class="no-data">未提取到相关行业顾问信息</div>';
        }
        html += '</div>';
        // 法律顾问（分公司和保荐人）
        html += '<div class="subsection">';
        html += '<h3>公司法律顾问</h3>';
        html += this.renderLegalAdviserList(professionals?.legalAdvisersToCompany);
        html += '</div>';
        html += '<div class="subsection">';
        html += '<h3>保荐人法律顾问</h3>';
        html += this.renderLegalAdviserList(professionals?.legalAdvisersToSponsors);
        html += '</div>';
        html += '</div>';

        // 元数据
        if (metadata) {
            html += '<div class="section metadata">';
            html += '<h3>提取信息</h3>';
            html += `<div class="info-item"><label>提取时间:</label><span>${metadata.extractTime ? new Date(metadata.extractTime).toLocaleString() : '无'}</span></div>`;
            const charOrPage = metadata.englishCharCount != null
                ? metadata.englishCharCount
                : (metadata.totalPages != null ? `约${metadata.totalPages}页` : '无');
            html += `<div class="info-item"><label>当前招股书（英文版）字数:</label><span>${charOrPage}</span></div>`;
            html += '</div>';
        }

        html += '</div>';
        this.elements.results.innerHTML = html;
    }

    // 渲染法律顾问列表（支持公司/保荐人）
    renderLegalAdviserList(list) {
        if (!Array.isArray(list) || list.length === 0) {
            return '<div class="no-data">未提取到相关法律顾问信息</div>';
        }
        let html = '';
        list.forEach((item) => {
            html += `<div class="company-item">${item.name || '未提取'}</div>`;
        });
        return html;
    }

    /**
     * 启动进度条动画，duration为总时长（秒）
     */
    startProgressBar(duration = 30) {
        const bar = document.querySelector('.progress-bar .progress-inner');
        if (!bar) return;
        bar.style.width = '0%';
        let startTime = Date.now();
        let timer = setInterval(() => {
            let elapsed = (Date.now() - startTime) / 1000;
            let percent = Math.min((elapsed / duration) * 100, 99);
            bar.style.width = percent + '%';
            if (percent >= 99) clearInterval(timer);
        }, 200);
        // 保存timer，便于finishProgressBar清理
        this._progressTimer = timer;
    }

    /**
     * 让进度条直接满格并清理动画
     */
    finishProgressBar() {
        const bar = document.querySelector('.progress-bar .progress-inner');
        if (bar) bar.style.width = '100%';
        if (this._progressTimer) clearInterval(this._progressTimer);
    }

    async copyResults() {
        if (!this.extractedData) {
            this.updateStatus('没有可复制的内容', 'warning');
            return;
        }

        try {
            const response = await this.sendMessageToContent('getFormattedText');
            if (response && response.success) {
                await navigator.clipboard.writeText(response.data);
                this.updateStatus('结果已复制到剪贴板', 'success');
            } else {
                throw new Error('获取格式化文本失败');
            }
        } catch (error) {
            this.logger.error('复制失败:', error);
            this.updateStatus('复制失败，请手动复制', 'error');
        }
    }

    /**
     * 一键下载中文招股书PDF
     * 实现逻辑：自动获取当前页面英文PDF链接，推算中文PDF链接并直接下载PDF。
     * 详细注释，便于维护和扩展。
     */
    async downloadChinese() {
        // 1. 通过Chrome扩展API获取当前激活tab的真实url，兼容所有PDF页面环境
        try {
            chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
                if (!tabs || !tabs[0] || !tabs[0].url) {
                    this.logger.error('无法获取当前tab的URL');
                    this.updateStatus('无法获取当前页面链接，请在PDF页面点击', 'error');
                    return;
                }
                const pdfUrl = tabs[0].url;
                if (!pdfUrl.endsWith('.pdf')) {
                    this.logger.error('当前页面不是PDF，无法推算中文招股书链接');
                    this.updateStatus('请在PDF页面点击本按钮', 'error');
                    return;
                }
                this.logger.info('当前英文PDF链接', pdfUrl);

                // 2. 校验并推算中文PDF链接
                try {
                    // 匹配最后一串数字（如01889）
                    const match = pdfUrl.match(/(\d+)(\.pdf)$/i);
                    if (!match) {
                        throw new Error('链接格式不正确');
                    }
                    const numStr = match[1];
                    const num = parseInt(numStr, 10);
                    if (isNaN(num) || num < 1) {
                        throw new Error('编号提取失败');
                    }
                    // 生成新编号，补齐前导0
                    const newNumStr = String(num - 1).padStart(numStr.length, '0');
                    // 构造中文PDF链接
                    const chinesePdfUrl = pdfUrl.replace(/(\d+)(\.pdf)$/i, `${newNumStr}_c.pdf`);
                    this.logger.info('推算得到的中文PDF链接', chinesePdfUrl);

                    // 3. 直接打开新链接（新窗口下载）
                    window.open(chinesePdfUrl, '_blank');
                    this.updateStatus('已跳转至中文招股书PDF，若未打开请检查链接有效性', 'success');
                } catch (err) {
                    this.logger.error('推算中文PDF链接失败', err);
                    this.updateStatus('推算中文PDF链接失败，请手动检查链接', 'error');
                }
            });
        } catch (e) {
            this.logger.error('chrome.tabs.query调用失败', e);
            this.updateStatus('插件权限异常，无法获取页面链接', 'error');
        }
    }

    updateStatus(message, type = 'info') {
        this.logger.info(`状态: ${message} (${type})`);
        if (this.elements.status) {
            this.elements.status.textContent = message;
            this.elements.status.className = `status ${type}`;
        }
    }

    showLoading(show) {
        if (this.elements.loading) {
            this.elements.loading.style.display = show ? 'block' : 'none';
        }
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    const siberLink = document.getElementById('siber-link');
    if(siberLink && window.chrome && chrome.runtime && chrome.runtime.getURL){
        siberLink.addEventListener('click', function(e){
            e.preventDefault();
            window.open(chrome.runtime.getURL('welcome page.html'), '_blank');
        });
    }
    new PopupController();
    // 关于我按钮跳转
    const aboutBtn = document.getElementById('aboutBtn');
    if (aboutBtn) {
        aboutBtn.addEventListener('click', function() {
            window.open(chrome.runtime.getURL('welcome page.html'), '_blank');
        });
    }
});
