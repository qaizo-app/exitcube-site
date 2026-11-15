#!/usr/bin/env python3
"""Builds the static ExitCube site into public/.

Sources:  src/page.html (landing template), src/strings.json (texts per language),
          src/site.json (phone etc.), and the legal texts below.
Output:   public/index.html (Hebrew), public/ru/, public/en/, legal pages,
          sitemap.xml, robots.txt.  Run:  python3 tools/build.py
"""
import json, re, html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUB = ROOT / "public"
BASE = "https://exitcube.co.il"
LANGS = ["he", "ru", "en"]
HOME = {"he": "/", "ru": "/ru/", "en": "/en/"}
LOCALE = {"he": "he_IL", "ru": "ru_RU", "en": "en_US"}
FONT = {"he": "rubik-hebrew-wght-normal.woff2", "ru": "rubik-cyrillic-wght-normal.woff2", "en": "rubik-latin-wght-normal.woff2"}
UPDATED = "15.11.2026"
_TA = "/Attraction_Review-g1137841-d7751597-Reviews-ExitGame_Israel_LTD-Ashdod_Southern_District.html"
TRIPADVISOR = {"he": "https://www.tripadvisor.co.il" + _TA, "ru": "https://www.tripadvisor.ru" + _TA, "en": "https://www.tripadvisor.com" + _TA}

T = json.loads((ROOT / "src/strings.json").read_text(encoding="utf8"))
SITE = json.loads((ROOT / "src/site.json").read_text(encoding="utf8"))
PAGE = (ROOT / "src/page.html").read_text(encoding="utf8")

ALT = {
    "he": {"hero": "ילדים מושיטים ידיים אל ביצת דינוזאור זוהרת בתוך קופסת משימה", "m1": "ביצת דינוזאור זוהרת בקופסת המשימה", "m2": "קוביות משימה עם אשנבים ירוקים זוהרים", "m3": "תיבת קסמים עם גביע זוהר ושיקויים"},
    "ru": {"hero": "Дети тянут руки к светящемуся яйцу динозавра в квест-боксе", "m1": "Светящееся яйцо динозавра в квест-боксе", "m2": "Квест-кубы со светящимися зелёными иллюминаторами", "m3": "Волшебный сундук со светящимся кубком и зельями"},
    "en": {"hero": "Kids reaching toward a glowing dinosaur egg inside a mission box", "m1": "Glowing dinosaur egg in the mission box", "m2": "Mission cubes with glowing green portholes", "m3": "Magic chest with a glowing goblet and potions"},
}

