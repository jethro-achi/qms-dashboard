# Publishing to GitHub & running in production

This walks through creating the GitHub repository, pushing this code to it, and
then running it in **production**. It assumes the repo has already been
initialised locally with a first commit (see [Already done](#already-done)).

- [Already done](#already-done)
- [1. Create the repository on GitHub](#1-create-the-repository-on-github)
- [2. Connect your local repo and push](#2-connect-your-local-repo-and-push)
- [3. Confirm no secrets were pushed](#3-confirm-no-secrets-were-pushed)
- [4. Run it in production](#4-run-it-in-production)
- [5. Tag a release](#5-tag-a-release)
- [Everyday git workflow](#everyday-git-workflow)

---

## Already done

The local repository is initialised and has its first commit. Verify with:

```bash
git log --oneline -1
git status
```

Secrets are excluded by [`.gitignore`](../.gitignore): `.env`, `.env.local`,
`data/` (the runtime config with DB passwords), and `*.pem` are never committed.

> **Set your git identity** (if the commit author looks wrong). This sets it for
> this repo only:
> ```bash
> git config user.name  "Your Name"
> git config user.email "you@example.com"
> git commit --amend --reset-author --no-edit   # fix the existing commit's author
> ```

---

## 1. Create the repository on GitHub

### Option A — GitHub website (no extra tools)

1. Go to **https://github.com/new**.
2. **Repository name:** `qms-dashboard` (or your choice).
3. **Visibility:** choose **Private** (recommended for a bank project).
4. **Do NOT** tick "Add a README", ".gitignore", or a licence — this repo already
   has them, and adding them on GitHub creates a conflicting first commit.
5. Click **Create repository**. GitHub then shows a "push an existing repository"
   snippet — it matches step 2 below.

### Option B — GitHub CLI (`gh`)

If you install the [GitHub CLI](https://cli.github.com/) and run `gh auth login`
once, you can create and push in a single command from the project folder:

```bash
gh repo create qms-dashboard --private --source=. --remote=origin --push
```

That creates the repo, wires up `origin`, and pushes — you can skip step 2.

---

## 2. Connect your local repo and push

Copy the HTTPS (or SSH) URL from your new repo's page, then:

```bash
# from the project folder
git branch -M main
git remote add origin https://github.com/<your-username>/qms-dashboard.git
git push -u origin main
```

- **HTTPS** will prompt for your GitHub username and a **Personal Access Token**
  (Settings → Developer settings → Tokens) — not your password.
- **SSH** (`git@github.com:<you>/qms-dashboard.git`) uses your SSH key instead.

If you later re-point the remote:

```bash
git remote set-url origin <new-url>
```

---

## 3. Confirm no secrets were pushed

After the push, on the GitHub repo page, check that these are **absent**:

- `.env`, `.env.local`
- the `data/` directory
- any `*.pem` files

They should be — `.gitignore` covers them. If you ever committed one by mistake,
rotate that secret immediately (generate a new `AUTH_SECRET`/`CRON_SECRET`, change
the DB password) because git history preserves it.

Present and correct on GitHub: `.env.example` (the template, no real secrets),
`Dockerfile`, `docker-compose.yml`, `README.md`, and `docs/`.

---

## 4. Run it in production

Anyone with access can now clone and run it. On the **production host** (a Linux
server on the intranet with Docker + the Compose plugin):

```bash
# 1. Clone your repository
git clone https://github.com/<your-username>/qms-dashboard.git
cd qms-dashboard

# 2. Create the production environment file from the template
cp .env.example .env
chmod 600 .env

# 3. Fill in real values in .env — at minimum:
#      AUTH_SECRET          =  $(openssl rand -base64 32)
#      CRON_SECRET          =  $(openssl rand -hex 32)
#      MYSQL_ROOT_PASSWORD  =  a strong password
#      APP_DB_PASSWORD      =  a strong password
#      QMS_DB_HOST/USER/PASSWORD/NAME  =  your read-only QMS replica
#      QMS_DB_CA            =  the DB's CA cert (for verified TLS)

# 4. Build and start in the background
docker compose up -d --build

# 5. Verify health
docker compose ps
curl -fsS "http://localhost:3000/api/health?deep=1"    # checks both databases
```

Then open the app in a browser and complete the **one-time `/setup` wizard**
(choose the DB engine, enter the app-DB connection, create the first Super Admin).
Full details, including the reverse proxy / HTTPS setup, hardening checklist,
backups and the scheduled-reports cron, are in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

**Production notes**

- Put a **TLS-terminating reverse proxy** (nginx/Traefik) in front — the app is
  served over plain HTTP inside the host and expects HTTPS at the edge (the
  session cookie is secure-prefixed). See [`DEPLOYMENT.md`](DEPLOYMENT.md#7-tls--reverse-proxy).
- Data persists in the `qms_data` Docker volume; **back it up** along with the
  application database (see [`DEPLOYMENT.md`](DEPLOYMENT.md#10-backups--restore)).
- To deploy an update later: `git pull && docker compose up -d --build`.

---

## 5. Tag a release

Mark deployable points so you can roll back cleanly:

```bash
git tag -a v1.0.0 -m "First production release"
git push origin v1.0.0
```

On the production host, deploy a specific version with
`git checkout v1.0.0 && docker compose up -d --build`.

---

## Everyday git workflow

```bash
git checkout -b feature/x     # branch for a change
# ...edit...
npm test && npx tsc --noEmit  # keep it green before committing
git add -A
git commit -m "Describe the change"
git push -u origin feature/x  # open a Pull Request on GitHub
```

Keep `main` deployable: run the tests and a `next build` before merging (see
[`TESTING.md`](TESTING.md#running-in-ci)).
