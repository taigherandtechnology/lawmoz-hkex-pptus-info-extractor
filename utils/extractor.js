/**
 * 港股招股书信息提取器 - 主提取器
 * 协调PDF解析和信息提取的核心模块
 */

(function() {
    'use strict';

    class ProspectusExtractor {
        constructor() {
            // 获取logger实例
            this.logger = window.HKEXLogger ? new window.HKEXLogger('ProspectusExtractor') : {
                debug: console.debug.bind(console),
                info: console.info.bind(console),
                warn: console.warn.bind(console),
                error: console.error.bind(console)
            };
    
            // 获取parser实例
            const ParserClass = window.HKEXTextParser || window.TextParser;
            if (ParserClass) {
                this.parser = new ParserClass();
            } else {
                this.logger.warn('TextParser未找到，将使用简化解析');
                this.parser = this.createFallbackParser();
            }
    
            this.isInitialized = false;
            this.extractedInfo = {
                company: {},
                professionals: {}
            };
            
            // 缓存已提取的页面文本
            this.pageTextCache = new Map();
        }
    
        /**
         * 创建备用解析器
         * @returns {Object} 简化的解析器对象
         */
        createFallbackParser() {
            return {
                parseCompanyInfo: (sections) => ({
                    companyName: '解析器未加载',
                    companyChineseName: '解析器未加载',
                    companyType: '解析器未加载',
                    industry: '解析器未加载'
                }),
                parseServiceProviders: (directorsText) => ({
                    sponsors: [],
                    auditors: [],
                    industryConsultants: [],
                    legalAdvisersToCompany: [],
                    legalAdvisersToSponsors: []
                }),
                configureAI: (config) => {
                    this.logger.info('备用解析器：AI配置已忽略');
                }
            };
        }
    
        /**
         * 初始化提取器
         */
        async initialize() {
            try {
                this.logger.info('初始化招股书信息提取器');
                
                if (typeof pdfjsLib === 'undefined') {
                    this.logger.warn('PDF.js库未加载，尝试等待加载...');
                    await this.waitForPdfJs();
                }
    
                try {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
                    this.logger.debug('PDF.js工作线程设置完成');
                } catch (error) {
                    this.logger.error('设置PDF.js工作线程失败', error);
                }
                
                this.isInitialized = true;
                this.logger.info('提取器初始化完成');
                return true;
            } catch (error) {
                this.logger.error('初始化提取器失败', error);
                throw error;
            }
        }
    
        /**
         * 等待PDF.js库加载
         */
        waitForPdfJs() {
            return new Promise((resolve, reject) => {
                let attempts = 0;
                const maxAttempts = 50; // 5秒超时
                const checkPdfJs = () => {
                    attempts++;
                    if (typeof pdfjsLib !== 'undefined') {
                        this.logger.info('PDF.js加载完成');
                        resolve();
                        return;
                    }
                    if (attempts >= maxAttempts) {
                        reject(new Error('PDF.js加载超时'));
                        return;
                    }
                    setTimeout(checkPdfJs, 100);
                };
                checkPdfJs();
            });
        }
    
        /**
         * 主提取方法
         */
        async extractProspectusInfo() {
            try {
                if (!this.isInitialized) {
                    await this.initialize();
                }
                
                this.logger.info('开始从当前页面提取信息');
                const pdfUrl = window.location.href;
                
                if (!this.isValidProspectusUrl(pdfUrl)) {
                    throw new Error('当前页面不是有效的招股书PDF页面');
                }
                
                const initialized = await this.initializePDF();
                if (!initialized) {
                    throw new Error('PDF初始化失败');
                }

                // 提取各个章节的文本
                const sections = await this.extractAllRequiredSections();
                
                // 日志：各章节文本长度和前500字符
                this.logger.info('[调试] 传递给parser的sections内容', {
                    firstPageLength: sections.firstPageText ? sections.firstPageText.length : 0,
                    firstPagePreview: sections.firstPageText ? sections.firstPageText.slice(0, 500) : '',
                    summaryLength: sections.summaryText ? sections.summaryText.length : 0,
                    summaryPreview: sections.summaryText ? sections.summaryText.slice(0, 500) : '',
                    directorsLength: sections.directorsText ? sections.directorsText.length : 0,
                    directorsPreview: sections.directorsText ? sections.directorsText.slice(0, 500) : ''
                });
                
                this.logger.info('调用parseCompanyInfo前的sections', JSON.stringify(sections));
                
                // 使用parser分析提取的文本
                this.extractedInfo.company = await this.parser.parseCompanyInfo(sections);
                this.logger.info('[调试] 传递给parseServiceProviders的professionalChunks', sections.professionalChunks);
                this.extractedInfo.professionals = await this.parser.parseServiceProviders(sections.professionalChunks);
                
                this.extractedInfo.metadata = {
                    extractTime: new Date().toISOString(),
                    pdfUrl: window.location.href,
                    directorPages: sections.metadata.directorPages,
                    weAreLocation: sections.metadata.weAreLocation,
                    companyType: sections.companyType,
                    totalPages: this.pdfDoc.numPages
                };
                
                this.logger.info('招股书信息提取完成', this.extractedInfo);
                return this.extractedInfo;
            } catch (error) {
                this.logger.error('提取信息失败', error);
                throw error;
            }
        }
    
        /**
         * 验证是否为有效的招股书URL
         */
        isValidProspectusUrl(url) {
            const validPattern = /hkexnews\.hk.*\.pdf$/i;
            const isValid = validPattern.test(url);
            this.logger.debug('URL验证', { url, isValid });
            return isValid;
        }
    
        /**
         * 初始化PDF文档
         */
        async initializePDF() {
            try {
                this.logger.info('开始初始化PDF文档');
                if (typeof pdfjsLib === 'undefined') {
                    this.logger.error('PDF.js库未加载');
                    return false;
                }
                
                const pdfUrl = window.location.href;
                if (!pdfUrl.includes('.pdf')) {
                    throw new Error('当前页面不是PDF文档');
                }
                
                const loadingTask = pdfjsLib.getDocument({
                    url: pdfUrl,
                    cMapUrl: chrome.runtime.getURL('lib/cmaps/'),
                    cMapPacked: true
                });
                
                this.pdfDoc = await loadingTask.promise;
                this.logger.info(`PDF文档加载成功，共 ${this.pdfDoc.numPages} 页`);
                return true;
            } catch (error) {
                this.logger.error('PDF文档初始化失败', error);
                return false;
            }
        }

        /**
         * 提取所有必需的章节文本，调用前确保PDF已初始化
         * @returns {Promise<Object>} 包含各章节文本的对象
         */
        async extractAllRequiredSections() {
            try {
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] === 开始提取所有必需章节 ===`);
                // 修复：确保PDF文档已初始化，否则自动初始化
                if (!this.pdfDoc) {
                    this.logger.info('[ProspectusExtractor] pdfDoc未初始化，自动调用initializePDF');
                    const initialized = await this.initializePDF();
                    if (!initialized || !this.pdfDoc) {
                        throw new Error('PDF文档未初始化，无法提取章节');
                    }
                }
                // 1. 提取首页文本
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 步骤1: 提取首页文本`);
                const firstPageText = await this.extractPageText(1);

                // 2. 检测公司类型
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 步骤2: 检测公司类型`);
                const companyType = this.detectCompanyType(firstPageText);
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 检测到公司类型: ${companyType}`);

                // 3. 搜索并提取"We are"语句
                const weAreResult = await this.extractWeAreStatement();
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] We are句子位置: ${JSON.stringify(weAreResult.location)}, 文本长度: ${weAreResult.text.length}`);
                
                // 4. 查找Summary章节
                const summarySection = await this.findSummarySection();
                let summaryText = '';
                if (summarySection) {
                    this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] Summary章节找到: 第${summarySection.startPage}页至${summarySection.endPage}页`);
                    summaryText = await this.extractChapterText(summarySection.startPage, summarySection.endPage);
                } else {
                    this.logger.warn(`[ProspectusExtractor][WARN][${new Date().toISOString()}] 未找到Summary章节，尝试使用We are语句替代`);
                    summaryText = weAreResult.text;
                }

                // 5. 查找Directors章节
                const directorsSection = await this.findDirectorsSection(companyType);
                let directorsText = '';
                let directorPages = '';
                if (directorsSection) {
                    directorPages = `${directorsSection.startPage}-${directorsSection.endPage}`;
                    this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] Directors章节找到: 第${directorsSection.startPage}页至${directorsSection.endPage}页`);
                    directorsText = await this.extractChapterText(directorsSection.startPage, directorsSection.endPage);
                } else {
                    this.logger.warn(`[ProspectusExtractor][WARN][${new Date().toISOString()}] 未找到Directors章节`);
                }

                // 创建返回对象
                const sections = {
                    firstPageText,
                    companyType,
                    weAreText: weAreResult.text,
                    summaryText,
                    directorsText,
                    metadata: {
                        directorPages,
                        weAreLocation: weAreResult.location
                    }
                };
                
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] [章节内容预览][Summary] 长度: ${summaryText.length}, 前500字符: ${summaryText.slice(0, 500)}`);
                
                // ========== 新增：提取专业机构关键词片段 ==========
                sections.professionalChunks = this.extractProfessionalChunks(directorsText);
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] [专业机构关键词片段] 提取完成: ${JSON.stringify(sections.professionalChunks)}`);
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 所有章节提取完成: ` + JSON.stringify({
                    firstPageLength: firstPageText.length,
                    weAreLength: weAreResult.text.length,
                    directorsLength: directorsText.length,
                    companyType,
                    directorPages: directorPages
                }));
                
                return sections;
            } catch (error) {
                this.logger.error(`[ProspectusExtractor][ERROR][${new Date().toISOString()}] 提取章节文本失败`, error);
                throw error;
            }
        }

        /**
         * 检测公司类型
         * @param {string} firstPageText - 首页文本
         * @returns {string} 公司类型
         */
        detectCompanyType(firstPageText) {
            try {
                this.logger.debug("开始检测公司类型");
                
                // 检测开曼公司的关键词
                const caymanPatterns = [
                    /cayman\s+islands?/i,
                    /开曼群岛/i,
                    /incorporated\s+in\s+the\s+cayman\s+islands?/i
                ];
                
                for (const pattern of caymanPatterns) {
                    if (pattern.test(firstPageText)) {
                        this.logger.info("检测到开曼公司");
                        return 'cayman';
                    }
                }
                
                this.logger.info("检测到非开曼公司");
                return 'non-cayman';
            } catch (error) {
                this.logger.error("检测公司类型失败", error);
                return 'unknown';
            }
        }
    
        /**
         * 搜索并提取"We are"语句
         * @returns {Promise<Object>} 包含文本和位置信息的对象
         */
        async extractWeAreStatement() {
            try {
                this.logger.info("开始搜索'We are'语句");
                
                // 搜索整本招股书
                for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
                    const pageText = await this.extractPageText(pageNum);
                    
                    // 检查是否包含"We are"语句
                    const weAreMatch = pageText.match(/We\s+are\s+[^.!?]+[.!?]/i);
                    if (weAreMatch) {
                        this.logger.info(`在第${pageNum}页找到"We are"语句: ${weAreMatch[0].substring(0, 100)}...`);
                        
                        // 提取包含该语句的段落（扩展上下文）
                        const paragraph = this.extractParagraphContaining(pageText, weAreMatch[0]);
                        
                        return {
                            text: paragraph,
                            location: {
                                page: pageNum,
                                sentence: weAreMatch[0]
                            }
                        };
                    }
                }
                
                this.logger.warn("未找到'We are'语句");
                return {
                    text: "",
                    location: null
                };
            } catch (error) {
                this.logger.error("提取'We are'语句失败", error);
                return {
                    text: "",
                    location: null
                };
            }
        }
    
        /**
         * 提取包含指定语句的段落
         * @param {string} pageText - 页面文本
         * @param {string} sentence - 目标语句
         * @returns {string} 段落文本
         */
        extractParagraphContaining(pageText, sentence) {
            try {
                const sentenceIndex = pageText.indexOf(sentence);
                if (sentenceIndex === -1) return sentence;
                
                // 向前查找段落开始（找到两个连续换行符或文本开始）
                let startIndex = sentenceIndex;
                for (let i = sentenceIndex - 1; i >= 0; i--) {
                    if (pageText.substring(i, i + 2) === '\n\n') {
                        startIndex = i + 2;
                        break;
                    }
                    if (i === 0) {
                        startIndex = 0;
                        break;
                    }
                }
                
                // 向后查找段落结束（找到两个连续换行符或文本结束）
                let endIndex = sentenceIndex + sentence.length;
                for (let i = endIndex; i < pageText.length - 1; i++) {
                    if (pageText.substring(i, i + 2) === '\n\n') {
                        endIndex = i;
                        break;
                    }
                    if (i === pageText.length - 2) {
                        endIndex = pageText.length;
                        break;
                    }
                }
                
                const paragraph = pageText.substring(startIndex, endIndex).trim();
                this.logger.debug(`提取段落成功，长度: ${paragraph.length}`);
                return paragraph;
            } catch (error) {
                this.logger.error("提取段落失败", error);
                return sentence;
            }
        }
    
        /**
         * 根据公司类型查找Directors章节
         * 非cayman公司若查不到，自动切换为开曼公司关键词查找
         * @param {string} companyType - 公司类型
         * @returns {Promise<Object|null>} 章节位置信息
         */
        async findDirectorsSection(companyType) {
            try {
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 开始查找Directors章节，公司类型: ${companyType}`);
                // 优先选择当前公司类型的关键词
                let searchKeywords = companyType === 'cayman'
                    ? ['Directors and Parties Involved', 'DIRECTORS AND PARTIES INVOLVED']
                    : ['Directors, Supervisors and Parties Involved', 'DIRECTORS, SUPERVISORS AND PARTIES INVOLVED'];
                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 搜索关键词: ${searchKeywords.join(', ')}`);
                let foundOccurrences = [];

                // 搜索整本招股书，收集所有匹配项
                for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
                    const pageText = await this.extractPageText(pageNum);
                    for (const keyword of searchKeywords) {
                        if (pageText.includes(keyword)) {
                            foundOccurrences.push({
                                page: pageNum,
                                keyword: keyword
                            });
                            this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 找到匹配项 #${foundOccurrences.length}: 第${pageNum}页 - ${keyword}`);
                        }
                    }
                }

                // 如果非cayman公司未找到Directors章节，尝试使用开曼公司关键词
                if (companyType !== 'cayman' && foundOccurrences.length === 0) {
                    this.logger.warn(`[ProspectusExtractor][WARN][${new Date().toISOString()}] 非cayman公司未找到Directors章节，自动切换为开曼公司关键词兼容查找`);
                    searchKeywords = ['Directors and Parties Involved', 'DIRECTORS AND PARTIES INVOLVED'];
                    this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 兼容搜索关键词: ${searchKeywords.join(', ')}`);
                    // 重新查找
                    for (let pageNum = 1; pageNum <= this.pdfDoc.numPages; pageNum++) {
                        const pageText = await this.extractPageText(pageNum);
                        for (const keyword of searchKeywords) {
                            if (pageText.includes(keyword)) {
                                foundOccurrences.push({
                                    page: pageNum,
                                    keyword: keyword
                                });
                                this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 兼容查找-找到匹配项 #${foundOccurrences.length}: 第${pageNum}页 - ${keyword}`);
                            }
                        }
                    }
                }

                // 处理搜索结果（严格按规则过滤起始匹配项）
                if (foundOccurrences.length > 0) {
                    // 按页码排序
                    foundOccurrences.sort((a, b) => a.page - b.page);
                    let validIdx = 2; // 默认忽略前2个
                    if (foundOccurrences.length > 10) {
                        validIdx = 3; // 超过10个时，忽略前3个
                        this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 匹配项超过10个，忽略前3个，从第4个开始。`);
                    } else {
                        this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 匹配项不超过10个，忽略前2个，从第3个开始。`);
                    }
                    if (foundOccurrences.length > validIdx) {
                        const validOccurrence = foundOccurrences[validIdx];
                        const endPage = await this.findChapterEndPage(validOccurrence.page, validOccurrence.keyword);
                        this.logger.info(`[ProspectusExtractor][INFO][${new Date().toISOString()}] 使用第${validIdx+1}个匹配项作为Directors章节: 第${validOccurrence.page}页 - ${validOccurrence.keyword}`);
                        return {
                            startPage: validOccurrence.page,
                            endPage: endPage,
                            title: validOccurrence.keyword
                        };
                    } else {
                        // 匹配项太少，降级用最后一个
                        const lastOccurrence = foundOccurrences[foundOccurrences.length - 1];
                        const endPage = await this.findChapterEndPage(lastOccurrence.page, lastOccurrence.keyword);
                        this.logger.warn(`[ProspectusExtractor][WARN][${new Date().toISOString()}] 匹配项不足${validIdx+1}个，降级使用最后一个匹配项: 第${lastOccurrence.page}页 - ${lastOccurrence.keyword}`);
                        return {
                            startPage: lastOccurrence.page,
                            endPage: endPage,
                            title: lastOccurrence.keyword
                        };
                    }
                }
                this.logger.warn(`[ProspectusExtractor][WARN][${new Date().toISOString()}] 未找到Directors章节`);
                return null;
            } catch (error) {
                this.logger.error(`[ProspectusExtractor][ERROR][${new Date().toISOString()}] 查找Directors章节失败`, error);
                return null;
            }
        }

        /**
         * 查找章节结束页码
         * @param {number} startPage - 开始页码
         * @param {string} chapterTitle - 章节标题
         * @returns {Promise<number>} 结束页码
         */
        async findChapterEndPage(startPage, chapterTitle) {
            try {
                this.logger.debug(`查找章节结束页码，开始页: ${startPage}`);
                
                // 从下一页开始搜索，寻找下一个章节标题
                for (let pageNum = startPage + 1; pageNum <= Math.min(startPage + 20, this.pdfDoc.numPages); pageNum++) {
                    const pageText = await this.extractPageText(pageNum);
                    
                    // 查找下一个章节的标题模式（全大写，可能包含编号）
                    const nextChapterPattern = /^[A-Z][A-Z\s,&]+(?:\n|$)/m;
                    const matches = pageText.match(nextChapterPattern);
                    
                    if (matches && matches[0].trim() !== chapterTitle) {
                        this.logger.info(`找到下一章节在第${pageNum}页: ${matches[0].trim()}`);
                        return pageNum - 1;
                    }
                }
                
                // 如果没找到下一章节，默认取开始页后10页
                const defaultEndPage = Math.min(startPage + 10, this.pdfDoc.numPages);
                this.logger.info(`使用默认结束页码: ${defaultEndPage}`);
                return defaultEndPage;
            } catch (error) {
                this.logger.error("查找章节结束页码失败", error);
                return Math.min(startPage + 5, this.pdfDoc.numPages);
            }
        }
    
               /**
         * 提取单页文本（带缓存）
         * @param {number} pageNum - 页码
         * @returns {Promise<string>} 页面文本
         */
        async extractPageText(pageNum) {
            try {
                // 检查缓存
                if (this.pageTextCache.has(pageNum)) {
                    return this.pageTextCache.get(pageNum);
                }
                
                const page = await this.pdfDoc.getPage(pageNum);
                const content = await page.getTextContent();
                const pageText = content.items.map(item => item.str).join(' ');
                
                // 缓存结果
                this.pageTextCache.set(pageNum, pageText);
                
                return pageText;
            } catch (error) {
                this.logger.error(`提取第${pageNum}页文本失败`, error);
                return '';
            }
        }
    
        /**
         * 提取章节文本
         * @param {number} startPage - 开始页码
         * @param {number} endPage - 结束页码
         * @returns {Promise<string>} 章节文本
         */
        async extractChapterText(startPage, endPage) {
            try {
                this.logger.info(`提取章节文本，页码范围: ${startPage}-${endPage}`);
                let text = "";
                
                for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
                    const pageText = await this.extractPageText(pageNum);
                    text += pageText + "\n";
                }
                
                this.logger.info(`章节文本提取完成，总长度: ${text.length}`);
                return text;
            } catch (error) {
                this.logger.error(`提取章节文本失败 (${startPage}-${endPage})`, error);
                throw error;
            }
        }
    
        /**
         * 获取已提取的信息
         */
        getExtractedInfo() {
            return this.extractedInfo;
        }
    
        /**
         * 格式化输出文本
         */
        formatOutputText() {
            const info = this.extractedInfo;
            let output = '=== 港股招股书信息提取结果 ===\n\n';
            
            // 公司信息
            output += '【公司基本信息】\n';
            output += `公司英文名称: ${info.company?.companyName || '未找到'}\n`;
            output += `公司中文名称: ${info.company?.companyChineseName || '未找到'}\n`;
            output += `公司类别: ${info.company?.companyType || '未确定'}\n`;
            output += `行业信息: ${info.company?.industry || '未找到'}\n\n`;
            
            output += '【参与各方信息】\n';
    
            // 保荐人
            if (info.professionals?.sponsors?.length > 0) {
                output += '\n保荐人 (Sponsors):\n';
                info.professionals.sponsors.forEach((sponsor, index) => {
                    output += `  ${index + 1}. ${sponsor.name}\n`;
                });
            }
            
            // 审计师与报告会计师
            if (info.professionals?.auditors?.length > 0) {
                output += '\n审计师与报告会计师 (Auditor and Reporting Accountants):\n';
                info.professionals.auditors.forEach((auditor, index) => {
                    output += `  ${index + 1}. ${auditor.name}\n`;
                });
            }
            
            // 行业顾问
            if (info.professionals?.industryConsultants?.length > 0) {
                output += '\n行业顾问 (Industry Consultant):\n';
                info.professionals.industryConsultants.forEach((consultant, index) => {
                    output += `  ${index + 1}. ${consultant.name}\n`;
                });
            }
            
            // 公司法律顾问
            if (info.professionals?.legalAdvisersToCompany?.length > 0) {
                output += '\n公司法律顾问 (Legal Advisers to the Company):\n';
                info.professionals.legalAdvisersToCompany.forEach((adviser, index) => {
                    output += `  ${index + 1}. ${adviser.name}\n`;
                });
            }
    
            // 保荐人法律顾问
            if (info.professionals?.legalAdvisersToSponsors?.length > 0) {
                output += '\n保荐人法律顾问 (Legal Advisers to the Sponsors):\n';
                info.professionals.legalAdvisersToSponsors.forEach((adviser, index) => {
                    output += `  ${index + 1}. ${adviser.name}\n`;
                });
            }
            
            // 元数据
            output += '\n\n【提取元数据】\n';
            if (info.metadata) {
                output += `提取时间: ${info.metadata.extractTime || 'N/A'}\n`;
                output += `PDF链接: ${info.metadata.pdfUrl || 'N/A'}\n`;
                output += `公司类型: ${info.metadata.companyType || '未检测'}\n`;
                output += `Directors章节页码: ${info.metadata.directorPages || '未找到'}\n`;
                if (info.metadata.weAreLocation) {
                    output += `"We are"语句位置: 第${info.metadata.weAreLocation.page}页\n`;
                }
                output += `总页数: ${info.metadata.totalPages || 'N/A'}\n`;
            } else {
                output += '元数据不可用\n';
            }
    
            this.logger.debug('格式化输出文本完成');
            return output;
        }

        /**
         * 生成中文版链接
         * @param {string} englishUrl - 英文版招股书URL
         * @returns {string|null} 中文版招股书URL
         */
        generateChineseVersion(englishUrl) {
            try {
                this.logger.debug('生成中文版链接', englishUrl);
                let chineseUrl = englishUrl;
                
                if (/\/e([^\/]*\.pdf)$/i.test(englishUrl)) {
                    chineseUrl = englishUrl.replace(/\/e([^\/]*\.pdf)$/i, '/c$1');
                } else if (/e\.pdf$/i.test(englishUrl)) {
                    chineseUrl = englishUrl.replace(/e\.pdf$/i, 'c.pdf');
                } else if (/_e\.pdf$/i.test(englishUrl)) {
                    chineseUrl = englishUrl.replace(/_e\.pdf$/i, '_c.pdf');
                } else if (/sehk(\d+)e(\d+)\.pdf$/i.test(englishUrl)) {
                    chineseUrl = englishUrl.replace(/sehk(\d+)e(\d+)\.pdf$/i, 'sehk$1c$2.pdf');
                } else {
                    this.logger.warn('无法识别URL格式，使用默认规则');
                    chineseUrl = englishUrl.replace(/\.pdf$/i, '_c.pdf');
                }
                
                this.logger.info('中文版链接生成完成', { original: englishUrl, chinese: chineseUrl });
                return chineseUrl;
            } catch (error) {
                this.logger.error('生成中文版链接失败', error);
                return null;
            }
        }

        /**
         * 验证中文版链接是否可用
         * @param {string} chineseUrl - 中文版招股书URL
         * @returns {Promise<boolean>} 链接是否有效
         */
        async validateChineseVersion(chineseUrl) {
            try {
                this.logger.debug('验证中文版链接', chineseUrl);
                const response = await fetch(chineseUrl, { 
                    method: 'HEAD',
                    cache: 'no-cache'
                });
                const isValid = response.ok && response.headers.get('content-type')?.includes('pdf');
                this.logger.info('中文版链接验证结果', {
                    url: chineseUrl,
                    isValid: isValid
                });
                return isValid;
            } catch (error) {
                this.logger.error('验证中文版链接失败', error);
                return false;
            }
        }

        /**
         * 查找Summary章节
         * @returns {Promise<Object|null>} Summary章节的位置信息
         */
        async findSummarySection() {
            try {
                this.logger.info('开始查找Summary章节');
                const searchKeywords = ['SUMMARY', 'Summary'];
                
                // 搜索前30页
                const maxSearchPages = Math.min(30, this.pdfDoc.numPages);
                
                for (let pageNum = 1; pageNum <= maxSearchPages; pageNum++) {
                    const pageText = await this.extractPageText(pageNum);
                    
                    for (const keyword of searchKeywords) {
                        if (pageText.includes(keyword)) {
                            this.logger.info(`在第${pageNum}页找到Summary章节`);
                            
                            // 找到了Summary章节，确定其结束页码
                            const endPage = await this.findChapterEndPage(pageNum, keyword);
                            
                            return {
                                startPage: pageNum,
                                endPage: endPage,
                                title: keyword
                            };
                        }
                    }
                }
                
                this.logger.warn('未找到Summary章节');
                return null;
            } catch (error) {
                this.logger.error('查找Summary章节失败', error);
                return null;
            }
        }

        /**
         * 从董事章节中提取专业机构关键词片段
         * @param {string} directorsText - 董事章节文本
         * @returns {Object} 提取的关键词片段
         */
        extractProfessionalChunks(directorsText) {
            try {
                this.logger.info('开始提取专业机构关键词片段');
                const chunks = {};
                
                // 定义需要提取的专业机构类型及其关键词
                const professionalTypes = [
                    {
                        key: 'sponsors',
                        keywords: ['Sponsors', 'Sponsor', 'Joint Sponsors', 'Joint Sponsor', 'Sole Sponsor']
                    },
                    {
                        key: 'auditors',
                        keywords: ['Auditors', 'Auditor', 'Reporting Accountants', 'Reporting Accountant']
                    },
                    {
                        key: 'industryConsultants',
                        keywords: ['Industry Consultant', 'Industry Consultants']
                    },
                    {
                        key: 'legalAdvisersToCompany',
                        keywords: [
                            'Legal Advisers to the Company',
                            'Legal Adviser to the Company',
                            'Legal Advisors to the Company',
                            'Legal Advisor to the Company',
                            'Legal Advisers to our Company',
                            'Legal Adviser to our Company',
                            'Legal Advisors to our Company',
                            'Legal Advisor to our Company',
                            'Legal Advisers to Company',
                            'Legal Adviser to Company',
                            'Legal Advisors to Company',
                            'Legal Advisor to Company'
                        ]
                    },
                    {
                        key: 'legalAdvisersToSponsors',
                        keywords: [
                            // 通用
                            'Legal Advisers to the Sponsors',
                            'Legal Adviser to the Sponsors',
                            'Legal Advisors to the Sponsors',
                            'Legal Advisor to the Sponsors',
                            'Legal Advisers to Sponsors',
                            'Legal Adviser to Sponsors',
                            'Legal Advisors to Sponsors',
                            'Legal Advisor to Sponsors',
                            'Legal Advisors to the Sponsor',
                            // Sole Sponsor
                            'Legal Advisers to the Sole Sponsor',
                            'Legal Adviser to the Sole Sponsor',
                            'Legal Advisors to the Sole Sponsor',
                            'Legal Advisor to the Sole Sponsor',
                            'Legal Advisers to Sole Sponsor',
                            'Legal Adviser to Sole Sponsor',
                            'Legal Advisors to Sole Sponsor',
                            'Legal Advisor to Sole Sponsor',
                            'Legal Advisers to our Sole Sponsor',
                            'Legal Adviser to our Sole Sponsor',
                            'Legal Advisors to our Sole Sponsor',
                            'Legal Advisor to our Sole Sponsor',
                            // Joint Sponsor
                            'Legal Advisers to the Joint Sponsors',
                            'Legal Adviser to the Joint Sponsors',
                            'Legal Advisors to the Joint Sponsors',
                            'Legal Advisor to the Joint Sponsors',
                            'Legal Advisers to Joint Sponsors',
                            'Legal Adviser to Joint Sponsors',
                            'Legal Advisors to Joint Sponsors',
                            'Legal Advisor to Joint Sponsors',
                            'Legal Advisers to our Joint Sponsors',
                            'Legal Adviser to our Joint Sponsors',
                            'Legal Advisors to our Joint Sponsors',
                            'Legal Advisor to our Joint Sponsors',
                            // to joint/sole（无 sponsor）
                            'Legal Advisers to the Joint',
                            'Legal Adviser to the Joint',
                            'Legal Advisors to the Joint',
                            'Legal Advisor to the Joint',
                            'Legal Advisers to Joint',
                            'Legal Adviser to Joint',
                            'Legal Advisors to Joint',
                            'Legal Advisor to Joint',
                            'Legal Advisers to our Joint',
                            'Legal Adviser to our Joint',
                            'Legal Advisors to our Joint',
                            'Legal Advisor to our Joint',
                            'Legal Advisers to the Sole',
                            'Legal Adviser to the Sole',
                            'Legal Advisors to the Sole',
                            'Legal Advisor to the Sole',
                            'Legal Advisers to Sole',
                            'Legal Adviser to Sole',
                            'Legal Advisors to Sole',
                            'Legal Advisor to Sole',
                            'Legal Advisers to our Sole',
                            'Legal Adviser to our Sole',
                            'Legal Advisors to our Sole',
                            'Legal Advisor to our Sole',
                            'Legal advisor to the [REDACTED]',
                            'Legal advisors to the [REDACTED]',
                            'Legal advisor to our [REDACTED]',
                            'Legal advisors to our [REDACTED]',
                        ]
                    }
                ];
                
                // 为每种专业机构类型提取文本片段
                professionalTypes.forEach(type => {
                    const extractedChunks = [];
                    
                    type.keywords.forEach(keyword => {
    let found = false;
    let matchIndex = -1;
    let matchLength = 0;
    if (keyword.includes(' ')) {
        // 短语关键词，允许跨行、大小写不敏感
        const pattern = keyword.replace(/\s+/g, '\\s+');
        // 加上 's' 修饰符，保证正则既支持大小写不敏感，也支持跨行提取
        const regex = new RegExp(pattern, 'is');
        const match = regex.exec(directorsText);
        if (match) {
            found = true;
            matchIndex = match.index;
            matchLength = match[0].length;
        }
    } else {
        // 单词关键词，仍用indexOf
        matchIndex = directorsText.toLowerCase().indexOf(keyword.toLowerCase());
        if (matchIndex !== -1) {
            found = true;
            matchLength = keyword.length;
        }
    }
    if (found) {
        // 提取包含关键词的段落
        const startIndex = Math.max(0, matchIndex - 50);
        const endIndex = Math.min(directorsText.length, matchIndex + matchLength + 500);
        const chunk = directorsText.substring(startIndex, endIndex).trim();
        extractedChunks.push({
            keyword,
            chunk
        });
    }
});
                    
                    chunks[type.key + 'Chunk'] = extractedChunks;
                    this.logger.info(`[调试] ${type.key}Chunk内容预览`, extractedChunks && extractedChunks.length > 0 ? extractedChunks.map(c => ({keyword: c.keyword, preview: c.chunk.slice(0, 100)})) : '无内容');
                });
                
                this.logger.info('专业机构关键词片段提取完成');
                return chunks;
            } catch (error) {
                this.logger.error('提取专业机构关键词片段失败', error);
                return {};
            }
        }
    }

    // 将提取器注册到全局对象
    window.HKEXProspectusExtractor = ProspectusExtractor;
})();
