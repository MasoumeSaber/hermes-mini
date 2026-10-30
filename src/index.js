const ACTIONS = ["add", "done", "undone", "del", "rename", "settime", "list", "chat"];
const FALLBACK = "متوجه نشدم. می‌شه یک جور دیگه بگی؟ 🙏";
const MAX_ADD = 10;
const ASK_WHICH = {
  action: "chat",
  reply: "کدوم تسک رو می‌گی؟ شماره‌ش رو بگو، یا اول بنویس «کارام چیه».",
};
const ROLLED_NOTE = "\n(ساعت امروز گذشته بود، برای فردا ثبت شد)";

const WELCOME =`سلام! من هرمس‌مینی‌ام 🪽✨
دستیار باهوش و سریع تو برای مدیریت کارهای روزانه!

💬 فقط عادی باهام حرف بزن؛ کارهات رو ثبت می‌کنم، سر وقت یادآوری می‌کنم و انجام‌شده‌ها رو پیگیری می‌کنم.

⏰ یادآوری هوشمند | 📝 مدیریت کارها | ☀️ برنامه روزانه | 🌙 گزارش شبانه

دیگه نگران فراموش کردن کارهات نباش؛ بسپرشون به من! 😉

🚀 خب، اولین کارت چیه؟`;

const SYSTEM_PROMPT = `You are the brain of a personal Persian task-manager Telegram bot.
Read the user's message and output EXACTLY ONE LINE of JSON and nothing else (no markdown, no explanation).

Allowed outputs:
{"action":"add","tasks":[{"text":"<short Persian title>","time":"HH:MM or null","day":"today or tomorrow"}]}
{"action":"done","ids":[<task ids>]}
{"action":"undone","ids":[<task ids>]}
{"action":"del","ids":[<task ids>]}
{"action":"rename","id":<task id>,"text":"<new short Persian title>"}
{"action":"settime","ids":[<task ids>],"time":"HH:MM","day":"today or tomorrow"}
{"action":"settime","ids":[<task ids>],"in_minutes":<number>}
{"action":"settime","ids":[<task ids>],"clear":true}
{"action":"list"}
{"action":"chat","reply":"<Persian reply>"}
Special form: {"action":"del","all":true} (also allowed for done and undone) means every task.

Rules:
- ids must come ONLY from the TASKS list (lines are id|status|due|text). Never invent ids.
- add: one entry per task, at most 10. Titles must be short and canonical, for example "خرید شیر", "رفتن به دکتر". Drop filler words and the time phrase.
- "time" must be filled ONLY if the user explicitly said a clock time. Use 24h HH:MM ("۵ عصر" = "17:00", "۸ شب" = "20:00", "۷ صبح" = "07:00"; a bare hour 1-6 with no period means PM). Never invent a time; otherwise "time":null.
- "day" is "tomorrow" only if the user says فردا, otherwise "today".
- settime: give or change the time of EXISTING tasks. "in N minutes" -> in_minutes. "remove the time" or "بی‌ساعت" -> clear.
- If the user says they bought/finished/did something, use done with the id of the matching task. If they say it is not done / undo, use undone.
- For delete: "number 3" or "شماره 3" means id 3. "delete all", "همه رو حذف کن" or "همه رو پاک کن" means {"action":"del","all":true}.
- "remind me again" or "in N minutes" right after a reminder message refers to the task named in that reminder message (use settime).
- For delete, done and undone NEVER guess from context: the user must give a task number or a name that matches a task in TASKS. If the user only says "this one", "that one" or "the last one" (این یکی، اون یکی، آخری), use chat and ask which task.
- To change the name/title of an existing task, use rename.
- Any request to see, show or list the tasks (for example "کارام چیه", "چیه کارام", "لیست", "چی دارم") MUST be list, never chat.
- Use chat only for greetings, thanks, questions about date or time (use the NOW line), or when you must ask a clarifying question.
- If the message is ambiguous, use chat and ask a short clarifying question in Persian. Never guess a destructive action.
- Always write text and reply in Persian.

Examples:
User: شیر بخر -> {"action":"add","tasks":[{"text":"خرید شیر","time":null,"day":"today"}]}
User: نان و شیر بخر -> {"action":"add","tasks":[{"text":"خرید نان","time":null,"day":"today"},{"text":"خرید شیر","time":null,"day":"today"}]}
User: کلاس ساعت 4 عصر -> {"action":"add","tasks":[{"text":"کلاس","time":"16:00","day":"today"}]}
User: فردا ساعت 8 صبح برم دکتر -> {"action":"add","tasks":[{"text":"رفتن به دکتر","time":"08:00","day":"tomorrow"}]}
User: شیر رو خریدم (TASKS has 4|open|-|خرید شیر) -> {"action":"done","ids":[4]}
User: قرص رو 10 دقیقه دیگه یادآوری کن (TASKS has 6|open|-|خوردن قرص) -> {"action":"settime","ids":[6],"in_minutes":10}
User: زنگ مامان رو بذار ساعت 8 شب (TASKS has 2|open|-|زنگ به مامان) -> {"action":"settime","ids":[2],"time":"20:00","day":"today"}
User: ساعت شماره 2 رو بردار -> {"action":"settime","ids":[2],"clear":true}
User: اسم شماره 2 رو تغییر بده به خرید نان تازه -> {"action":"rename","id":2,"text":"خرید نان تازه"}
User: کارام چیه -> {"action":"list"}
User: شماره 3 رو پاک کن -> {"action":"del","ids":[3]}
User: اون یکی رو پاک کن -> {"action":"chat","reply":"کدوم تسک رو حذف کنم؟ شماره‌ش رو بگو."}
User: همه رو حذف کن -> {"action":"del","all":true}
User: همه رو انجام دادم -> {"action":"done","all":true}
User: سلام -> {"action":"chat","reply":"سلام! چطور می‌تونم کمکت کنم؟"}`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if (secret !== env.WEBHOOK_SECRET) {
        return new Response("forbidden", { status: 403 });
      }

      // از اینجا به بعد همیشه 200، تا تلگرام پیام رو دوباره نفرسته
      try {
        const update = await request.json();
        const msg = update.message;
        if (!msg || !msg.text) return new Response("ok");

        if (String(msg.from?.id) !== env.ALLOWED_USER_ID) {
          return new Response("ok");
        }

        await handleMessage(env, msg);
      } catch (err) {
        console.error("webhook error", err);
      }
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
};

