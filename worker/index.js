// ExitCube backend: stores waitlist requests from the site form in D1 and
// notifies the owner in Telegram. Everything else is served as static assets.
//
// Bindings (wrangler.jsonc):  DB (D1), ASSETS (static files)
// Secrets (Cloudflare dashboard):  TELEGRAM_BOT_TOKEN
// Optional variable:  TELEGRAM_CHAT_ID — if absent, the chat that first sent
// /start to the bot is used and remembered.

const SITE_HOSTS = new Set(["exitcube.co.il", "www.exitcube.co.il"]);
const MISSIONS = { any: "Любая", trex: "Операция Т-Рекс", space: "Космические агенты (6 кубов)", magic: "Волшебные миссии" };
const LANGS = { he: "иврит", ru: "русский", en: "английский" };
const DEDUP_MINUTES = 10; // same phone again within this window updates the earlier request
const HOURLY_CAP = 60; // crude flood guard for the whole site

const json = (body, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
	});

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === "/api/lead") return handleLead(request, env, ctx);
		if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "not_found" }, 404);
		return env.ASSETS.fetch(request);
	},
};

let schemaReady = false;
async function ensureSchema(db) {
	if (schemaReady) return;
	await db.batch([
		db.prepare(
			`CREATE TABLE IF NOT EXISTS leads (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				created_at TEXT NOT NULL,
				name TEXT, phone TEXT NOT NULL, city TEXT,
				kids INTEGER, age TEXT, mission TEXT, lang TEXT,
				consent INTEGER NOT NULL DEFAULT 0,
				status TEXT NOT NULL DEFAULT 'new',
				note TEXT
			)`,
		),
		db.prepare(`CREATE INDEX IF NOT EXISTS leads_phone ON leads(phone)`),
		db.prepare(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`),
	]);
	schemaReady = true;
}

function allowedOrigin(request) {
	const origin = request.headers.get("origin");
	if (!origin) return false;
	let host;
	try {
		host = new URL(origin).hostname;
	} catch {
		return false;
	}
	return SITE_HOSTS.has(host) || host.endsWith(".workers.dev") || host === "localhost" || host === "127.0.0.1";
}

const clean = (v, max) =>
	String(v ?? "")
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.trim()
		.slice(0, max);

async function handleLead(request, env, ctx) {
	if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
	if (!allowedOrigin(request)) return json({ ok: false, error: "origin" }, 403);

	const raw = await request.text();
	if (raw.length > 4000) return json({ ok: false, error: "too_large" }, 413);
	let data;
	try {
		data = JSON.parse(raw);
	} catch {
		return json({ ok: false, error: "bad_json" }, 400);
	}
	if (!data || typeof data !== "object") return json({ ok: false, error: "bad_json" }, 400);

	// Honeypot: real visitors never see or fill this field. Pretend it worked.
	if (clean(data.website, 100)) return json({ ok: true });

	const phone = clean(data.phone, 30).replace(/[^\d+]/g, "");
	const digits = phone.replace(/\D/g, "");
	if (digits.length < 9 || digits.length > 15) return json({ ok: false, error: "phone" }, 400);
	if (data.consent !== true) return json({ ok: false, error: "consent" }, 400);

	const kidsNum = Number.parseInt(data.kids, 10);
	const lead = {
		name: clean(data.name, 80),
		phone,
		city: clean(data.city, 80),
		kids: Number.isInteger(kidsNum) && kidsNum >= 1 && kidsNum <= 30 ? kidsNum : null,
		age: clean(data.age, 20),
		mission: Object.hasOwn(MISSIONS, data.mission) ? data.mission : "any",
		lang: Object.hasOwn(LANGS, data.lang) ? data.lang : "he",
	};

	const db = env.DB;
	await ensureSchema(db);
	const now = new Date();
	const nowIso = now.toISOString();

	const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
	const recent = await db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at > ?`).bind(hourAgo).first();
	if (recent && recent.n >= HOURLY_CAP) return json({ ok: false, error: "busy" }, 429);

	const since = new Date(now.getTime() - DEDUP_MINUTES * 60_000).toISOString();
	const dup = await db
		.prepare(`SELECT id FROM leads WHERE phone = ? AND created_at > ? ORDER BY id DESC LIMIT 1`)
		.bind(lead.phone, since)
		.first();

	if (dup) {
		await db
			.prepare(`UPDATE leads SET name = ?, city = ?, kids = ?, age = ?, mission = ?, lang = ? WHERE id = ?`)
			.bind(lead.name, lead.city, lead.kids, lead.age, lead.mission, lead.lang, dup.id)
			.run();
		return json({ ok: true });
	}

	const res = await db
		.prepare(
			`INSERT INTO leads (created_at, name, phone, city, kids, age, mission, lang, consent)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		)
		.bind(nowIso, lead.name, lead.phone, lead.city, lead.kids, lead.age, lead.mission, lead.lang)
		.run();

	ctx.waitUntil(notifyTelegram(env, db, lead, res.meta?.last_row_id).catch((e) => console.error("telegram", e)));
	return json({ ok: true });
}

// 0527392229 -> 972527392229, for a wa.me link the owner can tap.
function waNumber(phone) {
	const d = phone.replace(/\D/g, "");
	if (phone.startsWith("+")) return d;
	if (d.startsWith("972")) return d;
	if (d.startsWith("0")) return "972" + d.slice(1);
	return d;
}

async function telegramChatId(env, db, token) {
	if (env.TELEGRAM_CHAT_ID) return String(env.TELEGRAM_CHAT_ID);
	const saved = await db.prepare(`SELECT value FROM settings WHERE key = 'tg_chat'`).first();
	if (saved?.value) return saved.value;

	// First run: the owner is whoever pressed Start in the bot first.
	const r = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=%5B%22message%22%5D`);
	if (!r.ok) return null;
	const body = await r.json();
	const first = (body.result || []).find((u) => u.message?.chat?.type === "private" && (u.message.text || "").startsWith("/start"));
	if (!first) return null;
	const id = String(first.message.chat.id);
	await db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('tg_chat', ?)`).bind(id).run();
	return id;
}

async function notifyTelegram(env, db, lead, id) {
	const token = env.TELEGRAM_BOT_TOKEN;
	if (!token) return;
	const chat = await telegramChatId(env, db, token);
	if (!chat) return;

	const lines = [
		`🟢 Новая заявка ExitCube${id ? " №" + id : ""}`,
		`Имя: ${lead.name || "—"}`,
		`Телефон: ${lead.phone}`,
		`Город: ${lead.city || "—"}`,
		`Миссия: ${MISSIONS[lead.mission]}`,
		`Детей: ${lead.kids ?? "—"}, возраст: ${lead.age || "—"}`,
		`Язык сайта: ${LANGS[lead.lang]}`,
		`Написать: https://wa.me/${waNumber(lead.phone)}`,
	];
	await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ chat_id: chat, text: lines.join("\n"), disable_web_page_preview: true }),
	});
}
