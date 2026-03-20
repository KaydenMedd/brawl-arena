# Brawl Arena — Step-by-Step Railway Deployment Guide

> Get your 3v3 MOBA game live on the internet in ~15 minutes.

---

## Prerequisites (What You Need Before Starting)

Before you begin, make sure you have these installed and set up:

- **Node.js** (v18+) — download from [nodejs.org](https://nodejs.org)
- **Git** — download from [git-scm.com](https://git-scm.com)
- **A GitHub account** — sign up at [github.com](https://github.com) (free)
- **A Railway account** — sign up at [railway.com](https://railway.com) using your GitHub account

**Verify your installs** by running these in your terminal:
```bash
node --version    # Should show v18.x.x or higher
git --version     # Should show git version 2.x.x
npm --version     # Should show 9.x.x or higher
```

---

## PHASE 1: Set Up the Project Locally

### Step 1 — Create your project folder

Open a terminal (Command Prompt on Windows, Terminal on Mac/Linux) and run:

```bash
mkdir brawl-arena
cd brawl-arena
```

### Step 2 — Copy the project files

You have a downloadable project folder from our conversation. Copy all the files from `brawl-arena-deploy/` into your `brawl-arena/` folder so it looks like this:

```
brawl-arena/
├── public/
│   └── index.html        ← The game client (browser)
├── src/
│   └── server.js          ← The game server (Node.js)
├── package.json
├── .gitignore
└── README.md
```

### Step 3 — Install dependencies

```bash
npm install
```

This installs Express, ws (WebSocket), and uuid.

### Step 4 — Test locally

```bash
npm start
```

You should see:

```
╔══════════════════════════════════════════╗
║        BRAWL ARENA — Game Server         ║
║                                          ║
║   Port: 3000                             ║
║   Tick Rate: 20 Hz                       ║
║   Max Rooms: 50                          ║
║                                          ║
║   Status: READY                          ║
╚══════════════════════════════════════════╝
```

Open your browser to **http://localhost:3000** — you should see the game!

Press `Ctrl+C` in the terminal to stop the server when done testing.

---

## PHASE 2: Push to GitHub

### Step 5 — Initialize a Git repository

```bash
git init
git add .
git commit -m "Initial commit: Brawl Arena 3v3 MOBA"
```

### Step 6 — Create a GitHub repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `brawl-arena`
3. Set it to **Public** (or Private if you prefer)
4. Do **NOT** check "Add a README" (you already have one)
5. Click **Create repository**

### Step 7 — Push your code to GitHub

GitHub will show you commands after creating the repo. Run these (replace `YOUR_USERNAME` with your GitHub username):

```bash
git remote add origin https://github.com/YOUR_USERNAME/brawl-arena.git
git branch -M main
git push -u origin main
```

If prompted, enter your GitHub username and a personal access token (not your password — GitHub requires tokens now). You can create a token at: **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**.

---

## PHASE 3: Deploy to Railway

### Step 8 — Sign in to Railway

1. Go to **[railway.com](https://railway.com)**
2. Click **Login** (top right)
3. Sign in with **GitHub** (this connects your repos automatically)

### Step 9 — Create a new project

1. On your Railway dashboard, click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. If this is your first time, Railway will ask you to **authorize access** to your GitHub repos — click **"Configure GitHub App"** and grant access to the `brawl-arena` repo (or all repos)
4. Select the **`brawl-arena`** repository from the list

### Step 10 — Railway auto-deploys

Railway will immediately:
- Detect it's a **Node.js** project (from `package.json`)
- Run `npm install` automatically
- Run `npm start` to launch your server
- Show you build logs in real-time

Wait for the build to complete. You'll see logs ending with the Brawl Arena server banner. This usually takes 30-60 seconds.

### Step 11 — Generate a public URL

Your app is deployed but doesn't have a public URL yet:

1. Click on your **service** (it will be named after your repo, "brawl-arena")
2. Go to the **"Settings"** tab
3. Scroll down to the **"Networking"** section
4. Under **"Public Networking"**, click **"Generate Domain"**
5. Railway creates a URL like: `brawl-arena-production-xxxx.up.railway.app`

**Your game is now LIVE on the internet!** Open that URL in your browser.

### Step 12 — Configure the health check (recommended)

Still in the Settings tab:

1. Find the **"Deploy"** section
2. Set **Health Check Path** to: `/health`
3. This tells Railway how to verify your server is running

### Step 13 — Verify everything works

1. Open your Railway URL in a browser
2. You should see the Brawl Arena start screen
3. Select a brawler and click "BATTLE!"
4. The game should start with AI bots

Check server health: visit `https://YOUR-URL.up.railway.app/health`

You should see JSON like:
```json
{
  "status": "ok",
  "rooms": 1,
  "players": 6,
  "uptime": 123.45
}
```

---

## PHASE 4: Automatic Updates (CI/CD)

### Step 14 — Future updates deploy automatically

From now on, every time you push code to GitHub, Railway redeploys automatically:

```bash
# Make changes to your code, then:
git add .
git commit -m "Added new brawler"
git push
```

Railway detects the push, rebuilds, and redeploys with **zero downtime**.

---

## PHASE 5: Optional — Add a Custom Domain

### Step 15 — Connect your own domain (optional)

If you own a domain (e.g., `brawlarena.com`):

1. In Railway, go to **Settings → Networking**
2. Click **"+ Custom Domain"**
3. Enter your domain: `brawlarena.com`
4. Railway shows you DNS records to add
5. Go to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.)
6. Add the **CNAME record** Railway provides
7. Wait 5-30 minutes for DNS to propagate
8. Railway auto-provisions SSL (HTTPS) for you

---

## PHASE 6: Optional — Add Database Services

### Step 16 — Add Redis (for matchmaking/sessions)

1. In your Railway project, click **"+ New"** on the canvas
2. Select **"Database"**
3. Choose **"Redis"**
4. Railway creates a Redis instance and injects `REDIS_URL` into your server environment automatically

### Step 17 — Add PostgreSQL (for player data)

1. Click **"+ New"** again
2. Select **"Database"**
3. Choose **"PostgreSQL"**
4. Railway creates a Postgres instance and injects `DATABASE_URL` automatically

You can then update your server code to use these environment variables.

---

## Cost Breakdown

| What you get | Cost |
|---|---|
| **Trial** | Free $5 credit (good for testing) |
| **Hobby plan** | $5/month subscription (includes $5 usage) |
| **Low traffic game server** | ~$5-10/month usage |
| **Redis addon** | ~$2-5/month |
| **PostgreSQL addon** | ~$3-7/month |
| **Total for a small game** | **~$10-25/month** |

Railway uses usage-based pricing — you pay for actual CPU and memory consumed, billed per minute. A game server running 24/7 with a few concurrent players will cost roughly $5-15/month in usage beyond the included $5.

---

## Troubleshooting

### "Build failed"
- Check the build logs in Railway for red error text
- Most common: missing dependency — make sure `package.json` lists everything
- Run `npm install` locally first to verify it works

### "Application failed to respond"
- Make sure your server listens on `process.env.PORT` (not a hardcoded port)
- Railway assigns ports dynamically — `const PORT = process.env.PORT || 3000` is correct

### "WebSocket connection failed"
- Railway supports WebSockets natively — no extra config needed
- Make sure your client connects to `wss://` (not `ws://`) in production
- The URL should be `wss://your-app.up.railway.app`

### "502 Bad Gateway"
- Your server crashed. Check the logs in Railway: click your service → "Deployments" → click the latest → "View Logs"
- Common cause: unhandled exception in the game loop

### Need more help?
- Railway docs: [docs.railway.com](https://docs.railway.com)
- Railway Discord: [discord.gg/railway](https://discord.gg/railway)

---

## What's Next?

Now that your game is live, here's what to build next:

1. **Multiplayer client** — Update the browser client to connect via WebSocket instead of running locally
2. **Player accounts** — Add login/signup with JWT authentication
3. **Matchmaking** — Build a lobby system so players can find matches
4. **More brawlers** — Add new characters with unique abilities
5. **More game modes** — Bounty, Brawl Ball, Showdown
6. **Leaderboards** — Track trophies and rankings with PostgreSQL
7. **Mobile support** — Add touch controls for mobile browsers

---

*You now have a live, deployed game server. Ship fast, iterate often!*