// ---------- منطق اصلی ----------

async function handleMessage(env, msg) {
  const chatId = msg.chat.id;
  const userText = normalizeText(msg.text.trim().slice(0, 1000));

  // دکمه‌ی Start خود تلگرام (دستور محصول نیست)
  if (userText === "/start") {
    await sendMessage(env, chatId, WELCOME);
    return;
  }

  // اگر منتظر تأیید حذف گروهی هستیم، اول جواب همون رو بررسی می‌کنیم
  const pend = await getState(env, "pending_delete");
  if (pend) {
    await delState(env, "pending_delete");
    if (isNo(userText)) {
      await respond(env, chatId, userText, "باشه، چیزی حذف نشد 👌");
      return;
    }
    if (isYes(userText)) {
      await respond(env, chatId, userText, await confirmDelete(env, pend));
      return;
    }
  }

  const tasks = await getTasks(env);
  const history = await getHistory(env);

  let decision = null;
  try {
    const raw = await askLLM(env, userText, tasks, history);
    decision = validate(parseJson(raw), tasks);
  } catch (err) {
    console.error("llm/parse failure", err);
  }

  let reply = FALLBACK;
  if (decision) {
    try {
      console.log("action:", decision.action);
      reply = await execute(env, decision, tasks);
    } catch (err) {
      console.error("execute failure", err);
    }
  } else {
    console.log("invalid LLM output -> fallback, nothing written");
  }

  await respond(env, chatId, userText, reply);
}

