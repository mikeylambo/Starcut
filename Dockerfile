# STARCUT authority server.
#
#   docker build --build-arg GIT_SHA=$(git rev-parse --short HEAD) -t starcut-authority .
#   docker run -d --name starcut --restart unless-stopped \
#     -p 9208:9208/tcp -p 20000-20010:20000-20010/udp \
#     -v starcut-data:/data starcut-authority
#
# Ports: TCP 9208 (WebRTC signalling + /healthz + /replay + /report) and the UDP
# range RTC_PORT_MIN..RTC_PORT_MAX (WebRTC data channels). BOTH must be open on
# the host firewall and any cloud security list. See DEPLOY.md.

# ---- build: bundle the server (and the shared sim) into one file --------------
FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY game/package.json game/package.json
COPY vendor/web-shell/package.json vendor/web-shell/package.json
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:server

# ---- runtime: node + the one native dependency (geckos / node-datachannel) ----
FROM node:22-bookworm-slim
ARG GIT_SHA=unknown
WORKDIR /app
ENV NODE_ENV=production \
    PORT=9208 \
    RTC_PORT_MIN=20000 \
    RTC_PORT_MAX=20010 \
    STARCUT_DATA=/data \
    GIT_SHA=$GIT_SHA
COPY --from=build /src/package.json ./package.json
RUN GECKOS=$(node -p "require('./package.json').dependencies['@geckos.io/server']") \
 && VERSION=$(node -p "require('./package.json').version") \
 && node -e "require('fs').writeFileSync('package.json', JSON.stringify({name:'starcut-authority',version:process.argv[1],private:true,type:'module'}))" "$VERSION" \
 && npm install --omit=dev --no-audit --no-fund "@geckos.io/server@${GECKOS}" \
 && mkdir -p /data
COPY --from=build /src/dist-server/index.mjs ./index.mjs
COPY --from=build /src/dist-server/admin.html ./admin.html
VOLUME ["/data"]
EXPOSE 9208/tcp
EXPOSE 20000-20010/udp
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9208)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.mjs"]
