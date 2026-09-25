# Deploying STARCUT (closed beta)

Two pieces:

| Piece | What | Where |
| --- | --- | --- |
| **Client** | Static Vite build (`game/dist`) | Vercel (or any static host) |
| **Authority** | Node server: rooms, 60 Hz sim, WebRTC data channels, profiles, feedback, admin page | One small Linux VPS. It needs **UDP**, so serverless platforms won't work. |

**Staging and production run on the same VPS**, side by side, on separate ports and data directories:

| Environment | pm2 app | TCP (signalling + HTTP) | UDP (data channels) | Data |
| --- | --- | --- | --- | --- |
| production | `starcut-production` | `9208` | `20000-20010` | `/var/lib/starcut/production` |
| staging | `starcut-staging` | `9308` | `20100-20110` | `/var/lib/starcut/staging` |

Nothing needs Docker on your machine. You deploy with one command from your PC over ssh.

## Recommendation: pm2 on the VPS (no Docker anywhere)

Two options work. **Use pm2.**

- **pm2 + the Node bundle (recommended).** The VPS runs `npm ci && npm run build:server`
  and pm2 keeps `dist-server/index.mjs` alive. It's the fewest moving parts. Staging and
  production are just two pm2 apps. Deploys take about 30 s. Logs are `pm2 logs starcut-production`.
- **Docker on the VPS (alternative).** Build the image on the VPS itself (see the end of this
  file). Use this if the VPS already runs other containers. It's slower to deploy and makes
  the UDP port mapping more fiddly.

## 1. Provision the VPS (once)

Any 1 vCPU / 1 GB box handles several rooms. The sim is about 0.1 ms per room-tick.

```bash
# Ubuntu 24.04
sudo apt-get update && sudo apt-get install -y git curl caddy
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
sudo npm install -g pm2 && pm2 startup systemd -u $USER --hp $HOME   # run the line it prints

sudo mkdir -p /srv/starcut /var/lib/starcut/production /var/lib/starcut/staging /etc/starcut
sudo chown -R $USER /srv/starcut /var/lib/starcut

# firewall: ssh, TLS proxy, and both UDP ranges
sudo ufw allow 22/tcp && sudo ufw allow 443/tcp
sudo ufw allow 20000:20010/udp && sudo ufw allow 20100:20110/udp
sudo ufw enable
```

Open the same ports in the cloud provider's firewall (security group / VCN security list).
The classic failure is `/healthz` answering while the game hangs on "opening a data
channel…". That means a UDP range is blocked.

### Secrets: `/etc/starcut/<env>.env` (on the VPS only)

```bash
sudo tee /etc/starcut/production.env >/dev/null <<'ENV'
ADMIN_PASSWORD=<long random string>
CLIENT_URL=https://starcut.vercel.app
CORS_ORIGIN=https://starcut.vercel.app
STUN_URLS=stun:stun.l.google.com:19302
# Optional Supabase (otherwise JSON files under /var/lib/starcut/<env>):
# SUPABASE_URL=https://<project>.supabase.co
# SUPABASE_SERVICE_ROLE_KEY=<service role key>
# SUPABASE_ANON_KEY=<anon key>
ENV
sudo cp /etc/starcut/production.env /etc/starcut/staging.env   # then edit CLIENT_URL/CORS_ORIGIN for staging
sudo chmod 600 /etc/starcut/*.env && sudo chown $USER /etc/starcut/*.env
```

The admin password and the Supabase service key are **only** in these files. They are
never in the repo or in the client bundle. `npm run verify` fails if a secret name or test
aid appears in either production bundle (`tools/check-prod.mjs`).

### TLS for signalling

A client on `https://…vercel.app` can't signal to a plain `http://` authority, so Caddy
terminates TLS in front of each environment's TCP port. The UDP data channels are
DTLS-encrypted and bypass the proxy.

```bash
# DNS: authority.example.com and staging-authority.example.com -> the VPS IP
sudo tee /etc/caddy/Caddyfile >/dev/null <<'CADDY'
authority.example.com {
  reverse_proxy 127.0.0.1:9208
}
staging-authority.example.com {
  reverse_proxy 127.0.0.1:9308
}
CADDY
sudo systemctl restart caddy
```