async function respond(env, chatId, userText, reply) {
  await saveHistory(env, userText, reply);
  await sendMessage(env, chatId, reply);
}

function isYes(s) {
  return /^(تایید|تأیید|آره|اره|بله|آری|اوکی|ok|yes)[\s.!]*$/i.test(s.trim());
}

function isNo(s) {
  return /^(نه|نخیر|لغو|بیخیال|no)[\s.!]*$/i.test(s.trim());
}

// ارقام فارسی/عربی -> انگلیسی، و «ي» و «ك» عربی -> «ی» و «ک» فارسی
function normalizeText(s) {
  const fa = "۰۱۲۳۴۵۶۷۸۹";
  const ar = "٠١٢٣٤٥٦٧٨٩";
  return s
    .replace(/[۰-۹]/g, (d) => fa.indexOf(d))
    .replace(/[٠-٩]/g, (d) => ar.indexOf(d))
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک");
}

// کلید مقایسه برای تشخیص تسک تکراری: بدون فاصله و علامت، حروف یکسان
function dupKey(s) {
  return normalizeText(s)
    .replace(/[\s\u200c.,،!؟?]+/g, "")
    .toLowerCase();
}
async function askLLM(env, userText, tasks, history) {
  const taskLines = tasks.length
    ? tasks
        .map((t) => `${t.id}|${t.done ? "done" : "open"}|${t.time ?? "-"}|${t.text}`)
        .join("\n")
    : "(none)";
  const hist = history.map((h) => `${h.role}: ${h.content}`).join("\n") || "(none)";

  const res = await env.AI.run(env.MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `NOW (Tehran): ${tehranNow()}\n\n` +
          `TASKS (id|status|due|text):\n${taskLines}\n\n` +
          `RECENT CONVERSATION:\n${hist}\n\nUSER MESSAGE:\n${userText}`,
      },
    ],
    max_tokens: 400,
    temperature: 0,
  });
  return res?.response ?? res?.choices?.[0]?.message?.content ?? "";
}

