/**
 * 🤖 تليجرام بوت - بالذكاء الاصطناعي
 * Claude AI يرد على كل رسالة عادية
 */

const TelegramBot = require("node-telegram-bot-api");
const axios       = require("axios");
const fs          = require("fs");
const path        = require("path");

// ══════════════════════════════════════════
// ⚙️  الإعدادات
// ══════════════════════════════════════════

const TOKEN      = process.env.TELEGRAM_TOKEN;
const CLAUDE_KEY = process.env.ANTHROPIC_API_KEY;
const DB_FILE    = path.join(__dirname, "data.json");

if (!TOKEN) { console.error("❌ ضع TELEGRAM_TOKEN في المتغيرات"); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });
console.log("✅ البوت شغال على تليجرام!");

// ══════════════════════════════════════════
// 📦  قاعدة البيانات
// ══════════════════════════════════════════

function loadDB() {
  try { return fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE,"utf8")) : {notes:{},todos:{},autoReplies:{},reminders:[]}; }
  catch { return {notes:{},todos:{},autoReplies:{},reminders:[]}; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2),"utf8"); }
let DB = loadDB();

// تاريخ المحادثات للـ AI
const conversations = {};

// ══════════════════════════════════════════
// 📤  إرسال رسالة
// ══════════════════════════════════════════

async function send(chatId, text, replyTo=null) {
  try {
    const opts = { parse_mode: "Markdown" };
    if (replyTo) opts.reply_to_message_id = replyTo;
    await bot.sendMessage(chatId, text, opts);
  } catch(e) {
    // لو فشل بـ Markdown، جرب بدونه
    try { await bot.sendMessage(chatId, text); }
    catch(e2) { console.error("خطأ إرسال:", e2.message); }
  }
}

// ══════════════════════════════════════════
// 🤖  Claude AI
// ══════════════════════════════════════════

async function askClaude(chatId, userMessage) {
  try {
    const res = await axios.get(
      "http://de3.bot-hosting.net:21007/kilwa-claude",
      { params: { text: userMessage }, timeout: 15000 }
    );
    if (res.data?.reply) return res.data.reply;
    return "❌ مش قادر أرد دلوقتي";
  } catch(e) {
    console.error("AI API:", e.message);
    return "❌ مش قادر أرد دلوقتي، جرّب تاني";
  }
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
    const list={USD:"🇺🇸 دولار",EUR:"🇪🇺 يورو",SAR:"🇸🇦 ريال",AED:"🇦🇪 درهم",GBP:"🇬🇧 إسترليني",KWD:"🇰🇼 دينار"};
    let msg="💱 *أسعار العملات / الجنيه المصري*\n\n";
    for(const [c,n] of Object.entries(list)) if(r.data.rates[c]) msg+=`${n}: *${(1/r.data.rates[c]).toFixed(2)} ج.م*\n`;
    return msg+`\n🕐 ${new Date().toLocaleTimeString("ar-EG")}`;
  } catch { return "❌ مش قادر يجيب الأسعار"; }
}

function getTime() {
  const n=new Date();
  return `🕐 *${n.toLocaleTimeString("ar-EG",{hour:"2-digit",minute:"2-digit",hour12:true})}*\n📅 ${n.toLocaleDateString("ar-EG",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}`;
}

// ══════════════════════════════════════════
// ⏰  تذكيرات
// ══════════════════════════════════════════

function parseTime(t) {
  const m=t.match(/^(\d{1,2}):(\d{2})$/); if(!m) return null;
  const d=new Date(); d.setHours(+m[1],+m[2],0,0);
  if(d<=new Date()) d.setDate(d.getDate()+1); return d;
}

function addReminder(chatId, timeStr, text) {
  const f=parseTime(timeStr); if(!f) return null;
  const e={chatId:String(chatId),timeStr,text,fireAt:f.toISOString()};
  DB.reminders.push(e); saveDB(DB);
  setTimeout(()=>{ send(chatId,`⏰ *تذكير!*\n\n${text}`); DB.reminders=DB.reminders.filter(r=>r.fireAt!==e.fireAt); saveDB(DB); }, f-Date.now());
  return f;
}

