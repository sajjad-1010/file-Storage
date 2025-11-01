FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache bash python3 make g++ \
    && npm install -g pnpm \
    && apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm install --production

COPY . .

RUN npm run build

EXPOSE 4000

CMD ["node", "dist/main.js"]
