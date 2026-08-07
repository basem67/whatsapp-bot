/**
 * 🤖 واتساب بوت - بالذكاء الاصطناعي
 * Claude AI يرد على كل رسالة عادية
 */

global.crypto = require("crypto").webcrypto;

const { default: makeWASocket, useMultiFileAuthState,
        DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const { Boom }  = require("@hapi/boom");
const pino      = require("pino");
const axios     = require("axios");
const fs        = require("fs");
const path      = require("path");
const http      = require("http");
const QRCode    = require("qrcode");

// ══════════════════════════════════════════
// ⚙️  الإعدادات
// ══════════════════════════════════════════

// مجلد الـ auth — لو في Volume هيتحفظ فيه تلقائياً
const AUTH_DIR   = process.env.AUTH_DIR || "./auth_info";
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const PORT       = process.env.PORT || 3000;

// تاريخ المحادثات (في الذاكرة)
const conversations = {};

// ══════════════════════════════════════════
// 🤖  Claude AI
// ══════════════════════════════════════════

async function askClaude(chatId, userMessage) {
  if (!CLAUDE_KEY) return "❌ ANTHROPIC_API_KEY مش موجود في الإعدادات";

  if (!conversations[chatId]) conversations[chatId] = [];

  conversations[chatId].push({ role: "user", content: userMessage });

  // نحتفظ بآخر 20 رسالة بس
  if (conversations[chatId].length > 20)
    conversations[chatId] = conversations[chatId].slice(-20);

  try {
    const res = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system:     "أنت مساعد ذكاء اصطناعي على واتساب. رد دائماً بالعربي بشكل مختصر ومفيد. لا تستخدم markdown أو نجوم أو رموز تنسيق.",
        messages:   conversations[chatId]
      },
      {
        headers: {
          "x-api-key":         CLAUDE_KEY,
          "anthropic-version": "2023-06-01",
          "content-type":      "application/json"
        },
        timeout: 30000
      }
    );
    const reply = res.data.content[0].text;
    conversations[chatId].push({ role: "assistant", content: reply });
    return reply;
  } catch (e) {
    console.error("Claude API:", e.response?.data || e.message);
    return "❌ مش قادر أرد دلوقتي، جرّب تاني";
  }
}

// ══════════════════════════════════════════
// 🌐  سيرفر QR Code
// ══════════════════════════════════════════

let currentQR   = null;
let isConnected = false;

