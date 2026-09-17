#!/usr/bin/env bash
# Build the site and publish it on Cloudflare Pages: https://dwg.moonforge.tech
#
# Credentials: CLOUDFLARE_API_TOKEN from the environment, otherwise from
# Vault (the owner's lifeOS rule: secrets live in Vault and nowhere else).
# The Pages project, its custom domain and the CNAME were set up once.
#
# DEPLOY_BRANCH picks the Pages branch: main is production, anything else is a
# preview at <branch>.dwg-moonforge-tech.pages.dev.
set -euo pipefail
cd "$(dirname "$0")"
here="$(pwd)"

PROJECT=dwg-moonforge-tech
BRANCH="${DEPLOY_BRANCH:-main}"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  export VAULT_ADDR="${VAULT_ADDR:-https://vault.techsource.pro}"
  CLOUDFLARE_API_TOKEN="$(vault kv get -field=token secret/internal/cloudflare-api-token)"
fi
export CLOUDFLARE_API_TOKEN
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-8e86412a685c7430fdb9801b463da7fc}"

npm run build

# Deploy from a directory of its own: wrangler started inside a Vite project
# rewrites the project's config, and dotfiles stay home.
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
rsync -a --exclude '.*' dist/ "$stage/site/"
cd "$stage"
npx --yes wrangler@4 pages deploy site --project-name "$PROJECT" --branch "$BRANCH" \
  --commit-hash "$(git -C "$here" rev-parse --short HEAD)" --commit-dirty=true
