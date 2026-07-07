# k8s — sl-ontoground backing services

Apply order (namespace `sl-ontoground` already exists):

1. `kubectl -n sl-ontoground apply -f postgres.yaml`
2. `kubectl -n sl-ontoground rollout status statefulset/postgres`  # wait Ready
3. `kubectl -n sl-ontoground apply -f pyservice.yaml`
4. `kubectl -n sl-ontoground rollout status deploy/pyservice`      # wait Ready (model load ~30-60s)
5. Then roll out the app: `kubectl -n sl-ontoground rollout restart deploy/sl-ontoground`

In-cluster DNS the app uses:
- Postgres: `postgres.sl-ontoground:5432`
- Python service: `http://pyservice.sl-ontoground:8000`

Note: the app Deployment (`sl-ontoground`) must get `DATABASE_URL` (from `postgres-secret`)
and `PYSERVICE_URL` env added separately — that edit is out of this directory's scope.
Set the real POSTGRES_PASSWORD in-cluster before apply (placeholder in postgres.yaml).

## 앱 Deployment 환경변수 (v-next)

The app Deployment (`sl-ontoground`) needs two env vars, set in-cluster (not in this repo):

- `DATABASE_URL` = `postgres://slonto:<password>@postgres.sl-ontoground:5432/slonto`
  (password lives in `postgres-secret`; reference the secret key rather than inlining it)
- `PYSERVICE_URL` = `http://pyservice.sl-ontoground:8000`

```
kubectl -n sl-ontoground set env deploy/sl-ontoground \
  DATABASE_URL='postgres://slonto:$(POSTGRES_PASSWORD)@postgres.sl-ontoground:5432/slonto' \
  PYSERVICE_URL='http://pyservice.sl-ontoground:8000'
# POSTGRES_PASSWORD from the secret:
kubectl -n sl-ontoground set env deploy/sl-ontoground \
  --from=secret/postgres-secret --keys=POSTGRES_PASSWORD
```

Without `DATABASE_URL` the app runs in the old in-memory mode (safe fallback);
adding it switches to Postgres persistence.
