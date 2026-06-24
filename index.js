#!/usr/bin/env node

// ===== SUPPRESS WARNINGS =====
process.env.NODE_NO_WARNINGS = '1';
process.env.NODE_ENV = 'production';

process.on('unhandledRejection', (err) => {});
process.on('warning', (warning) => {
    if (warning.name === 'DeprecationWarning') return;
});

// ===== IMPORTS =====
const readline = require("readline");
const pino = require("pino");
const fs = require("fs");
const crypto = require("crypto");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    makeInMemoryStore
} = require("@whiskeysockets/baileys");

// ============================================
// ===== ADVANCED ANTI-BAN CONFIGURATION =====
// ============================================

class AntiBanSystem {
    constructor() {
        // Random device fingerprints
        this.deviceFingerprints = [
            {
                appVersion: '2.24.8.78',
                os: 'Android',
                device: 'SM-G998B',
                platform: 'chrome',
                browserVersion: '120.0.6099.230'
            },
            {
                appVersion: '2.24.9.80',
                os: 'iOS',
                device: 'iPhone14,2',
                platform: 'safari',
                browserVersion: '16.5.1'
            },
            {
                appVersion: '2.24.7.75',
                os: 'Android',
                device: 'Pixel 6 Pro',
                platform: 'chrome',
                browserVersion: '119.0.6045.163'
            },
            {
                appVersion: '2.24.10.82',
                os: 'Windows',
                device: 'Windows 11',
                platform: 'firefox',
                browserVersion: '121.0.1'
            },
            {
                appVersion: '2.24.6.73',
                os: 'Android',
                device: 'OnePlus 9 Pro',
                platform: 'chrome',
                browserVersion: '118.0.5993.89'
            }
        ];

        // Human behavior patterns
        this.humanBehavior = {
            // Typing speeds in ms
            typingSpeed: () => 800 + Math.random() * 3500,
            // Reading time before reply
            readingTime: () => 1500 + Math.random() * 5000,
            // Reaction delay
            reactionDelay: () => 300 + Math.random() * 1200,
            // Send delay between messages
            sendDelay: () => 500 + Math.random() * 2500,
            // Break between conversations
            breakTime: () => 30000 + Math.random() * 90000,
            // Typing indicator duration
            typingDuration: () => 2000 + Math.random() * 3000
        };

        // Rate limits (safe limits to avoid ban)
        this.rateLimits = {
            messagesPerMinute: 6,
            messagesPerHour: 30,
            messagesPerDay: 200,
            groupsPerHour: 3,
            newChatsPerHour: 5,
            tagAllLimit: 30
        };

        // Conversation context
        this.conversations = new Map();
        this.messageHistory = new Map();
        this.activityLog = [];
    }

    // Get random device fingerprint
    getDeviceFingerprint() {
        const fp = this.deviceFingerprints[Math.floor(Math.random() * this.deviceFingerprints.length)];
        return {
            ...fp,
            // Add some randomness
            browserVersion: `${Math.floor(Math.random() * 50) + 100}.0.${Math.floor(Math.random() * 5000)}.${Math.floor(Math.random() * 100)}`
        };
    }

