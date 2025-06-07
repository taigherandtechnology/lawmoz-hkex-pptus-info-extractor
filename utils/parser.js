/**
 * 港股招股书信息提取器 - 文本解析器
 * 负责解析PDF文本内容，提取结构化信息
 */

(function() {
    'use strict';

    class TextParser {
        constructor() {
            // 获取logger实例，提供备用方案
            this.logger = window.HKEXLogger ? new window.HKEXLogger('TextParser') : {
                debug: console.debug.bind(console),
                info: console.info.bind(console),
                warn: console.warn.bind(console),
                error: console.error.bind(console)
            };
            
            this.companyTypePatterns = {
                'cayman': /cayman|开曼群岛|Cayman Islands/i,
                'china': /中华人民共和国|中国|PRC|People's Republic of China/i,
                'hong kong': /Hong Kong|香港/i,
                'bermuda': /Bermuda|百慕大/i,
                'bvi': /British Virgin Islands|英属维尔京群岛|BVI/i,
                'other': /Singapore|新加坡|Marshall Islands|马绍尔群岛/i 
            };

            // 添加AI配置
            this.aiConfig = {
                enabled: false, // 默认关闭AI验证
                apiKey: '', // AI API密钥
                endpoint: '' // AI API端点
            };
        }

        /**
         * 配置AI辅助功能
         * @param {Object} config - AI配置信息
         */
        configureAI(config) {
            this.aiConfig = {
                ...this.aiConfig,
                ...config
            };
        }

        /**
         * 解析公司基本信息
         * @param {Object} sections - 包含各章节文本的对象
         * @returns {Object} 解析结果
         */
        async parseCompanyInfo(sections) {
            this.logger.debug('开始解析公司基本信息');
            // 只让AI提取公司名和注册地类型
            const basicInfo = await this.extractBasicCompanyInfo(sections.firstPageText);
            // 只用weAre句子AI提取主营业务
            let industry = '未识别';
            if (sections.weAreText && sections.weAreText.length > 0) {
                industry = await this.extractIndustryFromWeAreWithAI(sections.weAreText);
            } else {
                this.logger.warn('未找到有效的We are句子，无法提取主营业务');
            }
            const result = {
                companyName: basicInfo.companyName || '未识别',
                companyChineseName: basicInfo.companyChineseName || '未识别',
                companyType: basicInfo.companyType || '未识别',
                industry
            };
            this.logger.info('公司基本信息解析完成', result);
            return result;
        }

        /**
         * 从首页提取公司基本信息
         * @param {string} firstPageText - 首页文本
         * @returns {Promise<Object>} 公司基本信息
         */
        async extractBasicCompanyInfo(firstPageText) {
            try {
                // 使用正则表达式提取关键区域
                const pattern = /Application\s+Proof\s+of([\s\S]*?)The\s+publication\s+of\s+this\s+Application\s+Proof\s+is\s+required\s+by\s+The/i;
                const match = firstPageText.match(pattern);
                let extractedText = '';
                let fallbackUsed = false;
                if (match && match[1]) {
                    extractedText = match[1].trim();
                    this.logger.info('公司基本信息区域正则提取成功', { preview: extractedText.slice(0, 200) });
                } else {
                    // fallback: 取首页前1000字符
                    extractedText = firstPageText.slice(0, 1000);
                    fallbackUsed = true;
                    this.logger.warn('未找到公司基本信息区域，使用首页前1000字符兜底', { preview: extractedText.slice(0, 200) });
                }
                const aiResult = await this.extractBasicInfoWithAI(extractedText);
                this.logger.info('AI返回公司基本信息', aiResult);
                // AI全未识别时，尝试正则兜底
                if ((aiResult.companyName === '未识别' || !aiResult.companyName) && (aiResult.companyChineseName === '未识别' || !aiResult.companyChineseName)) {
                    // 英文公司名兜底
                    const engPattern = /(\b[A-Z][A-Za-z0-9\s\.,&()'-]{6,}\b)\s*(Limited|Corporation|Company|Incorporated)/i;
                    const engMatch = firstPageText.match(engPattern);
                    // 中文公司名兜底
                    const chiPattern = /([\u4e00-\u9fa5]{4,}(有限公司|股份有限公司))/;
                    const chiMatch = firstPageText.match(chiPattern);
                    if (engMatch) aiResult.companyName = engMatch[0];
                    if (chiMatch) aiResult.companyChineseName = chiMatch[0];
                    this.logger.warn('AI未识别，正则兜底公司名', { eng: aiResult.companyName, chi: aiResult.companyChineseName });
                }
                return aiResult;
            } catch (error) {
                this.logger.error('提取公司基本信息失败', error);
                return { companyName: '', companyChineseName: '', companyType: '' };
            }
        }

        /**
         * 使用AI解析公司基本信息
         * @param {string} text - 提取的文本
         * @returns {Promise<Object>} 解析结果
         */
        async extractBasicInfoWithAI(text) {
            // 修复AI返回内容为字符串且带markdown包裹的情况
            try {
                const prompt = `你是一个专业的港股招股书信息提取专家。请从以下文本中提取公司基本信息。\n\n请严格按照以下JSON格式返回结果：\n{\n  "companyName": "英文公司名称",\n  "companyChineseName": "中文公司名称（简体中文）",\n  "companyType": "注册地类型（如：中国公司、开曼公司、香港公司、百慕大公司、英属维尔京群岛公司、其他）"\n}\n...\n提取文本：\n${text}`;
                this.logger.info('AI公司信息提取调用前', { promptPreview: prompt.slice(0, 300), textPreview: text.slice(0, 200) });
                let result = await this.callAI(prompt);
                // 处理AI返回内容为字符串的情况
                if (typeof result === 'string') {
                    // 去除markdown代码块包裹
                    result = result.trim();
                    if (result.startsWith('```json')) {
                        result = result.replace(/^```json[\r\n]*/i, '').replace(/```$/i, '').trim();
                    } else if (result.startsWith('```')) {
                        result = result.replace(/^```[\w]*[\r\n]*/i, '').replace(/```$/i, '').trim();
                    }
                    try {
                        result = JSON.parse(result);
                    } catch (e) {
                        this.logger.warn('AI返回内容无法解析为JSON', { raw: result });
                        result = {};
                    }
                }
                this.logger.info('AI公司信息提取调用后', result);
                return result;
            } catch (error) {
                this.logger.error('AI解析公司基本信息失败', error);
                return { companyName: '', companyChineseName: '', companyType: '' };
            }
        }


        /**
         * 使用AI提取行业信息
         * @param {string} summaryText - Summary章节文本
         * @returns {Promise<string>} 行业描述
         */
        async extractIndustryWithAI(summaryText) {
            try {
                const prompt = "你是一个专业的港股招股书信息提取专家。请从以下招股书文本中提取公司的主要业务和行业信息。\n\n" +
                    "要求：\n" +
                    "1. 重点关注以下部分的内容：\n" +
                    "   - \"BUSINESS OVERVIEW\"或\"OUR BUSINESS\"部分\n" +
                    "   - \"COMPANY OVERVIEW\"部分\n" +
                    "   - \"INDUSTRY OVERVIEW\"部分\n\n" +
                    "2. 需要提取的信息包括：\n" +
                    "   - 公司的主营业务是什么\n" +
                    "   - 公司所属的行业领域\n" +
                    "   - 公司的主要产品或服务\n\n" +
                    "3. 返回格式要求：\n" +
                    "   - 用简洁的语言描述\n" +
                    "   - 不超过100字\n" +
                    "   - 如果找不到相关信息请说明\"未找到业务描述信息\"\n" +
                    "   - 直接返回描述文本不需要JSON格式\n\n" +
                    "提取文本：\n" + summaryText;

                const result = await this.callAI(prompt);
                if (typeof result === "string" && result.includes("未找到业务描述信息")) {
                    return "未能从Summary章节提取到行业信息";
                }
                return typeof result === "string" ? result : result.toString();
            } catch (error) {
                this.logger.error("AI提取行业信息失败", error);
                return "未识别";
            }
        }

        /**
         * 分段解析专业服务机构信息（新版：每类独立AI调用，兼容AI返回格式）
         * @param {Object} chunks - 各专业机构片段对象（sponsorsChunk, legalAdvisorChunk, industryConsultantsChunk, auditorsChunk）
         * @returns {Object} 服务机构信息
         */
        async parseServiceProviders(chunks) {
            this.logger.debug('开始分段解析专业服务机构信息', { chunksPreview: Object.fromEntries(Object.entries(chunks).map(([k, v]) => [k, v?.slice(0, 100)])) });

            // 1. 保荐人
            let sponsors = [];
            let sponsorsText = Array.isArray(chunks.sponsorsChunk) ? chunks.sponsorsChunk.map(item => item.chunk).join('\n') : '';
            if (sponsorsText) {
                let sponsorRes = await this.extractSponsorsWithAI(sponsorsText);
                // 兼容AI返回对象/数组
                if (Array.isArray(sponsorRes)) {
                    sponsors = sponsorRes;
                } else if (sponsorRes && sponsorRes.sponsors) {
                    sponsors = sponsorRes.sponsors;
                } else {
                    sponsors = [];
                }
            } else {
                this.logger.warn('保荐人关键词片段为空');
            }
            this.logger.info('保荐人最终结果', sponsors);

            // 2. 行业顾问
            let industryConsultants = [];
            let industryConsultantsText = Array.isArray(chunks.industryConsultantsChunk) ? chunks.industryConsultantsChunk.map(item => item.chunk).join('\n') : '';
            if (industryConsultantsText) {
                industryConsultants = await this.extractIndustryConsultantsWithAI(industryConsultantsText);
            } else {
                this.logger.warn('行业顾问关键词片段为空');
            }
            this.logger.info('行业顾问最终结果', industryConsultants);

            // 3. 法律顾问（分别提取公司法律顾问和保荐人法律顾问）
            let legalAdvisersToCompany = [];
            let legalAdvisersToSponsors = [];
            // 公司法律顾问
            let legalAdvisersToCompanyText = Array.isArray(chunks.legalAdvisersToCompanyChunk) ? chunks.legalAdvisersToCompanyChunk.map(item => item.chunk).join('\n') : '';
            if (legalAdvisersToCompanyText) {
                this.logger.info('AI公司法律顾问提取调用前', { textPreview: legalAdvisersToCompanyText.slice(0, 200) });
                try {
                    const res = await this.extractLegalAdvisers(legalAdvisersToCompanyText);
                    if (res && Array.isArray(res.company)) {
                        legalAdvisersToCompany = res.company;
                    } else if (Array.isArray(res)) {
                        legalAdvisersToCompany = res;
                    }
                    this.logger.info('AI公司法律顾问提取调用后', legalAdvisersToCompany);
                } catch (e) {
                    this.logger.error('AI公司法律顾问提取异常', e);
                }
            } else {
                this.logger.warn('公司法律顾问关键词片段为空');
            }
            // 保荐人法律顾问
            let legalAdvisersToSponsorsText = Array.isArray(chunks.legalAdvisersToSponsorsChunk) ? chunks.legalAdvisersToSponsorsChunk.map(item => item.chunk).join('\n') : '';
            if (legalAdvisersToSponsorsText) {
                this.logger.info('AI保荐人法律顾问提取调用前', { textPreview: legalAdvisersToSponsorsText.slice(0, 200) });
                try {
                    const res = await this.extractLegalAdvisers(legalAdvisersToSponsorsText);
                    if (res && Array.isArray(res.sponsors)) {
                        legalAdvisersToSponsors = res.sponsors;
                    } else if (Array.isArray(res)) {
                        legalAdvisersToSponsors = res;
                    }
                    this.logger.info('AI保荐人法律顾问提取调用后', legalAdvisersToSponsors);
                } catch (e) {
                    this.logger.error('AI保荐人法律顾问提取异常', e);
                }
            } else {
                this.logger.warn('保荐人法律顾问关键词片段为空');
            }
            // 兜底逻辑，如果都没有就用legalAdvisorChunk
            let legalAdvisorText = Array.isArray(chunks.legalAdvisorChunk) ? chunks.legalAdvisorChunk.map(item => item.chunk).join('\n') : '';
            if (!legalAdvisersToCompanyText && !legalAdvisersToSponsorsText && legalAdvisorText) {
                this.logger.info('AI法律顾问兜底提取调用前', { textPreview: legalAdvisorText.slice(0, 200) });
                try {
                    const res = await this.extractLegalAdvisers(legalAdvisorText);
                    if (res && Array.isArray(res.company)) legalAdvisersToCompany = res.company;
                    if (res && Array.isArray(res.sponsors)) legalAdvisersToSponsors = res.sponsors;
                    this.logger.info('AI法律顾问兜底提取调用后', res);
                } catch (e) {
                    this.logger.error('AI法律顾问兜底提取异常', e);
                }
            }

            // 4. 审计师
            let auditors = [];
            let auditorsText = Array.isArray(chunks.auditorsChunk) ? chunks.auditorsChunk.map(item => item.chunk).join('\n') : '';
            if (auditorsText) {
                const auditorRes = await this.extractAuditorsWithAI(auditorsText);
                if (Array.isArray(auditorRes)) {
                    auditors = auditorRes;
                } else if (auditorRes && auditorRes.auditors) {
                    auditors = auditorRes.auditors;
                } else {
                    auditors = [];
                }
            } else {
                this.logger.warn('审计师关键词片段为空');
            }
            this.logger.info('审计师最终结果', auditors);

            const result = {
                sponsors,
                auditors,
                industryConsultants,
                legalAdvisersToCompany,
                legalAdvisersToSponsors
            };
            this.logger.info('分段解析专业服务机构信息完成', result);
            return result;
        }

        /**
         * 提取法律顾问信息（公司法律顾问和保荐人法律顾问）
         * @param {string} text - 法律顾问相关文本
         * @returns {Promise<{company: Array, sponsors: Array}>}
         */
        async extractLegalAdvisers(text) {
            try {
                // 你可以根据实际需求调整prompt和返回格式
                const prompt = `你是港股招股书信息提取专家。请从以下文本中分别提取公司法律顾问和保荐人法律顾问，严格返回如下JSON：\n{\n  "company": [\n    {"name": "公司法律顾问名称"}, ...\n  ],\n  "sponsors": [\n    {"name": "保荐人法律顾问名称"}, ...\n  ]\n}\n只要名称，不要地址等。找不到请返回[]。\n\n文本：\n${text}`;
                this.logger.info('AI法律顾问信息提取调用前', { promptPreview: prompt.slice(0, 200), textPreview: text.slice(0, 200) });
                let result = await this.callAI(prompt);
                // 处理AI返回内容为字符串的情况
                if (typeof result === 'string') {
                    result = result.trim();
                    if (result.startsWith('```json')) {
                        result = result.replace(/^```json[\r\n]*/i, '').replace(/```$/i, '').trim();
                    } else if (result.startsWith('```')) {
                        result = result.replace(/^```[\w]*[\r\n]*/i, '').replace(/```$/i, '').trim();
                    }
                    try {
                        result = JSON.parse(result);
                    } catch (e) {
                        this.logger.warn('AI返回内容无法解析为JSON', { raw: result });
                        result = {};
                    }
                }
                // 兜底结构
                if (!result || typeof result !== 'object') result = {};
                if (!Array.isArray(result.company)) result.company = [];
                if (!Array.isArray(result.sponsors)) result.sponsors = [];
                this.logger.info('AI法律顾问信息提取调用后', result);
                return result;
            } catch (error) {
                this.logger.error('AI解析法律顾问信息失败', error);
                return { company: [], sponsors: [] };
            }
        }

        /**
         * 提取保荐人信息
         * @param {string} text - sponsorsChunk
         * @returns {Promise<Array>} 保荐人信息
         */
        async extractSponsorsWithAI(text) {
            try {
                const prompt = `你是港股招股书信息提取专家。请从以下文本中提取保荐人名称，严格返回如下JSON：\n{\n  "sponsors": [\n    {"name": "保荐人名称"},\n    ...\n  ]\n}\n只要名称，不要地址等。找不到请返回[]。\n\n文本：\n${text}`;
                this.logger.info('AI保荐人信息提取调用前', { promptPreview: prompt.slice(0, 200), textPreview: text.slice(0, 200) });
                let result = await this.callAI(prompt);
                this.logger.info('AI保荐人信息提取调用后', result);
                // 兼容字符串带markdown和字符串JSON
                if (typeof result === 'string') {
                    result = result.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/g, '').trim();
                    try {
                        result = JSON.parse(result);
                    } catch (e) {
                        this.logger.warn('AI返回内容无法解析为JSON', { raw: result });
                        result = {};
                    }
                }
                if (Array.isArray(result)) return result;
                if (result && Array.isArray(result.sponsors)) return result.sponsors;
                return [];
            } catch (error) {
                this.logger.error('AI解析保荐人信息失败', error);
                return [];
            }
        }

        /**
         * 提取审计师信息
         * @param {string} text - auditorsChunk（已精准分割的关键词片段）
         * @returns {Promise<Array<string>>} 审计师信息
         */
        async extractAuditorsWithAI(text) {
            try {
                const prompt = `你是港股招股书信息提取专家。下面文本中一定有一个审计师名称，请从以下文本中提取审计师名称，严格返回如下JSON：\n{\n  "auditors": [\n    {"name": "审计师名称"},\n    ...\n  ]\n}\n只要名称，不要地址等。找不到请返回[]。\n\n文本：\n${text}`;
                this.logger.info('AI审计师信息提取调用前', { promptPreview: prompt.slice(0, 200), textPreview: text.slice(0, 200) });
                let result = await this.callAI(prompt);
                this.logger.info('AI审计师信息提取调用后', result);
                // 兼容字符串带markdown和字符串JSON
                if (typeof result === 'string') {
                    result = result.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/g, '').trim();
                    try {
                        result = JSON.parse(result);
                    } catch (e) {
                        this.logger.warn('AI返回内容无法解析为JSON', { raw: result });
                        result = {};
                    }
                }
                if (Array.isArray(result)) return result;
                if (result && Array.isArray(result.auditors)) return result.auditors;
                return [];
            } catch (error) {
                this.logger.error('AI解析审计师信息失败', error);
                return [];
            }
        }

        /**
         * 提取行业顾问信息
         * @param {string} text - industryConsultantsChunk
         * @returns {Promise<Array>} 行业顾问信息
         */
        async extractIndustryConsultantsWithAI(text) {
            try {
                const prompt = `你是港股招股书信息提取专家。请从以下文本中提取行业顾问名称，注意只有一个行业顾问。严格返回如下JSON：\n{\n  "consultants": [\n    {"name": "行业顾问名称"},\n    ...\n  ]\n}\n只要名称，不要地址等。找不到请返回[]。\n\n文本：\n${text}`;
                this.logger.info('AI行业顾问信息提取调用前', { promptPreview: prompt.slice(0, 200), textPreview: text.slice(0, 200) });
                let result = await this.callAI(prompt);
                this.logger.info('AI行业顾问信息提取调用后', result);
                // 兼容字符串带markdown和字符串JSON
                if (typeof result === 'string') {
                    result = result.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/g, '').trim();
                    try {
                        result = JSON.parse(result);
                    } catch (e) {
                        this.logger.warn('AI返回内容无法解析为JSON', { raw: result });
                        result = {};
                    }
                }
                if (Array.isArray(result)) return result;
                if (result && Array.isArray(result.consultants)) return result.consultants;
                return [];
            } catch (error) {
                this.logger.error('AI解析行业顾问信息失败', error);
                return [];
            }
        }
        /**
         * 通用AI调用方法
         * @param {string} prompt - AI提示词
         * @returns {Promise<any>} AI返回结果
         */
        async callAI(prompt) {
            try {
                // 优先使用最新的全局配置
                let endpoint = this.aiConfig.endpoint;
                let apiKey = this.aiConfig.apiKey;
                let enabled = this.aiConfig.enabled;
                if (typeof window !== 'undefined' && window.HKEXConfig && window.HKEXConfig.ai) {
                    endpoint = window.HKEXConfig.ai.endpoint || endpoint;
                    apiKey = window.HKEXConfig.ai.apiKey || apiKey;
                    enabled = window.HKEXConfig.ai.enabled ?? enabled;
                }
                if (!enabled) {
                    this.logger.warn('AI功能未启用，直接返回空结果');
                    return {};
                }
                if (!endpoint || !apiKey) {
                    this.logger.error('AI配置缺失，endpoint或apiKey为空');
                    return {};
                }
                this.logger.info('调用AI接口', { endpoint, promptPreview: prompt.slice(0, 200) });
                // 以 OpenAI 格式调用
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: 'deepseek-chat',
                        messages: [
                            { role: 'user', content: prompt }
                        ]
                    })
                });
                if (!response.ok) {
                    this.logger.error('AI接口请求失败', { status: response.status, statusText: response.statusText });
                    return {};
                }
                const data = await response.json();
                let result = '';
                if (data && data.choices && data.choices[0] && data.choices[0].message) {
                    result = data.choices[0].message.content;
                } else {
                    this.logger.warn('AI接口返回格式异常', data);
                    return {};
                }
                // 尝试解析JSON
                try {
                    return JSON.parse(result);
                } catch (e) {
                    // 如果不是JSON，直接返回原始文本
                    return result;
                }
            } catch (error) {
                this.logger.error('AI调用异常', error);
                return {};
            }
        }

        /**
         * 使用AI解析 "We are" 句子主营行业
         * @param {string} weAreText - "We are" 段落内容
         * @returns {Promise<string>} 行业描述
         */
        async extractIndustryFromWeAreWithAI(weAreText) {
            try {
                const prompt =
                    '你是港股招股书行业信息提取专家。请根据下述“We are”句子或段落，总结公司主营行业，直接用一句话中文简明描述，避免多余修饰，不要返回JSON：\n' +
                    weAreText;
                this.logger.info('AI主营行业解析调用前', { promptPreview: prompt.slice(0, 200), textPreview: weAreText.slice(0, 200) });
                const result = await this.callAI(prompt);
                this.logger.info('AI主营行业解析调用后', result);
                if (typeof result === 'string') return result;
                if (result && result.industry) return result.industry;
                return '未识别';
            } catch (error) {
                this.logger.error('AI解析主营行业失败', error);
                return '未识别';
            }
        }
    }
    // 确保类在全局作用域中可用
    if (typeof window !== "undefined") {
        window.HKEXTextParser = TextParser;
        window.TextParser = TextParser; // 备用引用
    }

    console.info("[HKEX-Parser] 文本解析器加载完成 V4.2 - 修复语法错误");
})();
