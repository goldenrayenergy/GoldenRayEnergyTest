#!/bin/bash
set -e
echo "☀️  GoldenRay Energy — Full Stack Setup"
echo "========================================"

# Install root deps
echo "📦 Installing root dependencies..."
npm install

# Install server deps
echo "📦 Installing server dependencies..."
cd server && npm install && cd ..

# Install client deps
echo "📦 Installing client dependencies..."
cd client && npm install && cd ..

# Copy env if not exists
if [ ! -f .env ]; then
  echo "📋 Creating .env from template..."
  cp .env.example .env
  echo "⚠️  Edit .env with your database credentials!"
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Start PostgreSQL: docker compose up db -d"
echo "  2. Edit .env with your credentials"
echo "  3. Run: npm run dev"
echo ""
