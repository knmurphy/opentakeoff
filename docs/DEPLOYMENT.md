# Deployment & CI

Every change to this repo lands on `main` through a pull request and is
built and tested by CI. **This repo does not deploy anywhere** — there is no
deploy workflow here.

## The pipeline

```
branch → npm run check (local) → PR → CI (`web` check) → squash-merge
```

- **CI** (`.github/workflows/ci.yml`) runs on every PR: `npm ci` then
  `npm run check` (typecheck → lint → tests → build) inside `web/`.
- Nothing in this repo publishes `web/dist` anywhere. The `netlify.toml`
  build section exists for anyone spinning up their own one-click Netlify
  deploy of a fork.

## Local/CI parity

CI failures that don't reproduce locally are almost always environment drift.
This repo pins the environment so drift can't happen:

- **Node version** lives in `web/.nvmrc` (one source of truth). `nvm use`
  reads it locally; CI reads it via `node-version-file`.
- **`npm run check`** is the exact command CI runs — same order, same steps.
  Green locally ⇒ green in CI.
- **`npm ci`** in CI installs strictly from `package-lock.json`; if your
  lockfile is out of sync with `package.json`, CI fails fast rather than
  silently resolving different versions.

## Optional build-time env vars (team cloud mode)

The default build needs **no** environment at all. Turning on the optional
team-only cloud mode (Google sign-in + shared Drive) adds three build-time
variables, read by Vite and inlined into `web/dist` at build:

- `VITE_GOOGLE_CLIENT_ID` — the public OAuth 2.0 Web client id.
- `VITE_GOOGLE_HD` — your Google Workspace domain (e.g. `345flooring.com`).
- `VITE_PRICING_FILE_ID` — the Drive file id of the synced `pricing.json`.

All three are **non-secret public identifiers** and are meant to ship in the
bundle — there is no client secret or API key here. They're **optional**:
leave them unset and the app builds and runs exactly as before (anonymous,
local-only). Set them as build environment variables wherever
`npm run check`/`build` runs (or in `web/.env.local` locally — see
[`web/.env.example`](../web/.env.example)). Full one-time setup is in
[`GOOGLE_SETUP.md`](GOOGLE_SETUP.md).

## Rules on `main`

Enforced by GitHub branch protection (admins included):

- Changes land via PR only; direct pushes are rejected.
- The `web` CI check must be green.
- The branch must be up to date with `main` before merging.
- No force-pushes, no branch deletion.

Merge with `gh pr merge <n> --squash --delete-branch`, then
`git checkout main && git pull --ff-only`. Squash-merged local branches need
`git branch -D` (git can't see the squash as a merge).

## Security model

- This repo holds no deploy credentials of any kind — nothing here can
  publish to any hosting target.
- Fork PRs run CI with **no secrets** and a **read-only** `GITHUB_TOKEN`;
  first-time contributors need maintainer approval before workflows run.
- CI declares `permissions: contents: read` (least privilege).
- Only GitHub-owned and verified-creator actions are allowed.
- No token values, account identifiers, deploy targets, or rotation
  procedures appear in this repo.

## When something fails

- **CI red on a PR**: run `npm run check` in `web/` on Node from `.nvmrc`
  (`nvm use`). It reproduces the failure locally — fix, push, CI re-runs.
