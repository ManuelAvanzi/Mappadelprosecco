# Mappa turistica del Prosecco — immagine per l'hosting (Render, Fly, qualsiasi Docker).
# I dati modificabili (data/, uploads/) vanno su un disco persistente: DATA_DIR e UPLOADS_DIR (vedi render.yaml).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
EXPOSE 5800
CMD ["node", "server.mjs"]
