# Build client + server together (npm workspaces hoist deps to root node_modules)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm install --workspaces --include-workspace-root
COPY client client
COPY server server
RUN npm run build --workspace client && npm run build --workspace server

# Runtime
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/client/dist ./client/dist
ENV DB_PATH=/tmp/data.db
EXPOSE 8080
CMD ["node", "server/dist/index.js"]
