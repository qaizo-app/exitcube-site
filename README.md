# ExitCube site

Static site for https://exitcube.co.il. Everything served lives in `public/`.

- `src/page.html` — landing page template
- `src/strings.json` — all texts, per language (he / ru / en)
- `src/site.json` — phone and WhatsApp number (change here, then rebuild)
- `tools/build.py` — builds `public/`: one page per language (`/`, `/ru/`, `/en/`),
  privacy and accessibility pages, `sitemap.xml`, `robots.txt`

After editing anything in `src/` or the legal texts in `tools/build.py`, run:

    python3 tools/build.py

and commit the result. Cloudflare (Workers static assets, see `wrangler.jsonc`)
deploys every push to `main`. There is no build step on Cloudflare.
