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

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

// ============================================
// ===== ANTI-BAN SYSTEM =====
// ============================================

class AntiBanSystem {
    constructor() {
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
            }
        ];

        this.conversations = new Map();
        this.activityLog = [];
    }

    getDeviceFingerprint() {
        const fp = this.deviceFingerprints[Math.floor(Math.random() * this.deviceFingerprints.length)];
        return {
            ...fp,
            browserVersion: `${Math.floor(Math.random() * 50) + 100}.0.${Math.floor(Math.random() * 5000)}.${Math.floor(Math.random() * 100)}`
        };
    }

    async humanDelay(type = 'typing') {
        const delays = {
            typing: 800 + Math.random() * 3500,
            reading: 1500 + Math.random() * 5000,
            reaction: 300 + Math.random() * 1200,
            send: 500 + Math.random() * 2500
        };
        const delay = delays[type] || 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
    }

    addTypo(text) {
        if (Math.random() > 0.03) return text;
        const chars = text.split('');
        const typoMap = {
            'e': ['3', 'r', 'w'],
            'a': ['q', 's', 'z'],
            'i': ['u', 'o', 'p'],
            'o': ['i', 'p', 'l'],
            't': ['r', 'g', 'y']
        };
        for (let i = 0; i < chars.length; i++) {
            if (Math.random() < 0.02 && typoMap[chars[i].toLowerCase()]) {
                const typos = typoMap[chars[i].toLowerCase()];
                chars[i] = typos[Math.floor(Math.random() * typos.length)];
                break;
            }
        }
        return chars.join('');
    }

    trackConversation(jid, message) {
        if (!this.conversations.has(jid)) {
            this.conversations.set(jid, { messages: [], count: 0 });
        }
        const conv = this.conversations.get(jid);
        conv.messages.push({ text: message, time: Date.now() });
        conv.count++;
        if (conv.messages.length > 50) conv.messages.shift();
    }

    getKeepAliveInterval() {
        return 15000 + Math.random() * 10000;
    }
}

// ============================================
// ===== RATE LIMITER =====
// ============================================

class RateLimiter {
    constructor() {
        this.limits = {
            minute: { count: 0, reset: Date.now(), max: 6 },
            hour: { count: 0, reset: Date.now(), max: 30 },
            groups: { count: 0, reset: Date.now(), max: 3 }
        };
        this.locked = false;
        this.lockUntil = 0;
    }

    canSend(type = 'message') {
        const now = Date.now();
        
        if (this.locked && now < this.lockUntil) {
            return false;
        }
        
        ['minute', 'hour', 'groups'].forEach(key => {
            const limit = this.limits[key];
            const resetTime = key === 'minute' ? 60000 : key === 'hour' ? 3600000 : 3600000;
            if (now - limit.reset > resetTime) {
                limit.count = 0;
                limit.reset = now;
            }
        });

        const limit = this.limits[type === 'group' ? 'groups' : 'minute'];
        if (limit.count >= limit.max) {
            this.lock(30000);
            return false;
        }

        limit.count++;
        this.limits.hour.count++;
        return true;
    }

    lock(duration) {
        this.locked = true;
        this.lockUntil = Date.now() + duration;
        setTimeout(() => { this.locked = false; }, duration);
    }

    getStatus() {
        return {
            minute: `${this.limits.minute.count}/${this.limits.minute.max}`,
            hour: `${this.limits.hour.count}/${this.limits.hour.max}`,
            groups: `${this.limits.groups.count}/${this.limits.groups.max}`,
            locked: this.locked
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
        
        const fingerprint = antiBan.getDeviceFingerprint();

        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: antiBan.getKeepAliveInterval(),
            syncFullHistory: false,
            markOnlineOnConnect: true,
            browser: [
                `WhatsApp Bot ${fingerprint.appVersion}`,
                fingerprint.platform,
                fingerprint.browserVersion
            ]
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", (update) => {
            const { connection, lastDisconnect } = update;

            if (connection === "open") {
                console.log(`✅ ${userNumber} Connected`);
                activeUsers.add(userNumber);
            }

            if (connection === "close") {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                activeUsers.delete(userNumber);
                
                if (statusCode !== 401) {
                    console.log(`♻ Reconnecting ${userNumber}...`);
                    setTimeout(() => startBot(userNumber), 5000 + Math.random() * 3000);
                } else {
                    console.log(`❌ Authentication failed for ${userNumber}. Need to re-pair.`);
                }
            }
        });

