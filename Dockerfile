# Stage de build
FROM node:22-slim AS builder

# Installation de pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copie des fichiers de configuration
COPY package.json pnpm-lock.yaml* ./
COPY tsconfig.json ./

# Installation des dépendances
RUN pnpm install --frozen-lockfile

# Copie des sources
COPY src/ ./src/

# Build du projet
RUN pnpm run build

# Stage de production
FROM node:22-slim AS production

# Installation de pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copie des fichiers de configuration
COPY package.json pnpm-lock.yaml* ./

# Installation des dépendances de production uniquement
RUN pnpm install --prod --frozen-lockfile

# Copie des fichiers compilés depuis le stage de build
COPY --from=builder /app/dist ./dist

# Définition des variables d'environnement
ENV NODE_ENV=production

# Commande de démarrage
CMD ["node", "dist/index.js"]