#!/usr/bin/env bash
set -euo pipefail

image="ghcr.io/lee-sihyeon/mcp-server-3gpp-runtime"
tag="runtime-${GITHUB_SHA:0:12}"
reference="${image}:${tag}-${RUNNER_ARCH,,}"

# The runtime-only build removes the checkout's LFS pointer. Verify that a
# mounted synthetic DB works before publishing; no corporate data is uploaded.
docker build --build-arg BUNDLE_CORPUS=false --tag "$reference" .
docker run --rm --entrypoint node "$reference" -e "if(require('fs').existsSync('/app/data/corpus/3gpp.db'))process.exit(1)"
python3 .github/scripts/make-smoke-corpus.py
chmod 777 data/corpus
chmod 666 data/corpus/3gpp.db
docker run --detach --name 3gpp-runtime-smoke -p 127.0.0.1:39273:3000 \
  -e API_KEY=ci-only-key -e THREEGPP_DISABLE_SEMANTIC=true \
  -v "$PWD/data/corpus:/app/data/corpus" "$reference"
trap 'docker rm --force 3gpp-runtime-smoke >/dev/null 2>&1 || true' EXIT
node .github/scripts/smoke-container.mjs

printf '%s' "$GITHUB_TOKEN" | docker login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
docker push "$reference"
printf 'Published runtime-only image: %s\n' "$reference"
