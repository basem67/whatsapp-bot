/**
 * 🤖 واتساب بوت - نسخة الكلاود
 * Baileys — بدون Puppeteer، خفيف وبيشتغل على أي سيرفر
 */

// ضروري لـ Baileys على Node.js 18
global.crypto = require("crypto").webcrypto;

const { default: makeWASocket, useMultiFileAuthState,
        DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom }  = require("@hapi/boom");
const pino      = require("pino");
const axios     = require("axios");
const fs        = require("fs");
const path      = require("path");

// ══════════════════════════════════════════
// 📦  قاعدة البيانات
// ══════════════════════════════════════════

const DB_FILE = path.join(__dirname, "data.json");

function loadDB() {
  try {
    return fs.existsSync(DB_FILE)
      ? JSON.parse(fs.readFileSync(DB_FILE, "utf8"))
      : { notes:{}, todos:{}, autoReplies:{}, reminders:[] };
  } catch { return { notes:{}, todos:{}, autoReplies:{}, reminders:[] }; }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

let DB  = loadDB();
let sock = null;

// ══════════════════════════════════════════
// 📤  إرسال رسالة
// ══════════════════════════════════════════

async function send(chatId, text, quoted = null) {
  if (!sock) return;
  try {
    await sock.sendMessage(chatId, { text }, quoted ? { quoted } : {});
  } catch (e) {
    console.error("خطأ في الإرسال:", e.message);
  }
}

// ══════════════════════════════════════════
// 🌤️  طقس وعملات ووقت
// ══════════════════════════════════════════

async function getWeather(city) {
  try {
    const r = await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=3&lang=ar`, { timeout:6000 });
    return `🌤️ ${r.data}`;
  } catch { return `❌ مش لاقي طقس "${city}"`; }
}

async function getCurrency(code) {
  try {
    const r = await axios.get("https://open.er-api.com/v6/latest/EGP", { timeout:6000 });
    code = code.toUpperCase();
    if (!r.data.rates[code]) return `❌ العملة "${code}" مش موجودة`;
    return `💱 1 ${code} = ${(1 / r.data.rates[code]).toFixed(2)} ج.م`;
  } catch { return "❌ مش قادر يجيب السعر"; }
}

async function getTopCurrencies() {
  try {
    const r    = await axios.get("https://open.er-api.com/v6/latest/EGP", { timeout:6000 });
    const list = { USD:"🇺🇸 دولار", EUR:"🇪🇺 يورو", SAR:"🇸🇦 ريال", AED:"🇦🇪 درهم", GBP:"🇬🇧 إسترليني", KWD:"🇰🇼 دينار كويتي" };
    let msg = "💱 *أسعار العملات / الجنيه المصري*\n\n";
    for (const [c, n] of Object.entries(list)) {
      if (r.data.rates[c]) msg += `${n}: *${(1 / r.data.rates[c]).toFixed(2)} ج.م*\n`;
    }
    return msg + `\n🕐 ${new Date().toLocaleTimeString("ar-EG")}`;
  } catch { return "❌ مش قادر يجيب الأسعار"; }
}

function getTime() {
  const now = new Date();
  return `🕐 *${now.toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit",hour12:true})}*\n📅 ${now.toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}`;
}

// ══════════════════════════════════════════
// ⏰  التذكيرات
// ══════════════════════════════════════════

function parseTime(t) {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const d = new Date();
  d.setHours(+m[1], +m[2], 0, 0);
  if (d <= new Date()) d.setDate(d.getDate() + 1);
  return d;
}

function addReminder(chatId, timeStr, text) {
  const fireAt = parseTime(timeStr);
  if (!fireAt) return null;
  const entry = { chatId, timeStr, text, fireAt: fireAt.toISOString() };
  DB.reminders.push(entry);
  saveDB(DB);
  const delay = fireAt - Date.now();
  setTimeout(() => {
    send(chatId, `⏰ *تذكير!*\n\n${text}`);
    DB.reminders = DB.reminders.filter(r => r.fireAt !== entry.fireAt || r.chatId !== chatId);
    saveDB(DB);
  }, delay);
  return fireAt;
}

function restoreReminders() {
  const now = Date.now();
  DB.reminders = DB.reminders.filter(r => new Date(r.fireAt) > now);
  saveDB(DB);
  for (const r of DB.reminders) {
    const delay = new Date(r.fireAt) - now;
    setTimeout(() => {
      send(r.chatId, `⏰ *تذكير!*\n\n${r.text}`);
      DB.reminders = DB.reminders.filter(x => x !== r);
      saveDB(DB);
    }, delay);
  }
  if (DB.reminders.length) console.log(`⏰ استُعيد ${DB.reminders.length} تذكير`);
}

// ══════════════════════════════════════════
// 📝  ملاحظات / ✅ مهام / 💬 ردود تلقائية
// ══════════════════════════════════════════

// — ملاحظات —
const saveNote    = (id,t,v) => { (DB.notes[id]??={})[t]=v; saveDB(DB); };
const getNote     = (id,t)   => DB.notes[id]?.[t] || null;
const deleteNote  = (id,t)   => { if(!DB.notes[id]?.[t]) return false; delete DB.notes[id][t]; saveDB(DB); return true; };
function listNotes(id) {
  const n = DB.notes[id]; if (!n || !Object.keys(n).length) return "📭 مفيش ملاحظات";
  return "📝 *ملاحظاتك:*\n\n" + Object.keys(n).map((t,i)=>`${i+1}. ${t}`).join("\n") + "\n\n*!ملاحظة [عنوان]* لعرضها";
}

// — مهام —
const addTodo    = (id,t)  => { (DB.todos[id]??=[]).push({text:t,done:false}); saveDB(DB); return DB.todos[id].length; };
const doneTodo   = (id,n)  => { const t=DB.todos[id]; if(!t||!t[n-1]) return false; t[n-1].done=true; saveDB(DB); return t[n-1].text; };
const removeTodo = (id,n)  => { const t=DB.todos[id]; if(!t||!t[n-1]) return false; const [r]=t.splice(n-1,1); saveDB(DB); return r.text; };
function listTodos(id) {
  const t=DB.todos[id]; if(!t||!t.length) return "📭 المهام فاضية\n*!مهمة [نص]* لإضافة مهمة";
  const done=t.filter(x=>x.done).length;
  return "✅ *مهامك:*\n\n" + t.map((x,i)=>`${x.done?"✅":"⬜"} ${i+1}. ${x.text}`).join("\n") + `\n\n📊 ${done}/${t.length} مكتملة`;
}

// — ردود تلقائية —
const setReply    = (id,k,v) => { (DB.autoReplies[id]??={})[k.toLowerCase()]=v; saveDB(DB); };
const deleteReply = (id,k)   => { if(!DB.autoReplies[id]?.[k.toLowerCase()]) return false; delete DB.autoReplies[id][k.toLowerCase()]; saveDB(DB); return true; };
function getAutoReply(id,text) {
  for (const [k,v] of Object.entries(DB.autoReplies[id]||{}))
    if (text.toLowerCase().includes(k)) return v;
  return null;
}
function listReplies(id) {
  const r=DB.autoReplies[id]; if(!r||!Object.keys(r).length) return "📭 مفيش ردود تلقائية\n*!رد [كلمة] = [رد]*";
  return "💬 *ردودك:*\n\n" + Object.entries(r).map(([k,v],i)=>`${i+1}. "${k}" ← ${v}`).join("\n");
}

// ══════════════════════════════════════════
// ❓  المساعدة
// ══════════════════════════════════════════

const HELP = `🤖 *أوامر البوت*

━━━━━━━━━━━━━━━━
🌍 *معلومات*
━━━━━━━━━━━━━━━━
!طقس القاهرة
!عملة USD
!عملات
!وقت

━━━━━━━━━━━━━━━━
⏰ *التذكيرات*
━━━━━━━━━━━━━━━━
!ذكرني 14:30 روح الجيم
!تذكيراتي
!مسح تذكيرات

━━━━━━━━━━━━━━━━
📝 *الملاحظات*
━━━━━━━━━━━━━━━━
!حفظ العنوان | النص
!ملاحظاتي
!ملاحظة العنوان
!حذف ملاحظة العنوان

━━━━━━━━━━━━━━━━
✅ *المهام*
━━━━━━━━━━━━━━━━
!مهمة اشتري خضار
!مهامي
!تمت 1
!حذف مهمة 2

━━━━━━━━━━━━━━━━
💬 *ردود تلقائية*
━━━━━━━━━━━━━━━━
!رد أهلا = مرحباً بك!
!ردودي
!حذف رد أهلا`;

// ══════════════════════════════════════════
// 💬  معالجة الأوامر
// ══════════════════════════════════════════

async function handleMessage(chatId, body, rawMsg) {
  // ردود تلقائية
  const auto = getAutoReply(chatId, body);
  if (auto && !body.startsWith("!")) { await send(chatId, auto, rawMsg); return; }

  // مرحبا
  if (["!مرحبا","!هاي","!سلام"].includes(body)) {
    await send(chatId, "👋 أهلاً! اكتب *!مساعدة* تشوف الأوامر", rawMsg); return;
  }

  if (body === "!مساعدة" || body === "!help") { await send(chatId, HELP, rawMsg); return; }
  if (body === "!وقت")    { await send(chatId, getTime(), rawMsg); return; }

  if (body.startsWith("!طقس ")) {
    await send(chatId, "⏳ جاري البحث...");
    await send(chatId, await getWeather(body.slice(5).trim())); return;
  }

  if (body.startsWith("!عملة ")) {
    await send(chatId, "⏳ ...");
    await send(chatId, await getCurrency(body.slice(6).trim())); return;
  }

  if (body === "!عملات") {
    await send(chatId, "⏳ ...");
    await send(chatId, await getTopCurrencies()); return;
  }

  // تذكيرات
  if (body.startsWith("!ذكرني ")) {
    const parts = body.slice(7).trim().split(" ");
    const text  = parts.slice(1).join(" ");
    if (!text) { await send(chatId, "❗ مثال: *!ذكرني 14:30 روح الجيم*", rawMsg); return; }
    const t = addReminder(chatId, parts[0], text);
    await send(chatId, t ? `✅ تذكير محفوظ!\n⏰ ${parts[0]} — ${text}` : "❗ وقت غلط — استخدم HH:MM", rawMsg);
    return;
  }
  if (body === "!تذكيراتي") {
    const mine = DB.reminders.filter(r=>r.chatId===chatId);
    await send(chatId, mine.length ? "⏰ *تذكيراتك:*\n\n"+mine.map((r,i)=>`${i+1}. ${r.timeStr} — ${r.text}`).join("\n") : "📭 مفيش تذكيرات", rawMsg);
    return;
  }
  if (body === "!مسح تذكيرات") {
    const n = DB.reminders.filter(r=>r.chatId===chatId).length;
    DB.reminders = DB.reminders.filter(r=>r.chatId!==chatId); saveDB(DB);
    await send(chatId, n ? `🗑️ تم مسح ${n} تذكير` : "📭 مفيش تذكيرات", rawMsg); return;
  }

  // ملاحظات
  if (body.startsWith("!حفظ ")) {
    const c=body.slice(5).trim(), sep=c.indexOf("|");
    if (sep===-1) { await send(chatId,"❗ مثال: *!حفظ فكرة | النص*",rawMsg); return; }
    saveNote(chatId, c.slice(0,sep).trim(), c.slice(sep+1).trim());
    await send(chatId, `✅ تم حفظ: *${c.slice(0,sep).trim()}*`, rawMsg); return;
  }
  if (body === "!ملاحظاتي") { await send(chatId, listNotes(chatId), rawMsg); return; }
  if (body.startsWith("!ملاحظة ")) {
    const t=body.slice(8).trim(), n=getNote(chatId,t);
    await send(chatId, n?`📝 *${t}*\n\n${n}`:`❌ مش لاقي "${t}"`, rawMsg); return;
  }
  if (body.startsWith("!حذف ملاحظة ")) {
    const t=body.slice(13).trim();
    await send(chatId, deleteNote(chatId,t)?`🗑️ تم حذف "${t}"`:`❌ مش لاقي "${t}"`, rawMsg); return;
  }

  // مهام
  if (body.startsWith("!مهمة ")) { const n=addTodo(chatId,body.slice(6).trim()); await send(chatId,`✅ مهمة ${n}: ${body.slice(6).trim()}`,rawMsg); return; }
  if (body === "!مهامي")          { await send(chatId, listTodos(chatId), rawMsg); return; }
  if (body.startsWith("!تمت "))   { const t=doneTodo(chatId,+body.slice(5)); await send(chatId,t?`✅ أُنجزت: ${t}`:"❌ رقم غلط",rawMsg); return; }
  if (body.startsWith("!حذف مهمة ")) { const t=removeTodo(chatId,+body.slice(10)); await send(chatId,t?`🗑️ حُذفت: ${t}`:"❌ رقم غلط",rawMsg); return; }

  // ردود تلقائية
  if (body.startsWith("!رد ") && body.includes("=")) {
    const c=body.slice(4).trim(), i=c.indexOf("=");
    setReply(chatId, c.slice(0,i).trim(), c.slice(i+1).trim());
    await send(chatId, `✅ رد محفوظ: "${c.slice(0,i).trim()}" ← "${c.slice(i+1).trim()}"`, rawMsg); return;
  }
  if (body === "!ردودي")            { await send(chatId, listReplies(chatId), rawMsg); return; }
  if (body.startsWith("!حذف رد ")) { const k=body.slice(8).trim(); await send(chatId,deleteReply(chatId,k)?`🗑️ حُذف رد "${k}"`:`❌ مش لاقي "${k}"`,rawMsg); return; }

  // أمر غير معروف
  if (body.startsWith("!")) await send(chatId, `❓ أمر غير معروف\n*!مساعدة* لعرض الأوامر`, rawMsg);
}

// ══════════════════════════════════════════
// 🔌  الاتصال بواتساب
// ══════════════════════════════════════════

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    auth:   state,
    printQRInTerminal: false,           // هنستخدم Pairing Code بدل QR
    browser: ["WhatsApp Bot","Chrome","120.0"],
  });

  // ── طلب Pairing Code (بدل QR) ──
  if (!sock.authState.creds.registered) {
    const phone = process.env.PHONE_NUMBER;
    if (!phone) {
      console.error("❌ ضع رقم التليفون في متغير PHONE_NUMBER");
      console.error("   مثال: PHONE_NUMBER=201012345678");
      process.exit(1);
    }
    // انتظر حتى يكون الـ socket جاهز
    await new Promise(res => setTimeout(res, 2000));
    try {
      const code = await sock.requestPairingCode(phone.replace(/\D/g, ""));
      console.log("\n" + "═".repeat(40));
      console.log("🔐  كود الربط:", code);
      console.log("═".repeat(40));
      console.log("واتساب ← الأجهزة المرتبطة ← ربط بالرقم");
      console.log("أدخل الكود أعلاه\n");
    } catch (e) {
      console.error("❌ خطأ في طلب الكود:", e.message);
    }
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect }) => {
    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log("🔄 إعادة الاتصال...");
        setTimeout(connectToWhatsApp, 3000);
      } else {
        console.log("⛔ تسجيل الخروج — امسح مجلد auth_info وأعد التشغيل");
      }
    }
    if (connection === "open") {
      console.log("✅ البوت شغال وجاهز!");
      restoreReminders();
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue;
      const body = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text || ""
      ).trim();
      if (!body) continue;
      const chatId = msg.key.remoteJid;
      console.log(`📩 ${chatId}: ${body}`);
      await handleMessage(chatId, body, msg);
    }
  });
}

// ══════════════════════════════════════════
// 🚀  ابدأ
// ══════════════════════════════════════════

console.log("🚀 جاري تشغيل البوت...");
connectToWhatsApp();
