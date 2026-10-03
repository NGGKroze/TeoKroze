#!/usr/bin/env bash
# Builds dist/QwenLocal-Setup.zip (unzip anywhere on Windows, double-click QwenLocal.bat).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
rm -f dist/QwenLocal-Setup.zip
staging=$(mktemp -d)
mkdir "$staging/QwenLocal"
cp QwenLocal.ps1 QwenLocal.bat README.md "$staging/QwenLocal/"
(cd "$staging" && zip -qr - QwenLocal) > dist/QwenLocal-Setup.zip
rm -rf "$staging"
echo "Built dist/QwenLocal-Setup.zip"