function restoreReminders() {
  DB.reminders=DB.reminders.filter(r=>new Date(r.fireAt)>Date.now()); saveDB(DB);
  for(const r of DB.reminders) {
    const d=new Date(r.fireAt)-Date.now();
    setTimeout(()=>{ send(r.chatId,`⏰ *تذكير!*\n\n${r.text}`); DB.reminders=DB.reminders.filter(x=>x!==r); saveDB(DB); }, d);
  }
  if(DB.reminders.length) console.log(`⏰ استُعيد ${DB.reminders.length} تذكير`);
}

// ══════════════════════════════════════════
// 📝 ملاحظات / ✅ مهام / 💬 ردود
// ══════════════════════════════════════════

const id = c => String(c);
const saveNote   = (c,t,v)=>{ (DB.notes[id(c)]??={})[t]=v; saveDB(DB); };
const getNote    = (c,t)  => DB.notes[id(c)]?.[t]||null;
const deleteNote = (c,t)  =>{ if(!DB.notes[id(c)]?.[t]) return false; delete DB.notes[id(c)][t]; saveDB(DB); return true; };
function listNotes(c) { const n=DB.notes[id(c)]; if(!n||!Object.keys(n).length) return "📭 مفيش ملاحظات"; return "📝 *ملاحظاتك:*\n\n"+Object.keys(n).map((t,i)=>`${i+1}\\. ${t}`).join("\n"); }

const addTodo    = (c,t)=>{ (DB.todos[id(c)]??=[]).push({text:t,done:false}); saveDB(DB); return DB.todos[id(c)].length; };
const doneTodo   = (c,n)=>{ const t=DB.todos[id(c)]; if(!t||!t[n-1]) return false; t[n-1].done=true; saveDB(DB); return t[n-1].text; };
const removeTodo = (c,n)=>{ const t=DB.todos[id(c)]; if(!t||!t[n-1]) return false; const [r]=t.splice(n-1,1); saveDB(DB); return r.text; };
function listTodos(c) {
  const t=DB.todos[id(c)]; if(!t||!t.length) return "📭 المهام فاضية\nاكتب *!مهمة [نص]* لإضافة مهمة";
  const done=t.filter(x=>x.done).length;
  return "✅ *مهامك:*\n\n"+t.map((x,i)=>`${x.done?"✅":"⬜"} ${i+1}\\. ${x.text}`).join("\n")+`\n\n📊 ${done}/${t.length} مكتملة`;
}

const setReply    = (c,k,v)=>{ (DB.autoReplies[id(c)]??={})[k.toLowerCase()]=v; saveDB(DB); };
const deleteReply = (c,k)  =>{ if(!DB.autoReplies[id(c)]?.[k.toLowerCase()]) return false; delete DB.autoReplies[id(c)][k.toLowerCase()]; saveDB(DB); return true; };
function getAutoReply(c,text) { for(const [k,v] of Object.entries(DB.autoReplies[id(c)]||{})) if(text.toLowerCase().includes(k)) return v; return null; }
function listReplies(c) { const r=DB.autoReplies[id(c)]; if(!r||!Object.keys(r).length) return "📭 مفيش ردود تلقائية"; return "💬 *ردودك:*\n\n"+Object.entries(r).map(([k,v],i)=>`${i+1}\\. "${k}" ← ${v}`).join("\n"); }

// ══════════════════════════════════════════
// ❓  المساعدة
// ══════════════════════════════════════════

const HELP = `🤖 *أوامر البوت*

━━━━━━━━━━━━━━━━
🌍 *معلومات*
━━━━━━━━━━━━━━━━
\`!طقس القاهرة\`
\`!عملة USD\`
\`!عملات\`
\`!وقت\`

━━━━━━━━━━━━━━━━
⏰ *تذكيرات*
━━━━━━━━━━━━━━━━
\`!ذكرني 14:30 روح الجيم\`
\`!تذكيراتي\`
\`!مسح تذكيرات\`

━━━━━━━━━━━━━━━━
📝 *ملاحظات*
━━━━━━━━━━━━━━━━
\`!حفظ عنوان | النص\`
\`!ملاحظاتي\`
\`!ملاحظة عنوان\`

━━━━━━━━━━━━━━━━
✅ *مهام*
━━━━━━━━━━━━━━━━
\`!مهمة اشتري خضار\`
\`!مهامي\`
\`!تمت 1\`
\`!حذف مهمة 2\`

━━━━━━━━━━━━━━━━
💬 *ردود تلقائية*
━━━━━━━━━━━━━━━━
\`!رد أهلا = مرحباً!\`
\`!ردودي\`
\`!حذف رد أهلا\`

━━━━━━━━━━━━━━━━
🌐 *بحث وأخبار*
━━━━━━━━━━━━━━━━
\`!بحث اسم محمد\`
\`!أخبار\`
\`!يوتيوب رابط\`
\`!qr https://google.com\`

━━━━━━━━━━━━━━━━
🤖 *ذكاء اصطناعي*
━━━━━━━━━━━━━━━━
بعت أي كلام بدون ! ← Claude يرد
\`!مسح المحادثة\` ← تبدأ من أول`;

