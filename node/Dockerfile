# 使用 Alpine 作为基础镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 1. 安装 Chromium 及其运行依赖
# 这些是 Alpine 运行无头浏览器所必需的库
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# 2. 设置环境变量，告知 Puppeteer 使用系统安装的 Chromium
# 这样就不需要运行 npx puppeteer browsers install 了
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# 3. 复制依赖描述并安装
COPY ./node/package*.json ./
RUN npm install --production

# 4. 复制应用程序代码
COPY ./node .

# 5. 设置其他环境变量
ENV PORT=8080
ENV DEFAULT_SAVE_PATH=/app/downloads

# 暴露端口
EXPOSE 8080

# 启动应用程序
# 注意：在 Docker 中运行 Puppeteer 通常需要 --no-sandbox 参数（已在你 JS 代码中配置）
CMD ["node", "index.js"]
