#!/bin/bash
cd "$(dirname "$0")"
NODEDIR="$PWD/runtime/node"

# 1. Node.js: use the system one, or download a private copy into ./runtime/node
if ! command -v node >/dev/null 2>&1; then
  if [ ! -x "$NODEDIR/bin/node" ]; then
    echo "Node.js not found. Downloading it into this folder (one time only)..."
    ARCH=$( [ "$(uname -m)" = "arm64" ] && echo arm64 || echo x64 )
    BASE=https://nodejs.org/dist/latest-v22.x/
    NAME=$(curl -fsSL "${BASE}SHASUMS256.txt" | awk '{print $2}' | grep "darwin-${ARCH}.tar.gz$" | head -1)
    mkdir -p runtime && curl -fL "${BASE}${NAME}" -o runtime/node.tgz && tar -xzf runtime/node.tgz -C runtime \
      && rm runtime/node.tgz && rm -rf "$NODEDIR" && mv runtime/node-v* "$NODEDIR" \
      || { read -p "Could not download Node.js. Check the internet and try again. Press Enter."; exit 1; }
  fi
  export PATH="$NODEDIR/bin:$PATH"
fi

# 2. Google Chrome
if [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  echo "Google Chrome is not installed. Opening the download page: install it, then open this file again."
  open https://www.google.com/chrome/
  read -p "Press Enter to close."
  exit 1
fi

# 3. Packages (first start only)
if [ ! -d node_modules ]; then
  echo "First start: installing the runner. This takes about a minute..."
  npm install --no-audit --no-fund || { read -p "Install failed. Press Enter to close."; exit 1; }
fi

# 4. Start
echo "KEEP THIS WINDOW OPEN while the team is running sites. Close it to stop the runner."
node runner.js
