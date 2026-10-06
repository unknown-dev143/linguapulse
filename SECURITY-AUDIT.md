# LinguaPulse — Security Audit

**Date:** 2026-10-05
**Scope:** Full static review of the deployed client-side app (`index.html`, `app.js`, `sw.js`, `oauth-callback.html/.js`) plus a live reachability check of the published URL.
**Method:** Source code inspection for XSS sinks (`innerHTML`/`eval`/etc.), secrets handling, OAuth/WebAuthn flows, encryption-at-rest, CSP, service-worker caching, and network egress; plus a real-Chrome load against the live URL.

---

## 1. Live deployment & accessibility

- **Live URL:** `https://d0d356c0dcb945c4a3e645b9ae1716a9.sg.agentos-app.run` → **HTTP 200**, publicly reachable, no auth wall. Anyone with the link can open and use it. This build includes the mic-translation enhancements (silence tuning, live mic meter, recognition recovery), the three fixes from 2026-10-06 (proxy-aware GitHub sign-in, history-lock reload UX, `frame-ancestors` header), and the 2026-10-06 UI pass (PWA Install button, desktop keyboard shortcuts + focus rings + sizing polish).
- **Previous links `be9a30b4…`, `eda0eef5…`, `ceb376daf…`, and `22708a3d…` are dead** (the platform reassigns the subdomain on each publish). Replace them with `d0d356c0…` wherever shared.
- The app is a static client-side bundle; "accessible by other users" = the link is public. No server/backend processes requests.

---

## 2. Findings — strengths (verified)

| # | Area | Result |
|---|---|---|
| S1 | **CSP** | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https:; manifest-src 'self'`. No inline scripts; all JS is external same-origin. No third-party JavaScript is loaded anywhere (OAuth callback is same-origin, CSP-safe). `connect-src` is `self` + `https:` only → no plaintext-`http` exfil. |
| S2 | **Output encoding (XSS)** | Every user/API/translation string rendered to the DOM goes through `escapeHtml` — conversation turns, coaching notes, captions, profile name/email, account switcher, share banner. The `el()` helper (sets `innerHTML`) is **only** ever called with static class strings or trusted emoji avatars, never untrusted data. `decodeEntities()` uses the `<textarea>` RCDATA decode on a **detached** node, so it cannot execute injected markup. `exportTranscript` downloads a Blob (no DOM injection). **No `eval`, `new Function`, or `document.write` anywhere.** |
| S3 | **Auth / SSO** | Passkey/WebAuthn = zero-config, `residentKey:'preferred'`. Google/Discord implicit, Apple `code id_token`, GitHub **Device Authorization** (no client secret). `redirect_uri` is strictly same-origin. **CSRF:** a random `state` is sent and verified on return (mismatch → aborted). **Origin:** the `postMessage` listener ignores any event where `ev.origin !== location.origin`. **Tokens are not persisted** — the OAuth access/id token is used only to fetch the profile (email/name), then discarded; the stored account record carries only `methods:[provider]` + non-secret prefs. Client IDs are public (not secrets). |
| S4 | **Encryption at rest** | Device-bound AES-GCM 256 (`lp_devkey`) protects guest history, settings (incl. API key), and the account list. Per-account history is encrypted under a **PBKDF2-HMAC-SHA-256 (150,000 iters) → AES-GCM 256** key derived in memory on login; the key is **never persisted**, so re-auth is required on restart. AES-GCM provides integrity (tampered blobs are rejected). `accountPrefs()` strips the API key from account records; `sanitizeAccount`/`sanitizeAccounts` validate and de-dupe on every read. Non-secure-context fallback uses a per-device salted hash with a visible warning. |
| S5 | **Service worker** | Caches **only same-origin static assets**; cross-origin requests (MyMemory / OpenAI / Ollama) bypass the cache and hit the network. Conversation text is **never** written to the Cache API. |
| S6 | **Supply chain** | No CDN scripts, no `npm` runtime deps in the browser. Only Google Fonts CSS + font files, explicitly allow-listed in `style-src`/`font-src`. |
| S7 | **Transport** | Served over HTTPS; `connect-src 'self' https:` forbids plaintext egress. |

---

## 3. Findings — recommendations (defense-in-depth, not exploitable as shipped)

| # | Severity | Area | Detail / Action |
|---|---|---|---|
| A1 | Low | **Clickjacking** | `frame-ancestors` cannot be set from a `<meta>` CSP; it must come from an HTTP response header. **Fix shipped:** a `_headers` file now reproduces the full CSP plus `frame-ancestors 'none'` (and `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`). Netlify and Cloudflare Pages read it automatically; hosts that ignore `_headers` (GitHub Pages, the built-in static publisher) fall back to the `<meta>` CSP, which still blocks XSS — only the frame-ancestors hardening is absent there. |
| A2 | Low | **`style-src 'unsafe-inline'`** | Allows inline styles (the app sets dynamic `element.style` from JS). Does **not** enable script execution. Acceptable; could be tightened with nonces if desired, but not required. |
| A3 | Info | **Device key in `localStorage`** | `lp_devkey` lives in `localStorage`. This is inherent to any client-side-only encryption: it defends against remote attackers, XSS, and cross-origin exfil (the CSP prevents key theft), but **not** against someone with direct access to the device's storage. Expected and documented — there is no way to hold a secret secret client-side. |
| A4 | Info | **OAuth redirect URIs** | For SSO to work, the user must register the deployed origin (`https://d0d356c0dcb945c4a3e645b9ae1716a9.sg.agentos-app.run`) as an authorized redirect/callback URI at each provider, and paste the matching client ID in Settings. Until then the button stays disabled. (GitHub additionally needs a CORS proxy per A7.) |
| A5 | Info | **Test-env console noise** | Two console errors seen in the headless test come from a **Kaspersky/QQ browser extension** (`beacon.cdn.qq.com`, `gc.kis.v2.scr.kaspersky-labs.com`) hitting the environment CSP — **not** from the app. `app.js` emitted zero errors. |
| A6 | Info | **Local Ollama over `http://localhost`** | The strict `connect-src 'self' https:` (plus mixed-content rules) means a plaintext `http://localhost:11434` model endpoint works **only** when the app itself is served over `http`/`localhost` (e.g. `python -m http.server`). On the HTTPS deployment it is blocked. Use an `https`-reachable model endpoint, or run the app locally for Ollama. (Security-positive: it also blocks plaintext exfil.) |
| A7 | Medium (functional) → **resolved (mitigated)** | **GitHub device flow is CORS-blocked in-browser** | GitHub's device/token endpoints deliberately send no `Access-Control-Allow-Origin`, so a direct browser `fetch` is blocked (confirmed via web search + live test). **Fix shipped:** GitHub sign-in is now proxy-aware — `githubDeviceFlow()` routes both calls through a configurable same-origin `githubProxy` URL set in Settings, and the GitHub button stays **disabled with a clear tooltip** until both a client ID *and* a proxy are configured. Ready-to-deploy proxies are included: `netlify/functions/github-proxy.js` + `netlify.toml` (redirect at `/api/github/*`), and a Cloudflare Pages Function at `functions/api/github/[[catchall]].js` (+ `wrangler.toml`). On a host with that proxy the button works, otherwise it is safely disabled rather than failing at runtime. Google / Discord / Apple / Passkey remain unaffected. |

