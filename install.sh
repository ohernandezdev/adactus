#!/bin/sh
# Installs adactus globally via npm and runs the doctor check.
# POSIX sh — avoid bashisms so this works under dash/ash too.

set -e

# Resolve the directory this script lives in, portably (no readlink -f,
# which is not available on macOS by default).
resolve_script_dir() {
  script="$0"
  while [ -h "$script" ]; do
    dir=$(cd -P "$(dirname "$script")" >/dev/null 2>&1 && pwd)
    script=$(readlink "$script")
    case "$script" in
      /*) ;;
      *) script="$dir/$script" ;;
    esac
  done
  cd -P "$(dirname "$script")" >/dev/null 2>&1 && pwd
}

SCRIPT_DIR=$(resolve_script_dir)

if ! command -v node >/dev/null 2>&1; then
  echo "adactus install: node is not installed. Install Node.js >= 20 first." >&2
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "adactus install: Node.js >= 20 is required (found $(node -v))." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "adactus install: npm is not installed." >&2
  exit 1
fi

echo "Installing adactus from $SCRIPT_DIR ..."
# --install-links copies the package and installs node-pty; a plain
# `npm install -g .` would only symlink this folder without dependencies.
(cd "$SCRIPT_DIR" && npm install -g --install-links .)

echo ""
GLOBAL_BIN="$(npm prefix -g)/bin"

echo "Running adactus doctor..."
"$GLOBAL_BIN/adactus" doctor

if ! command -v adactus >/dev/null 2>&1; then
  echo "" >&2
  echo "adactus install: installed to $GLOBAL_BIN, which is not on your PATH." >&2
  echo "Add it to your shell profile:  export PATH=\"$GLOBAL_BIN:\$PATH\"" >&2
  exit 1
fi