A free DuckDNS hostname works if you don't own a domain.

## 2. Deploy (one command, from your PC)

Edit `deploy.config.json` once and set `"host": "you@your.vps.ip"`. Your ssh key must work
(`ssh you@your.vps.ip` with no password). Then:

```bash
npm run deploy -- staging       # the branch you're on (must be pushed)
npm run deploy -- production    # origin/main
```

Over ssh this checks out the exact pushed commit in `/srv/starcut/<env>` and runs `npm ci`
and `npm run build:server`. It then reloads that environment's pm2 app and prints its
`/healthz`. Git Bash on Windows provides `ssh`. `STARCUT_DEPLOY_HOST` overrides the host
for a single run. On the first deploy of each environment, the script clones the repo.

## 3. Client (Vercel)

Two Vercel environments, from one project:

| Vercel env | `VITE_AUTHORITY_URL` | Built from |
| --- | --- | --- |
| Production | `https://authority.example.com` | `main` |
| Preview (staging) | `https://staging-authority.example.com` | other branches |

Also set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you enable sign-in. They are
public by design. See `game/.env.example`. `vercel.json` already sets the build and the
invite-link rewrite (`/join/CODE` → the game). `?server=host:port` overrides the authority
for testing.

## 4. Supabase (optional)

Without it, profiles, the faction war, feedback, reports and telemetry live as JSON under
the environment's data dir. That's fine for a closed beta. To use Supabase:

1. Create a project. Apply `supabase/migrations/*.sql` with the Supabase CLI
   (`supabase db push`) or the SQL editor. **RLS is on for every table.** Players can read
   only their own profile. The faction standing is public. Everything else is server-only.
2. Auth → Providers: enable **Discord** (client id/secret from the Discord developer
   portal, redirect `https://<project>.supabase.co/auth/v1/callback`) and **Email** (magic
   link). Add the client URLs to the redirect allow-list.
3. Put `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` in
   `/etc/starcut/<env>.env`. Put the URL and **anon** key in Vercel as `VITE_SUPABASE_*`.

Replays stay on the VPS disk either way.

## 5. Verify end to end

1. `https://authority.example.com/healthz` returns `ok`. Its `version` should match the
   client's BETA watermark (bottom-left).
2. Open the client and play **Quick Play**. The lobby appears within a couple of seconds.
3. Open `https://authority.example.com/admin` and sign in with `ADMIN_PASSWORD`. Press F8
   in a match, send feedback, and it shows in the inbox with a "Watch clip" link.
4. If Quick Play hangs on "opening a data channel", a UDP range is blocked. If it says
   "server unreachable", the host is down or TCP/443 is blocked.

## Operating

- Logs: `pm2 logs starcut-production` (large corrections, feedback and match ends are logged).
- Restart: `pm2 restart starcut-staging`.
- Data: `/var/lib/starcut/<env>`: `profiles/`, `replays/`, `feedback.jsonl`, `reports.jsonl`,
  `telemetry.jsonl`, `war.json`. Back it up with `tar czf` from cron.
- Protocol mismatches between client and server are refused with a "refresh the page"
  message. Deploy server and client from the same commit.

## Alternative: Docker on the VPS

Build on the VPS, never locally:

```bash
cd /srv/starcut/production && git pull
docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t starcut-authority .
docker rm -f starcut-production; docker run -d --name starcut-production --restart unless-stopped \
  --env-file /etc/starcut/production.env -e STARCUT_DATA=/data \
  -p 127.0.0.1:9208:9208/tcp -p 20000-20010:20000-20010/udp \
  -v /var/lib/starcut/production:/data starcut-authority
```

For staging, use `-p 127.0.0.1:9308:9208/tcp -p 20100-20110:20100-20110/udp -e RTC_PORT_MIN=20100 -e RTC_PORT_MAX=20110`
with the staging env file and data dir.
