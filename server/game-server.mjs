import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const WORLD = { w: 3600, h: 2600 };
const TICK_HZ = 30;
const SNAPSHOT_HZ = 20;
const PLAYER_BASE_SPEED = 140;
const PLAYER_SPRINT_MULTIPLIER = 1.45;
const PLAYER_RADIUS = 17;
const ATTACK_FUDGE = 26;

const weapons = new Map(
  [
    { id: "stick", name: "Walking Stick", range: 36, cooldown: 0.66, damage: 1, type: "melee" },
    { id: "sword", name: "Wooden Sword", range: 48, cooldown: 0.48, damage: 2, type: "melee" },
    { id: "bow", name: "Bow", range: 260, cooldown: 0.96, damage: 2, type: "arrow" },
    { id: "pistol", name: "Pistol", range: 215, cooldown: 0.34, damage: 1, type: "bullet" },
    { id: "rifle", name: "Rifle", range: 360, cooldown: 0.82, damage: 3, type: "bullet" },
    { id: "laser", name: "Laser", range: 420, cooldown: 0.42, damage: 1, type: "laser" },
    { id: "spear", name: "Spear", range: 78, cooldown: 0.68, damage: 2, type: "melee" },
    { id: "wand", name: "Wand", range: 235, cooldown: 1.08, damage: 2, type: "spark" },
    { id: "hammer", name: "Hammer", range: 38, cooldown: 1.2, damage: 4, type: "melee" },
    { id: "blaster", name: "Blaster", range: 295, cooldown: 0.56, damage: 2, type: "laser" },
  ].map((weapon) => [weapon.id, weapon]),
);

const players = new Map();
let lastTick = Date.now();

const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ ok: true, players: players.size }));
});

server.on("upgrade", (request, socket) => {
  if ((request.headers.upgrade || "").toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n"),
  );

  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const result = readFrames(buffer);
    buffer = result.remaining;
    for (const frame of result.frames) handleFrame(socket, frame);
  });
  socket.on("close", () => removeSocket(socket));
  socket.on("error", () => removeSocket(socket));
});

server.listen(PORT, HOST, () => {
  console.log(`Mossvale game server listening on ws://${HOST}:${PORT}`);
});

setInterval(tickWorld, 1000 / TICK_HZ);
setInterval(broadcastSnapshot, 1000 / SNAPSHOT_HZ);

function handleFrame(socket, frame) {
  if (frame.opcode === 0x8) {
    removeSocket(socket);
    socket.end();
    return;
  }
  if (frame.opcode !== 0x1) return;

  let message;
  try {
    message = JSON.parse(frame.payload.toString("utf8"));
  } catch {
    return;
  }

  if (message.type === "join") {
    joinPlayer(socket, message);
    return;
  }

  const player = playerForSocket(socket);
  if (!player) return;

  player.lastSeen = Date.now();
  if (message.type === "move") handleMove(player, message);
  if (message.type === "state") handleState(player, message);
  if (message.type === "attack") handleAttack(player, message);
}

function joinPlayer(socket, message) {
  const id = safeId(message.id) || crypto.randomUUID();
  const existing = players.get(id);
  if (existing?.socket && existing.socket !== socket) {
    closeSocket(existing.socket, { type: "replaced" });
  }

  const player = {
    socket,
    id,
    name: safeText(message.name, 24) || "Traveler",
    x: clampNumber(message.x, 42, WORLD.w - 42, WORLD.w / 2),
    y: clampNumber(message.y, 42, WORLD.h - 42, WORLD.h / 2),
    tx: null,
    ty: null,
    vx: 0,
    vy: 0,
    hp: clampNumber(message.hp, 0, clampNumber(message.maxHp, 1, 40, 5), 5),
    maxHp: clampNumber(message.maxHp, 1, 40, 5),
    facing: Number(message.facing) || 0,
    color: safeColor(message.color, "#f3cf75"),
    skin: safeColor(message.skin, "#f0c59b"),
    hair: safeColor(message.hair, "#5a3929"),
    pants: safeColor(message.pants, "#516d75"),
    weaponId: weapons.has(message.weaponId) ? message.weaponId : "stick",
    sprinting: false,
    attackReadyAt: 0,
    dazedUntil: 0,
    lastSeen: Date.now(),
  };

  players.set(id, player);
  send(socket, { type: "welcome", id, tickHz: TICK_HZ, snapshotHz: SNAPSHOT_HZ });
  broadcast({ type: "server-event", event: "join", id, name: player.name }, socket);
}

