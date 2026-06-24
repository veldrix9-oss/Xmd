const readline = require("readline");
const pino = require("pino");

const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeInMemoryStore
} = require("@whiskeysockets/baileys");

// STORE (helps stability)
const store = makeInMemoryStore({
    logger: pino().child({ level: "silent" })
});

async function startBot() {

    const { state, saveCreds } =
        await useMultiFileAuthState("./session");

    const { version } =
        await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: "silent" }),
        printQRInTerminal: false
    });

    store.bind(sock.ev);

    sock.ev.on("creds.update", saveCreds);

    // ===== CONNECTION =====
    sock.ev.on("connection.update", (update) => {
        const { connection } = update;

        if (connection === "open") {
            console.log("✅ Bot Connected");
        }

        if (connection === "close") {
            console.log("♻ Reconnecting...");
            startBot();
        }
    });

    // ===== PAIRING CODE =====
    if (!sock.authState.creds.registered) {

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question("Enter number (255xxxxxxxxx): ", async (number) => {

            try {
                const code = await sock.requestPairingCode(number);

                console.log("\nPAIRING CODE:", code);
                console.log("Go to WhatsApp → Linked Devices → Link with code");

            } catch (e) {
                console.log(e);
            }

            rl.close();
        });
    }

    // ===== GROUP WELCOME =====
    sock.ev.on("group-participants.update", async (data) => {

        try {
            if (data.action === "add") {
                for (let user of data.participants) {
                    await sock.sendMessage(data.id, {
                        text: `👋 Welcome @${user.split("@")[0]}`,
                        mentions: [user]
                    });
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

        } catch {}
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

        console.log("MSG:", command);

        try {

            // ===== AUTO REACTION =====
            await sock.sendMessage(jid, {
                react: {
                    text: "⚡",
                    key: msg.key
                }
            });

            // ===== AUTO TYPING =====
            await sock.sendPresenceUpdate("composing", jid);

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
╰──────────`
                });
            }

            if (command === ".ping") {
                await sock.sendMessage(jid, { text: "🏓 Pong!" });
            }

            if (command === ".owner") {
                await sock.sendMessage(jid, {
                    text: "👑 Owner: Veldrix"
                });
            }

            // ===== GROUP INFO =====
            if (command === ".groupinfo") {

                if (!jid.endsWith("@g.us")) return;

                const meta = await sock.groupMetadata(jid);

                await sock.sendMessage(jid, {
                    text:
`📌 ${meta.subject}
👥 Members: ${meta.participants.length}`
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

                await sock.sendMessage(jid, {
                    text,
                    mentions
                });
            }

        } catch (e) {
            console.log("ERROR:", e);
        }
    });
}

startBot();
