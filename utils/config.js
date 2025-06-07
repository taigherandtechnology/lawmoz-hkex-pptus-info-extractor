// HKEX Prospectus Extractor 配置文件
(function() {
    'use strict';

    const config = {
        // DeepSeek API 配置
        ai: {
            enabled: true,
            apiKey: '', // 此处请填写你的 DeepSeek API Key，如 'sk-xxxxxx'
            endpoint: 'https://api.deepseek.com/v1/chat/completions'
        },
        
        // 其他配置项...
        debug: false
    };

    if (typeof window !== 'undefined') {
        window.HKEXConfig = config;
    }

    console.info('[HKEX-Config] 配置加载完成');
})();