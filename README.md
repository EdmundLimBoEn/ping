# Ping

Personal bot-to-iPhone push for Edmund Lim. A Cloudflare Worker accepts `POST /notify` from bots such as steve, stores a thin inbox in D1, and sends APNs alerts to phones registered by the Ping iOS app.

This repo is the Worker, the D1 schema, and a SwiftUI app with bundle id `co.sillyapps.ping`. v1 uses a `*.workers.dev` URL. There is no Android client and no custom domain.

## How it fits together

1. You create an APNs AuthKey (`.p8`) in Apple Developer and put the key, Key ID, Team ID, and bundle id on the Worker as secrets and vars.
2. Each bot gets its own secret. The Worker stores `HMAC-SHA256(BOT_KEY_PEPPER, secret)` only.
3. The iPhone app registers its APNs device token with `OWNER_SECRET`.
4. A bot posts `{title, body, tag?}`. The Worker writes the inbox, then sends a push unless mute, a muted tag, or quiet hours say otherwise.

Local `wrangler dev` cannot speak HTTP/2 to Apple. Keep `APNS_DRY_RUN=1` locally. Real pushes happen after `wrangler deploy`.

## Create the Cloudflare resources

You need a free Cloudflare account and Wrangler login.

```bash
npm install
npx wrangler login
npx wrangler d1 create ping
```

Copy the printed `database_id` into `wrangler.jsonc` in place of `00000000-0000-4000-8000-000000000000`.

```bash
cp .dev.vars.example .dev.vars
```

Set `OWNER_SECRET` and `BOT_KEY_PEPPER` to different values from `openssl rand -base64 32`.

Apply the schema:

```bash
npm run migrate:local
npx wrangler d1 migrations apply ping --remote
```

## Put APNs credentials on the Worker

