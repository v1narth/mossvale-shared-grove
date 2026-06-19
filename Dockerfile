FROM node:24-slim

WORKDIR /app

COPY package.json ./
COPY server ./server

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

CMD ["node", "server/game-server.mjs"]