LEGAL = {
    "privacy": {
        "he": ("מדיניות פרטיות", [
            ("מי אנחנו", "ExitCube מפעילה חדרי בריחה ניידים לימי הולדת, מאשדוד. לכל שאלה בנושא פרטיות אפשר לפנות אלינו בטלפון או בוואטסאפ: {phone}."),
            ("איזה מידע נאסף", "האתר אינו דורש הרשמה. כשאתם שולחים את הטופס, אנחנו שומרים את מה שמילאתם: שם, טלפון, עיר, מספר הילדים, גילם והמשימה שמעניינת אתכם. הטופס נשלח רק לאחר שסימנתם את האישור. אם תשלחו גם את הודעת הוואטסאפ, נראה אותה ואת מספר הטלפון שלכם."),
            ("למה אנחנו משתמשים במידע", "כדי לחזור אליכם בנוגע להשקה ולהזמנות. איננו מוכרים ואיננו מעבירים את הפרטים לגורמים אחרים."),
            ("עוגיות ומעקב", "האתר אינו משתמש בעוגיות פרסום או מעקב."),
            ("איפה המידע נשמר", "האתר ומאגר הפניות מתארחים אצל Cloudflare, ששומרת גם נתונים טכניים (כמו כתובת IP) לצורכי אבטחה ותפעול. הודעה על כל פנייה חדשה נשלחת אלינו בטלגרם."),
            ("ילדים", "האתר מיועד להורים. איננו אוספים ביודעין מידע מילדים."),
            ("הזכויות שלכם", "אפשר לבקש לעיין במידע שנמצא אצלנו, לתקן אותו או למחוק אותו. פנו אלינו ונטפל בבקשה."),
            ("עדכונים", "ייתכן שנעדכן מדיניות זו מעת לעת. עדכון אחרון: {date}."),
        ]),
        "ru": ("Политика конфиденциальности", [
            ("Кто мы", "ExitCube проводит мобильные квесты на дни рождения, мы работаем из Ашдода. По вопросам конфиденциальности пишите или звоните: {phone}."),
            ("Какие данные собираются", "Сайт не требует регистрации. Когда вы отправляете форму, мы сохраняем то, что вы в ней указали: имя, телефон, город, число детей, их возраст и интересующую миссию. Форма отправляется только после того, как вы отметили согласие. Если вы отправите ещё и сообщение в WhatsApp, мы увидим его текст и ваш номер."),
            ("Зачем нам эти данные", "Чтобы ответить вам о запуске и бронировании. Мы не продаём и не передаём ваши данные третьим лицам."),
            ("Cookie и отслеживание", "Сайт не использует рекламные и отслеживающие cookie."),
            ("Где хранятся данные", "Сайт и база заявок размещены в Cloudflare, который хранит также технические данные (например, IP-адрес) для безопасности и работы сервиса. Уведомление о каждой новой заявке приходит нам в Telegram."),
            ("Дети", "Сайт предназначен для родителей. Мы сознательно не собираем данные детей."),
            ("Ваши права", "Вы можете попросить показать, исправить или удалить данные, которые есть у нас. Напишите нам, и мы это сделаем."),
            ("Изменения", "Мы можем время от времени обновлять эту политику. Последнее обновление: {date}."),
        ]),
        "en": ("Privacy policy", [
            ("Who we are", "ExitCube runs mobile escape games for birthday parties, based in Ashdod, Israel. For privacy questions, call or message us: {phone}."),
            ("What is collected", "The site needs no sign-up. When you send the form, we store what you entered: name, phone, city, number of kids, their age and the mission you are interested in. The form is sent only after you tick the consent box. If you also send the WhatsApp message, we see its text and your phone number."),
            ("How we use it", "To reply to you about the launch and bookings. We do not sell or pass your details to anyone else."),
            ("Cookies and tracking", "The site uses no advertising or tracking cookies."),
            ("Where it is kept", "The site and the list of requests are hosted by Cloudflare, which also keeps technical data (such as IP addresses) for security and operations. A notice about each new request reaches us on Telegram."),
            ("Children", "The site is meant for parents. We do not knowingly collect information from children."),
            ("Your rights", "You can ask to see, correct or delete the information we hold. Contact us and we will handle it."),
            ("Changes", "We may update this policy from time to time. Last updated: {date}."),
        ]),
    },
    "accessibility": {
        "he": ("הצהרת נגישות", [
            ("המחויבות שלנו", "ExitCube רואה חשיבות רבה במתן שירות שווה ונגיש לכולם, ופועלת להנגיש את האתר ברוח התקן הישראלי ת״י 5568 והנחיות WCAG 2.0 ברמה AA."),
            ("מה נעשה באתר", "האתר מותאם לטלפון ולמחשב; אפשר לנווט בו במקלדת; סימון הפוקוס גלוי; הטקסט בניגודיות גבוהה וניתן להגדלה; לתמונות יש תיאור חלופי; והאנימציות מכבדות את הגדרת ״הפחתת תנועה״ במכשיר."),
            ("מגבלות ידועות", "סרטון הלוגו הוא קישוטי, ללא קול וללא מידע חיוני. התמונות באתר הן הדמיות. ייתכן שחלקים באתר עדיין אינם נגישים במלואם, ואנחנו ממשיכים לשפר."),
            ("נגישות השירות", "אם לילד או לילדה יש צורך מיוחד, ספרו לנו מראש ונתאים את המשחק ככל האפשר."),
            ("פנייה בנושא נגישות", "נתקלתם בבעיה או שיש לכם הצעה לשיפור? פנו אלינו בטלפון או בוואטסאפ: {phone}. נשתדל לטפל בכל פנייה בהקדם."),
            ("עדכון ההצהרה", "ההצהרה עודכנה לאחרונה בתאריך {date}."),
        ]),
        "ru": ("Заявление о доступности", [
            ("Наше обязательство", "ExitCube считает важным равный и доступный сервис для всех и делает сайт доступным в духе израильского стандарта 5568 и рекомендаций WCAG 2.0 уровня AA."),
            ("Что сделано на сайте", "Сайт подстроен под телефон и компьютер; по нему можно перемещаться с клавиатуры; фокус виден; текст контрастный и увеличивается; у изображений есть текстовое описание; анимации учитывают системную настройку «уменьшить движение»."),
            ("Известные ограничения", "Ролик с логотипом декоративный, без звука и без важной информации. Изображения на сайте являются концепт-артом. Отдельные части сайта могут быть ещё не полностью доступны, мы продолжаем их улучшать."),
            ("Доступность услуги", "Если у ребёнка есть особые потребности, расскажите нам заранее, и мы постараемся адаптировать игру."),
            ("Обращения по доступности", "Столкнулись с проблемой или есть предложение? Позвоните или напишите в WhatsApp: {phone}. Мы постараемся ответить как можно скорее."),
            ("Обновление", "Заявление обновлено {date}."),
        ]),
        "en": ("Accessibility statement", [
            ("Our commitment", "ExitCube believes in equal, accessible service for everyone and works to make this site accessible in the spirit of Israeli Standard 5568 and WCAG 2.0 level AA."),
            ("What we have done", "The site adapts to phones and computers; it can be navigated by keyboard; focus is visible; text has high contrast and can be enlarged; images have text alternatives; and animations respect the device's reduce-motion setting."),
            ("Known limitations", "The logo film is decorative, silent and carries no essential information. Images on the site are concept art. Some parts of the site may not be fully accessible yet, and we keep improving them."),
            ("Accessibility of the service", "If a child has special needs, tell us in advance and we will adapt the game as far as we can."),
            ("Contact about accessibility", "Found a problem or have a suggestion? Call or message us on WhatsApp: {phone}. We will do our best to respond quickly."),
            ("Last update", "This statement was last updated on {date}."),
        ]),
    },
}

