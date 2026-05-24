FROM node:21-alpine3.18

WORKDIR /app

COPY package*.json ./
# COPY yarn.lock ./

RUN apk update
RUN yarn
RUN yarn cache clean
COPY . .

ENV PORT 3000
EXPOSE 3000

CMD ["node", "index.js"]
