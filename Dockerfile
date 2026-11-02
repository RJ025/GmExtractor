FROM node:22-bookworm-slim

# Set working directory
WORKDIR /app

# Environment variables for production & Playwright
ENV NODE_ENV=production
ENV DOCKER_CONTAINER=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy package manifests first for layer caching
COPY package*.json ./

# Install Node dependencies & Playwright Chromium with required Debian system libraries
RUN npm ci --omit=dev && \
    npx playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

# Copy application source
COPY . .

# Ensure data directory exists and is writable
RUN mkdir -p /app/data && chmod -R 777 /app/data

# Expose default port (Render & Railway override PORT dynamically)
EXPOSE 5000

# Start the server
CMD ["node", "server.js"]
