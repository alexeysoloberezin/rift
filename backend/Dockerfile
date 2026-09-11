# Собирается с контекстом = корень репозитория (см. docker-compose.yml:
# build.context: . / build.dockerfile: backend/Dockerfile) — это нужно,
# чтобы затащить в образ db/schema.sql, который лежит на уровень выше backend/.

FROM node:20-alpine

WORKDIR /app/backend

COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/. .
COPY db /app/db

RUN mkdir -p uploads/demos

EXPOSE 3000

CMD ["node", "src/index.js"]
