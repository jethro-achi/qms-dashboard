# Hosting a public demo on Oracle Cloud (Always Free)

A step-by-step to stand up a shareable test instance — dashboard **+ the local AI
assistant** — on Oracle Cloud's **Always Free** tier, at no cost.

> ## Rule zero — synthetic data only
> This is a **public** box. Do **not** load real bank / NIRA data onto it. Use the
> bundled `scripts/seed-demo-qms.sql` (fake, randomly generated) — step 6 below.

**Why Oracle Free works here:** the free **Ampere A1 (ARM)** shape gives up to
**4 cores / 24 GB RAM** — enough to run the app, two MySQL databases, *and* the
CPU-only model. (The free AMD `E2.1.Micro` shape has only 1 GB RAM — too small
for the assistant. Use Ampere A1.)

Everything in the stack is multi-arch, so it builds natively on ARM — no changes.

---

## 1. Create the instance
1. Sign up at cloud.oracle.com (Always Free).
2. **Compute → Instances → Create instance:**
   - Image: **Ubuntu 22.04**
   - Shape: **Ampere (VM.Standard.A1.Flex)**, e.g. **4 OCPU / 24 GB** (within the free allowance)
   - Add your SSH public key.
3. Note the instance's **public IP**.

## 2. Open the network (two layers — both are required)
**a. OCI Security List / NSG** (cloud firewall): on the instance's subnet, add
**Ingress** rules — source `0.0.0.0/0`, TCP, destination ports **80**, **443**,
and **3000** (3000 only for the quick-look option).

**b. Ubuntu's own firewall** — OCI Ubuntu images ship with restrictive `iptables`
that block everything but SSH. This is the #1 "why can't I reach it" gotcha:
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80   -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443  -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3000 -j ACCEPT
sudo netfilter-persistent save
```

## 3. Base setup (Docker + swap)
```bash
# Docker + compose plugin (arm64-aware)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# A little swap — safe headroom for the build and the model
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

## 4. Get the code and configure
```bash
git clone https://github.com/jethro-achi/qms-dashboard.git
cd qms-dashboard
cp .env.example .env
```
Edit `.env` — set strong values and point the app at the bundled MySQL (`db`):
```ini
AUTH_SECRET=<run: openssl rand -base64 32>
CRON_SECRET=<run: openssl rand -hex 32>

# QMS (read) side = the bundled demo database
QMS_DB_HOST=db
QMS_DB_USER=qms_user
QMS_DB_PASSWORD=change-me-qms-password   # matches deploy/mysql-init/01-init.sql (demo only)
QMS_DB_NAME=qms

# Bundled MySQL + app DB
MYSQL_ROOT_PASSWORD=<strong>
APP_DB_NAME=appdb
APP_DB_USER=app_user
APP_DB_PASSWORD=<strong>

# On CPU/ARM a 1.5B model keeps the demo snappy; qwen2.5:3b is smarter but slower.
ASSISTANT_MODEL=qwen2.5:1.5b
```

## 5. Build and start
```bash
docker compose up -d --build      # builds natively on ARM; first build ~a few min
```

## 6. Load the synthetic QMS data
```bash
docker compose exec -T db mysql -uroot -p"$MYSQL_ROOT_PASSWORD" qms \
  < scripts/seed-demo-qms.sql
# → prints: tickets=15000  branches=5  log_rows=~500
```

## 7. Pull the AI model (one time)
```bash
docker compose exec ollama ollama pull qwen2.5:1.5b
```
Until this finishes, the assistant shows a friendly "model not installed" message
instead of erroring.

## 8. First-run setup + demo users
1. Browse to **http://\<public-ip>:3000** → you're redirected to **/setup**.
2. In the wizard: engine **MySQL**, host **db**, port **3306**, user/password/db =
   your `APP_DB_*` values. Create the **super-admin** login.
3. Sign in, open **User management**, and create two demo accounts so testers can
   see both role experiences (the assistant is available to these, not the super admin):
   - an **Dashboard admin** (sees all branches)
   - a **Branch ops** user — assign it **Kampala Central** + **Nakawa** so testers
     can see branch-scoped data and a scoped assistant.

## 9. Make it reachable
- **Quick look:** share **http://\<public-ip>:3000** (works now; no TLS, so the
  login cookie isn't `Secure` — fine for a throwaway demo).
- **Proper (recommended):** put a domain in front with HTTPS. You already have the
  nginx reverse-proxy profile — see [DEPLOY.md](DEPLOY.md); set `server_name` to
  your domain and use a Let's Encrypt cert (or Caddy for one-line auto-HTTPS),
  then `docker compose --profile proxy up -d`.

---

## Notes
- **Speed:** CPU inference on ARM is a few tokens/sec — fine for short analytics
  Q&A. Drop to `qwen2.5:1.5b` (done above) for responsiveness; raise to `qwen2.5:3b`
  if you have cores to spare.
- **Cost:** stays within Always Free as long as you keep to the free Ampere
  allowance (≤4 OCPU / ≤24 GB total) and free block storage.
- **Reset the demo:** re-run step 6 to regenerate fresh synthetic tickets.
- **Tear down:** `docker compose down -v` removes the containers and volumes.
