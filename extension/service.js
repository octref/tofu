'use strict';
import Storage from './storage.js';
import Settings from './settings.js';


/**
 * Service settings
 */
export const SERVICE_SETTINGS = {
    'service.debug': false,
    'service.requestInterval': 1000,
};


/**
 * Class TaskError
 */
export class TaskError extends Error {
    constructor(message) {
        super(message);
    }
}


/**
 * Class Task
 */
export class Task {
    /**
     * Initialize the task
     * @param {callback} fetch
     * @param {Storage} storage
     * @param {Logger} logger
     * @param {callback} parseHTML
     * @param {number} jobId
     * @param {Object} session
     */
    init(fetch, storage, logger, parseHTML, jobId, session) {
        this.fetch = fetch;
        this.storage = storage;
        this.logger = logger;
        this.parseHTML = parseHTML;
        this.jobId = jobId;
        this.session = session;
    }

    /**
     * Run task
     */
    async run() {
        throw new TaskError('Not implemented.');
    }

    /**
     * Convert to JSON string
     * @returns {string}
     */
    toJSON() {
        return this.name;
    }

    /**
     * Get task name
     * @returns {string}
     */
    get name() {
        throw new TaskError('Not implemented.');
    }
}


/**
 * Parse HTML
 * @param {string} html 
 * @param {string} url 
 */
function parseHTML(html, url) {
    let context = document.implementation.createHTMLDocument('');
    context.documentElement.innerHTML = html;
    let base = context.createElement('base');
    base.href = url;
    context.head.appendChild(base);
    return context;
}


/**
 * Class Job
 */
class Job {
    constructor(service) {
        this._service = service;
        this._tasks = [];
        this._isRunning = false;
        this._currentTask = null;
        this._id = null;
    }

    /**
     * Signin account
     * @param {callback} fetch 
     * @returns {object}
     */
    async signin(fetch) {
        const URL_MINE = 'https://m.douban.com/mine/';
        let response = await fetch(URL_MINE);
        if (response.redirected) {
            window.open(response.url);
            throw new TaskError('未登录豆瓣');
        }
        let bodyElement = parseHTML(await response.text(), URL_MINE);
        let inputElement = bodyElement.querySelector('#user');
        let name = inputElement.getAttribute('data-name');
        let userid = inputElement.getAttribute('value');
        let homepageLink = bodyElement.querySelector('.profile .detail .basic-info>a');
        let homepageURL = homepageLink.getAttribute('href');
        let userSymbol = homepageURL.match(/\/people\/(.+)/).pop();
        let cookiesNeeded = {
            'ue': '',
            'bid': '',
            'frodotk_db': '',
            'ck': '',
            'dbcl2': '',
        };
        let cookies = await new Promise(resolve => chrome.cookies.getAll({url: 'https://*.douban.com'}, resolve));
        for (let cookie of cookies) {
            if (cookie.name in cookiesNeeded) {
                cookiesNeeded[cookie.name] = cookie.value;
            }
        }
        return {
            user_id: parseInt(userid),
            name: name,
            symbol: userSymbol,
            cookies: cookiesNeeded,
        }
    }

    /**
     * Add a task
     * @param {Task} task 
     */
    addTask(task) {
        this._tasks.push(task);
    }

    /**
     * Run the job
     * @param {callback} fetch 
     * @param {Storage} storage 
     * @param {Logger} logger 
     */
    async run(fetch, storage, logger) {
        this._isRunning = true;
        let session = await this.signin(fetch);
        await storage.put('session', session);
        let jobId =await storage.add('job', {
            user_id: session.id,
            created: Date.now(),
            tasks: JSON.parse(JSON.stringify(this._tasks)),
        });
        this._id = jobId;
        for (let task of this._tasks) {
            this._currentTask = task;
            task.init(fetch, storage, logger, parseHTML, jobId, session);
            try {
                await task.run();
            } catch (e) {
                logger.error('Fail to run task:' + e);
            }
        }
        this._currentTask = null;
        this._isRunning = false;
    }

    /**
     * Whether the job is running
     * @returns {boolean}
     */
    get isRunning() {
        return this._isRunning;
    }

