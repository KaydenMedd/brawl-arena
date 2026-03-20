const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// ============================================================
// SERVER SETUP
// ============================================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Serve static files (game client)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check endpoint (Railway uses this)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    rooms: rooms.size,
    players: totalPlayers(),
    uptime: process.uptime()
  });
});

// API: list active rooms
app.get('/api/rooms', (req, res) => {
  const roomList = [];
  rooms.forEach((room, id) => {
    roomList.push({
      id,
      players: room.players.size,
      maxPlayers: 6,
      mode: room.mode,
      state: room.state
    });
  });
  res.json(roomList);
});

// ============================================================
// GAME CONSTANTS
// ============================================================
const TICK_RATE = 20; // Server ticks per second
const TICK_MS = 1000 / TICK_RATE;
const ARENA_W = 1600;
const ARENA_H = 1000;
const GAME_DURATION = 120; // seconds
const GEMS_TO_WIN = 10;
const RESPAWN_TIME = 3;
const MAX_ROOMS = 50;
const MATCHMAKING_TIMEOUT = 30000; // 30 seconds

const BRAWLERS = {
  blaze: {
    name: 'Blaze', role: 'Fighter', hp: 5000, speed: 3.2,
    damage: 600, range: 280, reload: 0.4,
    projectileSpeed: 8, projectileSize: 6, burstCount: 1,
    abilityCd: 5, superCd: 12
  },
  frostbite: {
    name: 'Frostbite', role: 'Sharpshooter', hp: 3200, speed: 2.8,
    damage: 1100, range: 450, reload: 0.8,
    projectileSpeed: 12, projectileSize: 4, burstCount: 1,
    abilityCd: 8, superCd: 15
  },
  tank: {
    name: 'Tank', role: 'Heavyweight', hp: 8000, speed: 2.4,
    damage: 400, range: 160, reload: 0.25,
    projectileSpeed: 6, projectileSize: 10, burstCount: 3,
    abilityCd: 6, superCd: 10
  },
  phantom: {
    name: 'Phantom', role: 'Assassin', hp: 3600, speed: 3.8,
    damage: 800, range: 200, reload: 0.5,
    projectileSpeed: 10, projectileSize: 5, burstCount: 2,
    abilityCd: 4, superCd: 11
  }
};

// ============================================================
// ROOM & MATCHMAKING
// ============================================================
const rooms = new Map();
const matchmakingQueue = [];

function totalPlayers() {
  let count = 0;
  rooms.forEach(room => count += room.players.size);
  return count;
}

function createRoom() {
  const roomId = uuidv4().slice(0, 8);
  const room = {
    id: roomId,
    players: new Map(),
    state: 'waiting', // waiting | playing | ended
    mode: 'gem_grab',
    gameTime: GAME_DURATION,
    blueScore: 0,
    redScore: 0,
    entities: new Map(),
    projectiles: [],
    gems: [],
    walls: generateWalls(),
    gemSpawnTimer: 2,
    tickInterval: null
  };
  rooms.set(roomId, room);
  console.log(`[Room ${roomId}] Created`);
  return room;
}

function generateWalls() {
  return [
    { x: 0, y: 0, w: ARENA_W, h: 20 },
    { x: 0, y: ARENA_H - 20, w: ARENA_W, h: 20 },
    { x: 0, y: 0, w: 20, h: ARENA_H },
    { x: ARENA_W - 20, y: 0, w: 20, h: ARENA_H },
    { x: 350, y: 200, w: 80, h: 80 },
    { x: 350, y: 700, w: 80, h: 80 },
    { x: 700, y: 400, w: 200, h: 40 },
    { x: 700, y: 560, w: 200, h: 40 },
    { x: 500, y: 460, w: 40, h: 80 },
    { x: 1060, y: 460, w: 40, h: 80 },
    { x: 1170, y: 200, w: 80, h: 80 },
    { x: 1170, y: 700, w: 80, h: 80 }
  ];
}

