# Stage 1: Build
FROM node:24-alpine AS builder

WORKDIR /app

# Copy dependency files first to leverage Docker layer caching
COPY package*.json ./

# Install all dependencies (including devDependencies for the build)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the application (transpiles TS to JS in /dist)
RUN npm run build

# Stage 2: Final Production Image
FROM node:24-alpine

WORKDIR /app

# Set environment to production
ENV NODE_ENV=production

# Copy only the compiled output and production dependencies
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Use a non-root user for security
USER node

EXPOSE 3000

# Start the application
CMD ["node", "dist/main.js"]