function parseJson(raw) {
  if (raw && typeof raw === "object") return raw;
  const m = String(raw ?? "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// ---------- اعتبارسنجی خروجی مدل ----------
// هر چیز نامعتبر = null = هیچ چیزی نوشته نمی‌شه

function validTime(v) {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function dayWord(v) {
  return v === "tomorrow" ? "tomorrow" : "today";
}

function validate(obj, tasks) {
  if (!obj || typeof obj !== "object") return null;
  if (!ACTIONS.includes(obj.action)) return null;

  switch (obj.action) {
    case "add": {
      if (!Array.isArray(obj.tasks)) return null;
      const items = [];
      for (const x of obj.tasks) {
        const text = typeof x?.text === "string" ? x.text.trim().slice(0, 200) : "";
        if (!text) continue;
        items.push({ text, time: validTime(x.time), day: dayWord(x.day) });
        if (items.length >= MAX_ADD) break;
      }
      return items.length ? { action: "add", items } : null;
    }
    case "done":
    case "undone":
    case "del": {
      let ids;
      if (obj.all === true) {
        // «همه»: کد خودش idها رو از دیتابیس برمی‌داره، نه مدل
        ids = tasks
          .filter((t) =>
            obj.action === "done" ? !t.done : obj.action === "undone" ? t.done : true
          )
          .map((t) => t.id);
        if (ids.length === 0) {
          return { action: "chat", reply: "تسکی برای این کار پیدا نشد." };
        }
      } else {
        if (!Array.isArray(obj.ids)) return null;
        const valid = new Set(tasks.map((t) => t.id));
        ids = [...new Set(obj.ids.map(Number))]
          .filter((n) => Number.isInteger(n) && valid.has(n))
          .slice(0, 50);
        if (ids.length === 0) return ASK_WHICH;
      }
      return { action: obj.action, ids };
    }
    case "rename": {
      const id = Number(obj.id);
      const text = typeof obj.text === "string" ? obj.text.trim().slice(0, 200) : "";
      if (!text) return null;
      if (!tasks.some((t) => t.id === id)) return ASK_WHICH;
      return { action: "rename", id, text };
    }
    case "settime": {
      if (!Array.isArray(obj.ids)) return null;
      const valid = new Set(tasks.map((t) => t.id));
      const ids = [...new Set(obj.ids.map(Number))]
        .filter((n) => Number.isInteger(n) && valid.has(n))
        .slice(0, 20);
      if (ids.length === 0) return ASK_WHICH;
      if (obj.clear === true) return { action: "settime", ids, mode: "clear" };
      const mins = Number(obj.in_minutes);
      if (Number.isInteger(mins) && mins >= 1 && mins <= 1440) {
        return { action: "settime", ids, mode: "in", minutes: mins };
      }
      const time = validTime(obj.time);
      if (time) return { action: "settime", ids, mode: "at", time, day: dayWord(obj.day) };
      return {
        action: "chat",
        reply: "ساعتش رو نفهمیدم. مثلاً بگو «ساعت ۸ شب» یا «۱۰ دقیقه دیگه».",
      };
    }
    case "list":
      return { action: "list" };
    case "chat": {
      const reply = typeof obj.reply === "string" ? obj.reply.trim() : "";
      if (!reply || reply.length > 1500) return null;
      return { action: "chat", reply };
    }
  }
  return null;
}

// ---------- اجرای اکشن ----------

async function execute(env, d, tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const names = (ids) => ids.map((id) => byId.get(id).text).join("، ");

  switch (d.action) {
    case "add": {
      const open = tasks.filter((t) => !t.done);
      const used = await getAllIds(env);
      const seen = new Set();
      const stmts = [];
      const lines = [];
      let rolledAny = false;

      for (const it of d.items) {
        const key = dupKey(it.text);
        let due = null;
        if (it.time) {
          const r = computeDue(it.time, it.day);
          due = r.due;
          if (r.rolled) rolledAny = true;
        }
        // تسک باز با همین متن؟ رد می‌شه (فقط اگر ساعت داده شده، به همون تسک ساعت می‌دیم)
        const dup = open.find((t) => dupKey(t.text) === key);
        if (dup) {
          if (due) {
            stmts.push(
              env.DB.prepare("UPDATE tasks SET time = ?, reminded = 0 WHERE id = ?").bind(due, dup.id)
            );
            lines.push(`⏰ از قبل بود؛ ساعتش ثبت شد: ${dup.id}. ${fmtDue(due)}${dup.text}`);
          } else {
            lines.push(`⚠️ از قبل هست: ${dup.id}. ${dup.text}`);
          }
          continue;
        }
        if (seen.has(key)) continue; // تکرار داخل همین پیام
        seen.add(key);

        const id = nextFreeId(used); // کوچک‌ترین شماره‌ی خالی
        used.add(id);
        stmts.push(
          env.DB.prepare("INSERT INTO tasks (id, text, time, reminded) VALUES (?, ?, ?, 0)").bind(
            id,
            it.text,
            due
          )
        );
        lines.push(`• ${id}. ${fmtDue(due)}${it.text}`);
      }
      if (stmts.length) await env.DB.batch(stmts);
      const head = stmts.length ? "✅ ثبت شد:" : "ℹ️ چیزی اضافه نشد:";
      return `${head}\n${lines.join("\n")}${rolledAny ? ROLLED_NOTE : ""}`;
    }
    case "done": {
      await env.DB.batch(
        d.ids.map((id) =>
          env.DB.prepare("UPDATE tasks SET done = 1, done_at = datetime('now') WHERE id = ?").bind(id)
        )
      );
      return `☑️ انجام شد: ${names(d.ids)}`;
    }
    case "undone": {
      await env.DB.batch(
        d.ids.map((id) =>
          env.DB.prepare("UPDATE tasks SET done = 0, done_at = NULL WHERE id = ?").bind(id)
        )
      );
      return `↩️ دوباره باز شد: ${names(d.ids)}`;
    }
    case "del": {
      // حذف چند تسک نیاز به تأیید داره
      if (d.ids.length >= 2) {
        await setState(env, "pending_delete", JSON.stringify({ ids: d.ids, at: Date.now() }));
        return `⚠️ ${d.ids.length} تسک حذف می‌شه:\n${d.ids
          .map((id) => `• ${id}. ${byId.get(id).text}`)
          .join("\n")}\n\nمطمئنی؟ بنویس «تایید» (یا «نه»).`;
      }
      await env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(d.ids[0]).run();
      return `🗑 حذف شد: ${names(d.ids)}`;
    }
    case "rename": {
      const old = byId.get(d.id).text;
      await env.DB.prepare("UPDATE tasks SET text = ? WHERE id = ?").bind(d.text, d.id).run();
      return `✏️ اسم عوض شد:\n${old}  ←  ${d.text}`;
    }
    case "settime": {
      let due = null;
      let note = "";
      if (d.mode === "at") {
        const r = computeDue(d.time, d.day);
        due = r.due;
        if (r.rolled) note = ROLLED_NOTE;
      } else if (d.mode === "in") {
        due = tehranNow(new Date(Date.now() + d.minutes * 60000));
      }
      await env.DB.batch(
        d.ids.map((id) =>
          env.DB.prepare("UPDATE tasks SET time = ?, reminded = 0 WHERE id = ?").bind(due, id)
        )
      );
      if (d.mode === "clear") return `👌 ساعت برداشته شد: ${names(d.ids)}`;
      if (d.mode === "in") return `⏰ ${d.minutes} دقیقه دیگه یادآوری می‌کنم: ${names(d.ids)}`;
      return `⏰ یادآوری تنظیم شد:\n${fmtDue(due)}${names(d.ids)}${note}`;
    }
    case "list":
      return formatList(tasks);
    case "chat":
      return d.reply;
  }
  return FALLBACK;
}

// بعد از «تایید»: فقط idهایی که هنوز وجود دارن حذف می‌شن، و تأیید بعد از ۲ دقیقه منقضی می‌شه
async function confirmDelete(env, pend) {
  let p = null;
  try {
    p = JSON.parse(pend);
  } catch {
    return "تأیید منقضی شده؛ دوباره بگو چی حذف بشه.";
  }
  if (!p || Date.now() - p.at > 120000 || !Array.isArray(p.ids)) {
    return "تأیید منقضی شده؛ دوباره بگو چی حذف بشه.";
  }
  const existing = await getAllIds(env);
  const ids = p.ids.filter((id) => existing.has(id));
  if (ids.length === 0) return "چیزی برای حذف نمونده.";
  await env.DB.batch(ids.map((id) => env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id)));
  return `🗑 ${ids.length} تسک حذف شد.`;
}

// ---------- دیتابیس ----------

async function getTasks(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, text, done, done_at, time FROM tasks ORDER BY done ASC, (time IS NULL), time, id LIMIT 50"
  ).all();
  return results;
}

async function getAllIds(env) {
  const { results } = await env.DB.prepare("SELECT id FROM tasks").all();
  return new Set(results.map((r) => r.id));
}

// کوچک‌ترین شماره‌ی خالی: اگر ۲ آزاد شده باشه، تسک بعدی شماره‌ی ۲ می‌گیره
function nextFreeId(used) {
  let i = 1;
  while (used.has(i)) i++;
  return i;
}

async function getHistory(env) {
  const { results } = await env.DB.prepare(
    "SELECT role, content FROM chat_history ORDER BY id DESC LIMIT 4"
  ).all();
  return results.reverse();
}

async function saveHistory(env, userText, reply) {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO chat_history (role, content) VALUES ('user', ?)").bind(userText),
    env.DB.prepare("INSERT INTO chat_history (role, content) VALUES ('assistant', ?)").bind(reply),
    env.DB.prepare(
      "DELETE FROM chat_history WHERE id NOT IN (SELECT id FROM chat_history ORDER BY id DESC LIMIT 20)"
    ),
  ]);
}