function assignTeam(room) {
  let blueCount = 0, redCount = 0;
  room.players.forEach(p => {
    if (p.team === 'blue') blueCount++;
    else redCount++;
  });
  return blueCount <= redCount ? 'blue' : 'red';
}

function addPlayerToRoom(ws, room, brawlerId) {
  const team = assignTeam(room);
  const playerId = uuidv4().slice(0, 8);
  const brawler = BRAWLERS[brawlerId] || BRAWLERS.blaze;

  const spawnX = team === 'blue'
    ? 100 + Math.random() * 150
    : ARENA_W - 250 + Math.random() * 150;
  const spawnY = 350 + Math.random() * 300;

  const playerData = {
    id: playerId,
    ws,
    team,
    brawlerId,
    brawler,
    x: spawnX,
    y: spawnY,
    vx: 0, vy: 0,
    hp: brawler.hp,
    maxHp: brawler.hp,
    angle: 0,
    alive: true,
    gems: 0,
    kills: 0,
    deaths: 0,
    shootCooldown: 0,
    abilityCooldown: 0,
    superCooldown: 0,
    respawnTimer: 0,
    shielded: false,
    shieldTimer: 0,
    stunTimer: 0,
    slowTimer: 0,
    lastInput: null,
    inputSeq: 0
  };

  room.players.set(playerId, playerData);
  ws.playerId = playerId;
  ws.roomId = room.id;

  // Tell the player their ID and room info
  sendToPlayer(ws, {
    type: 'joined',
    playerId,
    team,
    roomId: room.id,
    brawler: brawlerId,
    walls: room.walls
  });

  console.log(`[Room ${room.id}] Player ${playerId} joined as ${team} (${brawler.name})`);

  // Check if we can start the game
  if (room.players.size >= 2 && room.state === 'waiting') {
    startGame(room);
  }
}

function fillWithBots(room) {
  const brawlerKeys = Object.keys(BRAWLERS);
  while (room.players.size < 6) {
    const team = assignTeam(room);
    const botId = 'bot_' + uuidv4().slice(0, 6);
    const brawlerId = brawlerKeys[Math.floor(Math.random() * brawlerKeys.length)];
    const brawler = BRAWLERS[brawlerId];

    const spawnX = team === 'blue'
      ? 100 + Math.random() * 150
      : ARENA_W - 250 + Math.random() * 150;
    const spawnY = 350 + Math.random() * 300;

    room.players.set(botId, {
      id: botId,
      ws: null, // Bot — no WebSocket
      team,
      brawlerId,
      brawler,
      isBot: true,
      x: spawnX,
      y: spawnY,
      vx: 0, vy: 0,
      hp: brawler.hp,
      maxHp: brawler.hp,
      angle: 0,
      alive: true,
      gems: 0,
      kills: 0,
      deaths: 0,
      shootCooldown: 0,
      abilityCooldown: 0,
      superCooldown: 0,
      respawnTimer: 0,
      shielded: false,
      shieldTimer: 0,
      stunTimer: 0,
      slowTimer: 0,
      aiState: 'roam',
      aiTimer: 0,
      aiTarget: null
    });
  }
}

// ============================================================
// GAME LOGIC
// ============================================================
function startGame(room) {
  room.state = 'playing';
  room.gameTime = GAME_DURATION;

  // Fill remaining slots with bots
  fillWithBots(room);

  // Notify all human players
  broadcastToRoom(room, {
    type: 'game_start',
    players: getPlayersSnapshot(room)
  });

  // Start game loop
  room.tickInterval = setInterval(() => gameTick(room), TICK_MS);
  console.log(`[Room ${room.id}] Game started with ${room.players.size} players`);
}