BACK = {"he": "→ חזרה לאתר", "ru": "← На главную", "en": "← Back to the site"}

LEGAL_TPL = """<!DOCTYPE html>
<html lang="{lang}" dir="{dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — ExitCube</title>
<meta name="description" content="{title} — ExitCube">
<meta name="theme-color" content="#0a0c0b">
<link rel="canonical" href="{url}">
{alternates}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230a0c0b'/%3E%3Crect x='8' y='8' width='16' height='16' fill='none' stroke='%23ffd400' stroke-width='3'/%3E%3Crect x='13.5' y='13.5' width='5' height='5' fill='%2335e85a'/%3E%3C/svg%3E">
<style>
@font-face{{font-family:Rubik;font-style:normal;font-weight:300 900;font-display:swap;src:url(/fonts/rubik-hebrew-wght-normal.woff2) format("woff2");unicode-range:U+0307-0308,U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}}
@font-face{{font-family:Rubik;font-style:normal;font-weight:300 900;font-display:swap;src:url(/fonts/rubik-cyrillic-wght-normal.woff2) format("woff2");unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}}
@font-face{{font-family:Rubik;font-style:normal;font-weight:300 900;font-display:swap;src:url(/fonts/rubik-latin-wght-normal.woff2) format("woff2");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}}
:root{{color-scheme:dark}}
*{{box-sizing:border-box}}
body{{margin:0;background:#0a0c0b;color:#f3f5f2;font-family:Rubik,system-ui,-apple-system,"Segoe UI",Arial,sans-serif;font-size:18px;line-height:1.65}}
a{{color:#ffd400}}
:focus-visible{{outline:2px solid #ffd400;outline-offset:3px}}
.wrap{{width:min(760px,100% - 40px);margin-inline:auto}}
header{{border-bottom:1px solid #262b28}}
header .wrap{{display:flex;justify-content:space-between;align-items:center;gap:16px;height:68px}}
.logo{{font-weight:800;font-size:25px;letter-spacing:.02em;text-decoration:none;color:#f3f5f2;direction:ltr;unicode-bidi:isolate}}
.logo b{{color:#35e85a}}
header a.back{{font-size:16px}}
main{{padding-block:56px 80px}}
h1{{font-size:clamp(32px,6vw,48px);font-weight:800;line-height:1.1;margin:0 0 32px}}
h2{{font-size:22px;font-weight:700;margin:34px 0 8px}}
p{{margin:0;color:#c9d0cb}}
footer{{border-top:1px solid #262b28;color:#8d9791;font-size:15px}}
footer .wrap{{padding-block:24px}}
</style>
</head>
<body>
<header><div class="wrap"><a class="logo" href="{home}" aria-label="ExitCube">EXIT<b>CUBE</b></a><a class="back" href="{home}">{back}</a></div></header>
<main class="wrap">
<h1>{title}</h1>
{body}
</main>
<footer><div class="wrap">© 2026 ExitCube</div></footer>
</body>
</html>
"""


