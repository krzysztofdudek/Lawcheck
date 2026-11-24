#!/bin/sh
set -eu
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg chromium > /dev/null
mkdir -p /work
tar -C /src --exclude=./node_modules --exclude=./dist --exclude=./film/dist --exclude=./.git -cf - . | tar -C /work -xf -
cd /work
npm ci --no-audit --no-fund
npm run build
HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium node film/render.mjs --out /out
chown -R "$(stat -c %u:%g /out)" /out