function gameTick(room) {
  if (room.state !== 'playing') return;

  const dt = TICK_MS / 1000;
  room.gameTime -= dt;

  // Spawn gems
  room.gemSpawnTimer -= dt;
  if (room.gemSpawnTimer <= 0 && room.gems.length < 8) {
    room.gems.push({
      id: uuidv4().slice(0, 6),
      x: ARENA_W / 2 + (Math.random() - 0.5) * 300,
      y: ARENA_H / 2 + (Math.random() - 0.5) * 200
    });
    room.gemSpawnTimer = 4;
  }

  // Update all entities
  room.players.forEach(player => {
    if (!player.alive) {
      player.respawnTimer -= dt;
      if (player.respawnTimer <= 0) {
        respawnPlayer(room, player);
      }
      return;
    }

    // Cooldowns
    player.shootCooldown = Math.max(0, player.shootCooldown - dt);
    player.abilityCooldown = Math.max(0, player.abilityCooldown - dt);
    player.superCooldown = Math.max(0, player.superCooldown - dt);
    player.stunTimer = Math.max(0, player.stunTimer - dt);
    player.slowTimer = Math.max(0, player.slowTimer - dt);
    if (player.shieldTimer > 0) {
      player.shieldTimer -= dt;
      if (player.shieldTimer <= 0) player.shielded = false;
    }

    // Apply input for human players
    if (!player.isBot && player.lastInput) {
      applyInput(player, player.lastInput);
    }

    // Bot AI
    if (player.isBot) {
      updateBotAI(room, player, dt);
    }

    // Move
    if (player.stunTimer <= 0) {
      player.x += player.vx;
      player.y += player.vy;
    }

    // Clamp to arena
    player.x = Math.max(30, Math.min(ARENA_W - 30, player.x));
    player.y = Math.max(30, Math.min(ARENA_H - 30, player.y));

    // Wall collision
    resolveWallCollision(player, room.walls);

    // Gem pickup
    for (let i = room.gems.length - 1; i >= 0; i--) {
      const g = room.gems[i];
      const dx = g.x - player.x, dy = g.y - player.y;
      if (dx * dx + dy * dy < 900) { // 30^2
        player.gems++;
        if (player.team === 'blue') room.blueScore++;
        else room.redScore++;
        room.gems.splice(i, 1);
      }
    }

    // HP regen
    if (player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.01 * dt);
    }
  });

  // Update projectiles
  for (let i = room.projectiles.length - 1; i >= 0; i--) {
    const p = room.projectiles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.traveled += Math.sqrt(p.vx * p.vx + p.vy * p.vy);

    let hitWall = room.walls.some(w =>
      p.x >= w.x && p.x <= w.x + w.w && p.y >= w.y && p.y <= w.y + w.h
    );

    if (hitWall || p.traveled > p.range || p.x < 0 || p.x > ARENA_W || p.y < 0 || p.y > ARENA_H) {
      room.projectiles.splice(i, 1);
      continue;
    }

    // Hit detection
    room.players.forEach(player => {
      if (!player.alive || player.team === p.team || player.id === p.ownerId) return;
      const dx = player.x - p.x, dy = player.y - p.y;
      if (dx * dx + dy * dy < (18 + p.radius) * (18 + p.radius)) {
        let dmg = p.damage;
        if (player.shielded) dmg *= 0.5;
        player.hp -= dmg;

        if (player.hp <= 0) {
          killPlayer(room, player, p.ownerId);
        }

        room.projectiles.splice(room.projectiles.indexOf(p), 1);
      }
    });
  }

  // Check win conditions
  if (room.gameTime <= 0 || room.blueScore >= GEMS_TO_WIN || room.redScore >= GEMS_TO_WIN) {
    endGame(room);
    return;
  }

  // Broadcast state to all human players
  const snapshot = buildStateSnapshot(room);
  room.players.forEach(player => {
    if (!player.isBot && player.ws && player.ws.readyState === 1) {
      sendToPlayer(player.ws, snapshot);
    }
  });
}

function applyInput(player, input) {
  if (player.stunTimer > 0) return;

  let speed = player.brawler.speed;
  if (player.slowTimer > 0) speed *= 0.5;

  player.vx = 0;
  player.vy = 0;
  if (input.up) player.vy = -speed;
  if (input.down) player.vy = speed;
  if (input.left) player.vx = -speed;
  if (input.right) player.vx = speed;

  if (player.vx && player.vy) {
    player.vx *= 0.707;
    player.vy *= 0.707;
  }

  player.angle = input.angle || 0;

  // Shooting
  if (input.shoot && player.shootCooldown <= 0) {
    for (let i = 0; i < player.brawler.burstCount; i++) {
      const spread = (Math.random() - 0.5) * 0.15;
      room_spawnProjectile(player, player.angle + spread);
    }
    player.shootCooldown = player.brawler.reload;
  }
}