    // Human-like delay
    async humanDelay(type = 'typing') {
        const delayMap = {
            typing: this.humanBehavior.typingSpeed,
            reading: this.humanBehavior.readingTime,
            reaction: this.humanBehavior.reactionDelay,
            send: this.humanBehavior.sendDelay,
            break: this.humanBehavior.breakTime
        };
        
        const delay = delayMap[type] ? delayMap[type]() : 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Check if we should add random typos
    shouldAddTypo() {
        return Math.random() < 0.03; // 3% chance
    }

    // Add realistic typos to text
    addTypo(text) {
        if (!this.shouldAddTypo()) return text;
        
        const typoMap = {
            'e': ['3', 'r', 'w'],
            'a': ['q', 's', 'z'],
            'i': ['u', 'o', 'p'],
            'o': ['i', 'p', 'l'],
            't': ['r', 'g', 'y'],
            'n': ['b', 'm', 'h'],
            's': ['a', 'd', 'z'],
            'h': ['j', 'g', 'n']
        };
        
        const chars = text.split('');
        for (let i = 0; i < chars.length; i++) {
            if (Math.random() < 0.02 && typoMap[chars[i].toLowerCase()]) {
                const typos = typoMap[chars[i].toLowerCase()];
                chars[i] = typos[Math.floor(Math.random() * typos.length)];
                break;
            }
        }
        
        // Sometimes add an extra space or punctuation
        if (Math.random() < 0.01) {
            chars.push(['!', '?', '.', ',', ' '][Math.floor(Math.random() * 5)]);
        }
        
        return chars.join('');
    }

    // Track conversation
    trackConversation(jid, message) {
        if (!this.conversations.has(jid)) {
            this.conversations.set(jid, {
                messages: [],
                lastActivity: Date.now(),
                count: 0
            });
        }
        
        const conv = this.conversations.get(jid);
        conv.messages.push({
            text: message,
            time: Date.now()
        });
        conv.lastActivity = Date.now();
        conv.count++;
        
        // Keep only last 50 messages
        if (conv.messages.length > 50) {
            conv.messages.shift();
        }
    }

    // Get conversation context
    getConversationContext(jid) {
        return this.conversations.get(jid) || { messages: [], count: 0 };
    }

    // Generate random activity
    generateActivity() {
        const activities = ['typing', 'paused', 'recording', 'reading'];
        return activities[Math.floor(Math.random() * activities.length)];
    }

    // Random keep-alive interval
    getKeepAliveInterval() {
        return 15000 + Math.random() * 10000;
    }

    // Check if we should take a break
    shouldTakeBreak() {
        return Math.random() < 0.05; // 5% chance
    }

    // Get break duration
    getBreakDuration() {
        return 60000 + Math.random() * 180000; // 1-4 minutes
    }

    // Log activity
    logActivity(type, data) {
        this.activityLog.push({
            type,
            data,
            time: Date.now()
        });
        
        // Keep only last 100 entries
        if (this.activityLog.length > 100) {
            this.activityLog.shift();
        }
    }

    // Get status
    getStatus() {
        return {
            activeConversations: this.conversations.size,
            totalMessages: Array.from(this.conversations.values()).reduce((sum, c) => sum + c.count, 0),
            deviceFingerprints: this.deviceFingerprints.length,
            activityLog: this.activityLog.length
        };
    }
}

// ============================================
// ===== RATE LIMITING SYSTEM =====
// ============================================

class RateLimiter {
    constructor() {
        this.limits = {
            minute: { count: 0, reset: Date.now(), max: 6 },
            hour: { count: 0, reset: Date.now(), max: 30 },
            day: { count: 0, reset: Date.now(), max: 200 },
            groups: { count: 0, reset: Date.now(), max: 3 }
        };
        this.locked = false;
        this.lockUntil = 0;
    }

    canSend(type = 'message') {
        const now = Date.now();
        
        // Check if locked
        if (this.locked && now < this.lockUntil) {
            console.log(`🔒 Rate limiter locked for ${Math.ceil((this.lockUntil - now) / 1000)}s`);
            return false;
        }
        
        // Reset counters
        ['minute', 'hour', 'day', 'groups'].forEach(key => {
            const limit = this.limits[key];
            const resetTime = key === 'minute' ? 60000 : 
                             key === 'hour' ? 3600000 : 
                             key === 'day' ? 86400000 : 3600000;
            
            if (now - limit.reset > resetTime) {
                limit.count = 0;
                limit.reset = now;
            }
        });

        const limit = this.limits[type === 'group' ? 'groups' : 'minute'];
        const hourLimit = this.limits.hour;

        if (limit.count >= limit.max) {
            console.log(`⏳ Rate limit: Too many ${type}s per minute`);
            this.lock(30000); // Lock for 30 seconds
            return false;
        }

        if (hourLimit.count >= hourLimit.max) {
            console.log(`⏳ Rate limit: Too many ${type}s per hour`);
            this.lock(300000); // Lock for 5 minutes
            return false;
        }

        limit.count++;
        hourLimit.count++;
        return true;
    }

    lock(duration) {
        this.locked = true;
        this.lockUntil = Date.now() + duration;
        setTimeout(() => {
            this.locked = false;
        }, duration);
    }