In [Apple Developer > Keys](https://developer.apple.com/account/resources/authkeys/list), create a key with Apple Push Notifications enabled. Download the `.p8` once. Note the Key ID. Your Team ID is on the account membership page. The app bundle id is `co.sillyapps.ping`.

Do not commit the `.p8` or any secret.

Local file `.dev.vars` (already gitignored):

```
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=XXXXXXXXXX
APNS_P8="-----BEGIN PRIVATE KEY-----
paste-the-p8-body
-----END PRIVATE KEY-----"
APNS_DRY_RUN=1
```

`wrangler.jsonc` already sets `APNS_BUNDLE_ID` to `co.sillyapps.ping`. Change that var if you change the Xcode bundle id.

Deployed Worker (never pass secret values on the command line):

```bash
npx wrangler secret put OWNER_SECRET
npx wrangler secret put BOT_KEY_PEPPER
npx wrangler secret put APNS_KEY_ID
npx wrangler secret put APNS_TEAM_ID
npx wrangler secret put APNS_P8
```

Leave `APNS_DRY_RUN` unset in production. To force dry-run on the deployed Worker, run `npx wrangler secret put APNS_DRY_RUN` and enter `1`.

In the Apple Developer app identifier for `co.sillyapps.ping`, enable Push Notifications. In Xcode, select the Ping target, set your Team, and confirm the Push Notifications capability.

## Mint a bot key (steve)

The mint script hashes with the same HMAC the Worker uses. It prints the plaintext secret once.

```bash
node scripts/mint-bot-key.mjs steve --apply-local
node scripts/mint-bot-key.mjs steve --apply-remote
```

Save the printed `png_…` secret in the bot. Example for steve:

```bash
export STEVE_BOT_SECRET='png_…'
export PING_URL='http://127.0.0.1:43123'
```

After deploy, set `PING_URL` to `https://ping.<your-subdomain>.workers.dev`.

## Run the Worker locally

```bash
npm test
npm run deploy:dry-run
npm run migrate:local
npm run dev
```

`npm run dev` binds `http://127.0.0.1:43123`. Open that URL for the status page. `GET /health` returns `{"ok":true,"service":"ping"}`.

### curl from steve

With no iPhone registered, the Worker stores the inbox row and returns `push: "none"`:

```bash
curl -sS "$PING_URL/notify" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $STEVE_BOT_SECRET" \
  -d '{"title":"steve","body":"deploy finished","tag":"ci"}'
```

You can put the secret in the JSON body instead of the header:

```bash
curl -sS "$PING_URL/notify" \
  -H 'content-type: application/json' \
  -d "{\"title\":\"steve\",\"body\":\"hello\",\"tag\":\"chat\",\"secret\":\"$STEVE_BOT_SECRET\"}"
```

Read the inbox with the owner secret (the iOS app does this too):

```bash
curl -sS "$PING_URL/inbox" \
  -H "authorization: Bearer $OWNER_SECRET"
```

## Register the iPhone

1. Open `ios/Ping/Ping.xcodeproj` on a Mac.
2. Set the Team on the Ping target. Keep bundle id `co.sillyapps.ping` unless you also change `APNS_BUNDLE_ID`.
3. Run on a physical iPhone. The simulator does not receive APNs.
4. In Settings, paste `https://ping.<your-subdomain>.workers.dev` and the `OWNER_SECRET` value.
5. Tap Enable notifications and accept the system prompt.
6. Confirm `POST /devices` succeeded. The status line should read `Registered sandbox` for a Debug build.

Debug builds register `environment: "sandbox"` and the Worker uses `api.sandbox.push.apple.com`. Release and TestFlight builds register `production`.

If a token is rejected with `Unregistered` or `410`, the Worker deletes that device row.

## Deploy

```bash
npx wrangler deploy
npx wrangler d1 migrations apply ping --remote
```

Wrangler prints `https://ping.<your-subdomain>.workers.dev`. Point the iOS app at that URL. Mint steve against `--apply-remote` if you have not already.

A successful `wrangler deploy --dry-run` only proves the Worker bundles. It does not prove APNs or D1.

## TestFlight later

This pass does not upload to App Store Connect. When you are ready:

1. Add a 1024px App Icon in `ios/Ping/Ping/Assets.xcassets/AppIcon.appiconset`.
2. Replace every `[PLACEHOLDER: …]` string in the app and write your own App Store listing copy.
3. In `Ping.entitlements`, Xcode will set `aps-environment` to `production` for a distribution signing identity.
4. Archive in Xcode, upload to App Store Connect, and add the build to an internal TestFlight group.

## API

Auth:

- Bots on `POST /notify` send `Authorization: Bearer <bot-secret>` or JSON `secret`.
- The iOS app on `/devices`, `/inbox`, and `/prefs` sends `Authorization: Bearer <OWNER_SECRET>`.

| Method | Path | Who | Body |
| --- | --- | --- | --- |
| GET | `/health` | anyone | |
| POST | `/notify` | bot | `{ "title", "body", "tag?", "secret?" }` |
| POST | `/devices` | owner | `{ "token", "environment": "sandbox" \| "production" }` |
| DELETE | `/devices` | owner | `{ "token" }` |
| GET | `/inbox?limit=50` | owner | |
| GET | `/prefs` | owner | |
| PUT | `/prefs` | owner | `{ "muted", "timezone", "quiet": { "start": "HH:MM", "end": "HH:MM" } \| null, "muted_tags": ["ci"] }` |

`POST /notify` always writes an inbox row. `push` is `sent`, `skipped`, `none`, or `failed`. `reason` is `muted`, `muted_tag`, `quiet_hours`, `no_devices`, or `null`.

Quiet hours use the stored IANA timezone. A window with `start` after `end` wraps midnight. `start` equal to `end` disables the window.

Inbox `GET` groups rows by bot, newest first, and keeps the latest 500 notifications.

## Tests

```bash
npm test
```

Covers HMAC bot auth, owner vs bot isolation, quiet hours, tag mute, global mute, and dry-run send after device registration.
