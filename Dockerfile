FROM node:20

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .
EXPOSE 8090

ENV NODE_ENV=production

CMD ["npm","start"]