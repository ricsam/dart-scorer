# Oche — Dart Scorer

A responsive casual darts scoring web app for 2–8 players.

## Features

- 2–8 editable players with automatic turn rotation
- 101, 301, 501, and 701 game modes
- Independent single-in/double-in and single-out/double-out rules
- Checkout suggestions tailored to the selected rules
- Dart-by-dart keyboard entry, including shorthand values such as `36`
- Empty Enter for a miss, editable last dart via Undo, and reset confirmation
- Standard and easier checkout routes that update after every dart
- Clickable leg history with player averages and every dart from each visit
- Visit rewind with confirmation, restoring a past turn while discarding the later timeline
- Persistent light and dark themes through the working settings panel
- Editable player names, leg counts, averages, dart counts, and recent visits
- Undo, restart, bust handling, and leg-win flow

## Development

```bash
npm install
npm run dev
```

Create a production build with:

```bash
npm run build
```

## Kubernetes deployment

The static production build can be deployed without a private image registry. Build it, create the generated asset ConfigMap, and apply the workload:

```bash
npm run build
kubectl create namespace dart-scorer --dry-run=client -o yaml | kubectl apply -f -
kubectl -n dart-scorer create configmap site-assets --from-file=dist --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f k8s/deployment.yaml
```

The deployment mounts the generated site from `site-assets` into an unprivileged Nginx container.
