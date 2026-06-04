# AI/ML Developer Platform (IDP)

Data scientists and ML engineers shouldn't need to understand Kubernetes to deploy a model. And platform teams shouldn't need to manually set up a new repo, ArgoCD app, MLflow registration, and cost tracking every time someone wants to put a model in production.

This internal developer platform closes that gap. It uses Backstage as the developer portal with a self-service template — fill in the form, get a repo with the right structure, an ArgoCD app wired up, and an MLflow experiment already created. GPU cost tracking is a separate lightweight service that shows spend by team without needing access to the full AWS console.

## What gets automated when a new model service is scaffolded

1. GitHub repository created from the template (correct structure, Dockerfile, k8s manifests)
2. MLflow registered model created with team and risk-level tags
3. ArgoCD application configured and synced to the target environment
4. Backstage catalog entry created so the service appears in the portal
5. GPU cost tracker starts grouping this team's spend under the right tag

All of this happens in one Backstage template form submission.

## Stack

| Component | Runs on | Purpose |
|-----------|---------|---------|
| Backstage | EKS (platform namespace) | Developer portal and service catalog |
| MLflow | EKS (ml-platform namespace) | Experiment tracking and model registry |
| ArgoCD | EKS (argocd namespace) | GitOps deployment of ML services |
| GPU Cost Tracker | ECS Fargate | Lightweight cost/utilization dashboard |

The GPU cost tracker is on Fargate rather than EKS intentionally. It's a Node.js Express app that doesn't need orchestration overhead. Putting everything on Kubernetes just because you can is a design smell.

## Deploying

```bash
# Provision EKS and ECS infrastructure
cd terraform && terraform init && terraform apply

# Install Backstage (using Helm chart)
helm repo add backstage https://backstage.github.io/charts
helm upgrade --install backstage backstage/backstage \
  -f helm-values/backstage-values.yaml \
  -n platform --create-namespace

# Install MLflow
helm upgrade --install mlflow community-charts/mlflow \
  -f helm-values/mlflow-values.yaml \
  -n ml-platform --create-namespace

# Register the Backstage template
kubectl apply -f backstage-template/

# Deploy GPU cost tracker
cd custom-services/gpu-cost-tracker
docker build -t gpu-cost-tracker .
# Push to ECR, then ECS deploys via ArgoCD
```

## GPU cost tracker endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/costs/by-team?days=30` | GPU + SageMaker spend grouped by team tag |
| `GET /api/gpu/utilization` | Last 30 minutes of GPU utilization from Container Insights |
| `GET /health` | Health check |

## Why Backstage

The alternative is documentation that says "here are the 8 manual steps to deploy a model." Nobody follows it consistently. Backstage turns the process into a form — the steps happen automatically and correctly every time. The catalog also gives you an inventory of every model in production with its owner, risk level, and MLflow URI, which is exactly what an EU AI Act audit needs.

---

## Architecture

The full architecture diagram is in [architecture.drawio](./architecture.drawio). Open it at [app.diagrams.net](https://app.diagrams.net) — File → Open from Device → select the file.
