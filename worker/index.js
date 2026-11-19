// ExitCube backend: stores booking requests from the site form in D1 and
// notifies the owner in Telegram. GET /api/busy lists dates already booked
// (requests with status "booked"), so the form can warn about them. Everything else is served as static assets.
//
// Bindings (wrangler.jsonc):  DB (D1), ASSETS (static files)
// Secrets (Cloudflare dashboard):  TELEGRAM_BOT_TOKEN
// Admin panel (/admin): sign-in by a one-time code the bot sends to the owner's
// Telegram chat; no password or extra secret to configure.
// Optional variable:  TELEGRAM_CHAT_ID — if absent, the chat that first sent
// /start to the bot is used and remembered.

const SITE_HOSTS = new Set(["exitcube.co.il", "www.exitcube.co.il"]);
const MISSIONS = { any: "Любая", trex: "Операция Т-Рекс", space: "Космические агенты (6 кубов)", magic: "Волшебные миссии" };
const LANGS = { he: "иврит", ru: "русский", en: "английский" };
const DELIVERY = { pickup: "самовывоз", delivery: "доставка и возврат" };
// Missions that use the single T-Rex box: one booking per date.
const ONE_BOX = ["trex", "any"];
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
		if (url.pathname === "/api/busy") return handleBusy(env);
		if (url.pathname.startsWith("/api/admin/")) return handleAdmin(request, env, url.pathname.slice(11));
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
	// Columns added after launch; ALTER fails harmlessly once they exist.
	for (const col of ["event_date TEXT", "delivery TEXT"]) {
		try {
			await db.prepare(`ALTER TABLE leads ADD COLUMN ${col}`).run();
		} catch (e) {
			if (!/duplicate column/i.test(String(e?.message || e))) throw e;
		}
	}
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

const today = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" }); // YYYY-MM-DD

// A party date: YYYY-MM-DD, from today up to a year and a half ahead; anything else is dropped.
function eventDate(v) {
	const d = clean(v, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d + "T00:00:00Z"))) return null;
	const max = new Date(Date.now() + 548 * 86_400_000).toISOString().slice(0, 10);
	return d >= today() && d <= max ? d : null;
}
const ruDate = (d) => (d ? d.split("-").reverse().join(".") : "—");

async function bookedDates(db) {
	const rows = await db
		.prepare(`SELECT DISTINCT event_date FROM leads WHERE status = 'booked' AND event_date >= ? AND mission IN ('trex', 'any') ORDER BY event_date`)
		.bind(today())
		.all();
	return (rows.results || []).map((r) => r.event_date);
}