        if (!sock.authState.creds.registered) {
            try {
                const code = await sock.requestPairingCode(userNumber);
                console.log(`\n🔑 PAIRING CODE for ${userNumber}: ${code}`);
                console.log(`📱 Ask ${userNumber} to go to WhatsApp → Linked Devices → Link with code\n`);
            } catch (e) {
                console.log(`❌ Pairing error: ${e.message}`);
            }
        }

        sock.ev.on("group-participants.update", async (data) => {
            try {
                if (!rateLimiter.canSend('group')) return;

                if (data.action === "add") {
                    for (let user of data.participants) {
                        await antiBan.humanDelay('reading');
                        let text = antiBan.addTypo(`👋 Welcome @${user.split("@")[0]}`);
                        await sock.sendMessage(data.id, { text, mentions: [user] });
                        await antiBan.humanDelay('send');
                    }
                }

                if (data.action === "remove") {
                    for (let user of data.participants) {
                        await antiBan.humanDelay('reaction');
                        let text = antiBan.addTypo(`😢 Goodbye @${user.split("@")[0]}`);
                        await sock.sendMessage(data.id, { text, mentions: [user] });
                    }
                }
            } catch (error) {}
        });

        sock.ev.on("messages.upsert", async ({ messages }) => {
            const msg = messages?.[0];
            if (!msg?.message) return;
            if (msg.key.fromMe) return;

            const jid = msg.key.remoteJid;
            
            const message = msg.message;
            let text =
                message?.conversation ||
                message?.extendedTextMessage?.text ||
                "";

            text = text.trim();
            const command = text.toLowerCase();

            console.log(`📨 ${userNumber}: ${text}`);

            try {
                if (!rateLimiter.canSend('message')) return;

                await antiBan.humanDelay('typing');
                await sock.sendPresenceUpdate("composing", jid);
                await antiBan.humanDelay('reading');

                if (command === ".menu") {
                    await sock.sendMessage(jid, {
                        text: `╭───❍ VELDRIX BOT
│
├── 📋 COMMANDS
│   ├ .menu - Show menu
│   ├ .ping - Test bot
│   ├ .owner - Bot owner
│   ├ .status - Bot status
│   ├ .groupinfo - Group info
│   └ .tagall - Tag members
│
├── 🛡️ ANTI-BAN
│   ├ Human-like behavior
│   ├ Rate limiting
│   └ Random delays
│
╰──────────`
                    });
                }

                if (command === ".ping") {
                    await sock.sendMessage(jid, { 
                        text: `🏓 Pong!\n⏱️ ${Math.round(Date.now() - msg.messageTimestamp * 1000)}ms` 
                    });
                }

                if (command === ".owner") {
                    await sock.sendMessage(jid, {
                        text: `👑 Bot Owner: Veldrix\n📱 Connected to: ${userNumber}\n🛡️ Anti-Ban: Active`
                    });
                }

                if (command === ".status") {
                    const totalUsers = activeUsers.size;
                    const uptime = process.uptime();
                    const hours = Math.floor(uptime / 3600);
                    const minutes = Math.floor((uptime % 3600) / 60);
                    const status = rateLimiter.getStatus();
                    
                    await sock.sendMessage(jid, {
                        text: `📊 BOT STATUS
├ Active Users: ${totalUsers}
├ Uptime: ${hours}h ${minutes}m
├─────────────────
├ 📊 RATE LIMITS
│  ├ Minute: ${status.minute}
│  ├ Hour: ${status.hour}
│  └ Groups: ${status.groups}
└ 🔒 Locked: ${status.locked ? 'Yes' : 'No'}`
                    });
                }

                if (command === ".groupinfo") {
                    if (!jid.endsWith("@g.us")) {
                        await sock.sendMessage(jid, { text: "❌ This command only works in groups!" });
                        return;
                    }
                    
                    const meta = await sock.groupMetadata(jid);
                    await sock.sendMessage(jid, {
                        text: `📌 GROUP INFO
├ Name: ${meta.subject}
├ Members: ${meta.participants.length}
├ Admins: ${meta.participants.filter(p => p.admin).length}
└ Owner: ${meta.owner ? meta.owner.split("@")[0] : "Unknown"}`
                    });
                }

                if (command === ".tagall") {
                    if (!jid.endsWith("@g.us")) {
                        await sock.sendMessage(jid, { text: "❌ This command only works in groups!" });
                        return;
                    }
                    
                    const meta = await sock.groupMetadata(jid);
                    const mentions = meta.participants.map(p => p.id);

                    if (mentions.length > 30) {
                        await sock.sendMessage(jid, {
                            text: `⚠️ Group has ${mentions.length} members. Max 15 tags allowed.`
                        });
                        return;
                    }

                    let tagText = "📢 TAG ALL\n\n";
                    const shuffled = mentions.sort(() => Math.random() - 0.5).slice(0, 15);
                    for (let m of shuffled) {
                        tagText += `@${m.split("@")[0]}\n`;
                    }

                    await sock.sendMessage(jid, {
                        text: tagText,
                        mentions: shuffled
                    });
                }

            } catch (error) {
                console.log(`❌ Error: ${error.message}`);
            }
        });