function room_spawnProjectile(owner, angle) {
  // Find the room this player belongs to
  const room = rooms.get(owner.ws?.roomId) ||
    Array.from(rooms.values()).find(r => r.players.has(owner.id));
  if (!room) return;

  room.projectiles.push({
    x: owner.x + Math.cos(angle) * 24,
    y: owner.y + Math.sin(angle) * 24,
    vx: Math.cos(angle) * owner.brawler.projectileSpeed,
    vy: Math.sin(angle) * owner.brawler.projectileSpeed,
    damage: owner.brawler.damage,
    team: owner.team,
    ownerId: owner.id,
    radius: owner.brawler.projectileSize,
    range: owner.brawler.range,
    traveled: 0
  });
}

function killPlayer(room, player, killerId) {
  player.alive = false;
  player.respawnTimer = RESPAWN_TIME;
  player.deaths++;

  // Award kill
  const killer = room.players.get(killerId);
  if (killer) killer.kills++;

  // Drop gems
  for (let i = 0; i < player.gems; i++) {
    room.gems.push({
      id: uuidv4().slice(0, 6),
      x: player.x + (Math.random() - 0.5) * 40,
      y: player.y + (Math.random() - 0.5) * 40
    });
  }
  if (player.team === 'blue') room.blueScore -= player.gems;
  else room.redScore -= player.gems;
  player.gems = 0;

  broadcastToRoom(room, {
    type: 'kill',
    victimId: player.id,
    killerId: killerId
  });
}

function respawnPlayer(room, player) {
  player.alive = true;
  player.hp = player.maxHp;
  player.shielded = false;
  player.stunTimer = 0;
  player.slowTimer = 0;

  if (player.team === 'blue') {
    player.x = 100 + Math.random() * 150;
    player.y = 350 + Math.random() * 300;
  } else {
    player.x = ARENA_W - 250 + Math.random() * 150;
    player.y = 350 + Math.random() * 300;
  }
}

function endGame(room) {
  room.state = 'ended';
  clearInterval(room.tickInterval);

  const winner = room.blueScore > room.redScore ? 'blue' :
    room.redScore > room.blueScore ? 'red' : 'draw';

  broadcastToRoom(room, {
    type: 'game_over',
    winner,
    blueScore: room.blueScore,
    redScore: room.redScore,
    players: getPlayersSnapshot(room)
  });

  // Cleanup room after 10 seconds
  setTimeout(() => {
    rooms.delete(room.id);
    console.log(`[Room ${room.id}] Cleaned up`);
  }, 10000);
}

