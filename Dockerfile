# Build client
FROM node:22-slim AS client-build
WORKDIR /app
COPY package.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm install --workspaces --include-workspace-root
COPY client client
RUN npm run build --workspace client

# Build server
FROM node:22-slim AS server-build
WORKDIR /app
COPY package.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm install --workspaces --include-workspace-root
COPY server server
RUN npm run build --workspace server

# Runtime
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=server-build /app/server/node_modules ./server/node_modules
COPY --from=server-build /app/server/dist ./server/dist
COPY --from=server-build /app/server/package.json ./server/package.json
COPY --from=client-build /app/client/dist ./client/dist
ENV DB_PATH=/tmp/data.db
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
