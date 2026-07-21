# Deployment & CI

How OpenTakeoff ships: every change lands on `main` through a pull request in
**this** repo (`knmurphy/opentakeoff`, public). This repo builds and tests
every change but does not deploy anything itself.

Production (<https://takeoff.345flooring.com>) is built and deployed from a
**separate private repo**, `345-Flooring/opentakeoff`, which carries this
repo as its `public` git remote and periodically merges `public/main` into
its own `main`. That push is what deploys — in the private repo, **a merge
is a deploy**; here, a merge is just a merge.

Why the split: this repo is a public fork tracking upstream
(`Kentucky-ai/opentakeoff`), so it stays a clean, presentable, generic
takeoff tool. Anything specific to running the business (the Neon-backed
team-library sync function and its schema, proprietary material-catalog
data, future pipeline-management code) lives only in the private repo, never
in this one's history.

## The pipeline

```
this repo (public)
branch → npm run check (local) → PR → CI (`web` check) → squash-merge
                                                             │
                                                             ▼
                                                     origin/main (public)
                                                             │
                                          (periodic: git merge public/main)
                                                             ▼
345-Flooring/opentakeoff (private)
                                                          main
                                                             │
                                                             ▼
                                          .github/workflows/deploy.yml
                                          npm ci → npm run check → netlify deploy
                                                             │
                                                             ▼
                                          https://takeoff.345flooring.com
```

- **CI** (`.github/workflows/ci.yml`) runs on every PR in *both* repos:
  `npm ci` then `npm run check` (typecheck → lint → tests → build) inside
  `web/`. This repo has no further workflow after that.
- **Deploy** (`.github/workflows/deploy.yml`) exists only in the private
  repo. It runs on every push to *its* `main`, re-runs the same check, then
  publishes `web/dist` to Netlify with `--no-build`.
- **Netlify never builds.** It only hosts what Actions uploads. The
  `netlify.toml` build section exists for one-click deploys of forks; the
  production site is upload-only.
- Merges here don't reach production on their own — someone needs to merge
  `public/main` into the private repo's `main` for a change to actually ship.

## Local/CI parity

CI failures that don't reproduce locally are almost always environment drift.
This repo pins the environment so drift can't happen:

- **Node version** lives in `web/.nvmrc` (one source of truth). `nvm use`
  reads it locally; both workflows read it via `node-version-file`.
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
bundle — there is no client secret or API key here, so unlike the Netlify token
they are not repository/environment secrets. They're **optional**: leave them
unset and the app builds and runs exactly as before (anonymous, local-only). Set
them as build environment variables wherever `npm run check`/`build` runs (or in
`web/.env.local` locally — see [`web/.env.example`](../web/.env.example)). Full
one-time setup is in [`GOOGLE_SETUP.md`](GOOGLE_SETUP.md).

These same three variables are replicated as GitHub Variables on the private
repo's `production` environment, so its build produces the same bundle this
repo would with cloud mode on.

## Rules on `main`

Enforced by GitHub branch protection (admins included), in both repos:

- Changes land via PR only; direct pushes are rejected.
- The `web` CI check must be green.
- The branch must be up to date with `main` before merging.
- No force-pushes, no branch deletion.

Merge with `gh pr merge <n> --squash --delete-branch`, then
`git checkout main && git pull --ff-only`. Squash-merged local branches need
`git branch -D` (git can't see the squash as a merge).

## Security model

- This repo has no Netlify credentials at all — the deploy token
  (`NETLIFY_AUTH_TOKEN`) and site id live only as **environment secrets** on
  the private repo's `production` environment, restricted to protected
  branches there. They were never retrievable from this repo even before the
  split (GitHub secrets are write-only), and now they don't exist here to
  begin with.
- Fork PRs run CI with **no secrets** and a **read-only** `GITHUB_TOKEN`;
  first-time contributors need maintainer approval before workflows run.
- CI declares `permissions: contents: read` (least privilege).
- Only GitHub-owned and verified-creator actions are allowed, and
  `netlify-cli` is pinned to an exact version in the private repo's deploy
  step — bump it deliberately, never float it.
- No token values, account identifiers, or rotation procedures appear in
  either repo. Account-level runbook details are documented privately.

## When something fails

- **CI red on a PR**: run `npm run check` in `web/` on Node from `.nvmrc`
  (`nvm use`). It reproduces the failure locally — fix, push, CI re-runs.
- **Deploy run red after a merge (private repo)**: the site keeps serving the
  previous deploy (Netlify deploys are atomic). Fix forward with a new PR, or
  re-run the failed run from the Actions tab once the cause is external
  (e.g. a secrets/config issue).