// ============================================================
// BOT AI
// ============================================================
function updateBotAI(room, bot, dt) {
  if (!bot.alive || bot.stunTimer > 0) return;

  bot.aiTimer -= dt;
  if (bot.aiTimer <= 0) {
    bot.aiTimer = 0.5 + Math.random() * 0.5;

    // Find closest gem
    let closestGem = null, minGemDist = Infinity;
    room.gems.forEach(g => {
      const dx = g.x - bot.x, dy = g.y - bot.y;
      const d = dx * dx + dy * dy;
      if (d < minGemDist) { minGemDist = d; closestGem = g; }
    });

    // Find closest enemy
    let closestEnemy = null, minEnemyDist = Infinity;
    room.players.forEach(e => {
      if (e.team !== bot.team && e.alive) {
        const dx = e.x - bot.x, dy = e.y - bot.y;
        const d = dx * dx + dy * dy;
        if (d < minEnemyDist) { minEnemyDist = d; closestEnemy = e; }
      }
    });

    if (closestGem && minGemDist < 90000) {
      bot.aiState = 'gem';
      bot.aiTarget = closestGem;
    } else if (closestEnemy && Math.sqrt(minEnemyDist) < bot.brawler.range * 1.2) {
      bot.aiState = 'fight';
      bot.aiTarget = closestEnemy;
    } else if (closestGem) {
      bot.aiState = 'gem';
      bot.aiTarget = closestGem;
    } else {
      bot.aiState = 'roam';
      bot.aiTarget = {
        x: ARENA_W / 2 + (Math.random() - 0.5) * 400,
        y: ARENA_H / 2 + (Math.random() - 0.5) * 300
      };
    }
  }

  if (!bot.aiTarget) return;

  const dx = bot.aiTarget.x - bot.x;
  const dy = bot.aiTarget.y - bot.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  let speed = bot.brawler.speed;
  if (bot.slowTimer > 0) speed *= 0.5;

  if (bot.aiState === 'fight') {
    bot.angle = Math.atan2(dy, dx);
    if (dist > bot.brawler.range * 0.6) {
      bot.vx = (dx / dist) * speed;
      bot.vy = (dy / dist) * speed;
    } else if (dist < bot.brawler.range * 0.3) {
      bot.vx = -(dx / dist) * speed;
      bot.vy = -(dy / dist) * speed;
    } else {
      bot.vx *= 0.8;
      bot.vy *= 0.8;
    }

    if (bot.shootCooldown <= 0 && dist < bot.brawler.range) {
      for (let i = 0; i < bot.brawler.burstCount; i++) {
        const spread = (Math.random() - 0.5) * 0.15;
        room.projectiles.push({
          x: bot.x + Math.cos(bot.angle) * 24,
          y: bot.y + Math.sin(bot.angle) * 24,
          vx: Math.cos(bot.angle + spread) * bot.brawler.projectileSpeed,
          vy: Math.sin(bot.angle + spread) * bot.brawler.projectileSpeed,
          damage: bot.brawler.damage,
          team: bot.team,
          ownerId: bot.id,
          radius: bot.brawler.projectileSize,
          range: bot.brawler.range,
          traveled: 0
        });
      }
      bot.shootCooldown = bot.brawler.reload;
    }
  } else {
    if (dist > 10) {
      bot.vx = (dx / dist) * speed;
      bot.vy = (dy / dist) * speed;
      bot.angle = Math.atan2(dy, dx);
    } else {
      bot.vx *= 0.8;
      bot.vy *= 0.8;
    }
  }
}

// ============================================================
// COLLISION HELPERS
// ============================================================
function resolveWallCollision(ent, walls) {
  for (const w of walls) {
    const closestX = Math.max(w.x, Math.min(ent.x, w.x + w.w));
    const closestY = Math.max(w.y, Math.min(ent.y, w.y + w.h));
    const dx = ent.x - closestX, dy = ent.y - closestY;
    if (dx * dx + dy * dy < 18 * 18) {
      const ang = Math.atan2(dy, dx);
      ent.x += Math.cos(ang) * 2;
      ent.y += Math.sin(ang) * 2;
    }
  }
}

// ============================================================
// NETWORKING HELPERS
// ============================================================
function sendToPlayer(ws, data) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

function broadcastToRoom(room, data) {
  const msg = JSON.stringify(data);
  room.players.forEach(player => {
    if (!player.isBot && player.ws && player.ws.readyState === 1) {
      player.ws.send(msg);
    }
  });
}

function getPlayersSnapshot(room) {
  const snapshot = [];
  room.players.forEach(p => {
    snapshot.push({
      id: p.id,
      team: p.team,
      brawlerId: p.brawlerId,
      isBot: !!p.isBot,
      kills: p.kills,
      deaths: p.deaths,
      gems: p.gems
    });
  });
  return snapshot;
}