        sessions.set(userNumber, sock);
        console.log(`✅ ${userNumber} bot started!`);
        
    } catch (error) {
        console.log(`❌ Error starting bot: ${error.message}`);
    }
}

// ============================================
// ===== MAIN MENU =====
// ============================================

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("🛡️ VELDRIX BOT - Advanced Anti-Ban");
console.log("=========================================");
console.log("📌 Features:");
console.log("  • Advanced anti-ban protection");
console.log("  • Human-like behavior patterns");
console.log("  • Random device fingerprints");
console.log("  • Smart rate limiting");
console.log("  • Auto-activity simulation");
console.log("=========================================\n");

function showMenu() {
    console.log("\n📋 Options:");
    console.log("  1. Add new user");
    console.log("  2. Show active users");
    console.log("  3. Remove user");
    console.log("  4. Show rate limit status");
    console.log("  5. Exit");
    console.log("=========================================");
}

function askForUser() {
    showMenu();
    
    rl.question("\nChoose option (1-5): ", async (choice) => {
        if (choice === '1') {
            rl.question("📱 Enter phone number (255xxxxxxxxx): ", async (number) => {
                number = number.replace(/[^0-9]/g, '');
                
                if (!number || number.length < 5) {
                    console.log("❌ Invalid number!");
                    askForUser();
                    return;
                }

                if (sessions.has(number)) {
                    console.log(`ℹ️ ${number} is already connected`);
                    askForUser();
                    return;
                }

                console.log(`🔄 Connecting ${number}...`);
                await startBot(number);
                console.log(`✅ ${number} added! Check their WhatsApp for pairing code`);
                setTimeout(askForUser, 2000);
            });
            return;
        }

        if (choice === '2') {
            console.log("\n👥 Active Users:");
            if (activeUsers.size === 0) {
                console.log("  No active users");
            } else {
                activeUsers.forEach(user => {
                    console.log(`  • ${user}`);
                });
            }
            console.log(`\nTotal: ${activeUsers.size} users`);
            setTimeout(askForUser, 2000);
            return;
        }

        if (choice === '3') {
            rl.question("📱 Enter number to remove: ", async (number) => {
                number = number.replace(/[^0-9]/g, '');
                
                if (sessions.has(number)) {
                    sessions.delete(number);
                    activeUsers.delete(number);
                    console.log(`✅ ${number} removed`);
                } else {
                    console.log(`❌ ${number} not found`);
                }
                setTimeout(askForUser, 2000);
            });
            return;
        }

        if (choice === '4') {
            const status = rateLimiter.getStatus();
            console.log("\n📊 Rate Limit Status:");
            console.log(`  • Per Minute: ${status.minute}`);
            console.log(`  • Per Hour: ${status.hour}`);
            console.log(`  • Groups: ${status.groups}`);
            console.log(`  • Locked: ${status.locked ? 'Yes' : 'No'}`);
            setTimeout(askForUser, 2000);
            return;
        }

        if (choice === '5') {
            console.log("👋 Goodbye!");
            rl.close();
            process.exit(0);
        }

        console.log("❌ Invalid option!");
        setTimeout(askForUser, 1000);
    });
}

askForUser();

process.on('SIGINT', () => {
    console.log("\n\n👋 Shutting down...");
    rl.close();
    process.exit(0);
});