function handleMove(player, message) {
  player.tx = clampNumber(message.x, 28, WORLD.w - 28, player.x);
  player.ty = clampNumber(message.y, 28, WORLD.h - 28, player.y);
  player.sprinting = Boolean(message.sprinting);
}

function handleState(player, message) {
  player.name = safeText(message.name, 24) || player.name;
  player.color = safeColor(message.color, player.color);
  player.skin = safeColor(message.skin, player.skin);
  player.hair = safeColor(message.hair, player.hair);
  player.pants = safeColor(message.pants, player.pants);
  player.weaponId = weapons.has(message.weaponId) ? message.weaponId : player.weaponId;
  player.facing = Number(message.facing) || player.facing;
  player.maxHp = clampNumber(message.maxHp, 1, 40, player.maxHp);
}

function handleAttack(attacker, message) {
  const at = Date.now();
  if (attacker.dazedUntil > at || attacker.attackReadyAt > at) return;

  const weapon = weapons.get(message.weaponId) || weapons.get(attacker.weaponId) || weapons.get("stick");
  attacker.weaponId = weapon.id;
  attacker.facing = Number(message.facing) || attacker.facing;
  attacker.attackReadyAt = at + weapon.cooldown * 1000;

  const targetX = clampNumber(message.targetX, 0, WORLD.w, attacker.x + Math.cos(attacker.facing) * weapon.range);
  const targetY = clampNumber(message.targetY, 0, WORLD.h, attacker.y + Math.sin(attacker.facing) * weapon.range);
  const attack = {
    type: "pvp-attack",
    id: attacker.id,
    weaponId: weapon.id,
    x: attacker.x,
    y: attacker.y,
    facing: attacker.facing,
    swingMs: weapon.type === "melee" ? 260 : 150,
    targetId: safeId(message.targetId),
    targetX,
    targetY,
  };
  broadcast(attack);

  const target = findAttackHit(attacker, weapon, attack);
  if (!target) return;

  target.hp = Math.max(0, target.hp - weapon.damage);
  if (target.hp <= 0) {
    target.dazedUntil = at + 2600;
    target.tx = null;
    target.ty = null;
  }

  broadcast({
    type: "pvp-hit",
    targetId: target.id,
    attackerId: attacker.id,
    attackerName: attacker.name,
    weaponId: weapon.id,
    weaponName: weapon.name,
    damage: weapon.damage,
    x: target.x,
    y: target.y,
    facing: attacker.facing,
    hp: target.hp,
    dazedMs: Math.max(0, target.dazedUntil - at),
  });
}

