FROM node:18-alpine

# 安装 Chromium 及其所有 Alpine 运行依赖
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    udev \
    dbus

# 环境设置
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    PORT=8080 \
    DEFAULT_SAVE_PATH=/app/downloads

WORKDIR /app

# 先安装依赖（利用缓存）
COPY ./node/package*.json ./
RUN npm install --production

# 复制源码
COPY ./node .

# 确保文件夹权限
RUN mkdir -p /app/downloads /app/tmp /app/node_modules

EXPOSE 8080
CMD ["node", "index.js"]