    /**
     * Get current task
     * @returns {Task|null}
     */
    get currentTask() {
        return this._currentTask;
    }

    /**
     * Get job id
     * @returns {number|null}
     */
    get id() {
        return this._id;
    }
}


/**
 * Class Logger
 */
class Logger extends EventTarget {
    /**
     * Constructor
     */
    constructor() {
        super();
        Object.assign(this, {
            LEVEL_CRITICAL: 50,
            LEVEL_ERROR: 40,
            LEVEL_WARNING: 30,
            LEVEL_INFO: 20,
            LEVEL_DEBUG: 10,
            LEVEL_NOTSET: 0,
        });
        this._level = this.LEVEL_INFO;
        this.entries = [];
    }

    /**
     * Log error
     * @param {string} message 
     * @param {any} context 
     * @returns {object}  
     */
    error(message, context = null) {
        return this.log(this.LEVEL_ERROR, message, context);
    }

    /**
     * Log warning
     * @param {string} message 
     * @param {any} context 
     * @returns {object} 
     */
    warning(message, context = null) {
        return this.log(this.LEVEL_WARNING, message, context);
    }

    /**
     * Log info
     * @param {string} message 
     * @param {any} context 
     * @returns {object} 
     */
    info(message, context = null) {
        return this.log(this.LEVEL_INFO, message, context);
    }

    /**
     * Log debug info
     * @param {string} message 
     * @param {any} context 
     * @returns {object} 
     */
    debug(message, context = null) {
        return this.log(this.LEVEL_DEBUG, message, context);
    }

    /**
     * Log message
     * @param {number} level 
     * @param {string} message 
     * @param {any} context 
     * @returns {object} 
     */
    log(level, message, context = null) {
        if (this._level > level) return;
        let levelName;
        switch (level) {
            case this.LEVEL_DEBUG:
            levelName = 'DEBUG';
            break;
            case this.LEVEL_INFO:
            levelName = 'INFO';
            break;
            case this.LEVEL_WARNING:
            levelName = 'WARNING';
            break;
            case this.LEVEL_ERROR:
            levelName = 'ERROR';
            break;
            case this.LEVEL_CRITICAL:
            levelName = 'CRITICAL';
            break;
            default:
            levelName = 'UNKNOWN';
        }
        let entry = {
            time: Date.now(),
            level: level,
            levelName: levelName,
            message: message,
            context: context,
        };
        let cancelled = !this.dispatchEvent(new CustomEvent('log', {detail: entry}));
        if (cancelled) {
            return entry;
        }
        return this.entries.push(entry);
    }

    /**
     * Get default level
     * @returns {number}
     */
    get level() {
        return this._level;
    }

    /**
     * Set default level
     * @param {number} value
     */
    set level(value) {
        this._level = value;
    }
}


/**
 * Class AsyncBlockingQueue
 */
class AsyncBlockingQueue {
    constructor() {
        this.resolves = [];
        this.promises = [];
    }

    _add() {
        this.promises.push(
            new Promise(resolve => {
                this.resolves.push(resolve);
            })
        );
    }

    enqueue(item) {
        if (!this.resolves.length) this._add();
        let resolve = this.resolves.shift();
        resolve(item);
    }

    dequeue() {
        if (!this.promises.length) this._add();
        return this.promises.shift();
    }

    isEmpty() {
        return !this.promises.length;
    }

    isBlocked() {
        return !!this.resolves.length;
    }

    clear() {
        this.promises.length = 0;
    }

    get length() {
        return (this.promises.length - this.resolves.length);
    }
}


/**
 * Class StateChangeEvent
 */
class StateChangeEvent extends Event {
    constructor(originalState, currentState) {
        super('statechange');
        this.originalState = originalState;
        this.currentState = currentState;
    }
}


/**
 * Class Service
 */
export default class Service extends EventTarget {
    constructor() {
        super();
        Object.assign(this, {
            STATE_STOPPED: 1,
            STATE_START_PENDING: 2,
            STATE_STOP_PENDING: 3,
            STATE_RUNNING: 4
        });
        this._ports = new Map();
        this._jobQueue = new AsyncBlockingQueue();
        this._status = this.STATE_STOPPED;
        this.lastRequest = 0;
        chrome.runtime.onConnect.addListener(port => this.onConnect(port));
    }