function findAttackHit(attacker, weapon, attack) {
  const candidates = attack.targetId ? [players.get(attack.targetId)].filter(Boolean) : [...players.values()];
  let best = null;
  let bestDistance = Infinity;

  for (const target of candidates) {
    if (target.id === attacker.id || target.hp <= 0) continue;
    let hit = false;
    let distance = dist(attacker.x, attacker.y, target.x, target.y);
    if (weapon.type === "melee") {
      const angle = Math.atan2(target.y - attacker.y, target.x - attacker.x);
      hit = distance <= weapon.range + PLAYER_RADIUS + ATTACK_FUDGE && Math.abs(angleDelta(attacker.facing, angle)) <= 1.05;
    } else {
      distance = pointSegmentDistance(target.x, target.y, attacker.x, attacker.y, attack.targetX, attack.targetY);
      hit =
        dist(attacker.x, attacker.y, attack.targetX, attack.targetY) <= weapon.range + ATTACK_FUDGE &&
        distance <= PLAYER_RADIUS + 14;
    }
    if (hit && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

function tickWorld() {
  const at = Date.now();
  const dt = Math.min(0.05, (at - lastTick) / 1000 || 1 / TICK_HZ);
  lastTick = at;

  for (const player of players.values()) {
    if (at - player.lastSeen > 12000) {
      removePlayer(player.id);
      continue;
    }
    if (player.dazedUntil > at) continue;
    updatePlayerMovement(player, dt);
  }
}

function updatePlayerMovement(player, dt) {
  if (player.tx == null || player.ty == null) {
    player.vx *= 0.82;
    player.vy *= 0.82;
    return;
  }

  const dx = player.tx - player.x;
  const dy = player.ty - player.y;
  const d = Math.hypot(dx, dy);
  if (d < 4) {
    player.tx = null;
    player.ty = null;
    player.vx *= 0.3;
    player.vy *= 0.3;
    return;
  }

  const speed = PLAYER_BASE_SPEED * (player.sprinting ? PLAYER_SPRINT_MULTIPLIER : 1);
  const step = Math.min(d, speed * dt);
  player.x = clamp(player.x + (dx / d) * step, 42, WORLD.w - 42);
  player.y = clamp(player.y + (dy / d) * step, 42, WORLD.h - 42);
  player.vx = (dx / d) * speed;
  player.vy = (dy / d) * speed;
  player.facing = Math.atan2(dy, dx);
}

function broadcastSnapshot() {
  const at = Date.now();
  const snapshot = {
    type: "snapshot",
    sentAt: at,
    players: [...players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      tx: player.tx,
      ty: player.ty,
      vx: player.vx,
      vy: player.vy,
      color: player.color,
      skin: player.skin,
      hair: player.hair,
      pants: player.pants,
      facing: player.facing,
      hp: player.hp,
      maxHp: player.maxHp,
      weaponId: player.weaponId,
      dazedMs: Math.max(0, player.dazedUntil - at),
      sentAt: at,
    })),
  };
  broadcast(snapshot);
}

function removeSocket(socket) {
  for (const player of players.values()) {
    if (player.socket === socket) {
      removePlayer(player.id);
      return;
    }
  }
}

function removePlayer(id) {
  const player = players.get(id);
  if (!player) return;
  players.delete(id);
  broadcast({ type: "leave", id });
}

function playerForSocket(socket) {
  for (const player of players.values()) {
    if (player.socket === socket) return player;
  }
  return null;
}

function broadcast(message, exceptSocket = null) {
  for (const player of players.values()) {
    if (player.socket !== exceptSocket) send(player.socket, message);
  }
}

function send(socket, message) {
  if (socket.destroyed) return;
  socket.write(writeFrame(Buffer.from(JSON.stringify(message))));
}

function closeSocket(socket, message) {
  send(socket, message);
  socket.end();
}

function readFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let header = 2;

    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      if (offset + 10 > buffer.length) break;
      length = Number(buffer.readBigUInt64BE(offset + 2));
      header = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = header + maskLength + length;
    if (offset + frameLength > buffer.length) break;

    let payload = buffer.subarray(offset + header + maskLength, offset + frameLength);
    if (masked) {
      const mask = buffer.subarray(offset + header, offset + header + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }
    frames.push({ opcode, payload });
    offset += frameLength;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function writeFrame(payload) {
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function safeId(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null;
}

function safeText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function angleDelta(a, b) {
  let d = (a - b + Math.PI) % (Math.PI * 2);
  if (d < 0) d += Math.PI * 2;
  return d - Math.PI;
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return dist(px, py, x1, y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy), 0, 1);
  return dist(px, py, x1 + dx * t, y1 + dy * t);
}