function buildStateSnapshot(room) {
  const entities = [];
  room.players.forEach(p => {
    entities.push({
      id: p.id,
      x: Math.round(p.x),
      y: Math.round(p.y),
      hp: Math.round(p.hp),
      maxHp: p.maxHp,
      angle: +(p.angle.toFixed(2)),
      team: p.team,
      brawlerId: p.brawlerId,
      alive: p.alive,
      gems: p.gems,
      shielded: p.shielded,
      stunTimer: +(p.stunTimer.toFixed(1)),
      isBot: !!p.isBot
    });
  });

  return {
    type: 'state',
    time: +(room.gameTime.toFixed(1)),
    blue: room.blueScore,
    red: room.redScore,
    entities,
    projectiles: room.projectiles.map(p => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
      team: p.team
    })),
    gems: room.gems.map(g => ({ id: g.id, x: Math.round(g.x), y: Math.round(g.y) }))
  };
}

// ============================================================
// WEBSOCKET CONNECTION HANDLER
// ============================================================
wss.on('connection', (ws, req) => {
  console.log(`[WS] New connection from ${req.socket.remoteAddress}`);

  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'join': {
          // Find or create a room
          let room = null;
          rooms.forEach(r => {
            if (r.state === 'waiting' && r.players.size < 6) {
              room = r;
            }
          });

          if (!room && rooms.size < MAX_ROOMS) {
            room = createRoom();
          }

          if (room) {
            addPlayerToRoom(ws, room, msg.brawler || 'blaze');
          } else {
            sendToPlayer(ws, { type: 'error', message: 'Server full, try again later' });
          }
          break;
        }

        case 'input': {
          const room = rooms.get(ws.roomId);
          if (!room) return;
          const player = room.players.get(ws.playerId);
          if (!player || !player.alive) return;

          player.lastInput = {
            up: !!msg.up,
            down: !!msg.down,
            left: !!msg.left,
            right: !!msg.right,
            angle: msg.angle || 0,
            shoot: !!msg.shoot,
            seq: msg.seq || 0
          };
          break;
        }

        case 'ability': {
          const room = rooms.get(ws.roomId);
          if (!room) return;
          const player = room.players.get(ws.playerId);
          if (!player || !player.alive || player.abilityCooldown > 0) return;

          player.abilityCooldown = player.brawler.abilityCd;
          // Simplified ability effects (expand as needed)
          broadcastToRoom(room, {
            type: 'ability_used',
            playerId: player.id,
            abilityType: 'q'
          });
          break;
        }

        case 'super': {
          const room = rooms.get(ws.roomId);
          if (!room) return;
          const player = room.players.get(ws.playerId);
          if (!player || !player.alive || player.superCooldown > 0) return;

          player.superCooldown = player.brawler.superCd;

          // AoE damage super
          room.players.forEach(e => {
            if (e.team !== player.team && e.alive) {
              const dx = e.x - player.x, dy = e.y - player.y;
              if (Math.sqrt(dx * dx + dy * dy) < 140) {
                e.hp -= 800;
                if (e.hp <= 0) killPlayer(room, e, player.id);
              }
            }
          });

          broadcastToRoom(room, {
            type: 'ability_used',
            playerId: player.id,
            abilityType: 'r'
          });
          break;
        }
      }
    } catch (err) {
      console.error('[WS] Message parse error:', err.message);
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (room) {
      room.players.delete(ws.playerId);
      console.log(`[Room ${room.id}] Player ${ws.playerId} disconnected (${room.players.size} remaining)`);

      // Clean up empty rooms
      const humanPlayers = Array.from(room.players.values()).filter(p => !p.isBot);
      if (humanPlayers.length === 0 && room.state === 'playing') {
        clearInterval(room.tickInterval);
        rooms.delete(room.id);
        console.log(`[Room ${room.id}] All humans left, room destroyed`);
      }
    }
  });
});

// Keepalive ping
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ============================================================
// START SERVER
// ============================================================
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║        BRAWL ARENA — Game Server         ║
║                                          ║
║   Port: ${String(PORT).padEnd(33)}║
║   Tick Rate: ${TICK_RATE} Hz${' '.repeat(24)}║
║   Max Rooms: ${MAX_ROOMS}${' '.repeat(25)}║
║                                          ║
║   Status: READY                          ║
╚══════════════════════════════════════════╝
  `);
});
