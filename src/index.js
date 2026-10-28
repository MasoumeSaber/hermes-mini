const ACTIONS = ["add", "done", "undone", "del", "list", "chat"];
const FALLBACK = "متوجه نشدم. می‌شه یک جور دیگه بگی؟ 🙏";

const SYSTEM_PROMPT = `You are the brain of a personal Persian task-manager Telegram bot.
Read the user's message and output EXACTLY ONE LINE of JSON and nothing else (no markdown, no explanation).

Allowed outputs:
{"action":"add","text":"<short task title in Persian>"}
{"action":"done","ids":[<task ids>]}
{"action":"undone","ids":[<task ids>]}
{"action":"del","ids":[<task ids>]}
{"action":"list"}
{"action":"chat","reply":"<Persian reply>"}
Special form: {"action":"del","all":true} (also allowed for done and undone) means every task.

Rules:
- ids must come ONLY from the TASKS list. Never invent ids.
- If the user says they bought/finished/did something, use done with the id of the matching task.
- If the user says they have not done it / undo, use undone.
- For delete: "number 3" or "شماره 3" means id 3. "delete all", "همه رو حذف کن" or "همه رو پاک کن" means {"action":"del","all":true}. "this one" or "the last one" refers to the task most recently mentioned in RECENT CONVERSATION; if you cannot tell which task, use chat and ask which one.
- Any request to see, show or list the tasks (for example "کارام چیه", "چیه کارام", "لیست", "چی دارم") MUST be list, never chat.
- Use chat only for greetings, thanks, general questions, or when you must ask a clarifying question.
- If the message is ambiguous or unclear, use chat and ask a short clarifying question in Persian. Never guess a destructive action.
- Always write text and reply in Persian.

Examples:
User: شیر بخر -> {"action":"add","text":"خرید شیر"}
User: نان بخرم -> {"action":"add","text":"خرید نان"}
User: شیر رو خریدم (TASKS has 4|open|خرید شیر) -> {"action":"done","ids":[4]}
User: کارام چیه -> {"action":"list"}
User: چیه کارام -> {"action":"list"}
User: لیست کارهام رو بگو -> {"action":"list"}
User: شماره 3 رو پاک کن -> {"action":"del","ids":[3]}
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

  await saveHistory(env, userText, reply);
  await sendMessage(env, chatId, reply);
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

async function askLLM(env, userText, tasks, history) {
  const taskLines = tasks.length
    ? tasks.map((t) => `${t.id}|${t.done ? "done" : "open"}|${t.text}`).join("\n")
    : "(none)";
  const hist = history.map((h) => `${h.role}: ${h.content}`).join("\n") || "(none)";

  const res = await env.AI.run(env.MODEL, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `TASKS (id|status|text):\n${taskLines}\n\nRECENT CONVERSATION:\n${hist}\n\nUSER MESSAGE:\n${userText}`,
      },
    ],
    max_tokens: 300,
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

// اعتبارسنجی خروجی مدل؛ هر چیز نامعتبر = null = هیچ چیزی نوشته نمی‌شه
function validate(obj, tasks) {
  if (!obj || typeof obj !== "object") return null;
  if (!ACTIONS.includes(obj.action)) return null;

  switch (obj.action) {
    case "add": {
      const text = typeof obj.text === "string" ? obj.text.trim() : "";
      if (!text || text.length > 200) return null;
      return { action: "add", text };
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
        if (ids.length === 0) {
          return {
            action: "chat",
            reply: "کدوم تسک رو می‌گی؟ شماره‌ش رو بگو، یا اول بنویس «کارام چیه».",
          };
        }
      }
      return { action: obj.action, ids };
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

async function execute(env, d, tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const names = (ids) => ids.map((id) => byId.get(id).text).join("، ");

  switch (d.action) {
    case "add": {
      await env.DB.prepare("INSERT INTO tasks (text) VALUES (?)").bind(d.text).run();
      return `✅ اضافه شد: ${d.text}`;
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
      await env.DB.batch(
        d.ids.map((id) => env.DB.prepare("DELETE FROM tasks WHERE id = ?").bind(id))
      );
      return `🗑 حذف شد: ${names(d.ids)}`;
    }
    case "list":
      return formatList(tasks);
    case "chat":
      return d.reply;
  }
  return FALLBACK;
}

// ---------- دیتابیس ----------
async function getTasks(env) {
  const { results } = await env.DB.prepare(
    "SELECT id, text, done, done_at FROM tasks ORDER BY done ASC, id ASC LIMIT 50"
  ).all();
  return results;
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

// ---------- نمایش و زمان ----------

function formatList(tasks) {
  const today = tehranToday();
  const shown = tasks.filter(
    (t) =>
      !t.done ||
      (t.done_at && tehranToday(new Date(t.done_at.replace(" ", "T") + "Z")) === today)
  );
  if (shown.length === 0) return "هیچ تسکی نداری 🎉";
  return (
    "📋 تسک‌ها:\n" +
    shown.map((t) => `${t.id}. ${t.done ? "☑️" : "⬜"} ${t.text}`).join("\n")
  );
}

// تاریخ امروز به وقت تهران، مثل 2026-10-28
function tehranToday(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
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

// ساعت فعلی تهران (0 تا 23)
function tehranHour(date = new Date()) {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tehran",
      hour: "2-digit",
      hour12: false,
    }).format(date)
  );
}

// ---------- Cron ----------

async function runCron(env) {
  try {
    await morningBrief(env);
  } catch (err) {
    console.error("cron error", err);
  }
}

async function morningBrief(env) {
  const today = tehranToday();
  if (tehranHour() < 8) return;

  const row = await env.DB.prepare(
    "SELECT value FROM state WHERE key = 'last_morning'"
  ).first();
  if (row?.value === today) return; // امروز قبلاً فرستاده شده

  const tasks = await getTasks(env);
  const res = await sendMessage(
    env,
    env.ALLOWED_USER_ID,
    "☀️ صبح بخیر!\n" + formatList(tasks)
  );

  // فقط بعد از ارسال موفق علامت می‌زنیم، تا اگه شکست خورد اجرای بعدی دوباره امتحان کنه
  if (res.ok) {
    await env.DB.prepare(
      "INSERT INTO state (key, value) VALUES ('last_morning', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
      .bind(today)
      .run();
  }
}