    /**
     * Get debug mode
     * @returns {boolean} 
     */
    get debug() {
        return this._debug;
    }

    /**
     * Set debug mode
     * @param {boolean} value
     */
    set debug(value) {
        if (this._debug = !!value) {
            let logger = this.logger;
            logger.level = logger.LEVEL_DEBUG;
            logger.addEventListener('log', event => {
                let entry = event.detail;
                let datetime = new Date(entry.time).toISOString();
                console.log(`[${datetime}] ${entry.levelName}: ${entry.message}`);
            })
        }
    }

    /**
     * Get logger
     * @returns {Logger} 
     */
    get logger() {
        let logger = this._logger;
        if (!logger) {
            this._logger = logger = new Logger();
        }
        return logger;
    }

    /**
     * Set settings
     * @param {object} settings
     */
    set settings(settings) {
        for (let key in settings) {
            try {
                let keyPath = key.split('.');
                if (keyPath.shift() != 'service') {
                    continue;
                }
                let lastNode = keyPath.pop();
                let target = this;
                for (let node of keyPath) {
                    target = target[node];
                }
                target[lastNode] = settings[key];
            } catch (e) {}
        }
    }

    /**
     * Get port unique name
     * @param {chrome.runtime.Port} port 
     * @returns {string}
     */
    getPortName(port) {
        let tab = port.sender.tab;
        return `${port.name}-${tab.windowId}-${tab.id}`;
    }

    /**
     * On connect
     * @param {chrome.runtime.Port} port 
     */
    onConnect(port) {
        this._ports.set(this.getPortName(port), port);
        port.onMessage.addListener(message => this.onMessage(port, message));
        port.onDisconnect.addListener(port => this.onDisconnect(port));
    }

    /**
     * On disconnect
     * @param {chrome.runtime.Port} port 
     */
    onDisconnect(port) {
        this._ports.delete(this.getPortName(port));
    }

    /**
     * On receive message
     * @param {chrome.runtime.Port} port 
     * @param {any} message 
     */
    onMessage(port, message) {
        switch (message.type) {
            case 'syscall':
            let retVal = this[message.method].apply(this, message.args);
            port.postMessage({
                type: message.type,
                id: message.id,
                return: retVal
            });
            break;
        }
    }

    /**
     * Post message
     * @param {chrome.runtime.Port} port 
     * @param {any} message 
     */
    postMessage(port, message) {
        try {
            return port.postMessage(message);
        } catch (e) {
            return false;
        }
    }

    /**
     * Broadcast message
     * @param {any} message 
     */
    broadcast(message) {
        for (let port of this._ports.values()) {
            this.postMessage(port, message);
        }
    }

    /**
     * Ping test
     * @param {any} payload 
     * @returns {string}
     */
    ping(payload) {
        return {'pang': payload};
    }

    /**
     * Get status code
     * @return {number}
     */
    get status() {
        return this._status;
    }

    /**
     * Start handling task queue
     */
    start() {
        let originalState = this._status;
        if (originalState != this.STATE_STOPPED) return false;
        this._status = this.STATE_START_PENDING;
        this.dispatchEvent(new StateChangeEvent(originalState, this._status));
        this.logger.debug('Starting service...');
        if (this._continuation) {
            this._continuation();
        }
        return true;
    }

    /**
     * Stop handling task queue
     */
    stop() {
        let originalState = this._status;

        switch (originalState) {
            case this.STATE_RUNNING:
            this._status = this.STATE_STOP_PENDING;
            this.dispatchEvent(new StateChangeEvent(originalState, this._status));
            this.logger.debug('Stopping service...');    
            break;

            case this.STATE_START_PENDING:
            this._status = this.STATE_STOPPED;
            this.dispatchEvent(new StateChangeEvent(originalState, this._status));
            this.logger.debug('Service stopped.');
            break;

            default:
            return false;
        }
        return true;
    }

