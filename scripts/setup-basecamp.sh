#!/usr/bin/env bash
# Creates the Secret Manager secrets the Basecamp tools use and lets Cloud Run
# read and update them. Run once. The values themselves are entered later on
# the server's /basecamp/connect page.
#
# Usage: GCP_PROJECT_ID=<project-id> bash scripts/setup-basecamp.sh

set -euo pipefail

PROJECT="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to your Google Cloud project ID}"

PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in BASECAMP_CLIENT_ID BASECAMP_CLIENT_SECRET BASECAMP_TOKENS; do
  if gcloud secrets describe "$SECRET" --project="$PROJECT" &>/dev/null; then
    echo "Secret '$SECRET' already exists."
  else
    gcloud secrets create "$SECRET" --replication-policy="automatic" --project="$PROJECT"
  fi
  # The connect page saves new values, so the server needs to add versions too
  for ROLE in roles/secretmanager.secretAccessor roles/secretmanager.secretVersionAdder; do
    gcloud secrets add-iam-policy-binding "$SECRET" \
      --member="serviceAccount:$SA" \
      --role="$ROLE" \
      --project="$PROJECT" \
      --quiet >/dev/null
  done
done

URL=$(gcloud run services describe toodledo-mcp --region us-central1 --project "$PROJECT" --format='value(status.url)' 2>/dev/null || true)
echo ""
echo "Done. Next:"
echo "  1. Register a Basecamp app at https://launchpad.37signals.com/integrations"
echo "     with Redirect URI: ${URL:-<server URL>}/basecamp/callback"
echo "  2. Open ${URL:-<server URL>}/basecamp/connect and follow the steps."