// پیام‌های خودکار (یادآوری) هم وارد حافظه‌ی کوتاه می‌شن تا «۱۰ دقیقه دیگه» بفهمه کدوم تسکه
async function addAssistantHistory(env, content) {
  await env.DB.prepare("INSERT INTO chat_history (role, content) VALUES ('assistant', ?)")
    .bind(content)
    .run();
}

// جدول state: حافظه‌ی کوچیک کلید/مقدار (آخرین پیام صبح/شب، streak، تأیید حذف)
async function getState(env, key) {
  const row = await env.DB.prepare("SELECT value FROM state WHERE key = ?").bind(key).first();
  return row?.value ?? null;
}

async function setState(env, key, value) {
  await env.DB.prepare(
    "INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  )
    .bind(key, value)
    .run();
}

async function delState(env, key) {
  await env.DB.prepare("DELETE FROM state WHERE key = ?").bind(key).run();
}

// ---------- نمایش ----------

function taskLine(t) {
  return `${t.id}. ${t.done ? "☑️" : "⬜"} ${fmtDue(t.time)}${t.text}`;
}

// لیست همه‌ی تسک‌ها؛ تسک انجام‌شده تا وقتی خود کاربر حذفش نکنه می‌مونه
function formatList(tasks) {
  const header = `📅 ${faDateLong(tehranToday())}`;
  if (tasks.length === 0) return `${header}\n\nهیچ تسکی نداری 🎉`;
  const doneCount = tasks.filter((t) => t.done).length;
  return `${header}\n${doneCount} از ${tasks.length} انجام شده\n\n${tasks.map(taskLine).join("\n")}`;
}

function fmtDue(due) {
  if (!due) return "";
  const [d, t] = due.split(" ");
  const today = tehranToday();
  if (d === today) return `⏰ ${t} — `;
  if (d === addDays(today, 1)) return `⏰ فردا ${t} — `;
  return `⏰ ${d} ${t} — `;
}

// ---------- زمان (همه‌چیز به وقت تهران) ----------
// مثل 2026-10-28 17:05
function tehranNow(date = new Date()) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)) {
    p[x.type] = x.value;
  }
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