    /**
     * Create a job
     * @param  {...Object} tasks 
     */
    async createJob(...tasks) {
        this.logger.debug('Creating a job...');
        let job = new Job(this);
        for (let {name, args} of tasks) {
            try {
                let module = await import(`./tasks/${name}.js`);
                if (typeof args == 'undefined') {
                    args = [];
                }
                let task = new module.default(...args);
                job.addTask(task);
            } catch (e) {
                this.logger.error('Fail to create task:' + e);
            }
        }
        this._jobQueue.enqueue(job);
        return job;
    }

    /**
     * Continue the task
     */
    continue() {
        let executor, originalState = this._status;

        switch (originalState) {
            case this.STATE_RUNNING:
                return Promise.resolve();

            case this.STATE_START_PENDING:
                executor = resolve => {
                    this._status = this.STATE_RUNNING;
                    this.dispatchEvent(new StateChangeEvent(originalState, this._status));
                    this.logger.debug('Service started.');
                    resolve();
                };
                break;

            case this.STATE_STOP_PENDING:
                executor = resolve => {
                    this._status = this.STATE_STOPPED;
                    this.dispatchEvent(new StateChangeEvent(originalState, this._status));
                    this.logger.debug('Service stopped.');
                    this._continuation = resolve;
                };
                break;

            case this.STATE_STOPPED:
                executor = resolve => this._continuation = resolve;
        }

        return new Promise(executor);
    }

    /**
     * Get ready for running task
     */
    ready() {
        let originalState = this._status;
        switch (originalState) {
            case this.STATE_RUNNING:
                this._status = this.STATE_START_PENDING;
                this.dispatchEvent(new StateChangeEvent(originalState, this._status));
                this.logger.debug('Service is pending...');

            case this.STATE_START_PENDING:
                return Promise.resolve();
        }
        return this.continue();
    }

    /**
     * Get singleton instance
     * @returns {Service}
     */
    static get instance() {
        if (!Service._instance) {
            Service._instance = new Service();
        }
        return Service._instance;
    }

    /**
     * Startup service
     * @returns {Service}
     */
    static async startup() {
        const RUN_FOREVER = true;

        let service = Service.instance;
        let logger = service.logger;

        service.settings = await Settings.load(SERVICE_SETTINGS);
        logger.debug('Service settings loaded.');

        let browserMainVersion = (/Chrome\/([0-9]+)/.exec(navigator.userAgent)||[,0])[1];
        let extraOptions = (browserMainVersion >= 72) ? ['blocking', 'requestHeaders', 'extraHeaders'] : ['blocking', 'requestHeaders'];

        chrome.webRequest.onBeforeSendHeaders.addListener(details => {
            let overrideHeaderTag = 'X-Override-';
            for (let header of details.requestHeaders) {
                if (header.name.startsWith(overrideHeaderTag)) {
                    header.name = header.name.substr(overrideHeaderTag.length);
                }
            }
            return {requestHeaders: details.requestHeaders};
        }, {urls: ['http://*.douban.com/*', 'https://*.douban.com/*']}, extraOptions);
        let lastRequest = 0;
        let fetchURL = (resource, init) => {
            let promise = service.continue();
            let requestInterval = lastRequest + service.requestInterval - Date.now();
            if (requestInterval > 0) {
                promise = promise.then(() => {
                    return new Promise(resolve => {
                        setTimeout(resolve, requestInterval);
                    });
                });
            }
            return promise.then(() => {
                let url = Request.prototype.isPrototypeOf(resource) ? resource.url : resource.toString();
                lastRequest = Date.now();
                logger.debug(`Fetching ${url}...`, resource);
                return fetch(resource, init);
            });
        };

        let storage = new Storage();
        storage.logger = logger;
        await storage.open();
        let currentJob;
        while (RUN_FOREVER) {
            await service.ready();
            if (typeof currentJob == 'undefined') {
                logger.debug('Waiting for a job...');
                currentJob = await service._jobQueue.dequeue();
            }
            try {
                await service.continue();
                logger.debug('Performing job...');
                await currentJob.run(fetchURL, storage, logger);
                logger.debug('Job completed...');
                currentJob = undefined;
            } catch (e) {
                logger.error(e);
                service.stop();
            }
        }
        storage.close();
    }
}
