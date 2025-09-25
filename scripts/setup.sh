#!/usr/bin/env bash
set -e

# Install Node deps
bun install

# Setup Python venv
python3 -m venv .venv
source .venv/bin/activate

# Upgrade pip + install deps
pip install --upgrade pip
pip install -r src/ai/py/requirements.txt

echo "Setup complete!"
