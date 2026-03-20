# Brawl Arena — 3v3 MOBA Browser Game

A real-time 3v3 multiplayer MOBA inspired by Brawl Stars, built with Node.js, Express, and WebSockets.

## Quick Start (Local)

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in your browser.

## Deploy to Railway

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com)

1. Push this repo to GitHub
2. Connect it to Railway
3. Railway auto-detects Node.js and deploys
4. Generate a public domain in Settings → Networking

## Tech Stack

- **Server**: Node.js + Express + ws (WebSocket)
- **Client**: HTML5 Canvas
- **Hosting**: Railway.app

## Game Features

- 4 unique Brawlers (Blaze, Frostbite, Tank, Phantom)
- Gem Grab game mode
- AI bots fill empty slots
- Real-time multiplayer via WebSocket
- Health check endpoint at `/health`