async function handleBusy(env) {
	await ensureSchema(env.DB);
	const res = json({ ok: true, dates: await bookedDates(env.DB) });
	res.headers.set("cache-control", "public, max-age=60");
	return res;
}

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
		event_date: eventDate(data.date),
		delivery: Object.hasOwn(DELIVERY, data.delivery) ? data.delivery : null,
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
			.prepare(`UPDATE leads SET name = ?, city = ?, kids = ?, age = ?, mission = ?, lang = ?, event_date = ?, delivery = ? WHERE id = ?`)
			.bind(lead.name, lead.city, lead.kids, lead.age, lead.mission, lead.lang, lead.event_date, lead.delivery, dup.id)
			.run();
		return json({ ok: true });
	}

	const res = await db
		.prepare(
			`INSERT INTO leads (created_at, name, phone, city, kids, age, mission, lang, event_date, delivery, consent)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
		)
		.bind(nowIso, lead.name, lead.phone, lead.city, lead.kids, lead.age, lead.mission, lead.lang, lead.event_date, lead.delivery)
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
	const token = botToken(env);
	if (!token) return;
	const chat = await telegramChatId(env, db, token);
	if (!chat) return;

	const taken = lead.event_date && ONE_BOX.includes(lead.mission) && (await bookedDates(db)).includes(lead.event_date);
	const lines = [
		`🟢 Новая заявка ExitCube${id ? " №" + id : ""}`,
		`Дата: ${ruDate(lead.event_date)}${taken ? " ⚠️ уже есть бронь на эту дату" : ""}`,
		`Получение: ${DELIVERY[lead.delivery] || "—"}`,
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

// The secret is meant to be called TELEGRAM_BOT_TOKEN, but accept any dashboard
// name that mentions Telegram (e.g. TELEGRAM_BOT) as long as the value has the
// shape of a bot key, so a naming slip does not silently switch notices off.
// Shape of the stored key, with no characters of it revealed.
function keyShape(env) {
	let raw = "";
	for (const k of Object.keys(env)) if (/telegram|tg_?bot/i.test(k) && typeof env[k] === "string") { raw = env[k]; break; }
	if (!raw) return "переменной с Telegram в названии нет";
	const i = raw.indexOf(":");
	const odd = [...raw].filter((c) => !/[\w:-]/.test(c)).length;
	const parts = [`всего ${raw.length} симв. (нужно 46)`];
	if (i < 0) parts.push("двоеточия нет");
	else parts.push(`до двоеточия ${i} (нужно 10 цифр${/^\d+$/.test(raw.slice(0, i)) ? "" : ", а там не только цифры"})`, `после двоеточия ${raw.length - i - 1} (нужно 35)`);
	parts.push(odd ? `посторонних знаков (пробел, кавычка, точка и т.п.): ${odd}` : "посторонних знаков нет");
	if (raw !== raw.trim()) parts.push("есть пробел или перенос строки в начале или в конце");
	return parts.join("; ");
}

function botToken(env) {
	// Pull the key out of the value even if a stray quote, space or dot was pasted around it.
	const pick = (v) => {
		if (typeof v !== "string") return "";
		const m = v.match(/\d{6,}:[\w-]{30,}/);
		return m ? m[0] : "";
	};
	const direct = pick(env.TELEGRAM_BOT_TOKEN);
	if (direct) return direct;
	for (const key of Object.keys(env)) {
		if (!/telegram|tg_?bot/i.test(key)) continue;
		const found = pick(env[key]);
		if (found) return found;
		// Name says Telegram but the shape is unusual: still try it, Telegram will judge.
		if (typeof env[key] === "string" && env[key].trim().length > 20) return env[key].trim().replace(/^["'\s]+|["'\s.,;]+$/g, "");
	}
	return "";
}

// ---------------------------------------------------------------------------
// Admin panel API. Only the owner can sign in: the code goes to the Telegram
// chat that receives the requests.
const STATUSES = ["new", "contacted", "waiting", "booked", "closed"];
const CODE_TTL_MS = 5 * 60_000;
const CODE_RESEND_MS = 60_000;
const CODE_MAX_TRIES = 5;
const SESSION_DAYS = 30;
const COOKIE = "xc_admin";

const getSetting = async (db, key) => (await db.prepare(`SELECT value FROM settings WHERE key = ?`).bind(key).first())?.value ?? null;
const setSetting = (db, key, value) => db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).bind(key, value).run();
const delSetting = (db, key) => db.prepare(`DELETE FROM settings WHERE key = ?`).bind(key).run();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function adminKey(db) {
	let key = await getSetting(db, "admin_key");
	if (!key) {
		key = hex(crypto.getRandomValues(new Uint8Array(32)));
		await setSetting(db, "admin_key", key);
	}
	return key;
}

async function sign(keyHex, message) {
	const raw = new Uint8Array(keyHex.match(/../g).map((h) => Number.parseInt(h, 16)));
	const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function sameText(a, b) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

async function signedIn(request, db) {
	const m = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=(\\d+)\\.([0-9a-f]{64})`));
	if (!m) return false;
	if (Number(m[1]) < Date.now()) return false;
	return sameText(m[2], await sign(await adminKey(db), "session:" + m[1]));
}

