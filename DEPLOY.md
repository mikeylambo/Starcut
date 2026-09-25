# Deploying STARCUT

Two pieces:

| Piece | What | Where |
| --- | --- | --- |
| **Client** | Static Vite build (`game/dist`) | Vercel (or any static host) |
| **Authority** | Node server: rooms, 60 Hz sim, WebRTC data channels | A small VPS. It needs **UDP**, so serverless platforms won't work. |

Nothing is deployed yet. This is the runbook for when you do.

## Ports

| Port | Proto | Used for |
| --- | --- | --- |
| `9208` (`PORT`) | TCP | WebRTC signalling (geckos.io), `GET /healthz`, `GET /replay/<id>`, `POST /report` |
| `20000-20010` (`RTC_PORT_MIN`..`RTC_PORT_MAX`) | **UDP** | WebRTC data channels: all match traffic. geckos multiplexes, so 11 ports serve every room on the box. |

Both must be open **on the VPS firewall *and* in the cloud provider's security list or
network ACL**. The classic failure is `/healthz` answering while the game hangs on
"opening a data channel…". That means the UDP range is blocked.

## 1. Provision the VPS

Any 1 vCPU / 1 GB Linux box handles several rooms. The sim is about 0.1 ms per room-tick.

```bash
# Ubuntu 24.04 example
sudo apt-get update && sudo apt-get install -y docker.io git
sudo usermod -aG docker $USER && newgrp docker

# host firewall
sudo ufw allow 22/tcp
sudo ufw allow 9208/tcp
sudo ufw allow 20000:20010/udp
sudo ufw allow 443/tcp          # only if you front it with TLS (step 3)
sudo ufw enable
```

Open the same ports in the provider's console. On Oracle Cloud that means the
VCN security list and the instance's iptables. On AWS, the security group. On
Hetzner or DO, the cloud firewall if you enabled one.

## 2. Build and run the authority container

```bash
git clone https://github.com/mikeylambo/Starcut.git && cd Starcut
docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t starcut-authority .
cp server/.env.example server/.env        # edit as needed
docker run -d --name starcut --restart unless-stopped \
  --env-file server/.env \
  -p 9208:9208/tcp -p 20000-20010:20000-20010/udp \
  -v starcut-data:/data \
  starcut-authority

curl http://localhost:9208/healthz        # {"ok":true,...,"protocol":4,"commit":"<sha>"}
```

- Replays land in `/data/replays/<id>.json` and reports in `/data/reports.jsonl`, on the
  `starcut-data` volume.
- **STUN** (`STUN_URLS`) lets the server discover and advertise its public IP when the
  VPS sits behind 1:1 NAT, which most clouds do. Keep it on. Use `NO_STUN=1` only on a LAN.
- **TURN** slot: set `TURN_URL` / `TURN_USER` / `TURN_PASS` on the server and
  `VITE_TURN_*` on the client once a relay exists. You only need it for players behind
  symmetric NAT that can't reach the UDP range directly.
- Without Docker: `npm ci && npm run build:server && node dist-server/index.mjs`
  (Node 20+). The container runs exactly this bundle.

## 3. TLS (needed once the client is on HTTPS)

A client served from `https://…vercel.app` can't signal to a plain `http://` authority
(mixed content). Put a TLS proxy in front of the signalling port. The UDP data channels
are already DTLS-encrypted and bypass the proxy.

```bash
# DNS: authority.example.com -> VPS IP, then:
sudo apt-get install -y caddy
echo 'authority.example.com {
  reverse_proxy 127.0.0.1:9208
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy
curl https://authority.example.com/healthz
```

A free DuckDNS hostname works if you don't own a domain. Jetpack Arena used this setup.

## 4. Point the client at it and deploy to Vercel

The client reads the authority at **build time**:

| Env var | Example | Notes |
| --- | --- | --- |
| `VITE_AUTHORITY_URL` | `https://authority.example.com` | https with no port → 443 (the Caddy proxy). `http://1.2.3.4:9208` also works for an http-only client. |
| `VITE_STUN_URLS` | `stun:stun.l.google.com:19302` | Comma-separated. |
| `VITE_TURN_URL` / `_USER` / `_PASS` | | Later. |

If unset, the client uses the page's own host on :9208. That's `localhost` in dev, and the
host machine for LAN play. `?server=host:port` overrides everything, for testing.

Vercel: import the repo. `vercel.json` already sets `npm ci` → `npm run build` → `game/dist`.
Add the env vars above under Project → Settings → Environment Variables, then redeploy.
Locally: `cp game/.env.example game/.env.production.local` and run `npm run build`.

## 5. Verify end to end

1. `https://authority.example.com/healthz` returns `ok`, and `commit` matches `git rev-parse --short HEAD`.
   The client and the authority share the sim code, so they must be on the same commit.
2. Open the Vercel URL, then **Quick Play**. The lobby should appear within a couple of seconds.
3. Open it on a second machine on a different network and **Join by Code**.
4. If step 2 hangs on "opening a data channel", the UDP range is blocked (step 1). If it
   says "could not open a connection", the host is down or TCP 9208/443 is blocked.

## Updating

```bash
cd Starcut && git pull
docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t starcut-authority .
docker rm -f starcut && docker run -d --name starcut ...   # same run line as above
```

Redeploy the client from the same commit. Protocol mismatches are refused with a
"refresh the page" message.
