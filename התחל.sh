#!/bin/bash
clear
echo ""
echo "  🤖  WhatsApp AI Agent"
echo "  ══════════════════════════════"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "  ❌  Node.js לא מותקן."
  echo "  ⬇️   הורד מ: https://nodejs.org"
  echo ""
  exit 1
fi

echo "  ⏳  מתקין תלויות..."
npm install --silent

if [ -f ".env" ]; then
  echo "  ✅  הגדרות קיימות — מפעיל סוכן..."
  echo ""
  node src/index.js
else
  echo "  🌐  פותח אשף הגדרה..."
  echo ""
  node scripts/setup-web.js
fi
