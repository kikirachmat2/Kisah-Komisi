#!/bin/bash
set -e

VPS_HOST="152.69.218.198"
VPS_USER="ubuntu"
VPS_DIR="/home/ubuntu/kisahkomisi-bot"
SSH_KEY="$HOME/.ssh/manake_singapore"

echo "🚀 Memulai sinkronisasi Kisah Komisi Bot ke Server VPS ($VPS_HOST)..."

rsync -avz --progress -e "ssh -i $SSH_KEY -o StrictHostKeyChecking=no" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'data/kisahkomisi.db*' \
  --exclude '.env' \
  ./ "$VPS_USER@$VPS_HOST:$VPS_DIR/"

echo "📦 Memperbarui dependencies dan me-reload PM2 di VPS..."
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$VPS_USER@$VPS_HOST" << 'EOF'
  cd /home/ubuntu/kisahkomisi-bot
  npm install --production
  pm2 reload kisahkomisi-bot || pm2 start src/index.js --name kisahkomisi-bot
  pm2 save
  echo "✅ Status PM2 terkini:"
  pm2 status kisahkomisi-bot
EOF

echo "🎉 Deployment selesai dan berjalan sukses!"