// ══════════════════════════════════════════
// 🌐  بحث في الويب
// ══════════════════════════════════════════

async function webSearch(query) {
  try {
    const res = await axios.get("https://api.duckduckgo.com/", {
      params: { q: query, format: "json", no_html: 1, skip_disambig: 1 },
      timeout: 8000
    });
    const d = res.data;
    let result = "";

    if (d.AbstractText) result += `📖 *${d.Heading}*
${d.AbstractText}

`;

    if (d.RelatedTopics?.length) {
      result += "🔗 *نتائج ذات صلة:*\n";
      d.RelatedTopics.slice(0, 4).forEach((t, i) => {
        if (t.Text) result += `${i+1}. ${t.Text.slice(0,120)}...\n`;
      });
    }

    return result || "❌ مش لاقي نتايج لـ: " + query;
  } catch(e) {
    return "❌ خطأ في البحث: " + e.message;
  }
}

// ══════════════════════════════════════════
// 📰  أخبار عربية
// ══════════════════════════════════════════

async function getArabicNews() {
  try {
    const feed = await rss.parseURL("https://feeds.bbci.co.uk/arabic/rss.xml");
    const items = feed.items.slice(0, 6);
    let msg = "📰 *آخر الأخبار - BBC عربي*\n\n";
    items.forEach((item, i) => {
      msg += `${i+1}. *${item.title}*\n`;
      if (item.contentSnippet) msg += `${item.contentSnippet.slice(0,80)}...\n`;
      msg += `🔗 ${item.link}\n\n`;
    });
    return msg;
  } catch(e) {
    return "❌ مش قادر يجيب الأخبار دلوقتي";
  }
}

