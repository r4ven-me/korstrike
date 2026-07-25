# syntax=docker/dockerfile:1
FROM node:20-alpine

# unzip: extracting downloaded map archives (server/scripts-style, no npm zip dep needed)
RUN apk add --no-cache unzip

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public

RUN addgroup -S panel && adduser -S panel -G panel && \
    mkdir -p /panel-data && chown panel:panel /panel-data && \
    mkdir -p /maps-data && chown panel:panel /maps-data && \
    mkdir -p /control && chown panel:panel /control

USER panel
EXPOSE 8080
VOLUME ["/panel-data", "/maps-data", "/control"]

CMD ["node", "src/index.js"]
