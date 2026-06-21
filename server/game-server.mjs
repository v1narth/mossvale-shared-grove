import crypto from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const WORLD = { w: 3600, h: 2600 };
const WORLD_3D = { minX: -3600, maxX: 3600, minY: -2600, maxY: 2600 };
const TICK_HZ = 30;
const SNAPSHOT_HZ = 20;
const PLAYER_BASE_SPEED = 140;
const PLAYER_3D_BASE_SPEED = 195;
const PLAYER_SPRINT_MULTIPLIER = 1.45;
const PLAYER_3D_SPRINT_MULTIPLIER = 315 / 195;
const PLAYER_RADIUS = 17;
const ATTACK_FUDGE = 26;
const ATTACK_OBSERVED_ORIGIN_FUDGE = 130;
const POSITION_HISTORY_MS = 1200;
const ATTACK_MAX_REWIND_MS = 650;
const EQUIPMENT_SLOTS = ["head", "weapon", "body", "offhand", "feet", "charm"];

const weapons = new Map(
  [
    { id: "stick", name: "Walking Stick", range: 36, cooldown: 0.66, damage: 1, type: "melee" },
    { id: "sword", name: "Wooden Sword", range: 48, cooldown: 0.48, damage: 2, type: "melee" },
    { id: "dagger", name: "Rogue Dagger", range: 38, cooldown: 0.36, damage: 1, type: "melee" },
    { id: "bow", name: "Bow", range: 260, cooldown: 0.96, damage: 2, type: "arrow" },
    { id: "crossbow", name: "Crossbow", range: 285, cooldown: 1.05, damage: 3, type: "arrow" },
    { id: "pistol", name: "Pistol", range: 215, cooldown: 0.34, damage: 1, type: "bullet" },
    { id: "rifle", name: "Rifle", range: 360, cooldown: 0.82, damage: 3, type: "bullet" },
    { id: "laser", name: "Laser", range: 420, cooldown: 0.42, damage: 1, type: "laser" },
    { id: "spear", name: "Spear", range: 78, cooldown: 0.68, damage: 2, type: "melee" },
    { id: "wand", name: "Wand", range: 235, cooldown: 1.08, damage: 2, type: "spark" },
    { id: "staff", name: "Staff", range: 275, cooldown: 1.18, damage: 3, type: "spark" },
    { id: "hammer", name: "Hammer", range: 38, cooldown: 1.2, damage: 4, type: "melee" },
    { id: "battle_axe", name: "Battle Axe", range: 54, cooldown: 0.78, damage: 3, type: "melee" },
    { id: "great_axe", name: "Great Axe", range: 62, cooldown: 1.08, damage: 4, type: "melee" },
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

  const renderer = message.renderer === "3d" ? "3d" : "2d";
  const bounds = worldBoundsForRenderer(renderer);
  const requestedY = renderer === "3d" ? message.z ?? message.y : message.y;
  const equipment = safeEquipment(message.equipment, {
    weapon: message.weaponId ?? "stick",
    offhand: message.offhandId,
  });
  const player = {
    socket,
    id,
    renderer,
    name: safeText(message.name, 24) || "Traveler",
    x: clampNumber(message.x, bounds.minX, bounds.maxX, bounds.spawnX),
    y: clampNumber(requestedY, bounds.minY, bounds.maxY, bounds.spawnY),
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
    equipment,
    weaponId: equipment.weapon,
    offhandId: equipment.offhand,
    movementState: safeMovementState(message.movementState),
    actionState: safeActionState(message.actionState),
    actionTool: safeId(message.actionTool),
    actionSequence: clampNumber(message.actionSequence, 0, 1000000000, 0),
    blocking: Boolean(message.blocking || message.actionState === "block"),
    headYaw: clampNumber(message.headYaw, -1.3, 1.3, 0),
    headPitch: clampNumber(message.headPitch, -0.7, 0.7, 0),
    sprinting: false,
    attackReadyAt: 0,
    dazedUntil: 0,
    lastSeen: Date.now(),
    positionHistory: [],
  };

  players.set(id, player);
  recordPlayerPosition(player, Date.now());
  send(socket, { type: "welcome", id, tickHz: TICK_HZ, snapshotHz: SNAPSHOT_HZ });
  broadcast({ type: "server-event", event: "join", id, name: player.name }, socket);
}

function handleMove(player, message) {
  const bounds = worldBoundsForRenderer(player.renderer);
  const requestedY = player.renderer === "3d" ? message.z ?? message.y : message.y;
  player.tx = clampNumber(message.x, bounds.minX, bounds.maxX, player.x);
  player.ty = clampNumber(requestedY, bounds.minY, bounds.maxY, player.y);
  player.sprinting = Boolean(message.sprinting);
}

function handleState(player, message) {
  const bounds = worldBoundsForRenderer(player.renderer);
  const requestedY = player.renderer === "3d" ? message.z ?? message.y : message.y;
  player.name = safeText(message.name, 24) || player.name;
  player.color = safeColor(message.color, player.color);
  player.skin = safeColor(message.skin, player.skin);
  player.hair = safeColor(message.hair, player.hair);
  player.pants = safeColor(message.pants, player.pants);
  player.equipment = safeEquipment(message.equipment, {
    ...player.equipment,
    weapon: message.weaponId === undefined ? player.equipment?.weapon : message.weaponId,
    offhand: message.offhandId === undefined ? player.equipment?.offhand : message.offhandId,
  });
  player.weaponId = player.equipment.weapon;
  player.offhandId = player.equipment.offhand;
  player.movementState = safeMovementState(message.movementState);
  player.actionState = safeActionState(message.actionState);
  player.actionTool = safeId(message.actionTool);
  player.actionSequence = clampNumber(message.actionSequence, 0, 1000000000, player.actionSequence || 0);
  player.blocking = Boolean(message.blocking || player.actionState === "block");
  player.headYaw = clampNumber(message.headYaw, -1.3, 1.3, player.headYaw || 0);
  player.headPitch = clampNumber(message.headPitch, -0.7, 0.7, player.headPitch || 0);
  if (player.renderer === "3d") {
    const nextX = clampNumber(message.x, bounds.minX, bounds.maxX, player.x);
    const nextY = clampNumber(requestedY, bounds.minY, bounds.maxY, player.y);
    const dt = Math.max(1 / SNAPSHOT_HZ, (Date.now() - player.lastSeen) / 1000);
    player.vx = (nextX - player.x) / dt;
    player.vy = (nextY - player.y) / dt;
    player.x = nextX;
    player.y = nextY;
    player.tx = null;
    player.ty = null;
  }
  player.facing = finiteNumber(message.facing, player.facing);
  player.maxHp = clampNumber(message.maxHp, 1, 40, player.maxHp);
}

function handleAttack(attacker, message) {
  const at = Date.now();
  if (attacker.dazedUntil > at || attacker.attackReadyAt > at) return;

  const weapon = weapons.get(message.weaponId) || weapons.get(attacker.weaponId) || weapons.get("stick");
  const clientFacing = finiteNumber(message.facing, attacker.facing);
  const hitFacing = attackFacingForPlayer(attacker, clientFacing);
  attacker.weaponId = weapon.id;
  attacker.facing = clientFacing;
  attacker.attackReadyAt = at + weapon.cooldown * 1000;

  const bounds = worldBoundsForRenderer(attacker.renderer);
  const targetX = clampNumber(message.targetX, bounds.minX, bounds.maxX, attacker.x + Math.cos(hitFacing) * weapon.range);
  const targetY = clampNumber(message.targetY, bounds.minY, bounds.maxY, attacker.y + Math.sin(hitFacing) * weapon.range);
  const originX = clampObservedCoordinate(message.originX, bounds.minX, bounds.maxX, attacker.x);
  const originY = clampObservedCoordinate(message.originY ?? message.originZ, bounds.minY, bounds.maxY, attacker.y);
  const hasObservedOrigin =
    originX != null &&
    originY != null &&
    dist(attacker.x, attacker.y, originX, originY) <= ATTACK_OBSERVED_ORIGIN_FUDGE;
  const observedAt = Number(message.observedAt ?? message.targetObservedAt);
  const targetObservedAt =
    Number.isFinite(observedAt) &&
    observedAt <= at + 100 &&
    at - observedAt <= ATTACK_MAX_REWIND_MS
      ? observedAt
      : null;
  const attack = {
    type: "pvp-attack",
    id: attacker.id,
    weaponId: weapon.id,
    x: attacker.x,
    y: attacker.y,
    originX: hasObservedOrigin ? originX : attacker.x,
    originY: hasObservedOrigin ? originY : attacker.y,
    facing: attacker.facing,
    swingMs: weapon.type === "melee" ? 260 : 150,
    targetId: safeId(message.targetId),
    targetObservedAt,
    targetX,
    targetY,
  };
  broadcast(attack);

  const target = findAttackHit(attacker, weapon, attack, hitFacing);
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

function findAttackHit(attacker, weapon, attack, hitFacing = attack.facing) {
  const candidates = attack.targetId ? [players.get(attack.targetId)].filter(Boolean) : [...players.values()];
  let best = null;
  let bestDistance = Infinity;
  const originX = Number.isFinite(attack.originX) ? attack.originX : attacker.x;
  const originY = Number.isFinite(attack.originY) ? attack.originY : attacker.y;

  for (const target of candidates) {
    if (target.id === attacker.id || target.hp <= 0) continue;
    const positions = [{ x: target.x, y: target.y }];
    const rewoundTarget =
      attack.targetId === target.id && attack.targetObservedAt
        ? historicalPlayerPosition(target, attack.targetObservedAt)
        : null;
    if (rewoundTarget) {
      positions.push(rewoundTarget);
    }

    let hit = false;
    let distance = Infinity;

    for (const position of positions) {
      let positionHit = false;
      let positionDistance = dist(originX, originY, position.x, position.y);
      if (weapon.type === "melee") {
        const angle = Math.atan2(position.y - originY, position.x - originX);
        positionHit =
          positionDistance <= weapon.range + PLAYER_RADIUS + ATTACK_FUDGE &&
          Math.abs(angleDelta(hitFacing, angle)) <= 1.05;
      } else {
        positionDistance = pointSegmentDistance(
          position.x,
          position.y,
          originX,
          originY,
          attack.targetX,
          attack.targetY,
        );
        positionHit =
          dist(originX, originY, attack.targetX, attack.targetY) <= weapon.range + ATTACK_FUDGE &&
          positionDistance <= PLAYER_RADIUS + 14;
      }

      if (positionHit && positionDistance < distance) {
        hit = true;
        distance = positionDistance;
      }
    }

    if (hit && distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

function finiteNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function attackFacingForPlayer(player, facing) {
  return player.renderer === "3d" ? Math.atan2(Math.cos(facing), Math.sin(facing)) : facing;
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
  if (player.renderer === "3d") {
    player.vx *= 0.82;
    player.vy *= 0.82;
    return;
  }
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

  const speed = player.renderer === "3d"
    ? PLAYER_3D_BASE_SPEED * (player.sprinting ? PLAYER_3D_SPRINT_MULTIPLIER : 1)
    : PLAYER_BASE_SPEED * (player.sprinting ? PLAYER_SPRINT_MULTIPLIER : 1);
  const bounds = worldBoundsForRenderer(player.renderer);
  const step = Math.min(d, speed * dt);
  player.x = clamp(player.x + (dx / d) * step, bounds.minX, bounds.maxX);
  player.y = clamp(player.y + (dy / d) * step, bounds.minY, bounds.maxY);
  player.vx = (dx / d) * speed;
  player.vy = (dy / d) * speed;
  player.facing = Math.atan2(dy, dx);
}

function broadcastSnapshot() {
  const at = Date.now();
  for (const player of players.values()) {
    recordPlayerPosition(player, at);
  }
  const snapshot = {
    type: "snapshot",
    sentAt: at,
    players: [...players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      z: player.renderer === "3d" ? player.y : undefined,
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
      equipment: player.equipment,
      weaponId: player.weaponId,
      offhandId: player.offhandId,
      movementState: player.movementState,
      actionState: player.actionState,
      actionTool: player.actionTool,
      actionSequence: player.actionSequence || 0,
      blocking: Boolean(player.blocking || player.actionState === "block"),
      headYaw: player.headYaw || 0,
      headPitch: player.headPitch || 0,
      renderer: player.renderer,
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

function safeEquipment(source = {}, fallback = {}) {
  return Object.fromEntries(
    EQUIPMENT_SLOTS.map((slot) => {
      const hasSourceSlot = Object.prototype.hasOwnProperty.call(source || {}, slot);
      const raw = hasSourceSlot ? source?.[slot] : fallback?.[slot] ?? null;
      const id = safeId(raw);
      if (slot === "weapon") return [slot, id && weapons.has(id) ? id : null];
      return [slot, id];
    }),
  );
}

function safeMovementState(value) {
  return ["idle", "walking", "running"].includes(value) ? value : "idle";
}

function safeActionState(value) {
  return ["idle", "attack", "gather", "block"].includes(value) ? value : "idle";
}

function safeText(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function worldBoundsForRenderer(renderer) {
  if (renderer === "3d") {
    return {
      minX: WORLD_3D.minX + 60,
      maxX: WORLD_3D.maxX - 60,
      minY: WORLD_3D.minY + 60,
      maxY: WORLD_3D.maxY - 60,
      spawnX: 72,
      spawnY: 0,
    };
  }

  return {
    minX: 42,
    maxX: WORLD.w - 42,
    minY: 42,
    maxY: WORLD.h - 42,
    spawnX: WORLD.w / 2,
    spawnY: WORLD.h / 2,
  };
}

function safeColor(value, fallback) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function recordPlayerPosition(player, at = Date.now()) {
  if (!player) return;
  const history = player.positionHistory || (player.positionHistory = []);
  const last = history[history.length - 1];
  if (
    !last ||
    at - last.at >= 20 ||
    dist(last.x, last.y, player.x, player.y) > 0.25 ||
    Math.abs(angleDelta(player.facing || 0, last.facing || 0)) > 0.005
  ) {
    history.push({
      at,
      x: player.x,
      y: player.y,
      facing: player.facing || 0,
    });
  }

  const oldest = at - POSITION_HISTORY_MS;
  while (history.length > 2 && history[0].at < oldest) {
    history.shift();
  }
}

function historicalPlayerPosition(player, observedAt) {
  const history = player?.positionHistory;
  if (!history?.length || !Number.isFinite(observedAt)) return null;

  const first = history[0];
  const last = history[history.length - 1];
  if (observedAt <= first.at) {
    return first.at - observedAt <= 100 ? first : null;
  }
  if (observedAt >= last.at) {
    return observedAt - last.at <= 100 ? last : null;
  }

  for (let index = 1; index < history.length; index += 1) {
    const next = history[index];
    if (next.at < observedAt) continue;
    const previous = history[index - 1];
    const span = Math.max(1, next.at - previous.at);
    const amount = clamp((observedAt - previous.at) / span, 0, 1);
    return {
      at: observedAt,
      x: previous.x + (next.x - previous.x) * amount,
      y: previous.y + (next.y - previous.y) * amount,
      facing:
        previous.facing +
        angleDelta(next.facing || 0, previous.facing || 0) * amount,
    };
  }

  return null;
}

function clampObservedCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, min, max) : null;
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
