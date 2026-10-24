#!/bin/bash
set -e

# Load from .env if exists
if [ -f .env ]; then
  export $(grep -E '^(VPS_HOST|VPS_USER|VPS_DIR|SSH_KEY)=' .env | xargs)
fi

VPS_HOST="${VPS_HOST:-$DEPLOY_VPS_HOST}"
VPS_USER="${VPS_USER:-ubuntu}"
VPS_DIR="${VPS_DIR:-/home/ubuntu/kisahkomisi-bot}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/manake_singapore}"

if [ -z "$VPS_HOST" ]; then
  echo "❌ Error: VPS_HOST tidak diset. Silakan set di .env atau jalankan: VPS_HOST=x.x.x.x ./deploy.sh"
  exit 1
fi

echo "🚀 Memulai sinkronisasi Kisah Komisi Bot ke Server VPS ($VPS_HOST)..."

rsync -avz --progress -e "ssh -i $SSH_KEY" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'data/kisahkomisi.db*' \
  --exclude '.env' \
  ./ "$VPS_USER@$VPS_HOST:$VPS_DIR/"

echo "📦 Memperbarui dependencies dan me-reload PM2 di VPS..."
ssh -i "$SSH_KEY" "$VPS_USER@$VPS_HOST" << 'EOF'
  cd /home/ubuntu/kisahkomisi-bot
  npm install --production
  pm2 reload kisahkomisi-bot || pm2 start src/index.js --name kisahkomisi-bot
  pm2 save
  echo "✅ Status PM2 terkini:"
  pm2 status kisahkomisi-bot
EOF

echo "🎉 Deployment selesai dan berjalan sukses!"
