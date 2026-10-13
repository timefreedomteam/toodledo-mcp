#!/usr/bin/env bash
# Sets up Workload Identity Federation so GitHub Actions can deploy to Cloud Run.
# Run once after creating the GCloud project and GitHub repo.
#
# Prerequisites:
#   - A GCloud project exists with billing linked
#   - GitHub repo exists (e.g. timefreedomteam/toodledo-mcp)
#   - Optional: the GitHub CLI (gh), signed in, to set the repo secrets for you
#
# Usage: GCP_PROJECT_ID=<project-id> bash scripts/setup-github-deploy.sh <github-org/repo>
#   e.g.: GCP_PROJECT_ID=toodledo-mcp-rmb bash scripts/setup-github-deploy.sh timefreedomteam/toodledo-mcp

set -euo pipefail

GITHUB_REPO="${1:?Usage: $0 <github-org/repo>}"
PROJECT="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID to your Google Cloud project ID}"
REGION="us-central1"
SA_NAME="github-deploy"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
WIF_POOL="github-pool"
WIF_PROVIDER="github-provider"

echo "=== Toodledo MCP - GitHub Actions Deploy Setup ==="
echo "Project:     $PROJECT"
echo "GitHub repo: $GITHUB_REPO"
echo ""

gcloud config set project "$PROJECT"

# 1. Enable required APIs
echo "Enabling APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  --project="$PROJECT"

# 2. Create Artifact Registry repo (if not exists)
if ! gcloud artifacts repositories describe toodledo-mcp --location="$REGION" --project="$PROJECT" &>/dev/null; then
  echo "Creating Artifact Registry repo..."
  gcloud artifacts repositories create toodledo-mcp \
    --repository-format=docker \
    --location="$REGION" \
    --project="$PROJECT"
else
  echo "Artifact Registry repo already exists."
fi

# 3. Create service account for GitHub Actions
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT" &>/dev/null; then
  echo "Creating service account: $SA_NAME"
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="GitHub Actions Deploy" \
    --project="$PROJECT"
else
  echo "Service account $SA_NAME already exists."
fi

# 4. Grant roles to the service account
echo "Granting IAM roles..."
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/iam.serviceAccountUser \
  roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE" \
    --quiet
done

# Also grant secretVersionAdder for TOODLEDO_TOKENS (token refresh at runtime)
# This is for the Cloud Run runtime SA, not the deploy SA — handled in setup-secrets.sh

# 5. Create Workload Identity Pool
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

if ! gcloud iam workload-identity-pools describe "$WIF_POOL" --location=global --project="$PROJECT" &>/dev/null; then
  echo "Creating Workload Identity Pool..."
  gcloud iam workload-identity-pools create "$WIF_POOL" \
    --location=global \
    --display-name="GitHub Actions" \
    --project="$PROJECT"
else
  echo "Workload Identity Pool already exists."
fi

# 6. Create Workload Identity Provider (GitHub OIDC)
POOL_ID="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}"
PROVIDER_ID="${POOL_ID}/providers/${WIF_PROVIDER}"

if ! gcloud iam workload-identity-pools providers describe "$WIF_PROVIDER" \
    --workload-identity-pool="$WIF_POOL" --location=global --project="$PROJECT" &>/dev/null; then
  echo "Creating Workload Identity Provider..."
  gcloud iam workload-identity-pools providers create-oidc "$WIF_PROVIDER" \
    --workload-identity-pool="$WIF_POOL" \
    --location=global \
    --issuer-uri="https://token.actions.githubusercontent.com" \
    --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}'" \
    --project="$PROJECT"
else
  echo "Workload Identity Provider already exists."
fi

# 7. Allow the GitHub repo to impersonate the service account
echo "Binding WIF to service account..."
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_REPO}" \
  --project="$PROJECT" \
  --quiet

echo ""
echo "=== Done ==="
echo ""
if command -v gh &>/dev/null && gh auth status &>/dev/null; then
  echo "Setting GitHub repo secrets and variable with gh..."
  gh secret set WIF_PROVIDER --repo "$GITHUB_REPO" --body "$PROVIDER_ID"
  gh secret set WIF_SERVICE_ACCOUNT --repo "$GITHUB_REPO" --body "$SA_EMAIL"
  gh variable set GCP_PROJECT_ID --repo "$GITHUB_REPO" --body "$PROJECT"
  echo "Done."
else
  echo "Add these in the GitHub repo (Settings → Secrets and variables → Actions):"
  echo ""
  echo "  Secret   WIF_PROVIDER:        ${PROVIDER_ID}"
  echo "  Secret   WIF_SERVICE_ACCOUNT: ${SA_EMAIL}"
  echo "  Variable GCP_PROJECT_ID:      ${PROJECT}"
fi
echo ""
echo "The deploy workflow (.github/workflows/deploy.yml) references these."
echo ""
echo "Next: run 'GCP_PROJECT_ID=$PROJECT bash scripts/setup-secrets.sh' to create the Toodledo secrets."
