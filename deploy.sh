#!/bin/bash
set -e

SERVER_USER="${VPS_USER:-ubuntu}"
SERVER_IP="${VPS_HOST:-152.69.218.198}"
SSH_KEY="${SSH_KEY_PATH:-$HOME/.ssh/manake_singapore}"
REMOTE_DIR="/home/ubuntu/kisahkomisi-bot"

echo "🚀 [1/3] Syncing code to Server 1 (SG1)..."
rsync -avz -e "ssh -i $SSH_KEY" \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.git' \
  --exclude 'data/*.db*' \
  ./kisahkomisi-bot/ "$SERVER_USER@$SERVER_IP:$REMOTE_DIR/"

echo "📦 [2/3] Installing dependencies & reloading PM2..."
ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" "bash -s" << 'REMOTE_SCRIPT'
  cd /home/ubuntu/kisahkomisi-bot
  npm install --omit=dev
  if pm2 describe kisahkomisi-bot > /dev/null 2>&1; then
    echo "🔄 Reloading PM2 process..."
    pm2 reload kisahkomisi-bot
  else
    echo "⚡ PM2 process not running yet. Make sure .env is configured first."
  fi
REMOTE_SCRIPT

echo "✅ Deployment finished successfully!"
