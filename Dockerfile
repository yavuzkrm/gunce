FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY public ./public
RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "server/index.js"]
