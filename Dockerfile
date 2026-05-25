FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache python3 py3-pip
COPY server/package.json server/
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server/ server/
COPY templates/ templates/
COPY --from=client-build /app/client/dist client/dist
ENV NODE_ENV=production
EXPOSE 3300
CMD ["node", "server/index.js"]
