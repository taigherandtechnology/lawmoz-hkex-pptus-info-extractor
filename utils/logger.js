/**
 * 港股招股书信息提取器 - 日志工具
 * 提供统一的日志记录功能
 */

(function() {
    'use strict';

    class Logger {
        constructor(name) {
            this.name = name || 'HKEX-Extension';
            this.debugEnabled = true;
        }

        /**
         * 记录普通信息
         * @param {string} message - 日志消息
         * @param {*} data - 附加数据（可选）
         */
        info(message, data = null) {
            this._log('INFO', message, data);
        }

        /**
         * 记录调试信息
         * @param {string} message - 日志消息
         * @param {*} data - 附加数据（可选）
         */
        debug(message, data = null) {
            if (this.debugEnabled) {
                this._log('DEBUG', message, data);
            }
        }

        /**
         * 记录警告信息
         * @param {string} message - 日志消息
         * @param {*} data - 附加数据（可选）
         */
        warn(message, data = null) {
            this._log('WARN', message, data);
        }

        /**
         * 记录错误信息
         * @param {string} message - 日志消息
         * @param {*} error - 错误对象（可选）
         */
        error(message, error = null) {
            this._log('ERROR', message, error);
            
            // 如果提供了错误对象，记录堆栈信息
            if (error && error.stack) {
                console.error(`[${this.name}] ERROR STACK:`, error.stack);
            }
        }

        /**
         * 内部日志记录方法
         * @private
         */
        _log(level, message, data) {
            const timestamp = new Date().toISOString();
            const prefix = `[${this.name}][${level}][${timestamp}]`;
            
            if (data !== null && data !== undefined) {
                if (level === 'ERROR') {
                    console.error(prefix, message, data);
                } else if (level === 'WARN') {
                    console.warn(prefix, message, data);
                } else if (level === 'DEBUG') {
                    console.debug(prefix, message, data);
                } else {
                    console.log(prefix, message, data);
                }
            } else {
                if (level === 'ERROR') {
                    console.error(prefix, message);
                } else if (level === 'WARN') {
                    console.warn(prefix, message);
                } else if (level === 'DEBUG') {
                    console.debug(prefix, message);
                } else {
                    console.log(prefix, message);
                }
            }
        }

        /**
         * 启用调试日志
         */
        enableDebug() {
            this.debugEnabled = true;
            this.debug('调试日志已启用');
        }

        /**
         * 禁用调试日志
         */
        disableDebug() {
            this.debug('调试日志即将禁用');
            this.debugEnabled = false;
        }

        /**
         * 创建子日志记录器
         * @param {string} subName - 子日志记录器名称
         * @returns {Logger} 新的日志记录器实例
         */
        createSubLogger(subName) {
            return new Logger(`${this.name}:${subName}`);
        }
    }

    // 确保类在全局作用域中可用
    if (typeof window !== 'undefined') {
        window.HKEXLogger = Logger;
        window.logger = new Logger('HKEX-Extension'); // 创建默认实例
    }

    // 输出加载确认
    console.info('[HKEX-Logger] 日志工具加载完成');

})();
