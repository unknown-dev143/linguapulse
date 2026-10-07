# LinguaPulse

Real-time conversation translator with on-the-spot language coaching.
Speak in your language, it translates, speaks the translation out loud, hands the floor to the
other person, and slips you a short coaching note **written in the language you're translating into**.

## Design language — Shazam-adjacent, not Shazam

| Shazam | LinguaPulse |
|---|---|
| Blue radial gradient, one pulsing ring | Violet → magenta → amber gradient, 68-bar **circular audio spectrum** that reacts to your voice |
| Tap to identify a song | Tap to open a live conversation channel |
| Horizontal list of identified songs | Two-sided conversation feed (Speaker A / B) with per-turn coaching |
| No context of who's talking | Turn-taking: it flips the mic language after every turn |

Same "one big glowing button, do the thing" muscle memory. Different colours, different motion,
different job.

## Run it

```bash
cd linguapulse
python -m http.server 5173      # or: npx serve .
```

Open `http://localhost:5173` in **Chrome or Edge**.

> Use a local server rather than double-clicking `index.html`. The Web Speech API needs a secure
> context, and `file://` is flaky for microphone permission.

If it opens in the built-in preview panel and the mic is blocked, open the same URL in a real
browser tab — preview iframes usually don't grant microphone access.

## Deploy

The app is a static PWA plus one optional Cloudflare Pages Function
(`functions/api/github/[[catchall]].js`) that proxies GitHub's CORS-blocked sign-in endpoints.

### Cloudflare Pages — recommended (permanent URL + same-domain GitHub proxy)

Hosting here gives you a **stable** `*.pages.dev` URL (the WorkBuddy publish link reassigns a new
subdomain on every publish) and the GitHub proxy on the **same domain** as the app, so no extra
CSP configuration is needed.

```bash
# 1. log in (opens a browser — needs your Cloudflare account)
npx wrangler login

# 2. deploy the whole folder (static assets + functions/)
npx wrangler pages deploy . --project-name linguapulse
```

No `wrangler.toml` is needed (and this repo deliberately does not ship one — see the troubleshooting
notes below). The site goes live at `https://linguapulse.pages.dev`, and the included `functions/`
folder is auto-detected as a Pages Function.

- **Enable GitHub sign-in** (optional): Settings → "GitHub CORS proxy" = `https://linguapulse.pages.dev/api/github`,
  plus your GitHub OAuth **client ID** in Settings → "SSO client IDs". The button enables once both are set.
- **Alternative — connect the git repo:** Cloudflare dashboard → *Workers & Pages → Create → Pages →
  Connect to Git*, pick `unknown-dev143/linguapulse`, then set all three build settings explicitly:

  | Field | Value |
  |---|---|
  | Framework preset | **None** |
  | Build command | *(leave the field blank — no text at all)* |
  | Deploy command | *(leave the field blank — no text at all)* |
  | Build output directory | **`.`** |

  > ⚠️ "Blank" means an **empty input box**. Do not type the word `empty` into the field —
  > Cloudflare runs whatever is in that box as a shell command, so it would fail with
  > `/bin/sh: 1: empty: not found`.