function tehranToday(date = new Date()) {
  return tehranNow(date).slice(0, 10);
}

function tehranHour() {
  return Number(tehranNow().slice(11, 13));
}

function addDays(day, n) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

// متن UTC دیتابیس (مثل 2026-10-28 09:15:00) به Date
function utcToDate(s) {
  return new Date(s.replace(" ", "T") + "Z");
}

// ساعت HH:MM رو به زمان کامل تهران تبدیل می‌کنه؛ اگر امروز گذشته باشه می‌ره برای فردا
function computeDue(time, word) {
  const now = tehranNow();
  let day = now.slice(0, 10);
  if (word === "tomorrow") day = addDays(day, 1);
  let due = `${day} ${time}`;
  let rolled = false;
  if (due <= now) {
    due = `${addDays(day, 1)} ${time}`;
    rolled = true;
  }
  return { due, rolled };
}

// مثلاً «چهارشنبه ۶ آبان ۱۴۰۵»؛ اگر مشکلی بود همون تاریخ میلادی برمی‌گرده
function faDateLong(day) {
  try {
    const d = new Date(`${day}T12:00:00Z`);
    const weekday = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      timeZone: "UTC",
      weekday: "long",
    }).format(d);
    const date = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
      timeZone: "UTC",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
    return `${weekday} ${date}`;
  } catch {
    return day;
  }
}