const server = http.createServer(async (req, res) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

  if (isConnected) {
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#e8f5e9}
      .box{background:#fff;border-radius:16px;padding:30px;display:inline-block;box-shadow:0 4px 12px rgba(0,0,0,.1)}
      h2{color:#25D366}p{color:#555}</style></head><body>
      <div class="box"><h2>✅ البوت متصل!</h2><p>البوت شغال وبيرد على الرسايل</p>
      <p>ابعت أي رسالة على واتساب وهيرد 🤖</p></div></body></html>`);
    return;
  }

  if (!currentQR) {
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta http-equiv="refresh" content="3">
      <style>body{font-family:sans-serif;text-align:center;padding:40px;background:#f5f5f5}
      .box{background:#fff;border-radius:16px;padding:30px;display:inline-block}</style></head><body>
      <div class="box"><h3>⏳ جاري تحميل QR Code...</h3><p>الصفحة بتتحدث تلقائياً</p></div></body></html>`);
    return;
  }

  const qrImg = await QRCode.toDataURL(currentQR, { width: 300, margin: 2 });
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="refresh" content="30">
    <style>body{font-family:sans-serif;text-align:center;padding:20px;background:#f5f5f5}
    .box{background:#fff;border-radius:16px;padding:20px;display:inline-block;box-shadow:0 4px 12px rgba(0,0,0,.1)}
    h2{color:#128C7E;margin:0 0 10px}img{border-radius:8px;display:block;margin:15px auto}
    .steps{text-align:right;background:#e8f5e9;border-radius:8px;padding:15px;margin-top:15px}
    .steps p{margin:5px 0;font-size:14px}</style></head><body>
    <div class="box"><h2>📱 امسح QR Code</h2>
    <img src="${qrImg}" width="280" height="280">
    <div class="steps">
      <p>1️⃣ افتح واتساب</p>
      <p>2️⃣ الأجهزة المرتبطة</p>
      <p>3️⃣ ربط جهاز</p>
      <p>4️⃣ امسح الكود</p>
    </div>
    <p style="color:#999;font-size:12px;margin-top:10px">⏱️ بيتجدد كل 30 ثانية</p>
    </div></body></html>`);
});

server.listen(PORT, () => console.log(`🌐 سيرفر QR شغال على port ${PORT}`));

// ══════════════════════════════════════════
// 📦  قاعدة البيانات
// ══════════════════════════════════════════

const DB_FILE = path.join(__dirname, "data.json");
function loadDB() {
  try { return fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE,"utf8")) : {notes:{},todos:{},autoReplies:{},reminders:[]}; }
  catch { return {notes:{},todos:{},autoReplies:{},reminders:[]}; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2),"utf8"); }
let DB = loadDB();
let sock = null;

async function send(chatId, text, quoted=null) {
  if (!sock) return;
  try { await sock.sendMessage(chatId, {text}, quoted?{quoted}:{}); }
  catch(e) { console.error("خطأ إرسال:", e.message); }
}

// ══════════════════════════════════════════
// 🌤️  طقس وعملات ووقت
// ══════════════════════════════════════════

async function getWeather(city) {
  try { const r=await axios.get(`https://wttr.in/${encodeURIComponent(city)}?format=3&lang=ar`,{timeout:6000}); return `🌤️ ${r.data}`; }
  catch { return `❌ مش لاقي طقس "${city}"`; }
}
async function getCurrency(code) {
  try {
    const r=await axios.get("https://open.er-api.com/v6/latest/EGP",{timeout:6000});
    code=code.toUpperCase();
    if(!r.data.rates[code]) return `❌ العملة "${code}" مش موجودة`;
    return `💱 1 ${code} = ${(1/r.data.rates[code]).toFixed(2)} ج.م`;
  } catch { return "❌ مش قادر يجيب السعر"; }
}
async function getTopCurrencies() {
  try {
    const r=await axios.get("https://open.er-api.com/v6/latest/EGP",{timeout:6000});
    const list={USD:"🇺🇸 دولار",EUR:"🇪🇺 يورو",SAR:"🇸🇦 ريال",AED:"🇦🇪 درهم",GBP:"🇬🇧 إسترليني",KWD:"🇰🇼 دينار كويتي"};
    let msg="💱 أسعار العملات / الجنيه المصري\n\n";
    for(const [c,n] of Object.entries(list)) if(r.data.rates[c]) msg+=`${n}: ${(1/r.data.rates[c]).toFixed(2)} ج.م\n`;
    return msg+`\nآخر تحديث: ${new Date().toLocaleTimeString("ar-EG")}`;
  } catch { return "❌ مش قادر يجيب الأسعار"; }
}
function getTime() {
  const n=new Date();
  return `${n.toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit",hour12:true})} - ${n.toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}`;
}

// ══════════════════════════════════════════
// ⏰  تذكيرات / 📝 ملاحظات / ✅ مهام / 💬 ردود
// ══════════════════════════════════════════

function parseTime(t) { const m=t.match(/^(\d{1,2}):(\d{2})$/); if(!m) return null; const d=new Date(); d.setHours(+m[1],+m[2],0,0); if(d<=new Date()) d.setDate(d.getDate()+1); return d; }
function addReminder(chatId,timeStr,text) { const f=parseTime(timeStr); if(!f) return null; const e={chatId,timeStr,text,fireAt:f.toISOString()}; DB.reminders.push(e); saveDB(DB); setTimeout(()=>{ send(chatId,`⏰ تذكير!\n\n${text}`); DB.reminders=DB.reminders.filter(r=>r.fireAt!==e.fireAt); saveDB(DB); },f-Date.now()); return f; }
function restoreReminders() { DB.reminders=DB.reminders.filter(r=>new Date(r.fireAt)>Date.now()); saveDB(DB); for(const r of DB.reminders){const d=new Date(r.fireAt)-Date.now(); setTimeout(()=>{send(r.chatId,`⏰ تذكير!\n\n${r.text}`); DB.reminders=DB.reminders.filter(x=>x!==r); saveDB(DB);},d);} }

const saveNote=(id,t,v)=>{ (DB.notes[id]??={})[t]=v; saveDB(DB); };
const getNote=(id,t)=>DB.notes[id]?.[t]||null;
const deleteNote=(id,t)=>{ if(!DB.notes[id]?.[t]) return false; delete DB.notes[id][t]; saveDB(DB); return true; };
function listNotes(id) { const n=DB.notes[id]; if(!n||!Object.keys(n).length) return "مفيش ملاحظات محفوظة"; return "ملاحظاتك:\n\n"+Object.keys(n).map((t,i)=>`${i+1}. ${t}`).join("\n"); }

const addTodo=(id,t)=>{ (DB.todos[id]??=[]).push({text:t,done:false}); saveDB(DB); return DB.todos[id].length; };
const doneTodo=(id,n)=>{ const t=DB.todos[id]; if(!t||!t[n-1]) return false; t[n-1].done=true; saveDB(DB); return t[n-1].text; };
const removeTodo=(id,n)=>{ const t=DB.todos[id]; if(!t||!t[n-1]) return false; const [r]=t.splice(n-1,1); saveDB(DB); return r.text; };
function listTodos(id) { const t=DB.todos[id]; if(!t||!t.length) return "قائمة المهام فاضية"; const done=t.filter(x=>x.done).length; return "مهامك:\n\n"+t.map((x,i)=>`${x.done?"✅":"⬜"} ${i+1}. ${x.text}`).join("\n")+`\n\n${done}/${t.length} مكتملة`; }

const setReply=(id,k,v)=>{ (DB.autoReplies[id]??={})[k.toLowerCase()]=v; saveDB(DB); };
const deleteReply=(id,k)=>{ if(!DB.autoReplies[id]?.[k.toLowerCase()]) return false; delete DB.autoReplies[id][k.toLowerCase()]; saveDB(DB); return true; };
function getAutoReply(id,text) { for(const [k,v] of Object.entries(DB.autoReplies[id]||{})) if(text.toLowerCase().includes(k)) return v; return null; }
function listReplies(id) { const r=DB.autoReplies[id]; if(!r||!Object.keys(r).length) return "مفيش ردود تلقائية"; return "ردودك:\n\n"+Object.entries(r).map(([k,v],i)=>`${i+1}. "${k}" - ${v}`).join("\n"); }

// ══════════════════════════════════════════
// ❓  المساعدة
// ══════════════════════════════════════════

const HELP = `اوامر البوت

الاوامر تبدأ بـ !
بدون ! = الذكاء الاصطناعي يرد

--- معلومات ---
!طقس القاهرة
!عملة USD
!عملات
!وقت

--- تذكيرات ---
!ذكرني 14:30 روح الجيم
!تذكيراتي
!مسح تذكيرات

--- ملاحظات ---
!حفظ عنوان | النص
!ملاحظاتي
!ملاحظة عنوان
!حذف ملاحظة عنوان

--- مهام ---
!مهمة اشتري خضار
!مهامي
!تمت 1
!حذف مهمة 2

--- ردود تلقائية ---
!رد أهلا = مرحباً بك
!ردودي
!حذف رد أهلا

--- ذكاء اصطناعي ---
!مسح المحادثة  (يبدأ محادثة جديدة)`;

// ══════════════════════════════════════════
// 💬  معالجة الأوامر
// ══════════════════════════════════════════

async function handleMessage(chatId, body, rawMsg) {
  // ردود تلقائية مخصصة
  const auto = getAutoReply(chatId, body);
  if (auto && !body.startsWith("!")) { await send(chatId, auto, rawMsg); return; }

  // أوامر تبدأ بـ !
  if (body.startsWith("!")) {
    if (["!مرحبا","!هاي","!سلام"].includes(body)) { await send(chatId,"👋 أهلاً! بعت أي سؤال وهرد عليك، أو اكتب !مساعدة للأوامر",rawMsg); return; }
    if (body==="!مساعدة"||body==="!help") { await send(chatId,HELP,rawMsg); return; }
    if (body==="!وقت") { await send(chatId,getTime(),rawMsg); return; }
    if (body.startsWith("!طقس ")) { await send(chatId,"⏳ جاري البحث..."); await send(chatId,await getWeather(body.slice(5).trim())); return; }
    if (body.startsWith("!عملة ")) { await send(chatId,await getCurrency(body.slice(6).trim())); return; }
    if (body==="!عملات") { await send(chatId,await getTopCurrencies()); return; }
    if (body.startsWith("!ذكرني ")) { const p=body.slice(7).trim().split(" "),t=p.slice(1).join(" "); if(!t){await send(chatId,"مثال: !ذكرني 14:30 روح الجيم",rawMsg);return;} const f=addReminder(chatId,p[0],t); await send(chatId,f?`✅ تذكير محفوظ - ${p[0]} - ${t}`:"وقت غلط، استخدم HH:MM",rawMsg); return; }
    if (body==="!تذكيراتي") { const m=DB.reminders.filter(r=>r.chatId===chatId); await send(chatId,m.length?"تذكيراتك:\n\n"+m.map((r,i)=>`${i+1}. ${r.timeStr} - ${r.text}`).join("\n"):"مفيش تذكيرات",rawMsg); return; }
    if (body==="!مسح تذكيرات") { const n=DB.reminders.filter(r=>r.chatId===chatId).length; DB.reminders=DB.reminders.filter(r=>r.chatId!==chatId); saveDB(DB); await send(chatId,n?`تم مسح ${n} تذكير`:"مفيش تذكيرات",rawMsg); return; }
    if (body.startsWith("!حفظ ")) { const c=body.slice(5).trim(),s=c.indexOf("|"); if(s===-1){await send(chatId,"مثال: !حفظ فكرة | النص",rawMsg);return;} saveNote(chatId,c.slice(0,s).trim(),c.slice(s+1).trim()); await send(chatId,`✅ تم حفظ: ${c.slice(0,s).trim()}`,rawMsg); return; }
    if (body==="!ملاحظاتي") { await send(chatId,listNotes(chatId),rawMsg); return; }
    if (body.startsWith("!ملاحظة ")) { const t=body.slice(8).trim(),n=getNote(chatId,t); await send(chatId,n?`${t}:\n\n${n}`:`مش لاقي "${t}"`,rawMsg); return; }
    if (body.startsWith("!حذف ملاحظة ")) { const t=body.slice(13).trim(); await send(chatId,deleteNote(chatId,t)?`تم حذف "${t}"`:`مش لاقي "${t}"`,rawMsg); return; }
    if (body.startsWith("!مهمة ")) { const n=addTodo(chatId,body.slice(6).trim()); await send(chatId,`✅ مهمة ${n} اتضافت`,rawMsg); return; }
    if (body==="!مهامي") { await send(chatId,listTodos(chatId),rawMsg); return; }
    if (body.startsWith("!تمت ")) { const t=doneTodo(chatId,+body.slice(5)); await send(chatId,t?`✅ تم: ${t}`:"رقم غلط",rawMsg); return; }
    if (body.startsWith("!حذف مهمة ")) { const t=removeTodo(chatId,+body.slice(10)); await send(chatId,t?`تم حذف: ${t}`:"رقم غلط",rawMsg); return; }
    if (body.startsWith("!رد ")&&body.includes("=")) { const c=body.slice(4).trim(),i=c.indexOf("="); setReply(chatId,c.slice(0,i).trim(),c.slice(i+1).trim()); await send(chatId,"✅ رد محفوظ",rawMsg); return; }
    if (body==="!ردودي") { await send(chatId,listReplies(chatId),rawMsg); return; }
    if (body.startsWith("!حذف رد ")) { const k=body.slice(8).trim(); await send(chatId,deleteReply(chatId,k)?`تم حذف رد "${k}"`:`مش لاقي "${k}"`,rawMsg); return; }
    if (body==="!مسح المحادثة") { conversations[chatId]=[]; await send(chatId,"✅ تم مسح المحادثة - ابدأ من أول",rawMsg); return; }
    // أمر مش موجود → الـ AI يرد
  }

  // 🤖 كل حاجة تانية → Claude AI
  console.log(`🤖 AI يرد على: "${body}"`);
  await send(chatId, "⏳ ...");
  const aiReply = await askClaude(chatId, body);
  await send(chatId, aiReply, rawMsg);
}

// ══════════════════════════════════════════
// 🔌  الاتصال بواتساب
// ══════════════════════════════════════════

async function connectToWhatsApp() {
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    logger:            pino({ level:"silent" }),
    auth:              state,
    printQRInTerminal: true,
    browser:           ["WhatsApp Bot","Chrome","120.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) { currentQR=qr; isConnected=false; console.log("📱 QR جاهز — افتح الرابط وامسحه"); }
    if (connection==="open") { currentQR=null; isConnected=true; console.log("✅ البوت متصل وشغال!"); restoreReminders(); }
    if (connection==="close") {
      isConnected=false;
      const code=new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code!==DisconnectReason.loggedOut) { console.log("🔄 إعادة الاتصال..."); setTimeout(connectToWhatsApp,3000); }
      else { console.log("⛔ تسجيل خروج"); currentQR=null; }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const msg of messages) {
      if (msg.key.fromMe || !msg.message) continue;
      const body = (
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        ""
      ).trim();
      if (!body) continue;
      console.log(`📩 "${body}" من ${msg.key.remoteJid}`);
      await handleMessage(msg.key.remoteJid, body, msg);
    }
  });
}

console.log("🚀 جاري تشغيل البوت...");
connectToWhatsApp();