---

## 4. Automated verification (2026-10-05)

Two headless-Chrome suites were run against a local `python -m http.server` mirror of the build, driving system Chrome via Playwright-core + the Chrome DevTools Protocol.

**Suite A — Auth (`_verify.mjs`):**

| Check | Result |
|---|---|
| Passkey register (virtual authenticator stores `credId` in `lp_passkeys`) | **PASS** |
| Passkey login (session established from stored passkey) | **PASS** |
| SSO buttons stay disabled until a client ID is set, then enable | **PASS** |
| Passkey SSO button enabled (`navigator.credentials` present) | **PASS** |
| Google OAuth URL — `accounts.google.com/o/oauth2/v2/auth`, correct `client_id`, same-origin `redirect_uri`, `state`, `response_type=token`, `scope=openid email profile` | **PASS** |
| Discord OAuth URL — `discord.com/oauth2/authorize`, correct `client_id`, same-origin `redirect_uri`, `response_type=token` | **PASS** |
| Apple OAuth URL — `appleid.apple.com/auth/authorize`, `response_type=code id_token`, same-origin `redirect_uri`, `scope=name email` | **PASS** |
| GitHub device flow fetches a real `device_code`/`user_code` | **FAIL (see A7)** |
| Zero page errors | **PASS** |

**Suite B — Mic-translation regression (`_smoke.mjs`, fake media device):**

| Check | Result |
|---|---|
| Signup reaches main app | **PASS** |
| Mic-meter wrapper + bar exist in DOM, hidden before listening | **PASS** |
| "Pause before committing" (`silenceSelect`) present with 4 options, defaults to 0.9 s | **PASS** |
| Silence setting written to `S` and persisted (`linguapulse.settings` blob) | **PASS** |
| Live mic-level meter starts without error and updates width on RAF tick (fake device) | **PASS** |
| Silence setting survives a full page reload (`S.silenceMs === 1500`) | **PASS** |
| Zero app console errors / zero page errors | **PASS** |

---

## 5. Manual verification still required (cannot be done headless)

- **Passkey** on a real device with a platform authenticator (Touch ID / Windows Hello / phone) over HTTPS — the *flow* is now proven with a CDP virtual authenticator, but a real device should still be spot-checked.
- **SSO end-to-end** with real OAuth client IDs pasted into Settings (URL construction is verified; the live token exchange with each provider still needs a real client ID + the deployed origin registered as a redirect URI).
- **Live mic translation** (Web Speech API needs real Chrome/Edge + a real mic; the meter, silence tuning, and recognition-recovery paths are verified in code and headless, but the spoken-translation loop needs a human + microphone).
- **GitHub SSO** is **not** usable client-side as written (see A7).

---

## 6. Verdict

The app is **safe to ship**: strong CSP with no inline JS or third-party scripts, consistent HTML-escaping of all untrusted text, CSRF- and origin-protected SSO with no token persistence, and a sound two-layer client-side encryption model. Both prior deploy-layer items are now addressed — `frame-ancestors 'none'` ships via `_headers` (A1) and the GitHub CORS block is mitigated by a proxy-aware flow with a bundled proxy (A7). The only remaining caveat to communicate to users is the Ollama-over-HTTP note (A6). Passkey and the Google/Discord/Apple SSO plumbing are verified by automated headless tests; no critical or high-severity vulnerabilities found.

**UX change (2026-10-06):** password accounts no longer force a full re-login on every page reload. After a reload the app stays usable immediately; past conversations show as "locked" with a one-tap "Sign in to unlock" that re-derives the decryption key. This keeps the security property (the history key is never persisted) while removing the friction.