// ══════════════════════════════════════════
// 💬  معالجة الرسائل
// ══════════════════════════════════════════

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const body   = (msg.text || "").trim();
  if (!body) return;

  console.log(`📩 [${chatId}] ${body}`);

  // ردود تلقائية
  const auto = getAutoReply(chatId, body);
  if (auto && !body.startsWith("!")) { await send(chatId, auto, msg.message_id); return; }

  // ── أوامر ──────────────────────────────

  if (["/start","!مرحبا","!هاي"].includes(body)) {
    await send(chatId, "👋 أهلاً! أنا بوتك الذكي 🤖\n\nبعت أي سؤال وهرد عليك بالذكاء الاصطناعي\nأو اكتب *!مساعدة* للأوامر المتاحة", msg.message_id); return;
  }

  if (body==="!مساعدة"||body==="/help") { await send(chatId,HELP,msg.message_id); return; }
  if (body==="!وقت")    { await send(chatId,getTime(),msg.message_id); return; }

  if (body.startsWith("!طقس ")) {
    await send(chatId,"⏳ جاري البحث...");
    await send(chatId, await getWeather(body.slice(5).trim())); return;
  }
  if (body.startsWith("!عملة ")) {
    await send(chatId, await getCurrency(body.slice(6).trim())); return;
  }
  if (body==="!عملات") {
    await send(chatId, await getTopCurrencies()); return;
  }

  // 🎨 توليد صور
  if (body.startsWith("!صورة")) {
    let style = "realistic", prompt = "";
    if (body.startsWith("!صورة-انمي "))       { style="anime";          prompt=body.slice(11).trim(); }
    else if (body.startsWith("!صورة-فن "))     { style="digital art";    prompt=body.slice(9).trim();  }
    else if (body.startsWith("!صورة-واقعية ")) { style="photorealistic"; prompt=body.slice(13).trim(); }
    else if (body.startsWith("!صورة "))        { style="realistic";      prompt=body.slice(7).trim();  }

    if (!prompt) { await send(chatId,"❗ مثال: `!صورة قطة على القمر`",msg.message_id); return; }

    await send(chatId, "🎨 جاري توليد الصورة... ⏳");

    try {
      const fullPrompt  = encodeURIComponent(prompt + ", " + style + ", high quality, detailed");
      const imageUrl    = `https://image.pollinations.ai/prompt/${fullPrompt}?width=768&height=768&nologo=true&seed=${Math.floor(Math.random()*99999)}`;

      // نحمّل الصورة كـ buffer الأول عشان نبعتها صح
      const imgRes = await axios.get(imageUrl, { responseType:"arraybuffer", timeout:30000 });
      const buffer = Buffer.from(imgRes.data);

      await bot.sendPhoto(chatId, buffer, {
        caption:    `🎨 *${prompt}*
_${style}_`,
        parse_mode: "Markdown"
      });
    } catch(e) {
      console.error("Image error:", e.message);
      await send(chatId, "❌ مش قادر يولّد الصورة دلوقتي، جرّب تاني بعد شوية");
    }
    return;
  }

  // تذكيرات
  if (body.startsWith("!ذكرني ")) {
    const parts=body.slice(7).trim().split(" "), text=parts.slice(1).join(" ");
    if(!text){await send(chatId,"❗ مثال: `!ذكرني 14:30 روح الجيم`",msg.message_id);return;}
    const f=addReminder(chatId,parts[0],text);
    await send(chatId, f?`✅ تذكير محفوظ!\n⏰ ${parts[0]} — ${text}`:"❗ وقت غلط، استخدم HH:MM", msg.message_id); return;
  }
  if (body==="!تذكيراتي") {
    const m=DB.reminders.filter(r=>r.chatId===String(chatId));
    await send(chatId, m.length?"⏰ *تذكيراتك:*\n\n"+m.map((r,i)=>`${i+1}\\. ${r.timeStr} — ${r.text}`).join("\n"):"📭 مفيش تذكيرات", msg.message_id); return;
  }
  if (body==="!مسح تذكيرات") {
    const n=DB.reminders.filter(r=>r.chatId===String(chatId)).length;
    DB.reminders=DB.reminders.filter(r=>r.chatId!==String(chatId)); saveDB(DB);
    await send(chatId, n?`🗑️ تم مسح ${n} تذكير`:"📭 مفيش تذكيرات", msg.message_id); return;
  }

  // ملاحظات
  if (body.startsWith("!حفظ ")) {
    const c=body.slice(5).trim(),s=c.indexOf("|");
    if(s===-1){await send(chatId,"❗ مثال: `!حفظ فكرة | النص هنا`",msg.message_id);return;}
    saveNote(chatId,c.slice(0,s).trim(),c.slice(s+1).trim());
    await send(chatId,`✅ تم حفظ: *${c.slice(0,s).trim()}*`,msg.message_id); return;
  }
  if (body==="!ملاحظاتي") { await send(chatId,listNotes(chatId),msg.message_id); return; }
  if (body.startsWith("!ملاحظة ")) {
    const t=body.slice(8).trim(),n=getNote(chatId,t);
    await send(chatId,n?`📝 *${t}*\n\n${n}`:`❌ مش لاقي "${t}"`,msg.message_id); return;
  }
  if (body.startsWith("!حذف ملاحظة ")) {
    const t=body.slice(13).trim();
    await send(chatId,deleteNote(chatId,t)?`🗑️ تم حذف "${t}"`:`❌ مش لاقي "${t}"`,msg.message_id); return;
  }

  // مهام
  if (body.startsWith("!مهمة "))     { const n=addTodo(chatId,body.slice(6).trim()); await send(chatId,`✅ مهمة ${n} اتضافت: ${body.slice(6).trim()}`,msg.message_id); return; }
  if (body==="!مهامي")               { await send(chatId,listTodos(chatId),msg.message_id); return; }
  if (body.startsWith("!تمت "))      { const t=doneTodo(chatId,+body.slice(5)); await send(chatId,t?`✅ أُنجزت: ${t}`:"❌ رقم غلط",msg.message_id); return; }
  if (body.startsWith("!حذف مهمة ")) { const t=removeTodo(chatId,+body.slice(10)); await send(chatId,t?`🗑️ حُذفت: ${t}`:"❌ رقم غلط",msg.message_id); return; }

  // ردود تلقائية
  if (body.startsWith("!رد ")&&body.includes("=")) {
    const c=body.slice(4).trim(),i=c.indexOf("=");
    setReply(chatId,c.slice(0,i).trim(),c.slice(i+1).trim());
    await send(chatId,`✅ رد محفوظ: "${c.slice(0,i).trim()}" ← "${c.slice(i+1).trim()}"`,msg.message_id); return;
  }
  if (body==="!ردودي")              { await send(chatId,listReplies(chatId),msg.message_id); return; }
  if (body.startsWith("!حذف رد "))  { const k=body.slice(8).trim(); await send(chatId,deleteReply(chatId,k)?`🗑️ حُذف رد "${k}"`:`❌ مش لاقي "${k}"`,msg.message_id); return; }
  if (body==="!مسح المحادثة")       { conversations[chatId]=[]; await send(chatId,"✅ تم مسح المحادثة — ابدأ من أول 🔄",msg.message_id); return; }

  // 🌐 بحث في الويب
  if (body.startsWith("!بحث ")) {
    const query = body.slice(5).trim();
    await send(chatId, "🌐 جاري البحث...");
    await send(chatId, await webSearch(query), msg.message_id);
    return;
  }

  // 📰 أخبار
  if (body === "!أخبار" || body === "!اخبار") {
    await send(chatId, "📰 جاري تحميل الأخبار...");
    await send(chatId, await getArabicNews(), msg.message_id);
    return;
  }

  // 🔣 QR Code
  if (body.startsWith("!qr ") || body.startsWith("!QR ")) {
    const text = body.slice(4).trim();
    if (!text) { await send(chatId, "❗ مثال: `!qr https://google.com`", msg.message_id); return; }
    try {
      const buffer = await QRCode.toBuffer(text, { width: 400, margin: 2,
        color: { dark:"#000000", light:"#FFFFFF" } });
      await bot.sendPhoto(chatId, buffer, { caption: `🔣 QR Code لـ: ${text}` });
    } catch(e) { await send(chatId, "❌ خطأ في توليد QR"); }
    return;
  }

  // 🎥 يوتيوب
  if (body.startsWith("!يوتيوب ") || body.startsWith("!youtube ")) {
    const url = body.includes("!يوتيوب ") ? body.slice(8).trim() : body.slice(9).trim();
    if (!url || !url.includes("youtu")) { await send(chatId,"❗ مثال: `!يوتيوب https://youtu.be/...`",msg.message_id); return; }
    await send(chatId, "🎵 جاري التحميل...");
    try {
      const info    = await ytdl.getInfo(url);
      const title   = info.videoDetails.title;
      const duration = parseInt(info.videoDetails.lengthSeconds);

      if (duration > 600) {
        await send(chatId, `❌ الفيديو طويل جداً (${Math.floor(duration/60)} دقيقة)
الحد الأقصى 10 دقائق`); return;
      }

      await send(chatId, `⬇️ بيتحمّل: *${title}*
انتظر شوية...`);

      const stream = ytdl(url, { filter:"audioonly", quality:"lowestaudio" });
      await bot.sendAudio(chatId, stream, {
        caption:    `🎵 ${title}`,
        title:      title,
        parse_mode: "Markdown"
      });
    } catch(e) {
      console.error("YouTube:", e.message);
      await send(chatId, "❌ مش قادر يحمّل الفيديو ده\nتأكد من الرابط أو جرّب فيديو تاني");
    }
    return;
  }

  // 🤖 كل حاجة تانية ← Claude AI
  const typing = bot.sendChatAction(chatId, "typing");
  const aiReply = await askClaude(chatId, body);
  await send(chatId, aiReply, msg.message_id);
});

bot.on("polling_error", (e) => console.error("Polling error:", e.message));

restoreReminders();
console.log("🚀 البوت جاهز — ابعت رسالة على تليجرام!");
