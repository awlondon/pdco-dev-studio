FROM node:20-slim

WORKDIR /app

ARG VITE_API_BASE
ARG VITE_WS_BASE

ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_WS_BASE=$VITE_WS_BASE
ENV PORT=8080

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# frontend build needs devDependencies (e.g. vite)
RUN npm --prefix pdco-frontend install --include=dev
RUN npm run frontend:build

ENV NODE_ENV=production
CMD ["node", "server.js"]
