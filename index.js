const readline = require("readline");
const pino = require("pino");

// ===== ANTI-BAN WRAPPER =====
const { wrapSocketWithFingerprint } = require('baileys-antiban');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");

// ===== RATE LIMITING SYSTEM =====
const rateLimits = {
    messagesPerMinute: 0,
    messagesPerHour: 0,
    lastMinuteReset: Date.now(),
    lastHourReset: Date.now(),
    maxPerMinute: 8,
    maxPerHour: 40
};

function canSendMessage() {
    const now = Date.now();
    
    // Reset minute counter
    if (now - rateLimits.lastMinuteReset > 60000) {
        rateLimits.messagesPerMinute = 0;
        rateLimits.lastMinuteReset = now;
    }
    
    // Reset hour counter
    if (now - rateLimits.lastHourReset > 3600000) {
        rateLimits.messagesPerHour = 0;
        rateLimits.lastHourReset = now;
    }
    
    if (rateLimits.messagesPerMinute >= rateLimits.maxPerMinute) {
        console.log("⏳ Rate limit: Too many messages per minute");
        return false;
    }
    
    if (rateLimits.messagesPerHour >= rateLimits.maxPerHour) {
        console.log("⏳ Rate limit: Too many messages per hour");
        return false;
    }
    
    rateLimits.messagesPerMinute++;
    rateLimits.messagesPerHour++;
    return true;
}

// ===== HUMAN-LIKE DELAYS =====
function getHumanDelay(min = 800, max = 3000) {
    return min + Math.random() * (max - min);
}

function getTypingDelay() {
    return 1500 + Math.random() * 2000;
}

// ===== SESSION MANAGEMENT =====
const sessions = new Map();
const activeUsers = new Set();

