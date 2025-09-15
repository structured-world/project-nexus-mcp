# ==============================================
# Stage 1: Builder - Full Node.js with build tools
# ==============================================
FROM node:22-alpine3.20 AS builder

# Set working directory
WORKDIR /app

# Install build dependencies (including Python for native modules)
RUN apk add --no-cache \
    python3 \
    py3-pip \
    git \
    build-base \
    && corepack enable \
    && rm -rf /var/cache/apk/*

# Copy package files for dependency installation
COPY package.json yarn.lock .yarnrc.yml ./

# Install ALL dependencies (including devDependencies for TypeScript compilation)
RUN yarn install --immutable

# Copy source code and build configuration
COPY src/ ./src/
COPY tsconfig.json ./

# Build the TypeScript application
RUN yarn build

# Clean up build artifacts but keep compiled dist/
RUN rm -rf src/ tsconfig.json

# Install only production dependencies for smaller runtime
RUN yarn workspaces focus --production \
    && yarn cache clean

# ==============================================
# Stage 2: Runtime - Minimal Node.js for production
# ==============================================
FROM node:22-alpine3.20 AS runtime

# Set working directory
WORKDIR /app

# Install only essential runtime dependencies for MCP providers
# - python3 + uv for GitLab MCP server (requires Python 3.13+)
# - git for GitLab integration
# - No build tools needed in runtime!
RUN apk add --no-cache \
    python3 \
    py3-pip \
    git \
    && pip3 install --break-system-packages --no-cache-dir uv \
    && rm -rf /var/cache/apk/* \
    && rm -rf /usr/lib/python*/ensurepip \
    && rm -rf /usr/lib/python*/idlelib \
    && rm -rf /usr/lib/python*/tkinter

# Create non-root user for security
RUN addgroup -g 1001 -S nexus \
    && adduser -S nexus -u 1001 -G nexus

# Copy built application and production dependencies from builder stage
COPY --from=builder --chown=nexus:nexus /app/dist ./dist
COPY --from=builder --chown=nexus:nexus /app/node_modules ./node_modules
COPY --from=builder --chown=nexus:nexus /app/package.json ./package.json

# Switch to non-root user
USER nexus

# Expose default HTTP port
EXPOSE 3000

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    NODE_OPTIONS="--max-old-space-size=512"

# Health check to ensure the service is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "fetch('http://localhost:3000/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))" || exit 1

# Default command runs in HTTP server mode
# Using the compiled JavaScript directly (no TypeScript dependencies needed)
CMD ["node", "--no-warnings", "-r", "source-map-support/register", "dist/main.js", "http", "--port", "3000"]
