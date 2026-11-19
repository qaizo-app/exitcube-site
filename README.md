# ExitCube site

Static site for https://exitcube.co.il. Everything served lives in `public/`.

- `src/page.html` — landing page template
- `src/trex.html` — Operation T-Rex page (`/t-rex/`, `/ru/t-rex/`, `/en/t-rex/`), uses the landing's CSS
- `src/strings.json` — all texts, per language (he / ru / en); `{{trex_price}}`,
  `{{delivery_price}}`, `{{booking_from}}` inside a text are filled from `site.json`
- `src/site.json` — phone, WhatsApp number, T-Rex price, delivery surcharge and the
  first bookable date (change here, then rebuild)
- `tools/build.py` — builds `public/`: one page per language (`/`, `/ru/`, `/en/`),
  privacy and accessibility pages, `sitemap.xml`, `robots.txt`

After editing anything in `src/` or the legal texts in `tools/build.py`, run:

    python3 tools/build.py

and commit the result. Cloudflare (see `wrangler.jsonc`) deploys every push to `main`.
There is no build step on Cloudflare.

## Waitlist backend

`worker/index.js` handles `POST /api/lead`: it stores the form (incl. party date and
pick-up/delivery) in the D1 database (binding `DB`, tables and new columns are created
on first use) and sends a Telegram notice. `GET /api/busy` lists future dates that
already have a request with status «Бронь» for T-Rex (or «Любая»): there is one box,
so the form warns when such a date is picked. Mark a request «Бронь» in admin to
block its date.
The bot key lives only in Cloudflare (Settings → Runtime variables and secrets,
not the Build section) — currently named `TELEGRAM_BOT`; any name containing
"telegram" works. Never commit it.
The notice goes to whoever pressed Start in the bot first; set the variable
`TELEGRAM_CHAT_ID` to override. Local run: `npx wrangler dev`.

## Admin panel

`/admin` — list of requests with status, note, WhatsApp/call buttons, search,
filter, delete and CSV export. Sign-in: a 6-digit code the bot sends to the
owner's Telegram (5 min, 5 tries), then a 30-day signed cookie. No password or
extra secret to configure. API: `/api/admin/{code,login,logout,leads,update,delete}`.
Statuses: new, contacted, waiting, booked, closed.

## Gotchas

- Pressing Deploy on a Cloudflare settings page that was opened before the
  latest push redeploys the old version. Reload the page first.
- Same phone within 10 minutes updates the earlier request and sends no new notice.

## Status and to-do (as of 19.11.2026)

Working: site in he/ru/en on exitcube.co.il, form → D1 → Telegram, WhatsApp
button on 058-699-5577, admin panel.

To do:
1. Add `www.exitcube.co.il` as a custom domain in Cloudflare.
2. Google Search Console + submit `sitemap.xml`.
3. Games counter per box (owner's request 17.11): boxes report finished games
   over their LTE modem to a new endpoint; manual entry from admin until then.
   Open question: show publicly on the site or only in admin. Idea: hide a
   box's counter on the public site until it passes ~10 games.
4. Batched text fixes, incl. Hebrew headline «שמגיע אליכם» vs «שמגיע עד אליכם».
5. Done 19.11: T-Rex page with prices, date and delivery in the form, busy dates.
   Later: time of day, online prepayment, deposit and cancellation terms on the page.
6. Delete test requests №1–3 from admin once real ones arrive.
