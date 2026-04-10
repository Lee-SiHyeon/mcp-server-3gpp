#!/usr/bin/env bash
# Deploy mcp-server-3gpp to Fly.io
#
# Prerequisites:
#   1. flyctl installed: curl -L https://fly.io/install.sh | sh
#   2. flyctl auth: flyctl auth login
#
# Usage:
#   ./deploy.sh              # Deploy with auto-generated app name
#   ./deploy.sh my-app-name  # Deploy with custom app name
#   API_KEY=secret ./deploy.sh  # Deploy with API key

set -euo pipefail

APP_NAME="${1:-mcp-server-3gpp}"
API_KEY="${API_KEY:-}"

echo "=== Fly.io Deploy: ${APP_NAME} ==="

# Check flyctl
if ! command -v flyctl &>/dev/null; then
  echo "Error: flyctl not installed."
  echo "Install: curl -L https://fly.io/install.sh | sh"
  exit 1
fi

# Check authentication
if ! flyctl auth whoami &>/dev/null; then
  echo "Error: Not authenticated."
  echo "Run: flyctl auth login"
  exit 1
fi

# Update fly.toml with app name
sed -i "s/^app = .*/app = \"${APP_NAME}\"/" fly.toml

# Create app if it doesn't exist
if ! flyctl apps list 2>/dev/null | grep -q "^${APP_NAME}"; then
  echo "Creating app: ${APP_NAME}"
  flyctl apps create "${APP_NAME}" --org personal
fi

# Set API key as secret (if provided)
if [ -n "${API_KEY}" ]; then
  echo "Setting API_KEY secret..."
  echo "${API_KEY}" | flyctl secrets set API_KEY="${API_KEY}" --app "${APP_NAME}"
fi

# Deploy
echo "Deploying..."
flyctl deploy --app "${APP_NAME}"

# Show status
echo ""
echo "=== Deploy Complete ==="
flyctl info --app "${APP_NAME}"
echo ""
echo "MCP Endpoint: https://${APP_NAME}.fly.dev/mcp"
echo "Health Check: https://${APP_NAME}.fly.dev/health"
if [ -z "${API_KEY}" ]; then
  echo "Warning: No API_KEY set. Server is open access."
  echo "Set it with: flyctl secrets set API_KEY=your-secret --app ${APP_NAME}"
fi