const cookieHeader = (value, maxAge) => `${COOKIE}=${value}; Path=/api/admin; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

async function readJson(request) {
	const raw = await request.text();
	if (raw.length > 4000) return null;
	try {
		const data = JSON.parse(raw || "{}");
		return data && typeof data === "object" ? data : null;
	} catch {
		return null;
	}
}

async function handleAdmin(request, env, action) {
	const db = env.DB;
	await ensureSchema(db);
	const post = request.method === "POST";
	if (post && !allowedOrigin(request)) return json({ ok: false, error: "origin" }, 403);

	if (action === "code" && post) {
		const token = botToken(env);
		const chat = token ? await telegramChatId(env, db, token) : null;
		if (!chat) return json({ ok: false, error: "no_telegram" }, 503);
		const prev = JSON.parse((await getSetting(db, "admin_code")) || "null");
		if (prev && Date.now() - prev.sent < CODE_RESEND_MS) return json({ ok: false, error: "wait" }, 429);
		const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
		const now = Date.now();
		await setSetting(db, "admin_code", JSON.stringify({ h: await sign(await adminKey(db), "code:" + code), exp: now + CODE_TTL_MS, sent: now, tries: 0 }));
		const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ chat_id: chat, text: `🔑 Код входа в админку ExitCube: ${code}\nДействует 5 минут. Если это не ты — просто не вводи его.` }),
		});
		if (!r.ok) return json({ ok: false, error: "no_telegram" }, 503);
		return json({ ok: true });
	}

	if (action === "login" && post) {
		const data = await readJson(request);
		const code = clean(data?.code, 12).replace(/\D/g, "");
		const saved = JSON.parse((await getSetting(db, "admin_code")) || "null");
		if (!saved || saved.exp < Date.now()) return json({ ok: false, error: "expired" }, 400);
		if (saved.tries >= CODE_MAX_TRIES) {
			await delSetting(db, "admin_code");
			return json({ ok: false, error: "expired" }, 400);
		}
		if (code.length !== 6 || !sameText(saved.h, await sign(await adminKey(db), "code:" + code))) {
			await setSetting(db, "admin_code", JSON.stringify({ ...saved, tries: saved.tries + 1 }));
			return json({ ok: false, error: "wrong", left: CODE_MAX_TRIES - saved.tries - 1 }, 400);
		}
		await delSetting(db, "admin_code");
		const exp = Date.now() + SESSION_DAYS * 86_400_000;
		const res = json({ ok: true });
		res.headers.set("set-cookie", cookieHeader(`${exp}.${await sign(await adminKey(db), "session:" + exp)}`, SESSION_DAYS * 86_400));
		return res;
	}

	if (action === "logout" && post) {
		const res = json({ ok: true });
		res.headers.set("set-cookie", cookieHeader("", 0));
		return res;
	}

	if (!(await signedIn(request, db))) return json({ ok: false, error: "auth" }, 401);

	if (action === "leads" && request.method === "GET") {
		const rows = await db
			.prepare(`SELECT id, created_at, name, phone, city, kids, age, mission, lang, event_date, delivery, status, note FROM leads ORDER BY id DESC LIMIT 1000`)
			.all();
		const leads = (rows.results || []).map((l) => ({
			...l,
			wa: waNumber(l.phone),
			mission_name: MISSIONS[l.mission] || l.mission,
			lang_name: LANGS[l.lang] || l.lang,
			delivery_name: DELIVERY[l.delivery] || "",
		}));
		return json({ ok: true, leads });
	}

	if (action === "update" && post) {
		const data = await readJson(request);
		const id = Number.parseInt(data?.id, 10);
		if (!Number.isInteger(id)) return json({ ok: false, error: "id" }, 400);
		if (data.status !== undefined) {
			if (!STATUSES.includes(data.status)) return json({ ok: false, error: "status" }, 400);
			await db.prepare(`UPDATE leads SET status = ? WHERE id = ?`).bind(data.status, id).run();
		}
		if (data.note !== undefined) await db.prepare(`UPDATE leads SET note = ? WHERE id = ?`).bind(clean(data.note, 500), id).run();
		if (data.event_date !== undefined) {
			// The owner may set any date here, past ones too (e.g. a game agreed by phone).
			const d = clean(data.event_date, 10);
			if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ ok: false, error: "date" }, 400);
			await db.prepare(`UPDATE leads SET event_date = ? WHERE id = ?`).bind(d || null, id).run();
		}
		return json({ ok: true });
	}

	if (action === "delete" && post) {
		const data = await readJson(request);
		const id = Number.parseInt(data?.id, 10);
		if (!Number.isInteger(id)) return json({ ok: false, error: "id" }, 400);
		await db.prepare(`DELETE FROM leads WHERE id = ?`).bind(id).run();
		return json({ ok: true });
	}

	return json({ ok: false, error: "not_found" }, 404);
}
