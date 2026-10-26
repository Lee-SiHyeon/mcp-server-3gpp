FROM node:22-bookworm-slim AS dependencies
WORKDIR /app

# Skip the repository postinstall (which attempts a Git LFS download), but
# explicitly install native dependencies needed by SQLite and local inference.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm rebuild better-sqlite3 onnxruntime-node \
    && node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.prepare('select 1').get();d.close()"

FROM node:22-bookworm-slim
WORKDIR /app
LABEL org.opencontainers.image.source="https://github.com/Lee-SiHyeon/mcp-server-3gpp"
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package*.json ./
COPY --chown=node:node src/ src/
COPY --chown=node:node db/ db/
COPY --chown=node:node data/corpus/3gpp.db data/corpus/3gpp.db
RUN chown -R node:node /app/data

# A bundled image must have SQLite, not an LFS pointer. A runtime-only image
# removes the pointer and expects a writable corpus directory to be mounted.
ARG BUNDLE_CORPUS=true
RUN if [ "$BUNDLE_CORPUS" = "true" ]; then \
      node -e "const fs=require('fs');const fd=fs.openSync('data/corpus/3gpp.db','r');const b=Buffer.alloc(16);fs.readSync(fd,b,0,16,0);fs.closeSync(fd);if(!b.equals(Buffer.from('SQLite format 3\\0')))throw Error('Corpus is not a SQLite database; fetch the Git LFS object first')"; \
    elif [ "$BUNDLE_CORPUS" = "false" ]; then rm -f data/corpus/3gpp.db; \
    else echo 'BUNDLE_CORPUS must be true or false' >&2; exit 1; fi

ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/http.js"]