// ---------- Cron (هر دقیقه) ----------

async function runCron(env) {
  try {
    await taskReminders(env);
  } catch (err) {
    console.error("reminders error", err);
  }
  try {
    await morningBrief(env);
  } catch (err) {
    console.error("morning error", err);
  }
  try {
    await eveningSummary(env);
  } catch (err) {
    console.error("evening error", err);
  }
}

// یادآوری سر وقت: فقط تسک‌های باز، با ساعت رسیده، که هنوز یادآوری نشده‌ان
async function taskReminders(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, text FROM tasks WHERE done = 0 AND reminded = 0 AND time IS NOT NULL AND time <= ? ORDER BY time, id LIMIT 20"
  )
    .bind(tehranNow())
    .all();

  for (const t of results) {
    const text = `⏰ وقتشه! (شماره ${t.id})\n${t.text}\n\nانجام شد؟ بنویس «${t.text} رو انجام دادم»، یا بگو «۱۰ دقیقه دیگه یادآوری کن».`;
    const res = await sendMessage(env, env.ALLOWED_USER_ID, text);
    // فقط بعد از ارسال موفق علامت می‌زنیم؛ اگر شکست خورد، دقیقه‌ی بعد دوباره امتحان می‌شه
    if (res.ok) {
      await env.DB.prepare("UPDATE tasks SET reminded = 1 WHERE id = ?").bind(t.id).run();
      await addAssistantHistory(env, text);
    }
  }
}

// پیام صبحگاهی: روزی یک بار، از ساعت 8 به بعد
async function morningBrief(env) {
  if (tehranHour() < 8) return;
  const today = tehranToday();
  if ((await getState(env, "last_morning")) === today) return;

  const tasks = await getTasks(env);
  const res = await sendMessage(env, env.ALLOWED_USER_ID, "☀️ صبح بخیر!\n" + formatList(tasks));
  if (res.ok) await setState(env, "last_morning", today);
}

// خلاصه‌ی شبانه با streak: چند روز پشت‌سرهم همه‌ی کارها تموم شده
async function eveningSummary(env) {
  if (tehranHour() < Number(env.EVENING_HOUR || "21")) return;
  const today = tehranToday();
  if ((await getState(env, "last_evening")) === today) return;

  const tasks = await getTasks(env);
  const doneToday = tasks.filter(
    (t) => t.done && t.done_at && tehranToday(utcToDate(t.done_at)) === today
  ).length;
  const open = tasks.filter((t) => !t.done).length;

  // اگؤ امروز اصلاً چیزی نبوده، پیامی نمی‌فرستیم
  if (doneToday + open === 0) {
    await setState(env, "last_evening", today);
    return;
  }
  const [n, lastDay] = ((await getState(env, "streak")) || "0|").split("|");
  let streak = 0;
  if (open === 0 && doneToday > 0) {
    streak = lastDay === today ? Number(n) : lastDay === addDays(today, -1) ? Number(n) + 1 : 1;
  }

  let text = `🌙 خلاصه‌ی امروز\n✅ ${doneToday} تا انجام شد\n⬜ ${open} تا مونده`;
  if (streak >= 2) text += `\n🔥 ${streak} روز پشت‌سرهم همه‌ی کارهات تموم شد!`;
  else if (open === 0) text += "\n🎉 همه‌ی کارها تموم شد!";

  const res = await sendMessage(env, env.ALLOWED_USER_ID, text);
  if (res.ok) {
    await setState(env, "streak", `${streak}|${streak ? today : ""}`);
    await setState(env, "last_evening", today);
  }
}

// ---------- تلگرام ----------

async function sendMessage(env, chatId, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text }),
    }
  );
  console.log("Telegram sendMessage status:", response.status);
  return response;
}