// ===== USER MANAGEMENT =====
async function startBot(userNumber) {
    const sessionDir = `./session_${userNumber}`;

    const { state, saveCreds } = 
        await useMultiFileAuthState(sessionDir);

    const { version } = 
        await fetchLatestBaileysVersion();

    // ===== WRAP WITH ANTI-BAN PROTECTION =====
    const sock = wrapSocketWithFingerprint(
        makeWASocket,
        {
            version,
            auth: state,
            logger: pino({ level: "silent" }),
            printQRInTerminal: false,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 15000 + Math.random() * 5000 // Randomize keep-alive
        },
        { 
            preset: 'moderate',
            // Enable all anti-ban features
            entropy: true,
            legitimacy: true,
            adaptiveRateLimit: true
        }
    );

    sock.ev.on("creds.update", saveCreds);

    // ===== CONNECTION =====
    sock.ev.on("connection.update", (update) => {
        const { connection } = update;

        if (connection === "open") {
            console.log(`✅ ${userNumber} Connected`);
            activeUsers.add(userNumber);
        }

        if (connection === "close") {
            console.log(`♻ ${userNumber} Reconnecting...`);
            activeUsers.delete(userNumber);
            setTimeout(() => startBot(userNumber), 5000);
        }
    });

    // ===== PAIRING CODE =====
    if (!sock.authState.creds.registered) {
        try {
            const code = await sock.requestPairingCode(userNumber);
            console.log(`\n🔑 PAIRING CODE for ${userNumber}:`, code);
            console.log(`📱 Ask ${userNumber} to go to WhatsApp → Linked Devices → Link with code\n`);
        } catch (e) {
            console.log(`❌ Error for ${userNumber}:`, e);
        }
    }

    // ===== GROUP WELCOME/GODBYE =====
    sock.ev.on("group-participants.update", async (data) => {

        try {
            if (data.action === "add") {
                for (let user of data.participants) {
                    // Human-like delay before welcome
                    await new Promise(resolve => setTimeout(resolve, getHumanDelay(2000, 5000)));
                    
                    await sock.sendMessage(data.id, {
                        text: `👋 Welcome @${user.split("@")[0]}`,
                        mentions: [user]
                    });
                    
                    // Rate limit check
                    if (!canSendMessage()) {
                        console.log("⏳ Rate limit hit - pausing...");
                        await new Promise(resolve => setTimeout(resolve, 30000));
                    }
                }
            }

            if (data.action === "remove") {
                for (let user of data.participants) {
                    await sock.sendMessage(data.id, {
                        text: `😢 Goodbye @${user.split("@")[0]}`,
                        mentions: [user]
                    });
                }
            }

        } catch (error) {
            console.log("Group update error:", error);
        }
    });

    // ===== MESSAGE HANDLER =====
    sock.ev.on("messages.upsert", async ({ messages }) => {

        const msg = messages?.[0];
        if (!msg?.message) return;
        if (msg.key.fromMe) return;

        const jid = msg.key.remoteJid;

        // ===== SAFE TEXT EXTRACTOR =====
        const message = msg.message;

        const text =
            message?.conversation ||
            message?.extendedTextMessage?.text ||
            message?.imageMessage?.caption ||
            message?.videoMessage?.caption ||
            message?.documentMessage?.caption ||
            message?.buttonsResponseMessage?.selectedButtonId ||
            message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
            "";

        const command = text.trim().toLowerCase();

        console.log(`📨 ${userNumber} MSG:`, command);

        try {

            // ===== ANTI-SPAM: Check rate limit =====
            if (!canSendMessage()) {
                console.log("⏳ Rate limit hit - delaying response...");
                await new Promise(resolve => setTimeout(resolve, 30000));
                return;
            }

            // ===== AUTO REACTION (with human delay) =====
            await new Promise(resolve => setTimeout(resolve, getHumanDelay(300, 800)));
            await sock.sendMessage(jid, {
                react: {
                    text: "⚡",
                    key: msg.key
                }
            });

            // ===== TYPING INDICATOR (human-like) =====
            await sock.sendPresenceUpdate("composing", jid);
            await new Promise(resolve => setTimeout(resolve, getTypingDelay()));

            // ===== COMMANDS =====

            if (command === ".menu") {
                await sock.sendMessage(jid, {
                    text:
`╭───❍ VELDRIX BOT
├ .menu
├ .ping
├ .owner
├ .tagall
├ .groupinfo
├ .status
╰──────────`
                });
            }

            if (command === ".ping") {
                await sock.sendMessage(jid, { text: "🏓 Pong!" });
            }

            if (command === ".owner") {
                await sock.sendMessage(jid, {
                    text: `👑 Bot Owner: Veldrix\n📱 Connected to: ${userNumber}`
                });
            }

            // ===== STATUS COMMAND =====
            if (command === ".status") {
                const totalUsers = activeUsers.size;
                const uptime = process.uptime();
                const hours = Math.floor(uptime / 3600);
                const minutes = Math.floor((uptime % 3600) / 60);
                
                await sock.sendMessage(jid, {
                    text:
`📊 BOT STATUS
├ Active Users: ${totalUsers}
├ Uptime: ${hours}h ${minutes}m
├ Rate Limit: ${rateLimits.messagesPerMinute}/${rateLimits.maxPerMinute} min
└ ${rateLimits.messagesPerHour}/${rateLimits.maxPerHour} hour`
                });
            }

            // ===== GROUP INFO =====
            if (command === ".groupinfo") {

                if (!jid.endsWith("@g.us")) return;

                const meta = await sock.groupMetadata(jid);

                await sock.sendMessage(jid, {
                    text:
`📌 ${meta.subject}
👥 Members: ${meta.participants.length}
👑 Owner: ${meta.owner ? meta.owner.split("@")[0] : "Unknown"}`
                });
            }

            // ===== TAG ALL =====
            if (command === ".tagall") {

                if (!jid.endsWith("@g.us")) return;

                const meta = await sock.groupMetadata(jid);

                const mentions = meta.participants.map(p => p.id);

                let text = "📢 TAG ALL\n\n";

                for (let m of mentions) {
                    text += `@${m.split("@")[0]}\n`;
                }

                // Anti-spam: Check if group is large
                if (mentions.length > 50) {
                    await sock.sendMessage(jid, {
                        text: "⚠️ Group has more than 50 members. Tagging all might trigger spam detection.",
                    });
                    return;
                }

                await sock.sendMessage(jid, {
                    text,
                    mentions
                });
            }

        } catch (error) {
            console.log(`${userNumber} ERROR:`, error);
        }
    });

    // Store the socket
    sessions.set(userNumber, sock);
}

// ===== MAIN MENU =====
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("🤖 VELDRIX BOT - Multi-User + Anti-Spam");
console.log("=========================================");
console.log("📌 Features:");
console.log("  • Anti-ban protection");
console.log("  • Rate limiting (8/min, 40/hr)");
console.log("  • Human-like delays");
console.log("  • Multi-user support");
console.log("  • Auto-reactions");
console.log("  • Group welcome/goodbye");
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
            console.log("\n📊 Rate Limit Status:");
            console.log(`  • Current minute: ${rateLimits.messagesPerMinute}/${rateLimits.maxPerMinute}`);
            console.log(`  • Current hour: ${rateLimits.messagesPerHour}/${rateLimits.maxPerHour}`);
            console.log(`  • Active sessions: ${sessions.size}`);
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

// ===== START THE BOT =====
askForUser();

// ===== GRACEFUL SHUTDOWN =====
process.on('SIGINT', () => {
    console.log("\n\n👋 Shutting down...");
    rl.close();
    process.exit(0);
});