def alternates(path):
    """hreflang links for a page that exists at the same sub-path in every language."""
    out = [f'<link rel="alternate" hreflang="{l}" href="{BASE}{HOME[l]}{path}">' for l in LANGS]
    out.append(f'<link rel="alternate" hreflang="x-default" href="{BASE}/{path}">')
    return "\n".join(out)


def write(rel, text):
    p = PUB / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf8")


def build_landing(lang):
    d = T[lang]
    s = PAGE

    def fill(m):
        open_tag, key = m.group(1), m.group(4)
        open_tag = open_tag.replace(f' data-i18n="{key}"', "")
        # word joiner keeps ranges like 7–13 on one line
        return open_tag + re.sub(r'(\d)–(\d)', '\\1–\u2060\\2', d[key]) + m.group(6)

    s, n = re.subn(r'(<(\w+)([^>]*?) data-i18n="(\w+)"([^>]*)>)(</\2>)', fill, s)
    assert "data-i18n" not in s, "unfilled text slot"
    s = re.sub(r"\{\{s:(\w+)\}\}", lambda m: html.escape(d[m.group(1)], quote=True), s)
    s = s.replace(f'<option value="{lang}">', f'<option value="{lang}" selected>')
    jsonld = {
        "@context": "https://schema.org", "@type": "EntertainmentBusiness",
        "name": "ExitCube", "url": BASE + HOME[lang], "description": d["desc"],
        "image": BASE + "/img/trex-m.jpg", "telephone": SITE["tel"],
        "address": {"@type": "PostalAddress", "addressLocality": "Ashdod", "addressCountry": "IL"},
        "areaServed": {"@type": "City", "name": "Ashdod"},
        "availableLanguage": ["he", "ru", "en"], "foundingDate": "2015",
    }
    L = {"msg": d["msg"], "age_mix": d["age_mix"], "err_phone": d["err_phone"], "err_consent": d["err_consent"],
         "saved": d["saved"], "save_fail": d["save_fail"],
         "msn": {"any": d["o_any"], "trex": d["m1_t"], "space": d["m2_t"], "magic": d["m3_t"]}}
    vals = {
        "lang": lang, "dir": "rtl" if lang == "he" else "ltr", "title": html.escape(d["title"]),
        "desc": html.escape(d["desc"], quote=True), "url": BASE + HOME[lang], "alternates": alternates(""),
        "locale": LOCALE[lang], "font": FONT[lang], "home": HOME[lang],
        "jsonld": json.dumps(jsonld, ensure_ascii=False), "L": json.dumps(L, ensure_ascii=False),
        "ta_url": TRIPADVISOR[lang],
        "wa": SITE["whatsapp"], "tel": SITE["tel"], "phone": SITE["phone_display"],
        "alt_hero": html.escape(ALT[lang]["hero"], quote=True), "alt_m1": html.escape(ALT[lang]["m1"], quote=True),
        "alt_m2": html.escape(ALT[lang]["m2"], quote=True), "alt_m3": html.escape(ALT[lang]["m3"], quote=True),
    }
    for k, v in vals.items():
        s = s.replace("{{" + k + "}}", v)
    assert "{{" not in s, "unfilled placeholder"
    write(HOME[lang].strip("/") + ("/" if lang != "he" else "") + "index.html", s)


def build_legal(kind, lang):
    title, sections = LEGAL[kind][lang]
    body = "\n".join(
        f"<h2>{html.escape(h)}</h2>\n<p>{html.escape(p.format(phone=SITE['phone_display'], date=UPDATED))}</p>"
        for h, p in sections)
    page = LEGAL_TPL.format(lang=lang, dir="rtl" if lang == "he" else "ltr", title=html.escape(title),
                            url=f"{BASE}{HOME[lang]}{kind}/", alternates=alternates(kind + "/"),
                            home=HOME[lang], back=BACK[lang], body=body)
    write(f"{HOME[lang].strip('/')}/{kind}/index.html".lstrip("/"), page)


def main():
    urls = []
    for lang in LANGS:
        build_landing(lang)
        urls.append(BASE + HOME[lang])
        for kind in LEGAL:
            build_legal(kind, lang)
            urls.append(f"{BASE}{HOME[lang]}{kind}/")
    sm = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sm += [f"  <url><loc>{u}</loc></url>" for u in urls] + ["</urlset>", ""]
    write("sitemap.xml", "\n".join(sm))
    write("robots.txt", f"User-agent: *\nAllow: /\n\nSitemap: {BASE}/sitemap.xml\n")
    print(f"built {len(urls)} pages")


if __name__ == "__main__":
    main()
