#!/bin/sh
# Runs as root (the container's default user — see Dockerfile.api, which no
# longer sets USER before this point) so it can fix ownership of WORK_DIR
# before dropping to the unprivileged "nextjs" user. This matters because
# WORK_DIR may be a Railway Volume mount, and Railway always mounts volumes
# as root:root regardless of the image's default user — without this, every
# write under WORK_DIR (job files, TTS/render output) fails with EACCES the
# moment WORK_DIR points at a mounted volume instead of the image's own
# (already root:nodejs-owned-at-build-time) filesystem.
set -e

WORK_DIR="${WORK_DIR:-/tmp/instareels}"
mkdir -p "$WORK_DIR"
chown -R nextjs:nodejs "$WORK_DIR"

# su (not gosu) deliberately — it ships in every Debian base image, so this
# has no new apt dependency to go stale or fail to resolve. su -c only takes
# a single command string, so the CMD argv is safely re-quoted into one.
cmd=""
for arg in "$@"; do
  cmd="$cmd '$(printf '%s' "$arg" | sed "s/'/'\\\\''/g")'"
done
exec su -s /bin/sh -c "exec$cmd" nextjs