- Headers in `_headers` (`frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, plus the full CSP) are applied by Cloudflare Pages automatically.

#### Troubleshooting: `✘ [ERROR] Missing entry-point to Worker script or to assets directory`

Happens on **Connect to Git** when Cloudflare auto-detects `wrangler.toml` and fills in
`npx wrangler deploy` as the deploy command. That is the **Workers** command, not the Pages one —
it looks for `main` / `[assets]` and fails because this project ships neither.

Fix — in the project's *Settings → Builds & deployments → Build configuration → Edit configuration*:
clear the **Deploy command** (and leave **Build command** empty, **output directory** `.`), then
*Retry deployment*. Pages then uploads the folder directly and picks up `functions/` on its own.

#### Troubleshooting: `Authentication error [code: 10000]` from `wrangler pages deploy`

If you put a deploy command in the box, wrangler authenticates with the `CLOUDFLARE_API_TOKEN` that
Pages injects into the build — and that token **does not carry Pages-write permission**, so the API
rejects it even though your account is Super Administrator:

```
A request to the Cloudflare API (/accounts/<id>/pages/projects/linguapulse) failed.
Authentication error [code: 10000]
```

Fix: **remove the deploy command entirely.** Let Pages do the upload — it needs no token. Only use
`npx wrangler pages deploy . --project-name linguapulse` from **your own machine**, where
`wrangler login` has granted full permissions.

#### Troubleshooting: `/bin/sh: 1: empty: not found`

The **Deploy command** box contains the literal text `empty` (or any placeholder word). Cloudflare
executes that box as a shell command, so it must be **completely blank** — not filled with a word
that describes blankness.

If the UI appears to complain about an empty box, the cause is usually the **Framework preset** still
being auto-detected as *Wrangler*. Set the preset to **None** first; blank Build/Deploy commands are
then accepted normally. (This repo ships no `wrangler.toml`, so nothing should be auto-detected.)

Rule of thumb: whatever you type into *Build command* / *Deploy command* is run by `/bin/sh`.
Only real commands belong there — never placeholders like `empty`, `none` or `n/a`.

**Canonical origin:** `https://linguapulse.pages.dev`. Register this exact URL as the OAuth redirect /
callback URI at each provider (Google, Apple, GitHub, Discord) before sign-in will work.

### Netlify

`netlify.toml` redirects `/api/github/*` to `netlify/functions/github-proxy.js`. Deploy the folder via
the dashboard or `netlify deploy --prod`. GitHub proxy URL: `https://<site>/.netlify/functions/github-proxy`.

### GitHub Pages

Push to a repo and enable Pages on the branch. `index.html`'s `<meta>` CSP still protects against XSS,
but `_headers` is ignored by GitHub Pages, so `frame-ancestors` hardening is missing and GitHub sign-in
needs an external proxy.

## How a turn flows

```
mic  →  SpeechRecognition (continuous, interim results)
     →  commit on ~900ms of silence
     →  translate (MyMemory free tier | OpenAI-compatible API)
     →  coach feedback, written in the TARGET language
     →  speak the translation (speechSynthesis)
     →  turn-taking: flip mic to the other language
```

## Controls

- **Orb** — tap to start/stop listening (or press `Space`)
- **Speaker A / B chips** — tap to change each side's language (48 languages)
- **⇄** — swap languages and hand the floor over
- **Auto-speak** — read the translation aloud (mic pauses during playback to avoid echo)
- **Turn-taking** — automatically switch recognition language after each turn
- **Coach feedback** — the correction + fluency score block
- **Demo** — scripted 4-turn restaurant conversation; works with no mic and no network (or press `D`)
- **Export** — download the transcript as Markdown
- **Share** — copy a backend-free link to the transcript (gzip + base64url in the URL, opens read-only)
- **Install** — appears in the top bar when the browser offers it; adds LinguaPulse as a standalone desktop/mobile app (PWA)
- **Profile** — switch between accounts stored on this device, add a passkey, pick an avatar
- **Accent theme** — five recolorings of the orb/spectrum (aurora / ocean / forest / sunset / mono)

**Keyboard shortcuts (desktop/laptop):** `Space` start/stop · `S` swap languages · `T` toggle light/dark theme · `D` run demo · `Esc` close any dialog.

## Translation engines

**Free (default)** — [MyMemory](https://mymemory.translated.net), no key, no signup. Good enough for
conversation; has a daily quota. Coaching falls back to the on-device rule engine.

**OpenAI-compatible (optional)** — Settings → pick the API option, then enter base URL, model, and
key. Works with OpenAI, DeepSeek, Groq, OpenRouter, Ollama (`http://localhost:11434/v1`), etc.
Unlocks much better translation plus AI-written coaching notes in any of the 48 languages.
The key is stored in `localStorage` and sent only to the endpoint you configure.

## The on-device coach (no API key needed)

Scores each utterance 35–99 and flags:

- **Filler words** — `um`, `like`, `you know` / `este`, `pues`, `o sea` / `euh`, `genre`, `du coup`…
- **Common mistakes** — "more better" → "much better", "I am agree" → "I agree",
  "discuss about" → "discuss", "I have 20 years" → "I am 20 years old"…
- **Sentence length** — over ~28 words gets a "split it up" note
- **Pace** — words per minute, from the utterance timestamps
- **Repetition** — the same word twice in a row

Every note is written in the target language (templates for en/es/fr/de/it/pt/zh/ja), with a short
English gloss underneath so you always understand it.

## Accounts, sign-in & passkeys

LinguaPulse is still 100% client-side — there is **no auth server** — but you can sign in so your
encrypted conversation history follows you across sessions on the same device, and so the pre-login
data sheet knows whose count to show.

- **Email + password** (default, no setup) — history is encrypted under a PBKDF2 key derived from
  your password (see Security). Re-auth on every app restart.
- **Passkey / WebAuthn** — works with **zero configuration**. A passkey is created and stored by your
  device/platform (Touch ID, Windows Hello, phone). Login is a tap — no password to remember and
  nothing secret leaves the device. This is the recommended option.
- **Google / Apple / GitHub / Discord SSO** — these need a free OAuth **client ID** that you paste
  into Settings → "SSO client IDs". Until a provider's ID is set, its button is disabled. Because
  there's no backend to keep a secret, the flows are designed to leak nothing sensitive:
  - *Google* & *Discord* — OAuth 2.0 implicit flow (an access/id token is returned directly; no
    client secret is involved).
  - *Apple* — `response_type=code id_token`, then the `id_token` is decoded locally for the name/email.
  - *GitHub* — OAuth 2.0 **Device Authorization** flow. GitHub deliberately sends **no CORS header**
    on its device/token endpoints, so a browser cannot call them directly. GitHub sign-in therefore
    needs a tiny proxy that adds `Access-Control-Allow-Origin: *` on the way back. Two bundled options:
    - **Cloudflare Pages** (recommended — proxies same-domain as the app): deploy the folder and the
      included `functions/api/github/` Pages Function; the proxy URL is
      `https://<project>.pages.dev/api/github`.
    - **Netlify**: deploy `netlify/functions/github-proxy.js` + `netlify.toml`; the proxy URL is
      `https://<site>/.netlify/functions/github-proxy` (or `/api/github`).
    Paste the proxy base URL into Settings → "GitHub CORS proxy". With no proxy set, the GitHub
    button stays disabled (rather than failing at runtime). Google / Apple / Discord / Passkey
    need no proxy.
  - All SSO redirects go to a **same-origin popup** (`oauth-callback.html`) that posts the token back
    to the app via `postMessage`. No third-party script is loaded, so the strict CSP is preserved.

> **Reload behaviour:** password accounts keep their conversation history encrypted under a
> key derived from your password (never stored), so after a page reload the app stays usable
> immediately while past conversations show as *locked* — tap **Sign in to unlock** to
> re-enter your password and decrypt them. Guest and legacy accounts restore automatically.

> The SSO profile only ever stores non-secret fields (display name, email, avatar, provider). It
> never stores the OAuth token past the session, and it never stores your translation API key.

**Account switcher** — if several accounts exist on the device, the Profile sheet lists them so you
can jump between them. "Add passkey" binds a platform passkey to the current account.

### Accent themes

Settings → "Accent" recolors the whole app (orb gradient, the 68-bar spectrum, buttons, highlights)
with five presets: **aurora** (default violet→magenta→amber), **ocean** (blue/cyan), **forest**
(green/teal), **sunset** (pink/orange), and **mono** (neutral graphite). The choice is saved in
settings and applied at boot.

### Shareable transcript (no backend)

The **Share** button compresses the current transcript with `CompressionStream` (gzip), base64url-
encodes it, and puts it in the URL hash (`#t=…`). Two ways to use it:

- Copy the link and send it — the recipient opens it and sees a **read-only** transcript (the orb,
  mic controls and language bar are hidden, with a "Shared transcript — read only" banner).
- Open the app with a `#t=` hash directly.

No server, no upload, no account — the conversation lives entirely inside the link. Long transcripts
may exceed URL length limits on some browsers/messengers, in which case use **Export** (Markdown)
instead.

## Files

```
linguapulse/
├── index.html           markup: orb, language chips, conversation feed, settings, auth
├── styles.css           design system + animations + accent themes
├── app.js               recognition, translation, coaching, TTS, visualiser, auth, share
├── oauth-callback.html  same-origin OAuth popup receiver (CSP-safe, no third-party scripts)
├── oauth-callback.js    posts tokens back to the opener via postMessage
├── sw.js                service worker (offline PWA)
├── manifest.webmanifest PWA manifest
├── favicon.svg
└── README.md
```

## Security & privacy

Everything runs **client-side** — there is no server and no account-in-the-cloud. Your conversations
never leave the browser except to the translation endpoint you choose. On top of that, the app is
hardened so a stolen device, a `localStorage` dump, or a malicious script can't read your talks.

- **Two-layer encryption at rest (AES-GCM 256).**
  - *Device-bound key* — a random key generated per browser profile protects guest history,
    settings (incl. any API key), and the account list.
  - *Password-derived key* — each account's conversation history is encrypted under a key derived
    from the user's password with **PBKDF2-HMAC-SHA-256 (150,000 iterations)**. That key is derived
    **in memory on login and never persisted**, so even a full storage dump (or the device key) can't
    reveal the conversation without the password.
  - **Re-auth on restart** — because the password key is never stored, relaunching the app asks for
    the password again before any account history can be decrypted.
  - **Integrity** — AES-GCM rejects tampered or swapped ciphertext; it's treated as empty rather
    than decrypted into garbage.
  - **Passkey / WebAuthn login** — an alternative to the password. The authenticator (Touch ID,
    Windows Hello, phone) proves possession; no password-derived key is needed and nothing secret
    is transmitted. Account history is still device-key-encrypted at rest; the passkey only unlocks
    the on-device account record.
- **Account model & SSO** — there is no auth server, so SSO providers only ever supply a non-secret
  profile (name/email/avatar/provider), stored in the device-keyed account list. The OAuth tokens
  are **not persisted** past the session. Client IDs you paste into Settings live in the device-keyed
  settings blob (protected by the device key). All SSO redirects resolve in a same-origin popup that
  posts back via `postMessage` with **no third-party scripts**, keeping the strict CSP intact.
  - **Secrets stay device-scoped** — the translation API key lives only in the device-keyed global
    settings blob, never inside the account record (a larger attack surface). Account records carry
    only non-secret preferences.
- **Strict Content-Security-Policy** — `script-src 'self'` (no inline scripts or event handlers),
  `style-src` limited to the app's own CSS + Google Fonts, and `connect-src 'self' https:` (no
  plaintext `http:`, so mixed-content/script exfil is blocked) for translation APIs only. This blocks
  script injection / exfiltration (defense-in-depth against XSS). `frame-ancestors` (clickjacking) must
  be set via an HTTP header at deploy time — it can't be delivered from a `<meta>` CSP.
- **Safe rendering & storage** — every piece of user/API text is HTML-escaped when rendered, and
  every stored object is validated and length-clamped on read, so corrupt or hostile storage can't
  crash the app or inject content.
- **Content-free login summary** — the pre-login data sheet shows only counts (turns, languages,
  active days), never conversation text.
- **Graceful fallback** — where Web Crypto is unavailable (a non-secure context), the app can't use
  SHA-256/PBKDF2, so passwords are hashed with a per-device random salt (djb2) and a visible warning
  notes that security is reduced. Accounts should be created on https/localhost where the strong path
  is used.

## Known limits

- Speech recognition requires Chrome/Edge (or a Chromium browser) — Safari and Firefox don't
  implement the Web Speech API the same way.
- Recognition periodically ends its session; the app auto-restarts it, which can clip a word
  if you pause mid-sentence for several seconds.
- The free translation tier rate-limits after sustained use — add an API key if you hit it.
- Two people sharing one device is the default mode. For two devices you'd need a shared
  session backend; that's the natural next step.
- **SSO (Google/Apple/GitHub/Discord)** requires you to paste your own OAuth client ID into
  Settings → "SSO client IDs". The buttons stay disabled until a valid ID is present, because the
  app has no server to hold a client secret. Passkey/WebAuthn needs no setup.
- **Passkeys** need a secure context (https or localhost) and a platform authenticator
  (Touch ID / Windows Hello / Android). On an `http://` IP address or an unsupported device they
  won't register.
- **Share links** encode the transcript in the URL. Very long transcripts can exceed browser/messenger
  URL-length limits — fall back to **Export → Markdown** for those.