    getStatus() {
        return {
            minute: `${this.limits.minute.count}/${this.limits.minute.max}`,
            hour: `${this.limits.hour.count}/${this.limits.hour.max}`,
            day: `${this.limits.day.count}/${this.limits.day.max}`,
            groups: `${this.limits.groups.count}/${this.limits.groups.max}`,
            locked: this.locked,
            lockRemaining: this.locked ? Math.max(0, Math.ceil((this.lockUntil - Date.now()) / 1000)) : 0
        };
    }
}

// ============================================
// ===== BOT STATE =====
// ============================================

const antiBan = new AntiBanSystem();
const rateLimiter = new RateLimiter();
const sessions = new Map();
const activeUsers = new Set();
const store = makeInMemoryStore({});

// ============================================
// ===== START BOT =====
// ============================================

async function startBot(userNumber) {
    try {
        console.log(`🔄 Starting bot for ${userNumber}...`);
        
        const sessionDir = `./session_${userNumber}`;
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
        const { version } = await fetchLatestBaileysVersion();
        
        // Get random device fingerprint
        const fingerprint = antiBan.getDeviceFingerprint();

        // ===== CREATE SOCKET WITH ANTI-BAN FEATURES =====
        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ 
                level: 'silent',
                stream: { write: () => {} }
            }),
            printQRInTerminal: false,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: antiBan.getKeepAliveInterval(),
            syncFullHistory: false,
            markOnlineOnConnect: true,
            // Randomize browser
            browser: [
                `WhatsApp Bot ${fingerprint.appVersion}`,
                fingerprint.platform,
                fingerprint.browserVersion
            ],
            // Random user agent
            userAgent: `Mozilla/5.0 (${fingerprint.os}; ${fingerprint.device}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${fingerprint.browserVersion} Safari/537.36`,
            // Padding for more randomness
            generateHighQualityLinkPreview: false,
            // Better reconnection handling
            patchMessageBeforeSending: (message) => {
                // Add small delay before sending
                return new Promise(resolve => {
                    setTimeout(() => resolve(message), Math.random() * 200);
                });
            }
        });

        // Bind store
        store.bind(sock.ev);

        // ===== CREDENTIALS UPDATE =====
        sock.ev.on("creds.update", saveCreds);

        // ===== CONNECTION =====
        sock.ev.on("connection.update", (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log(`✅ ${userNumber} Connected`);
                activeUsers.add(userNumber);
                antiBan.logActivity('connection', { user: userNumber, status: 'open' });
            }

            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                activeUsers.delete(userNumber);
                antiBan.logActivity('connection', { user: userNumber, status: 'close', code: statusCode });
                
                if (statusCode !== 401) {
                    console.log(`♻ Reconnecting ${userNumber} in 5 seconds...`);
                    setTimeout(() => startBot(userNumber), 5000 + Math.random() * 3000);
                } else {
                    console.log(`❌ Authentication failed for ${userNumber}. Need to re-pair.`);
                }
            }
        });

        // ===== PAIRING CODE =====
        if (!sock.authState.creds.registered) {
            try {
                await antiBan.humanDelay('typing');
                const code = await sock.requestPairingCode(userNumber);
                console.log(`\n🔑 PAIRING CODE for ${userNumber}: ${code}`);
                console.log(`📱 Ask ${userNumber} to go to WhatsApp → Linked Devices → Link with code\n`);
                antiBan.logActivity('pairing', { user: userNumber, code });
            } catch (e) {
                console.log(`❌ Pairing error for ${userNumber}: ${e.message}`);
            }
        }

        // ============================================
        // ===== GROUP PARTICIPANTS =====
        // ============================================
        
        sock.ev.on("group-participants.update", async (data) => {
            try {
                // Rate limit check for group actions
                if (!rateLimiter.canSend('group')) return;

                if (data.action === "add") {
                    for (let user of data.participants) {
                        // Human-like delay
                        await antiBan.humanDelay('reading');
                        
                        // Generate welcome message with possible typo
                        let welcomeText = `👋 Welcome @${user.split("@")[0]}`;
                        welcomeText = antiBan.addTypo(welcomeText);
                        
                        await sock.sendMessage(data.id, {
                            text: welcomeText,
                            mentions: [user]
                        });
                        
                        // Small delay between welcomes
                        await antiBan.humanDelay('send');
                    }
                }

                if (data.action === "remove") {
                    for (let user of data.participants) {
                        await antiBan.humanDelay('reaction');
                        
                        let goodbyeText = `😢 Goodbye @${user.split("@")[0]}`;
                        goodbyeText = antiBan.addTypo(goodbyeText);
                        
                        await sock.sendMessage(data.id, {
                            text: goodbyeText,
                            mentions: [user]
                        });
                    }
                }
            } catch (error) {
                // Silent fail
            }
        });

        // ============================================
        // ===== MESSAGE HANDLER =====
        // ============================================
        
        sock.ev.on("messages.upsert", async ({ messages }) => {
            const msg = messages?.[0];
            if (!msg?.message) return;
            if (msg.key.fromMe) return;

            const jid = msg.key.remoteJid;
            
            // ===== SAFE TEXT EXTRACTOR =====
            const message = msg.message;
            let text =
                message?.conversation ||
                message?.extendedTextMessage?.text ||
                message?.imageMessage?.caption ||
                message?.videoMessage?.caption ||
                message?.documentMessage?.caption ||
                message?.buttonsResponseMessage?.selectedButtonId ||
                message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
                "";

            // Clean text
            text = text.trim();
            const command = text.toLowerCase();

            console.log(`📨 ${userNumber}: ${text}`);

            try {
                // ===== RATE LIMIT CHECK =====
                if (!rateLimiter.canSend('message')) {
                    console.log('⏳ Rate limit reached, waiting...');
                    return;
                }

                // ===== HUMAN BEHAVIOR =====
                // Random typing indicator
                if (Math.random() < 0.7) {
                    await sock.sendPresenceUpdate("composing", jid);
                    await antiBan.humanDelay('typing');
                }
                
                // Random reading time
                await antiBan.humanDelay('reading');
                
                // Random reaction
                if (Math.random() < 0.3) {
                    await antiBan.humanDelay('reaction');
                    await sock.sendMessage(jid, {
                        react: {
                            text: ["⚡", "👍", "👀", "✨", "🔥"][Math.floor(Math.random() * 5)],
                            key: msg.key
                        }
                    });
                }

                // ===== CONVERSATION TRACKING =====
                antiBan.trackConversation(jid, text);

                // ===== COMMANDS =====
                if (command === ".menu" || command === "/menu") {
                    await antiBan.humanDelay('send');
                    await sock.sendMessage(jid, {
                        text:
`╭───❍ VELDRIX BOT
│
├── 📋 COMMANDS
│   ├ .menu  - Show this menu
│   ├ .ping  - Test bot
│   ├ .owner - Bot owner
│   ├ .status- Bot status
│   ├ .groupinfo - Group info
│   └ .tagall - Tag all members
│
├── 🛡️ ANTI-BAN
│   ├ Human-like behavior
│   ├ Rate limiting
│   ├ Random delays
│   └ Device rotation
│
╰──────────`
                    });
                }

                if (command === ".ping" || command === "/ping") {
                    await sock.sendMessage(jid, { 
                        text: `🏓 Pong!\n⏱️ ${Math.round(Date.now() - msg.messageTimestamp * 1000)}ms` 
                    });
                }

                if (command === ".owner" || command === "/owner") {
                    await sock.sendMessage(jid, {
                        text: `👑 Bot Owner: Veldrix\n📱 Connected to: ${userNumber}\n🛡️ Anti-Ban: Active`
                    });
                }

                // ===== STATUS =====
                if (command === ".status" || command === "/status") {
                    const totalUsers = activeUsers.size;
                    const uptime = process.uptime();
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    
                    const rateStatus = rateLimiter.getStatus();
                    const antiBanStatus = antiBan.getStatus();
                    
                    await sock.sendMessage(jid, {
                        text:
`📊 BOT STATUS
├ Active Users: ${totalUsers}
├ Uptime: ${hours}h ${minutes}m
├─────────────────
├ 🛡️ ANTI-BAN
│  ├ Conversations: ${antiBanStatus.activeConversations}
│  ├ Total Messages: ${antiBanStatus.totalMessages}
│  └ Devices: ${antiBanStatus.deviceFingerprints}
├─────────────────
├ 📊 RATE LIMITS
│  ├ Minute: ${rateStatus.minute}
│  ├ Hour: $
