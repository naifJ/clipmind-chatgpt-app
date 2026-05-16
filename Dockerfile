FROM node:20-alpine

WORKDIR /app

COPY clipmind-chatgpt-app/package*.json ./clipmind-chatgpt-app/
RUN cd clipmind-chatgpt-app && npm ci

COPY clipmind-chatgpt-app ./clipmind-chatgpt-app

WORKDIR /app/clipmind-chatgpt-app
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm", "start"]
