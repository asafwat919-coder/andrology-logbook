FROM node:22-slim
WORKDIR /app
COPY . .
ENV PORT=8080 HOST=0.0.0.0 COOKIE_SECURE=1 NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
