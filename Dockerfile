FROM node:22-alpine
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV PORT=7373
EXPOSE 7373

USER node
CMD ["node", "server.js"]
