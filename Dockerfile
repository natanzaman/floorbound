FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
# node directly (not npm) so SIGTERM on a deploy reaches the server, which drains and saves (server/shutdown.js)
CMD ["node", "server/index.js"]
