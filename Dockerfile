FROM node:20-slim

WORKDIR /app

ARG VITE_API_BASE
ARG VITE_WS_BASE

ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_WS_BASE=$VITE_WS_BASE
ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm --prefix pdco-frontend install
RUN npm run frontend:build

CMD ["node", "server.js"]
