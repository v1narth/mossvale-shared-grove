const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");

const ui = {
  online: document.getElementById("onlineCount"),
  wood: document.getElementById("woodCount"),
  stone: document.getElementById("stoneCount"),
  flower: document.getElementById("flowerCount"),
  cotton: document.getElementById("cottonCount"),
  playerName: document.getElementById("playerName"),
  energyProgress: document.getElementById("energyProgress"),
  energyCount: document.getElementById("energyCount"),
  actionLine: document.getElementById("actionLine"),
  actionProgress: document.getElementById("actionProgress"),
  gatherHud: document.getElementById("gatherHud"),
  gatherIcon: document.getElementById("gatherIcon"),
  gatherName: document.getElementById("gatherName"),
  gatherProgress: document.getElementById("gatherProgress"),
  pickupToasts: document.getElementById("pickupToasts"),
  focusName: document.getElementById("focusName"),
  focusDetail: document.getElementById("focusDetail"),
  abilitybar: document.getElementById("abilitybar"),
  quickbar: document.getElementById("quickbar"),
  buildBtn: document.getElementById("buildBtn"),
  buildPanel: document.getElementById("buildPanel"),
  buildPieces: document.getElementById("buildPieces"),
  buildClose: document.getElementById("buildClose"),
  rotateBuild: document.getElementById("rotateBuild"),
  cancelBuild: document.getElementById("cancelBuild"),
  buildHint: document.getElementById("buildHint"),
  craftBtn: document.getElementById("craftBtn"),
  craftPanel: document.getElementById("craftPanel"),
  craftCategories: document.getElementById("craftCategories"),
  craftRecipes: document.getElementById("craftRecipes"),
  craftClose: document.getElementById("craftClose"),
  craftBack: document.getElementById("craftBack"),
  craftTitle: document.getElementById("craftTitle"),
  craftSummary: document.getElementById("craftSummary"),
  inventoryPanel: document.getElementById("inventoryPanel"),
  inventoryClose: document.getElementById("inventoryClose"),
  equipmentSlots: document.getElementById("equipmentSlots"),
  inventorySlots: document.getElementById("inventorySlots"),
  itemPopover: document.getElementById("itemPopover"),
  itemPopoverIcon: document.getElementById("itemPopoverIcon"),
  itemPopoverName: document.getElementById("itemPopoverName"),
  itemPopoverType: document.getElementById("itemPopoverType"),
  itemPopoverDesc: document.getElementById("itemPopoverDesc"),
  itemPopoverLevel: document.getElementById("itemPopoverLevel"),
  itemPopoverCount: document.getElementById("itemPopoverCount"),
  itemPopoverClose: document.getElementById("itemPopoverClose"),
  itemPopoverAction: document.getElementById("itemPopoverAction"),
  bagSpace: document.getElementById("bagSpace"),
  inventorySummary: document.getElementById("inventorySummary"),
  homeBtn: document.getElementById("homeBtn"),
  plantBtn: document.getElementById("plantBtn"),
  waveBtn: document.getElementById("waveBtn"),
  pauseBtn: document.getElementById("pauseBtn"),
  renameBtn: document.getElementById("renameBtn"),
  nameModal: document.getElementById("nameModal"),
  nameForm: document.getElementById("nameForm"),
  nameInput: document.getElementById("nameInput"),
};

const WORLD = { w: 3600, h: 2600 };
const RESOURCE_VERSION = "mossvale_resources_v2";
const NAME_KEY = "mossvale_player_name";
const INV_KEY = "mossvale_inventory_v1";
const INV_LAYOUT_KEY = "mossvale_inventory_layout_v1";
const QUICKBAR_KEY = "mossvale_quickbar_v1";
const BUILD_KEY = "mossvale_buildings_v1";
const WEAPON_KEY = "mossvale_weapon_unlocks_v1";
const EQUIPMENT_KEY = "mossvale_equipment_v1";
const CLIENT_ID = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const channel = "BroadcastChannel" in window ? new BroadcastChannel("mossvale-grove") : null;

let width = 1;
let height = 1;
let dpr = 1;
let now = performance.now();
let last = now;
let paused = false;
let followSelf = true;
let selected = null;
let pointer = null;
let rightMove = null;
let hover = null;
let waveUntil = 0;
let buildMode = false;
let craftOpen = false;
let selectedCraftCategory = "materials";
let selectedCraftRecipeIndex = null;
let selectedCraftQuantity = 1;
let selectedBuild = 0;
let buildRotation = 0;
let buildPreview = null;
let lastPointerWorld = null;
let lastHoldMoveAt = 0;
let moveGuideTarget = null;
let dragPayload = null;

const HELD_MOVE_LEAD = 280;
const MOVE_GUIDE_MAX = 115;
const PLAYER_BASE_SPEED = 172;
const PLAYER_SPRINT_MULTIPLIER = 1.55;
const PLAYER_SPRINT_DRAIN = 16;
const PLAYER_ENERGY_REGEN = 8;
const PLAYER_SPRINT_RESUME_ENERGY = 3;
const PLAYER_ENERGY_DEPLETED_REGEN_DELAY = 6000;

const CAMERA_ZOOM = 1.5;
const camera = { x: WORLD.w / 2, y: WORLD.h / 2, zoom: CAMERA_ZOOM };
const inventory = normalizeInventory(loadJson(INV_KEY, emptyInventory()));
const resourceState = loadJson(RESOURCE_VERSION, {});
const buildings = loadJson(BUILD_KEY, []);
let equippedItems = loadJson(EQUIPMENT_KEY, {});
const others = new Map();
const particles = [];
const floatText = [];
const projectiles = [];
const droppedLoot = [];
const bots = [];
const audioSupport = window.AudioContext || window.webkitAudioContext;
let audio = null;
const DEFAULT_SOUND_RANGE = 760;
const CLOSE_SOUND_RANGE = 90;
const PICKUP_TOAST_MS = 3400;
const PICKUP_TOAST_EXIT_MS = 360;
const MAX_PICKUP_TOASTS = 6;

function ensureAudio() {
  if (!audioSupport) return null;
  if (!audio) {
    const ctx = new audioSupport();
    const master = ctx.createGain();
    const music = ctx.createGain();
    const sfx = ctx.createGain();
    master.gain.value = 0.72;
    music.gain.value = 0.24;
    sfx.gain.value = 0.66;
    music.connect(master);
    sfx.connect(master);
    master.connect(ctx.destination);
    audio = {
      ctx,
      master,
      music,
      sfx,
      noise: makeNoiseBuffer(ctx),
      nextMusicAt: 0,
      musicStep: 0,
      musicTimer: null,
      lastSfx: new Map(),
    };
  }
  if (audio.ctx.state === "suspended") audio.ctx.resume();
  syncAudioState();
  return audio;
}

function syncAudioState() {
  if (!audio) return;
  const at = audio.ctx.currentTime;
  audio.master.gain.cancelScheduledValues(at);
  audio.master.gain.setTargetAtTime(paused ? 0 : 0.72, at, 0.08);
  if (paused) {
    stopMusicLoop();
  } else {
    startMusicLoop();
  }
}

function startMusicLoop() {
  if (!audio || audio.musicTimer) return;
  audio.nextMusicAt = Math.max(audio.ctx.currentTime + 0.04, audio.nextMusicAt || 0);
  audio.musicTimer = setInterval(scheduleMusic, 120);
  scheduleMusic();
}

function stopMusicLoop() {
  if (!audio?.musicTimer) return;
  clearInterval(audio.musicTimer);
  audio.musicTimer = null;
}

function scheduleMusic() {
  if (!audio || paused) return;
  const lookahead = audio.ctx.currentTime + 1.1;
  const beat = 60 / 86;
  const root = 293.66;
  const scale = [0, 2, 4, 7, 9, 12, 14, 16];
  const melody = [0, 2, 4, 7, 4, 2, 0, 4, 9, 7, 4, 2, 0, 2, 4, 7];
  const bass = [0, -5, -7, -3];

  while (audio.nextMusicAt < lookahead) {
    const step = audio.musicStep;
    const at = audio.nextMusicAt;
    const note = melody[step % melody.length];
    const octave = step % 8 === 7 ? 1 : 0;
    playTone(root * 2 ** ((note + octave * 12) / 12), at, beat * 1.45, {
      destination: audio.music,
      gain: 0.045,
      type: "triangle",
      attack: 0.018,
      release: 0.42,
    });

    if (step % 2 === 0) {
      const bassNote = bass[Math.floor(step / 8) % bass.length];
      playTone(root * 2 ** ((bassNote - 12) / 12), at, beat * 2.7, {
        destination: audio.music,
        gain: 0.034,
        type: "sine",
        attack: 0.05,
        release: 0.75,
      });
    }

    if (step % 8 === 0) {
      for (const interval of [0, 4, 7]) {
        playTone(root * 2 ** ((scale[0] + interval) / 12), at + 0.03, beat * 6.8, {
          destination: audio.music,
          gain: 0.018,
          type: "sine",
          attack: 0.42,
          release: 1.4,
        });
      }
      playNoise(at, beat * 5.5, {
        destination: audio.music,
        gain: 0.012,
        filter: 950,
        filterType: "lowpass",
        attack: 0.55,
        release: 1.7,
      });
    }

    audio.musicStep += 1;
    audio.nextMusicAt += beat;
  }
}

function playSfx(name, intensity = 1) {
  const system = audio || ensureAudio();
  if (!system || (paused && name !== "ui")) return;
  intensity = clamp(intensity, 0, 1.4);
  const at = system.ctx.currentTime;
  const limits = { chop: 0.16, mine: 0.12, pick: 0.1, move: 0.08, ui: 0.05 };
  const limit = limits[name] || 0.04;
  if (at - (system.lastSfx.get(name) || -99) < limit) return;
  system.lastSfx.set(name, at);

  if (name === "ui") {
    playTone(620, at, 0.08, { gain: 0.035 * intensity, endFreq: 780 });
  } else if (name === "move") {
    playTone(210, at, 0.07, { gain: 0.026 * intensity, type: "triangle", endFreq: 170 });
  } else if (name === "error") {
    playTone(118, at, 0.14, { gain: 0.052 * intensity, type: "sawtooth", endFreq: 82 });
  } else if (name === "chop") {
    playNoise(at, 0.08, { gain: 0.06 * intensity, filter: 1450, filterType: "bandpass" });
    playTone(92, at, 0.1, { gain: 0.04 * intensity, type: "triangle", endFreq: 70 });
  } else if (name === "mine") {
    playTone(860, at, 0.12, { gain: 0.05 * intensity, type: "triangle", endFreq: 530 });
    playTone(1240, at + 0.018, 0.08, { gain: 0.025 * intensity, type: "sine", endFreq: 900 });
  } else if (name === "pick") {
    playTone(740, at, 0.13, { gain: 0.038 * intensity, type: "sine", endFreq: 1120 });
  } else if (name === "complete") {
    [0, 4, 7].forEach((step, index) => playTone(520 * 2 ** (step / 12), at + index * 0.055, 0.18, { gain: 0.036 * intensity }));
  } else if (name === "build") {
    playTone(118, at, 0.13, { gain: 0.068 * intensity, type: "triangle", endFreq: 86 });
    playNoise(at, 0.05, { gain: 0.036 * intensity, filter: 700, filterType: "lowpass" });
  } else if (name === "plant") {
    [0, 5, 9].forEach((step, index) => playTone(430 * 2 ** (step / 12), at + index * 0.045, 0.22, { gain: 0.034 * intensity, type: "sine" }));
  } else if (name === "wave") {
    playTone(670, at, 0.12, { gain: 0.04 * intensity, endFreq: 890 });
    playTone(890, at + 0.1, 0.14, { gain: 0.032 * intensity, endFreq: 760 });
  } else if (name === "melee") {
    playNoise(at, 0.09, { gain: 0.055 * intensity, filter: 1800, filterType: "highpass" });
    playTone(170, at + 0.02, 0.08, { gain: 0.028 * intensity, type: "triangle", endFreq: 115 });
  } else if (name === "shot") {
    playTone(390, at, 0.11, { gain: 0.046 * intensity, type: "square", endFreq: 220 });
  } else if (name === "laser") {
    playTone(920, at, 0.13, { gain: 0.045 * intensity, type: "sawtooth", endFreq: 1680 });
  } else if (name === "ability") {
    [0, 7].forEach((step, index) => playTone(500 * 2 ** (step / 12), at + index * 0.025, 0.18, { gain: 0.034 * intensity, type: "triangle" }));
  } else if (name === "hit") {
    playTone(150, at, 0.12, { gain: 0.055 * intensity, type: "triangle", endFreq: 96 });
  } else if (name === "defeat") {
    [7, 3, 0].forEach((step, index) => playTone(300 * 2 ** (step / 12), at + index * 0.08, 0.22, { gain: 0.038 * intensity, type: "sine" }));
  } else if (name === "playerHit") {
    playTone(94, at, 0.18, { gain: 0.065 * intensity, type: "sawtooth", endFreq: 58 });
  } else if (name === "guard") {
    [0, 4, 11].forEach((step, index) => playTone(620 * 2 ** (step / 12), at + index * 0.028, 0.16, { gain: 0.032 * intensity }));
  } else if (name === "loot") {
    [0, 3, 7, 12].forEach((step, index) => playTone(460 * 2 ** (step / 12), at + index * 0.04, 0.14, { gain: 0.033 * intensity }));
  }
}

function playWorldSfx(name, x, y, intensity = 1, range = DEFAULT_SOUND_RANGE) {
  if (!audio || x == null || y == null) return;
  const falloff = soundFalloff(x, y, range);
  if (falloff <= 0) return;
  playSfx(name, intensity * falloff);
}

function soundFalloff(x, y, range = DEFAULT_SOUND_RANGE) {
  const d = dist(player.x, player.y, x, y);
  if (d >= range) return 0;
  if (d <= CLOSE_SOUND_RANGE) return 1;
  const t = (d - CLOSE_SOUND_RANGE) / Math.max(1, range - CLOSE_SOUND_RANGE);
  return clamp((1 - t) ** 1.65, 0, 1);
}

function announceSfx(name, x, y, intensity = 1, range = DEFAULT_SOUND_RANGE) {
  announce("sfx", { sfx: { name, x, y, intensity, range } });
}

function playTone(freq, at, duration, options = {}) {
  if (!audio) return;
  const ctx = audio.ctx;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.006;
  const release = options.release ?? 0.12;
  const endAt = at + duration;
  osc.type = options.type || "sine";
  osc.frequency.setValueAtTime(Math.max(1, freq), at);
  if (options.endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, options.endFreq), Math.max(at + 0.01, endAt - release * 0.3));
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gain ?? 0.05), at + attack);
  gain.gain.setTargetAtTime(0.0001, Math.max(at + attack, endAt - release), release);
  osc.connect(gain);
  gain.connect(options.destination || audio.sfx);
  osc.start(at);
  osc.stop(endAt + release + 0.04);
}

function playNoise(at, duration, options = {}) {
  if (!audio) return;
  const ctx = audio.ctx;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  const attack = options.attack ?? 0.004;
  const release = options.release ?? 0.08;
  const endAt = at + duration;
  source.buffer = audio.noise;
  filter.type = options.filterType || "bandpass";
  filter.frequency.value = options.filter || 1200;
  filter.Q.value = options.q || 0.8;
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, options.gain ?? 0.04), at + attack);
  gain.gain.setTargetAtTime(0.0001, Math.max(at + attack, endAt - release), release);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(options.destination || audio.sfx);
  source.start(at);
  source.stop(endAt + release + 0.04);
}

function makeNoiseBuffer(ctx) {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

// Icons from Game-icons.net, licensed CC BY 3.0.
const ICON_BASE = "https://game-icons.net/icons/ffffff/000000/1x1";

function gameIcon(author, slug) {
  return `${ICON_BASE}/${author}/${slug}.svg`;
}

const weapons = [
  { id: "stick", name: "Walking Stick", icon: "K", level: 1, range: 36, cooldown: 0.66, damage: 1, speed: 0, color: "#d7a45c", type: "melee", starter: true, desc: "A starter branch. Good enough for light defense while you gather crafting parts." },
  { id: "sword", name: "Wooden Sword", icon: "S", level: 1, range: 48, cooldown: 0.48, damage: 2, speed: 0, color: "#eef3df", type: "melee", desc: "A balanced wood-and-stone blade for close-range fighting." },
  { id: "bow", name: "Bow", icon: "B", level: 2, range: 260, cooldown: 0.96, damage: 2, speed: 500, color: "#f0d27a", type: "arrow", desc: "Longer reach with slower arrows and solid damage." },
  { id: "pistol", name: "Pistol", icon: "P", level: 2, range: 215, cooldown: 0.34, damage: 1, speed: 760, color: "#f5f1d2", type: "bullet", desc: "Quick medium-range shots with light damage." },
  { id: "rifle", name: "Rifle", icon: "R", level: 4, range: 360, cooldown: 0.82, damage: 3, speed: 1060, color: "#e5ead8", type: "bullet", desc: "Slow, accurate long-range hits with heavy damage." },
  { id: "laser", name: "Laser", icon: "L", level: 5, range: 420, cooldown: 0.42, damage: 1, speed: 1450, color: "#9fe9ff", type: "laser", desc: "Very long reach with near-instant bright shots." },
  { id: "spear", name: "Spear", icon: "T", level: 2, range: 78, cooldown: 0.68, damage: 2, speed: 0, color: "#e9dfb5", type: "melee", desc: "Extended melee reach for poking from safer spacing." },
  { id: "wand", name: "Wand", icon: "W", level: 3, range: 235, cooldown: 1.08, damage: 2, speed: 390, color: "#cfb2ff", type: "spark", desc: "Slow drifting sparks that reward careful aiming." },
  { id: "hammer", name: "Hammer", icon: "H", level: 4, range: 38, cooldown: 1.2, damage: 4, speed: 0, color: "#d8ddd0", type: "melee", desc: "Very short range, very heavy impact." },
  { id: "blaster", name: "Blaster", icon: "X", level: 5, range: 295, cooldown: 0.56, damage: 2, speed: 820, color: "#ffb7d5", type: "laser", desc: "Punchy mid-long energy shots with steady damage." },
];
let selectedSlot = 0;
const abilityCooldowns = {};
const abilityKeys = ["Q", "W", "E", "R"];

function ability(id, name, icon, cooldown, desc, run) {
  return { id, name, icon, cooldown, desc, run };
}

const abilitySets = {
  stick: [
    ability("stick_q", "Poke", gameIcon("skoll", "drop-weapon"), 1.8, "A quick cautious jab.", () => meleeAbility("Poke", 46, 0.64, 1, "#d7a45c")),
    ability("stick_w", "Brace", gameIcon("lorc", "riot-shield"), 6.2, "Briefly blocks the next incoming hit.", () => guardAbility("Brace", 1400, "#d7a45c")),
    ability("stick_e", "Step", gameIcon("lorc", "sprint"), 5.2, "Hop forward and jab.", () => dashStrikeAbility("Step Jab", 58, 42, 0.58, 1, "#d7a45c")),
    ability("stick_r", "Sweep", gameIcon("delapouite", "dagger-rose"), 8.5, "A modest sweep around you.", () => areaAbility("Stick Sweep", player.x, player.y, 58, 1, "#e9dfb5")),
  ],
  sword: [
    ability("sword_q", "Quick Cut", gameIcon("delapouite", "dagger-rose"), 1.4, "Fast short slash in your aim direction.", () => meleeAbility("Quick Cut", 58, 0.82, 1, "#eef3df")),
    ability("sword_w", "Guard", gameIcon("lorc", "riot-shield"), 5.5, "Briefly blocks the next incoming hit.", () => guardAbility("Guard", 1800, "#eef3df")),
    ability("sword_e", "Lunge", gameIcon("lorc", "sprint"), 4.6, "Dash forward and slash on arrival.", () => dashStrikeAbility("Lunge", 94, 58, 0.74, 1, "#eef3df")),
    ability("sword_r", "Whirl", gameIcon("skoll", "drop-weapon"), 7.2, "A soft spinning slash around you.", () => areaAbility("Whirl", player.x, player.y, 76, 1, "#fff0a6")),
  ],
  bow: [
    ability("bow_q", "Aimed", gameIcon("skoll", "drop-weapon"), 2.4, "A stronger arrow with extra reach.", () => shotAbility("Aimed Shot", "arrow", "#f0d27a", 345, 640, 3)),
    ability("bow_w", "Volley", gameIcon("lorc", "transfuse"), 6.8, "Three arrows fan through the grove.", () => fanAbility("Volley", "arrow", "#f0d27a", 285, 520, 1, 3, 0.34)),
    ability("bow_e", "Bramble", gameIcon("lorc", "vine-leaf"), 7.8, "Pinprick burst at the aimed patch.", () => aimedAreaAbility("Bramble Pin", 260, 70, 1, "#bfe878")),
    ability("bow_r", "Flare", gameIcon("delapouite", "soul"), 9.5, "A bright scout flare that clips a wide patch.", () => aimedAreaAbility("Scout Flare", 330, 105, 1, "#ffe27b")),
  ],
  pistol: [
    ability("pistol_q", "Double", gameIcon("delapouite", "medallist"), 2.2, "Two quick shots with tiny spread.", () => fanAbility("Double Tap", "bullet", "#f5f1d2", 220, 820, 1, 2, 0.12)),
    ability("pistol_w", "Roll", gameIcon("lorc", "sprint"), 5.5, "Hop forward and fire from the hip.", () => dashShotAbility("Roll Shot", 70, "bullet", "#f5f1d2", 210, 780, 1)),
    ability("pistol_e", "Ricochet", gameIcon("lorc", "transfuse"), 7.2, "Instantly tags up to three nearby bots.", () => chainAbility("Ricochet", 260, 3, 1, "#f5f1d2")),
    ability("pistol_r", "Smoke", gameIcon("delapouite", "soul"), 8.5, "Pop smoke, shove close bots, and block briefly.", () => smokeAbility("Smoke Pop", 68, 1, "#d8ddd0")),
  ],
  rifle: [
    ability("rifle_q", "Mark", gameIcon("delapouite", "medallist"), 3.8, "Heavy single shot with long reach.", () => shotAbility("Marked Shot", "bullet", "#e5ead8", 430, 1180, 4)),
    ability("rifle_w", "Pierce", gameIcon("skoll", "drop-weapon"), 7.4, "A straight piercing round.", () => lineAbility("Piercing Round", 420, 18, 2, "#e5ead8")),
    ability("rifle_e", "Focus", gameIcon("delapouite", "soul"), 8.5, "Steady breath, then a brutal hit.", () => lineAbility("Focus Fire", 470, 14, 3, "#fff0a6")),
    ability("rifle_r", "Thunder", gameIcon("lorc", "dragon-head"), 11, "A loud impact at the aimed patch.", () => aimedAreaAbility("Thunder Round", 380, 86, 3, "#f0b66d")),
  ],
  laser: [
    ability("laser_q", "Pulse", gameIcon("delapouite", "soul"), 2.1, "Clean fast energy pulse.", () => shotAbility("Pulse", "laser", "#9fe9ff", 450, 1600, 1)),
    ability("laser_w", "Prism", gameIcon("lorc", "transfuse"), 6.4, "Five tiny beams in a prism fan.", () => fanAbility("Prism Fan", "laser", "#9fe9ff", 380, 1500, 1, 5, 0.62)),
    ability("laser_e", "Blink", gameIcon("lorc", "sprint"), 7.5, "Blink forward and emit a short ray.", () => dashShotAbility("Blink Ray", 98, "laser", "#9fe9ff", 300, 1500, 1)),
    ability("laser_r", "Overbeam", gameIcon("lorc", "dragon-head"), 10.5, "A long instant beam through the aim line.", () => lineAbility("Overbeam", 520, 24, 2, "#9fe9ff")),
  ],
  spear: [
    ability("spear_q", "Jab", gameIcon("skoll", "drop-weapon"), 1.8, "Long narrow poke.", () => meleeAbility("Jab", 98, 0.42, 2, "#e9dfb5")),
    ability("spear_w", "Sweep", gameIcon("delapouite", "dagger-rose"), 5.2, "Wide crescent sweep.", () => meleeAbility("Sweep", 86, 1.55, 1, "#e9dfb5")),
    ability("spear_e", "Vault", gameIcon("lorc", "sprint"), 6.2, "Leap forward with a spear point.", () => dashStrikeAbility("Vault", 112, 88, 0.52, 2, "#e9dfb5")),
    ability("spear_r", "Pin", gameIcon("delapouite", "ringed-tentacle"), 8.4, "Committed thrust with heavy damage.", () => meleeAbility("Pinning Thrust", 118, 0.38, 3, "#fff0a6")),
  ],
  wand: [
    ability("wand_q", "Spark", gameIcon("delapouite", "soul"), 2.3, "A slow bright spark.", () => shotAbility("Spark", "spark", "#cfb2ff", 260, 440, 2)),
    ability("wand_w", "Ring", gameIcon("delapouite", "ringed-tentacle"), 7.2, "Fairy ring around your feet.", () => areaAbility("Fairy Ring", player.x, player.y, 90, 1, "#cfb2ff")),
    ability("wand_e", "Bloom", gameIcon("lorc", "vine-leaf"), 7.8, "Magic bloom at the aimed patch.", () => aimedAreaAbility("Grove Bloom", 260, 82, 2, "#ffd0ee")),
    ability("wand_r", "Comet", gameIcon("lorc", "dragon-head"), 10, "A lazy comet burst.", () => fanAbility("Comet Spray", "spark", "#cfb2ff", 320, 420, 2, 4, 0.48)),
  ],
  hammer: [
    ability("hammer_q", "Bonk", gameIcon("delapouite", "medallist"), 2.6, "Short heavy smack.", () => meleeAbility("Bonk", 54, 0.9, 4, "#d8ddd0")),
    ability("hammer_w", "Quake", gameIcon("lorc", "transfuse"), 7.8, "Ground thump around you.", () => areaAbility("Quake", player.x, player.y, 96, 2, "#d8ddd0")),
    ability("hammer_e", "Shove", gameIcon("lorc", "sprint"), 6.4, "Step in with a punishing shove.", () => dashStrikeAbility("Shove", 70, 62, 1.1, 3, "#d8ddd0")),
    ability("hammer_r", "Crater", gameIcon("lorc", "dragon-head"), 11.5, "Big slow impact at the aimed patch.", () => aimedAreaAbility("Crater Drop", 190, 104, 4, "#f0b66d")),
  ],
  blaster: [
    ability("blaster_q", "Burst", gameIcon("lorc", "transfuse"), 2.8, "Three punchy energy shots.", () => fanAbility("Burst", "laser", "#ffb7d5", 300, 860, 1, 3, 0.2)),
    ability("blaster_w", "Comet", gameIcon("lorc", "dragon-head"), 6.2, "One heavy pink bolt.", () => shotAbility("Comet Bolt", "laser", "#ffb7d5", 360, 780, 3)),
    ability("blaster_e", "Shell", gameIcon("lorc", "riot-shield"), 8.2, "Bubble up and shock close bots.", () => smokeAbility("Shell Pop", 78, 1, "#ffb7d5")),
    ability("blaster_r", "Star", gameIcon("delapouite", "soul"), 10.8, "A wide starburst of bright shots.", () => fanAbility("Starburst", "laser", "#ffb7d5", 330, 840, 2, 7, 0.8)),
  ],
};

const BAG_SLOT_COUNT = 30;
const QUICK_SLOT_COUNT = 9;
const craftCategories = [
  { id: "materials", name: "Materials" },
  { id: "utilities", name: "Utilities" },
  { id: "weapons", name: "Weapons" },
  { id: "armor", name: "Armor" },
];
const itemDefs = [
  { key: "wood", name: "Wood", singular: "wood", plural: "wood", className: "wood", type: "Resource", level: 1, desc: "Building material gathered from roundleaf trees. Used for foundations, walls, planting, and wooden gear." },
  { key: "stone", name: "Stone", singular: "stone", plural: "stone", className: "stone", type: "Resource", level: 2, desc: "Heavy moss stone gathered from rocks. Useful for blades, heads, and sturdy crafted pieces." },
  { key: "flower", name: "Flowers", singular: "flower", plural: "flowers", className: "flower", type: "Resource", level: 1, desc: "Bright grove petals picked near lakes and soft clearings. A cheerful crafting ingredient." },
  { key: "cotton", name: "Cotton", singular: "cotton", plural: "cotton", className: "cotton", type: "Resource", level: 1, desc: "Soft white fiber picked from cotton tufts. Essential for bandages and bowstrings." },
  { key: "wood_block", name: "Wood Block", singular: "wood block", plural: "wood blocks", className: "wood-block", type: "Material", level: 1, desc: "Squared wood refined from raw logs. Used for weapon handles, shields, and sturdy craft frames." },
  { key: "stone_brick", name: "Stone Brick", singular: "stone brick", plural: "stone bricks", className: "stone-brick", type: "Material", level: 2, desc: "Cut stone refined from moss rock. Used for blades, hammer heads, and stronger fittings." },
  { key: "cloth", name: "Cloth", singular: "cloth", plural: "cloth", className: "cloth", type: "Material", level: 1, desc: "Woven cotton cloth. Used for bandages, bowstrings, padding, and travel gear." },
  { key: "petal_extract", name: "Petal Extract", singular: "petal extract", plural: "petal extract", className: "petal-extract", type: "Material", level: 2, desc: "Pressed glowflower essence. Used for utility craft, charms, and energy weapons." },
  { key: "bandage", name: "Bandage", singular: "bandage", plural: "bandages", className: "bandage", type: "Consumable", displayType: "Consumable", level: 1, desc: "A clean cotton wrap with petals tucked in. Use it to restore 2 health.", useLabel: "use bandage" },
  { key: "cloth_cap", name: "Cloth Cap", singular: "cloth cap", plural: "cloth caps", className: "armor-head", type: "Armor", displayType: "Armor", level: 1, slot: "head", hpBonus: 1, desc: "A soft cap that keeps your head out of trouble. Equip for +1 max health.", useLabel: "equip" },
  { key: "padded_vest", name: "Padded Vest", singular: "padded vest", plural: "padded vests", className: "armor-body", type: "Armor", displayType: "Armor", level: 2, slot: "body", hpBonus: 2, desc: "Layered cloth padding over a small wood frame. Equip for +2 max health.", useLabel: "equip" },
  { key: "wooden_shield", name: "Wooden Shield", singular: "wooden shield", plural: "wooden shields", className: "armor-offhand", type: "Armor", displayType: "Armor", level: 2, slot: "offhand", hpBonus: 1, desc: "A blocky offhand guard made from refined wood. Equip for +1 max health.", useLabel: "equip" },
  { key: "trail_boots", name: "Trail Boots", singular: "trail boots", plural: "trail boots", className: "armor-feet", type: "Armor", displayType: "Armor", level: 2, slot: "feet", hpBonus: 1, desc: "Cloth boots with stone-studded soles. Equip for +1 max health.", useLabel: "equip" },
  { key: "petal_charm", name: "Petal Charm", singular: "petal charm", plural: "petal charms", className: "armor-charm", type: "Armor", displayType: "Armor", level: 3, slot: "charm", hpBonus: 1, desc: "A tiny woven charm soaked in glowflower extract. Equip for +1 max health.", useLabel: "equip" },
];

const craftingRecipes = [
  { id: "wood_block", category: "materials", output: { key: "wood_block", count: 1 }, cost: { wood: 3 }, desc: "Refine raw wood into a sturdy block." },
  { id: "stone_brick", category: "materials", output: { key: "stone_brick", count: 1 }, cost: { stone: 3 }, desc: "Cut raw stone into a usable brick." },
  { id: "cloth", category: "materials", output: { key: "cloth", count: 1 }, cost: { cotton: 3 }, desc: "Weave cotton into crafting cloth." },
  { id: "petal_extract", category: "materials", output: { key: "petal_extract", count: 1 }, cost: { flower: 3 }, desc: "Press flowers into bright extract." },
  { id: "bandage", category: "utilities", output: { key: "bandage", count: 1 }, cost: { cloth: 1, petal_extract: 1 }, desc: "Restore 2 health when used." },
  { id: "wooden_sword", category: "weapons", output: { key: "sword", weapon: true }, cost: { wood_block: 2, stone_brick: 1 }, desc: "Reliable close-range weapon." },
  { id: "bow", category: "weapons", output: { key: "bow", weapon: true }, cost: { wood_block: 2, cloth: 1 }, desc: "Long-range arrows." },
  { id: "spear", category: "weapons", output: { key: "spear", weapon: true }, cost: { wood_block: 1, stone_brick: 2 }, desc: "Longer melee reach." },
  { id: "wand", category: "weapons", output: { key: "wand", weapon: true }, cost: { wood_block: 1, stone_brick: 1, petal_extract: 2 }, desc: "Slow drifting sparks." },
  { id: "hammer", category: "weapons", output: { key: "hammer", weapon: true }, cost: { wood_block: 2, stone_brick: 3 }, desc: "Heavy short-range impact." },
  { id: "pistol", category: "weapons", output: { key: "pistol", weapon: true }, cost: { wood_block: 2, stone_brick: 4 }, desc: "Fast medium-range shots." },
  { id: "rifle", category: "weapons", output: { key: "rifle", weapon: true }, cost: { wood_block: 3, stone_brick: 5 }, desc: "Heavy long-range shots." },
  { id: "laser", category: "weapons", output: { key: "laser", weapon: true }, cost: { stone_brick: 5, petal_extract: 3 }, desc: "Very long bright shots." },
  { id: "blaster", category: "weapons", output: { key: "blaster", weapon: true }, cost: { stone_brick: 4, cloth: 2, petal_extract: 3 }, desc: "Punchy energy bursts." },
  { id: "cloth_cap", category: "armor", output: { key: "cloth_cap", armor: true }, cost: { cloth: 1 }, desc: "Head armor. +1 max health." },
  { id: "padded_vest", category: "armor", output: { key: "padded_vest", armor: true }, cost: { cloth: 3, wood_block: 1 }, desc: "Body armor. +2 max health." },
  { id: "wooden_shield", category: "armor", output: { key: "wooden_shield", armor: true }, cost: { wood_block: 2, cloth: 1 }, desc: "Offhand armor. +1 max health." },
  { id: "trail_boots", category: "armor", output: { key: "trail_boots", armor: true }, cost: { cloth: 2, stone_brick: 1 }, desc: "Foot armor. +1 max health." },
  { id: "petal_charm", category: "armor", output: { key: "petal_charm", armor: true }, cost: { cloth: 1, petal_extract: 2 }, desc: "Charm armor. +1 max health." },
];

const buildPieces = [
  { id: "foundation", name: "Foundation", level: 1, cost: 2, w: 48, h: 48, blocks: false, color: "#caa46b" },
  { id: "wall", name: "Wall", level: 1, cost: 3, w: 56, h: 16, blocks: true, color: "#9a6b43" },
  { id: "door", name: "Door", level: 2, cost: 4, w: 50, h: 16, blocks: false, color: "#7c5536" },
  { id: "window", name: "Window", level: 2, cost: 4, w: 56, h: 16, blocks: true, color: "#a8784f" },
];

let ownedWeapons = sanitizeOwnedWeapons(loadJson(WEAPON_KEY, null));
equippedItems = sanitizeEquipment(equippedItems);
const DEFAULT_QUICK_KEYS = ["stick", null, null, null, null, null, null, null, null];
let inventoryLayout = sanitizeInventoryLayout(loadJson(INV_LAYOUT_KEY, []));
let quickSlots = sanitizeQuickSlots(loadJson(QUICKBAR_KEY, DEFAULT_QUICK_KEYS));

const palette = {
  grass: "#84ad72",
  grassDark: "#6f985f",
  grassLight: "#9fbe80",
  water: "#77b9c6",
  waterDeep: "#5fa0b7",
  soil: "#8e7b57",
  shadow: "rgba(34, 47, 31, 0.18)",
  outline: "rgba(44, 56, 36, 0.24)",
};

const player = {
  id: CLIENT_ID,
  name: localStorage.getItem(NAME_KEY) || randomName(),
  x: WORLD.w / 2 + randRange(-90, 90),
  y: WORLD.h / 2 + randRange(-70, 70),
  tx: null,
  ty: null,
  vx: 0,
  vy: 0,
  color: pick(["#f5b7bf", "#f3cf75", "#9fd3ef", "#b9d98b", "#cbb6f2"]),
  skin: pick(["#f0c59b", "#dba577", "#c98b65", "#f4d2ad"]),
  hair: pick(["#5a3929", "#75543d", "#2f2a25", "#c08245", "#e2c06f"]),
  pants: pick(["#516d75", "#6b7351", "#665d7e", "#5b6c54"]),
  facing: 0,
  action: null,
  attackTargetId: null,
  attackCooldown: 0,
  swingUntil: 0,
  hp: 5,
  maxHp: 5,
  hitUntil: 0,
  dazedUntil: 0,
  guardUntil: 0,
  energy: 24,
  maxEnergy: 24,
  sprintHeld: false,
  sprinting: false,
  sprintBlocked: false,
  energyRegenBlockedUntil: 0,
  lastSeen: Date.now(),
};

ui.playerName.textContent = player.name;
if (!localStorage.getItem(NAME_KEY)) openNameModal();
buildQuickbar();
renderAbilityBar();

const lakes = [
  { x: 630, y: 470, rx: 250, ry: 145, a: -0.24 },
  { x: 2710, y: 610, rx: 360, ry: 180, a: 0.18 },
  { x: 1920, y: 1860, rx: 330, ry: 170, a: -0.14 },
  { x: 1050, y: 1960, rx: 210, ry: 116, a: 0.36 },
];

const resources = makeResources();
makeBots();
resize();
syncPlayerStats();
buildBuildPanel();
buildCraftPanel();
renderInventoryPanel();
announce("hello");
requestAnimationFrame(tick);

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => announce("leave"));
window.addEventListener("pointerdown", ensureAudio, { capture: true });
window.addEventListener("keydown", onKeyDown);
window.addEventListener("keydown", ensureAudio, { capture: true });
window.addEventListener("keyup", onKeyUp);
window.addEventListener("blur", () => {
  player.sprintHeld = false;
  stopHeldRightMove();
});

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("mousedown", onMouseDown);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

ui.homeBtn.addEventListener("click", () => {
  playSfx("ui");
  followSelf = true;
  selected = { kind: "player", id: player.id };
});

ui.plantBtn.addEventListener("click", () => plantTree());
ui.buildBtn.addEventListener("click", () => setBuildMode(!buildMode));
ui.craftBtn.addEventListener("click", () => setCraftOpen(!craftOpen));
ui.waveBtn.addEventListener("click", () => {
  playSfx("wave");
  waveUntil = now + 1900;
  addFloat(player.x, player.y - 35, "hello");
  announce("wave", { x: player.x, y: player.y, name: player.name });
});

ui.pauseBtn.addEventListener("click", () => {
  playSfx("ui");
  paused = !paused;
  ui.pauseBtn.textContent = paused ? "▶" : "Ⅱ";
  ui.pauseBtn.title = paused ? "Resume local ambience" : "Pause local ambience";
  ui.pauseBtn.setAttribute("aria-label", paused ? "Resume local ambience" : "Pause local ambience");
  syncAudioState();
});

ui.renameBtn.addEventListener("click", openNameModal);
ui.inventoryClose.addEventListener("click", () => setInventoryOpen(false));
ui.equipmentSlots.addEventListener("click", onEquipmentSlotClick);
ui.inventorySlots.addEventListener("click", onInventorySlotClick);
ui.inventorySlots.addEventListener("dragstart", onInventoryDragStart);
ui.inventorySlots.addEventListener("dragover", onItemDragOver);
ui.inventorySlots.addEventListener("drop", onInventoryDrop);
ui.inventorySlots.addEventListener("dragend", onItemDragEnd);
ui.equipmentSlots.addEventListener("dragover", onEquipmentDragOver);
ui.equipmentSlots.addEventListener("dragleave", onEquipmentDragLeave);
ui.equipmentSlots.addEventListener("drop", onEquipmentDrop);
ui.equipmentSlots.addEventListener("dragend", onItemDragEnd);
ui.quickbar.addEventListener("dragstart", onQuickbarDragStart);
ui.quickbar.addEventListener("dragover", onItemDragOver);
ui.quickbar.addEventListener("drop", onQuickbarDrop);
ui.quickbar.addEventListener("dragend", onItemDragEnd);
ui.itemPopoverClose.addEventListener("click", hideItemPopover);
ui.itemPopoverAction.addEventListener("click", usePopoverItem);
ui.buildClose.addEventListener("click", () => setBuildMode(false));
ui.cancelBuild.addEventListener("click", () => setBuildMode(false));
ui.rotateBuild.addEventListener("click", rotateBuildPiece);
ui.craftClose.addEventListener("click", () => setCraftOpen(false));
ui.craftBack.addEventListener("click", () => showCraftRecipeList());
ui.nameForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const next = ui.nameInput.value.trim().slice(0, 16) || randomName();
  player.name = next;
  localStorage.setItem(NAME_KEY, next);
  ui.playerName.textContent = next;
  ui.nameModal.classList.remove("is-open");
  ui.nameModal.setAttribute("aria-hidden", "true");
  playSfx("complete", 0.72);
  announce("player");
});

if (channel) {
  channel.addEventListener("message", (event) => {
    const message = event.data;
    if (!message || message.id === CLIENT_ID) return;

    if (message.type === "hello") {
      announce("player");
      announce("resource-state", { state: resourceState });
      return;
    }

    if (message.type === "leave") {
      others.delete(message.id);
      return;
    }

    if (message.type === "player") {
      others.set(message.id, { ...message.player, lastSeen: Date.now() });
      return;
    }

    if (message.type === "sfx" && message.sfx) {
      playWorldSfx(message.sfx.name, message.sfx.x, message.sfx.y, message.sfx.intensity, message.sfx.range);
      return;
    }

    if (message.type === "resource-state") {
      Object.assign(resourceState, message.state || {});
      saveResourceState();
      return;
    }

    if (message.type === "resource-update") {
      resourceState[message.resourceId] = message.state;
      saveResourceState();
      const res = resources.find((item) => item.id === message.resourceId);
      if (res) {
        sparkle(res.x, res.y, message.state?.depletedUntil ? "#f2d37a" : "#b9ef91", 12);
        if (message.state?.depletedUntil) playWorldSfx("complete", res.x, res.y, 0.58, 840);
      }
      return;
    }

    if (message.type === "wave") {
      addFloat(message.x, message.y - 35, `${message.name || "Traveler"} waves`);
      playWorldSfx("wave", message.x, message.y, 0.84, 860);
    }
  });
}

function buildQuickbar() {
  renderQuickbar();
}

function renderQuickbar() {
  const nextSlots = sanitizeQuickSlots(quickSlots);
  if (nextSlots.join("|") !== quickSlots.join("|")) {
    quickSlots = nextSlots;
    saveQuickSlots();
  } else {
    quickSlots = nextSlots;
  }
  ui.quickbar.innerHTML = "";
  for (let index = 0; index < QUICK_SLOT_COUNT; index++) {
    const item = itemForKey(quickSlots[index]);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `quick-slot${index === selectedSlot ? " is-active" : ""}${item ? "" : " is-empty"}`;
    button.dataset.slot = String(index);
    button.draggable = Boolean(item);
    button.title = item ? `${index + 1}: ${item.name} (${itemLevelText(item)})` : `${index + 1}: Empty quick slot`;
    button.setAttribute("aria-label", item ? `Select ${item.name}, ${itemLevelText(item)}` : `Empty quick slot ${index + 1}`);
    button.innerHTML = item
      ? `<span class="slot-key">${index + 1}</span><span class="slot-level">${itemLevelShort(item)}</span>${itemIconMarkup(item, "slot-icon")}<span class="slot-name">${item.name}</span>`
      : `<span class="slot-key">${index + 1}</span><span class="slot-empty">+</span>`;
    button.addEventListener("click", () => activateQuickSlot(index));
    ui.quickbar.appendChild(button);
  }
}

function activateQuickSlot(index) {
  const item = itemForKey(quickSlots[index]);
  if (index === selectedSlot && item?.kind === "consumable") {
    useInventoryItem(item.key);
    return;
  }
  selectSlot(index);
}

function buildBuildPanel() {
  ui.buildPieces.innerHTML = "";
  buildPieces.forEach((piece, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "build-piece";
    button.dataset.piece = String(index);
    button.title = `${piece.name}, ${itemLevelText(piece)}: ${piece.cost} wood`;
    button.setAttribute("aria-label", `${piece.name}, ${itemLevelText(piece)}, costs ${piece.cost} wood`);
    button.innerHTML = `<span class="item-level-badge">${itemLevelShort(piece)}</span><strong>${piece.name}</strong><small>${piece.cost} wood</small>`;
    button.addEventListener("click", () => selectBuildPiece(index));
    ui.buildPieces.appendChild(button);
  });
  renderBuildPanel();
}

function renderBuildPanel() {
  ui.buildPieces.querySelectorAll(".build-piece").forEach((button) => {
    const piece = buildPieces[Number(button.dataset.piece)];
    const active = Number(button.dataset.piece) === selectedBuild;
    button.classList.toggle("is-active", active);
    button.disabled = inventory.wood < piece.cost;
    button.style.opacity = inventory.wood < piece.cost ? "0.52" : "1";
  });
  const piece = currentBuildPiece();
  const turn = buildRotation % 2 === 0 ? "horizontal" : "vertical";
  ui.buildHint.textContent = buildMode
    ? `${piece.name}: ${piece.cost} wood. ${turn}. Left-click ground to place.`
    : "Press B to build, R to rotate, Esc to cancel.";
}

function buildCraftPanel() {
  ui.craftCategories.innerHTML = "";
  craftCategories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "craft-tab";
    button.dataset.category = category.id;
    button.textContent = category.name;
    button.title = `${category.name} recipes`;
    button.setAttribute("aria-label", `${category.name} crafting section`);
    button.addEventListener("click", () => selectCraftCategory(category.id));
    ui.craftCategories.appendChild(button);
  });
  renderCraftRecipes();
}

function renderCraftRecipes() {
  if (selectedCraftRecipeIndex !== null) {
    renderCraftDetail();
    return;
  }

  ui.craftTitle.textContent = "Recipes";
  ui.craftBack.hidden = true;
  ui.craftCategories.hidden = false;
  ui.craftRecipes.classList.remove("is-detail");
  ui.craftRecipes.innerHTML = "";
  craftingRecipes.forEach((recipe, index) => {
    if ((recipe.category || "utilities") !== selectedCraftCategory) return;
    const item = recipeOutputItem(recipe);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "craft-recipe";
    button.dataset.recipe = String(index);
    button.addEventListener("click", () => showCraftRecipeDetail(index));
    button.innerHTML = `${itemIconMarkup(item)}
      <span>
        <strong>${item.name}</strong>
        <small>${recipe.desc}</small>
        <span class="craft-costs">${recipeCostCountsMarkup(recipe.cost)}</span>
      </span>
      <span class="craft-status"></span>`;
    ui.craftRecipes.appendChild(button);
  });
  renderCraftPanel();
}

function renderCraftPanel() {
  if (selectedCraftRecipeIndex !== null) {
    const recipe = craftingRecipes[selectedCraftRecipeIndex];
    const detail = ui.craftRecipes.querySelector(".craft-detail");
    if (recipe && detail?.dataset.recipe === String(selectedCraftRecipeIndex)) {
      updateCraftQuantityView(recipe);
    } else {
      renderCraftDetail();
    }
    return;
  }

  ui.craftCategories.querySelectorAll(".craft-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.category === selectedCraftCategory);
  });
  ui.craftRecipes.querySelectorAll(".craft-recipe").forEach((button) => {
    const recipe = craftingRecipes[Number(button.dataset.recipe)];
    const status = craftStatus(recipe);
    const item = recipeOutputItem(recipe);
    button.classList.toggle("is-unavailable", !status.canCraft);
    button.title = `${item.name}: ${recipeCostText(recipe.cost)}${status.reason ? `. ${status.reason}` : ""}`;
    button.setAttribute("aria-label", `Craft ${item.name}. ${recipeCostText(recipe.cost)}${status.reason ? `. ${status.reason}` : ""}`);
    button.querySelector(".craft-status").textContent = status.label;
    button.querySelector(".craft-costs").innerHTML = recipeCostCountsMarkup(recipe.cost);
  });
  const label = craftCategories.find((category) => category.id === selectedCraftCategory)?.name || "Recipes";
  ui.craftSummary.textContent = `${label}: refine raw resources first, then craft utilities, weapons, and armor from those materials.`;
}

function selectCraftCategory(categoryId) {
  if (!craftCategories.some((category) => category.id === categoryId)) return;
  selectedCraftCategory = categoryId;
  selectedCraftRecipeIndex = null;
  selectedCraftQuantity = 1;
  playSfx("ui", 0.55);
  renderCraftRecipes();
}

function showCraftRecipeList() {
  selectedCraftRecipeIndex = null;
  selectedCraftQuantity = 1;
  playSfx("ui", 0.55);
  renderCraftRecipes();
}

function showCraftRecipeDetail(index) {
  if (!craftingRecipes[index]) return;
  selectedCraftRecipeIndex = index;
  selectedCraftQuantity = clampCraftQuantity(craftingRecipes[index], selectedCraftQuantity);
  playSfx("ui", 0.55);
  renderCraftDetail();
}

function renderCraftDetail() {
  const recipe = craftingRecipes[selectedCraftRecipeIndex];
  if (!recipe) {
    selectedCraftRecipeIndex = null;
    renderCraftRecipes();
    return;
  }

  const item = recipeOutputItem(recipe);
  const maxQuantity = maxCraftQuantity(recipe);
  selectedCraftQuantity = clampCraftQuantity(recipe, selectedCraftQuantity);
  const status = craftStatus(recipe, selectedCraftQuantity);
  const outputCount = recipeOutputCount(recipe, selectedCraftQuantity);
  const outputText = outputCount > 1 ? `${outputCount} ${item.plural || item.name}` : item.name;

  ui.craftTitle.textContent = item.name;
  ui.craftBack.hidden = false;
  ui.craftCategories.hidden = true;
  ui.craftRecipes.classList.add("is-detail");
  ui.craftRecipes.innerHTML = `<section class="craft-detail" data-recipe="${selectedCraftRecipeIndex}" aria-label="${item.name} crafting details">
    <div class="craft-detail-icon">${itemIconMarkup(item, "craft-detail-item")}</div>
    <strong>${item.name}</strong>
    <p>${item.desc || recipe.desc}</p>
    <div class="craft-detail-costs" aria-label="Required materials">${recipeCostCountsMarkup(recipe.cost, selectedCraftQuantity)}</div>
    <div class="craft-quantity">
      <label for="craftQuantityRange">Quantity</label>
      <div class="craft-quantity-controls">
        <input id="craftQuantityRange" type="range" min="1" max="${maxQuantity}" value="${selectedCraftQuantity}" ${maxQuantity <= 1 ? "disabled" : ""} />
        <input id="craftQuantityInput" type="text" pattern="[0-9]*" value="${selectedCraftQuantity}" inputmode="numeric" aria-label="Craft quantity" ${maxQuantity <= 1 ? "disabled" : ""} />
      </div>
      <small class="craft-quantity-max">Max ${maxQuantity}</small>
    </div>
    <button class="craft-detail-action" type="button" ${status.canCraft ? "" : "disabled"}>${status.canCraft ? `Craft ${outputText}` : status.label}</button>
  </section>`;

  const range = ui.craftRecipes.querySelector("#craftQuantityRange");
  const input = ui.craftRecipes.querySelector("#craftQuantityInput");
  const craftButton = ui.craftRecipes.querySelector(".craft-detail-action");
  range.addEventListener("input", () => syncCraftQuantity(recipe, range.value));
  input.addEventListener("input", () => syncCraftQuantity(recipe, input.value));
  input.addEventListener("change", () => {
    selectedCraftQuantity = clampCraftQuantity(recipe, Number(input.value) || 1);
    input.value = String(selectedCraftQuantity);
    updateCraftQuantityView(recipe);
  });
  craftButton.addEventListener("click", () => {
    selectedCraftQuantity = clampCraftQuantity(recipe, Number(input.value) || selectedCraftQuantity);
    craftRecipe(selectedCraftRecipeIndex, selectedCraftQuantity);
  });
  ui.craftSummary.textContent = status.canCraft
    ? `Ready: ${recipeCostText(recipe.cost, selectedCraftQuantity)}.`
    : status.reason || `Can't craft ${item.name} yet.`;
}

function syncCraftQuantity(recipe, value) {
  if (value === "") return;
  selectedCraftQuantity = clampCraftQuantity(recipe, Number(value) || 1);
  updateCraftQuantityView(recipe);
}

function updateCraftQuantityView(recipe) {
  selectedCraftQuantity = clampCraftQuantity(recipe, selectedCraftQuantity);
  const item = recipeOutputItem(recipe);
  const maxQuantity = maxCraftQuantity(recipe);
  const status = craftStatus(recipe, selectedCraftQuantity);
  const outputCount = recipeOutputCount(recipe, selectedCraftQuantity);
  const outputText = outputCount > 1 ? `${outputCount} ${item.plural || item.name}` : item.name;
  const range = ui.craftRecipes.querySelector("#craftQuantityRange");
  const input = ui.craftRecipes.querySelector("#craftQuantityInput");
  const costs = ui.craftRecipes.querySelector(".craft-detail-costs");
  const maxLabel = ui.craftRecipes.querySelector(".craft-quantity-max");
  const craftButton = ui.craftRecipes.querySelector(".craft-detail-action");

  if (range) {
    range.max = String(maxQuantity);
    range.disabled = maxQuantity <= 1;
    range.value = String(selectedCraftQuantity);
  }
  if (input) input.disabled = maxQuantity <= 1;
  if (input && document.activeElement !== input) input.value = String(selectedCraftQuantity);
  if (costs) costs.innerHTML = recipeCostCountsMarkup(recipe.cost, selectedCraftQuantity);
  if (maxLabel) maxLabel.textContent = `Max ${maxQuantity}`;
  if (craftButton) {
    craftButton.disabled = !status.canCraft;
    craftButton.textContent = status.canCraft ? `Craft ${outputText}` : status.label;
  }
  ui.craftSummary.textContent = status.canCraft
    ? `Ready: ${recipeCostText(recipe.cost, selectedCraftQuantity)}.`
    : status.reason || `Can't craft ${item.name} yet.`;
}

function setCraftOpen(open, options = {}) {
  if (craftOpen !== open && !options.silent) playSfx("ui", 0.68);
  craftOpen = open;
  ui.craftPanel.classList.toggle("is-open", craftOpen);
  ui.craftPanel.setAttribute("aria-hidden", String(!craftOpen));
  ui.craftBtn.classList.toggle("is-active", craftOpen);
  if (craftOpen) {
    setBuildMode(false);
    setInventoryOpen(false, { silent: true });
    hideItemPopover();
    renderCraftPanel();
    ui.actionLine.textContent = "Crafting open. Cotton makes bandages; wood and stone make sturdy weapons.";
  } else {
    selectedCraftRecipeIndex = null;
    selectedCraftQuantity = 1;
  }
}

function craftRecipe(index, quantity = 1) {
  const recipe = craftingRecipes[index];
  if (!recipe) return;
  const craftQuantity = clampCraftQuantity(recipe, quantity);
  const status = craftStatus(recipe, craftQuantity);
  const item = recipeOutputItem(recipe);
  if (!status.canCraft) {
    playSfx("error");
    ui.actionLine.textContent = status.reason || `Can't craft ${item.name} yet.`;
    renderCraftPanel();
    return;
  }

  spendItems(recipe.cost, craftQuantity);
  if (recipe.output.weapon) {
    ownedWeapons[recipe.output.key] = true;
    saveOwnedWeapons();
    moveInventoryItem(recipe.output.key, firstOpenInventorySlot());
    assignFirstEmptyQuickSlot(recipe.output.key);
  } else if (recipe.output.armor) {
    inventory[recipe.output.key] = 1;
    equipItem(recipe.output.key, { silent: true });
  } else {
    inventory[recipe.output.key] = (inventory[recipe.output.key] || 0) + recipeOutputCount(recipe, craftQuantity);
  }

  saveJson(INV_KEY, inventory);
  inventoryLayout = sanitizeInventoryLayout(inventoryLayout);
  saveInventoryLayout();
  quickSlots = sanitizeQuickSlots(quickSlots);
  saveQuickSlots();
  renderCraftPanel();
  renderQuickbar();
  renderAbilityBar();
  refreshInventoryPanel();
  updateHud();
  sparkle(player.x, player.y - 8, "#ffe27b", 18);
  const craftedText = craftQuantity > 1 ? `crafted ${craftQuantity} ${item.plural || item.name}` : `crafted ${item.name}`;
  addFloat(player.x, player.y - 34, craftedText);
  playSfx("complete");
  ui.actionLine.textContent = craftQuantity > 1 ? `${craftQuantity} ${item.plural || item.name} crafted.` : `${item.name} crafted.`;
}

function recipeOutputItem(recipe) {
  return itemForKey(recipe.output.key, { includeLocked: true }) || itemDefs.find((item) => item.key === recipe.output.key);
}

function craftStatus(recipe, quantity = 1) {
  const item = recipeOutputItem(recipe);
  if (recipe.output.weapon && isWeaponOwned(recipe.output.key)) {
    return { canCraft: false, label: "owned", reason: `${item.name} is already in your bag.` };
  }
  if (recipe.output.armor && isArmorOwned(recipe.output.key)) {
    return { canCraft: false, label: "owned", reason: `${item.name} is already in your bag.` };
  }
  const missing = missingItems(recipe.cost, quantity);
  if (missing.length) {
    return { canCraft: false, label: "missing", reason: `Need ${missing.join(", ")}.` };
  }
  return { canCraft: true, label: "craft", reason: "" };
}

function recipeCostText(cost, quantity = 1) {
  return Object.entries(cost)
    .map(([key, count]) => countLabel(key, count * quantity))
    .join(", ");
}

function recipeCostCountsMarkup(cost, quantity = 1) {
  return Object.entries(cost)
    .map(([key, count]) => {
      const required = count * quantity;
      const available = inventory[key] || 0;
      const item = itemDefs.find((def) => def.key === key);
      const label = item?.name || key;
      return `<span class="craft-cost ${available >= required ? "is-met" : "is-missing"}">${label} ${available}/${required}</span>`;
    })
    .join("");
}

function missingItems(cost, quantity = 1) {
  return Object.entries(cost)
    .filter(([key, count]) => (inventory[key] || 0) < count * quantity)
    .map(([key, count]) => countLabel(key, count * quantity - (inventory[key] || 0)));
}

function spendItems(cost, quantity = 1) {
  for (const [key, count] of Object.entries(cost)) {
    inventory[key] = Math.max(0, (inventory[key] || 0) - count * quantity);
  }
}

function isSingleCraftRecipe(recipe) {
  return Boolean(recipe.output.weapon || recipe.output.armor);
}

function recipeOutputCount(recipe, quantity = 1) {
  return recipe.output.weapon || recipe.output.armor ? 1 : (recipe.output.count || 1) * quantity;
}

function maxCraftQuantity(recipe) {
  if (isSingleCraftRecipe(recipe)) return 1;
  const costs = Object.entries(recipe.cost);
  if (!costs.length) return 1;
  return Math.max(1, Math.min(...costs.map(([key, count]) => Math.floor((inventory[key] || 0) / count))));
}

function clampCraftQuantity(recipe, quantity) {
  return clamp(Math.round(quantity) || 1, 1, maxCraftQuantity(recipe));
}

function firstOpenInventorySlot() {
  inventoryLayout = sanitizeInventoryLayout(inventoryLayout);
  const index = inventoryLayout.indexOf(null);
  return index >= 0 ? index : BAG_SLOT_COUNT - 1;
}

function assignFirstEmptyQuickSlot(key) {
  const index = quickSlots.indexOf(null);
  if (index >= 0) {
    quickSlots[index] = key;
    selectedSlot = index;
  }
  if (itemForKey(key)?.kind === "weapon") {
    equippedItems.weapon = key;
    saveEquipment();
  }
}

function setBuildMode(open) {
  if (buildMode !== open) playSfx("ui", 0.72);
  buildMode = open;
  if (buildMode) setCraftOpen(false, { silent: true });
  ui.buildPanel.classList.toggle("is-open", buildMode);
  ui.buildPanel.setAttribute("aria-hidden", String(!buildMode));
  ui.buildBtn.classList.toggle("is-active", buildMode);
  buildPreview = null;
  if (buildMode) {
    player.attackTargetId = null;
    player.action = null;
    selected = null;
    updateBuildPreview(lastPointerWorld || { x: player.x + 56, y: player.y });
    ui.actionLine.textContent = `Build mode: ${currentBuildPiece().name}. Left-click to place.`;
  } else {
    ui.actionLine.textContent = "Build mode closed.";
  }
  renderBuildPanel();
}

function selectBuildPiece(index) {
  playSfx("ui", 0.68);
  selectedBuild = clamp(index, 0, buildPieces.length - 1);
  setBuildMode(true);
  renderBuildPanel();
}

function currentBuildPiece() {
  return buildPieces[selectedBuild] || buildPieces[0];
}

function rotateBuildPiece() {
  playSfx("ui", 0.68);
  buildRotation = (buildRotation + 1) % 4;
  updateBuildPreview(lastPointerWorld);
  renderBuildPanel();
}

function renderAbilityBar() {
  const abilities = currentAbilities();
  ui.abilitybar.innerHTML = abilities
    .map(
      (item, index) => `<button class="ability-slot" type="button" data-ability="${index}" style="--ability-color: ${currentWeapon().color}; --ability-icon: url('${item.icon}')" title="${abilityKeys[index]}: ${item.name} - ${item.desc}" aria-label="${abilityKeys[index]}, ${item.name}. ${item.desc}">
        <span class="slot-key">${abilityKeys[index]}</span>
        <span class="ability-icon" aria-hidden="true"></span>
        <span class="ability-name">${item.name}</span>
        <span class="ability-cooldown"></span>
      </button>`,
    )
    .join("");
  ui.abilitybar.querySelectorAll(".ability-slot").forEach((button) => {
    button.addEventListener("click", () => useAbility(Number(button.dataset.ability)));
  });
  updateAbilityBar();
}

function updateAbilityBar() {
  const abilities = currentAbilities();
  ui.abilitybar.querySelectorAll(".ability-slot").forEach((button) => {
    const abilityItem = abilities[Number(button.dataset.ability)];
    const remaining = Math.max(0, (abilityCooldowns[abilityItem.id] || 0) - now);
    const pct = remaining > 0 ? clamp(remaining / (abilityItem.cooldown * 1000), 0, 1) : 0;
    button.style.setProperty("--cooldown-scale", pct.toFixed(3));
    button.classList.toggle("is-cooling", remaining > 0);
    button.classList.toggle("is-ready", remaining <= 0);
    const label = button.querySelector(".ability-cooldown");
    label.textContent = remaining > 0 ? `${Math.ceil(remaining / 1000)}` : "";
  });
}

function setInventoryOpen(open, options = {}) {
  const isOpen = ui.inventoryPanel.classList.contains("is-open");
  if (isOpen !== open && !options.silent) playSfx("ui", 0.68);
  if (open) setCraftOpen(false, { silent: true });
  ui.inventoryPanel.classList.toggle("is-open", open);
  ui.inventoryPanel.setAttribute("aria-hidden", String(!open));
  if (open) renderInventoryPanel();
  else hideItemPopover();
}

function renderInventoryPanel() {
  renderEquipmentSlots();
  renderBagSlots();
  renderWeaponSummary();
  const used = inventoryItems().filter(Boolean).length;
  ui.bagSpace.textContent = `${used}/${BAG_SLOT_COUNT} slots`;
  ui.inventorySummary.textContent = "Drag items to sort, assign quick slots, or equip gear.";
}

function refreshInventoryPanel() {
  if (ui.inventoryPanel.classList.contains("is-open") && !ui.itemPopover.classList.contains("is-open") && !dragPayload) {
    renderInventoryPanel();
  }
}

function selectSlot(index) {
  playSfx("ui", 0.58);
  selectedSlot = clamp(index, 0, QUICK_SLOT_COUNT - 1);
  const item = currentQuickItem();
  if (item?.kind === "weapon") {
    equippedItems.weapon = item.key;
    saveEquipment();
  }
  renderQuickbar();
  renderAbilityBar();
  renderWeaponSummary();
  refreshInventoryPanel();
  const weapon = currentWeapon();
  if (!item) {
    ui.actionLine.textContent = `Quick slot ${selectedSlot + 1} is empty. Drag an inventory item here.`;
  } else if (item.kind === "weapon") {
    ui.actionLine.textContent = `${weapon.name} ${itemLevelText(weapon)} equipped. Q/W/E/R abilities ready.`;
  } else {
    ui.actionLine.textContent = `${item.name} ${itemLevelText(item)} selected. Combat still uses ${weapon.name}.`;
  }
}

function currentQuickItem() {
  return itemForKey(quickSlots[selectedSlot]);
}

function currentWeapon() {
  const equippedWeapon = itemForKey(equippedItems.weapon);
  if (equippedWeapon?.kind === "weapon") return equippedWeapon;
  const fallbackKey = quickSlots.find((key) => itemForKey(key)?.kind === "weapon");
  return itemForKey(fallbackKey) || itemForKey("stick") || itemForKey("stick", { includeLocked: true }) || weapons[0];
}

function currentAbilities() {
  return abilitySets[currentWeapon().id] || abilitySets.sword;
}

function weaponAttackRate(weapon) {
  return Math.round(10 / weapon.cooldown) / 10;
}

function itemLevel(item) {
  return Math.max(1, Math.floor(item?.level || 1));
}

function itemLevelText(item) {
  return `Level ${itemLevel(item)}`;
}

function itemLevelShort(item) {
  return `L${itemLevel(item)}`;
}

function itemForKey(key, options = {}) {
  if (!key) return null;
  const weapon = weapons.find((item) => item.id === key);
  if (weapon) {
    if (!options.includeLocked && !isWeaponOwned(weapon.id)) return null;
    return { ...weapon, key: weapon.id, kind: "weapon", className: "weapon", displayType: "Weapon", count: 1 };
  }
  const def = itemDefs.find((item) => item.key === key);
  if (!def || (!options.includeLocked && (inventory[def.key] || 0) <= 0)) return null;
  const kind = def.type === "Consumable" ? "consumable" : def.type === "Armor" ? "armor" : "resource";
  return { ...def, kind, count: inventory[def.key] || 0 };
}

function ownedInventoryKeys() {
  return [
    ...weapons.filter((weapon) => isWeaponOwned(weapon.id)).map((weapon) => weapon.id),
    ...itemDefs.filter((item) => (inventory[item.key] || 0) > 0).map((item) => item.key),
  ];
}

function equippedInventoryKeys() {
  return [currentWeapon().key, ...Object.values(equippedItems)].filter(Boolean);
}

function sanitizeEquipment(source = {}) {
  const next = { head: null, weapon: null, body: null, offhand: null, feet: null, charm: null };
  for (const slotId of Object.keys(next)) {
    const key = typeof source?.[slotId] === "string" ? source[slotId] : null;
    if (slotId === "weapon") {
      next.weapon = key && isWeaponOwned(key) ? key : null;
      continue;
    }
    const armor = itemDefs.find((item) => item.key === key && item.type === "Armor" && item.slot === slotId);
    next[slotId] = armor && (inventory[armor.key] || 0) > 0 ? armor.key : null;
  }
  return next;
}

function sanitizeInventoryLayout(layout) {
  const owned = ownedInventoryKeys();
  const seen = new Set();
  const slots = Array.from({ length: BAG_SLOT_COUNT }, (_, index) => {
    const key = Array.isArray(layout) ? layout[index] : null;
    if (!key || !owned.includes(key) || seen.has(key)) return null;
    seen.add(key);
    return key;
  });
  for (const key of owned) {
    if (seen.has(key)) continue;
    const emptyIndex = slots.indexOf(null);
    if (emptyIndex < 0) break;
    slots[emptyIndex] = key;
    seen.add(key);
  }
  return slots;
}

function sanitizeQuickSlots(slots) {
  const owned = ownedInventoryKeys();
  const source = Array.isArray(slots) ? slots : DEFAULT_QUICK_KEYS;
  const next = Array.from({ length: QUICK_SLOT_COUNT }, (_, index) => {
    const key = source[index] ?? null;
    return key && owned.includes(key) ? key : null;
  });
  const hasWeapon = next.some((key) => itemForKey(key)?.kind === "weapon");
  if (!hasWeapon && isWeaponOwned("stick")) {
    const index = next.indexOf(null);
    next[index >= 0 ? index : 0] = "stick";
  }
  return next;
}

function sanitizeOwnedWeapons(source) {
  const next = {};
  for (const weapon of weapons) {
    if (weapon.starter || source?.[weapon.id]) next[weapon.id] = true;
  }
  return next;
}

function isWeaponOwned(id) {
  return Boolean(ownedWeapons?.[id] || weapons.find((weapon) => weapon.id === id)?.starter);
}

function isArmorOwned(key) {
  return Boolean((inventory[key] || 0) > 0 || Object.values(equippedItems).includes(key));
}

function syncPlayerStats() {
  const baseMaxHp = 5;
  const bonus = Object.values(equippedItems).reduce((total, key) => {
    const item = itemForKey(key);
    return total + (item?.hpBonus || 0);
  }, 0);
  const nextMax = baseMaxHp + bonus;
  if (player.maxHp !== nextMax) {
    const missingHealth = Math.max(0, player.maxHp - player.hp);
    player.maxHp = nextMax;
    player.hp = clamp(player.maxHp - missingHealth, 1, player.maxHp);
  }
}

function saveInventoryLayout() {
  saveJson(INV_LAYOUT_KEY, inventoryLayout);
}

function saveQuickSlots() {
  saveJson(QUICKBAR_KEY, quickSlots);
}

function saveEquipment() {
  const next = sanitizeEquipment(equippedItems);
  for (const [slotId, key] of Object.entries(next)) {
    if (key && !canEquipItemInSlot(itemForKey(key), slotId)) next[slotId] = null;
  }
  equippedItems = next;
  saveJson(EQUIPMENT_KEY, equippedItems);
}

function saveOwnedWeapons() {
  ownedWeapons = sanitizeOwnedWeapons(ownedWeapons);
  saveJson(WEAPON_KEY, ownedWeapons);
}

function itemIconMarkup(item, extraClass = "") {
  const classes = extraClass ? ` ${extraClass}` : "";
  if (item.kind === "weapon") {
    return `<span class="weapon-prop weapon-${item.id}${classes}" style="--item-color: ${item.color}" aria-hidden="true"></span>`;
  }
  return `<span class="item-icon ${item.className}${classes}" aria-hidden="true"></span>`;
}

function renderEquipmentSlots() {
  const weapon = currentWeapon();
  const slotViews = [
    { id: "head", label: "head", area: "head", item: itemForKey(equippedItems.head) },
    { id: "weapon", label: "weapon", area: "weapon", item: weapon },
    { id: "body", label: "body", area: "body", item: itemForKey(equippedItems.body) },
    { id: "offhand", label: "offhand", area: "offhand", item: itemForKey(equippedItems.offhand) },
    { id: "feet", label: "feet", area: "feet", item: itemForKey(equippedItems.feet) },
    { id: "charm", label: "charm", area: "charm", item: itemForKey(equippedItems.charm) },
  ];

  ui.equipmentSlots.innerHTML = slotViews
    .map((slot) => {
      if (slot.item) {
        return `<button class="equipment-slot is-filled equipment-${slot.area}" type="button" data-equip-slot="${slot.id}" data-item="${slot.item.key}" title="${slot.item.name}, ${itemLevelText(slot.item)}" aria-label="${slot.item.name}, ${itemLevelText(slot.item)}">
          <span class="equipment-label">${slot.label}</span>
          <span class="item-level-badge">${itemLevelShort(slot.item)}</span>
          ${itemIconMarkup(slot.item, "equipment-weapon-icon")}
          <strong>${slot.item.name}</strong>
        </button>`;
      }
      return `<div class="equipment-slot is-empty equipment-${slot.area}" data-equip-slot="${slot.id}" title="Empty ${slot.label} slot" aria-label="Empty ${slot.label} slot">
        <span class="equipment-label">${slot.label}</span>
      </div>`;
    })
    .join("");
}

function renderBagSlots() {
  const items = inventoryItems();
  const slots = [];
  for (let i = 0; i < BAG_SLOT_COUNT; i++) {
    const item = items[i];
    if (item) {
      const stackText = item.kind === "resource" || item.kind === "consumable" ? `, stack of ${item.count}` : "";
      slots.push(`<button class="bag-slot is-filled ${item.className}" type="button" draggable="true" data-slot="${i}" data-item="${item.key}" title="${item.name}, ${itemLevelText(item)}${stackText}" aria-label="${item.name}, ${itemLevelText(item)}${stackText}">
        <span class="item-level-badge">${itemLevelShort(item)}</span>
        ${itemIconMarkup(item)}
        ${item.kind === "resource" || item.kind === "consumable" ? `<strong>${item.count}</strong>` : ""}
      </button>`);
    } else {
      slots.push(`<div class="bag-slot is-empty" data-slot="${i}" aria-label="Empty inventory slot"></div>`);
    }
  }
  ui.inventorySlots.innerHTML = slots.join("");
}

function onInventorySlotClick(event) {
  const slot = event.target.closest(".bag-slot.is-filled");
  if (!slot) return;
  const item = itemForKey(slot.dataset.item);
  if (!item) return;
  showItemPopover(item);
}

function onEquipmentSlotClick(event) {
  const slot = event.target.closest(".equipment-slot.is-filled");
  if (!slot) return;
  const item = itemForKey(slot.dataset.item);
  if (!item) return;
  showItemPopover(item);
}

function onInventoryDragStart(event) {
  const slot = event.target.closest(".bag-slot.is-filled");
  if (!slot) return;
  hideItemPopover();
  dragPayload = { source: "inventory", key: slot.dataset.item, index: Number(slot.dataset.slot) };
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData("text/plain", JSON.stringify(dragPayload));
  slot.classList.add("is-dragging");
}

function onQuickbarDragStart(event) {
  const slot = event.target.closest(".quick-slot");
  if (!slot) return;
  const index = Number(slot.dataset.slot);
  const key = quickSlots[index];
  if (!key) return;
  dragPayload = { source: "quickbar", key, index };
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData("text/plain", JSON.stringify(dragPayload));
  slot.classList.add("is-dragging");
}

function onItemDragOver(event) {
  const target = event.target.closest("[data-slot]");
  if (!target || !dragPayload) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = target.classList.contains("quick-slot") ? "copy" : "move";
}

function onEquipmentDragOver(event) {
  const slot = event.target.closest("[data-equip-slot]");
  const item = itemForKey(dragPayload?.key);
  if (!slot || !item || !canEquipItemInSlot(item, slot.dataset.equipSlot)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  ui.equipmentSlots.querySelectorAll(".is-drop-target").forEach((target) => target.classList.remove("is-drop-target"));
  slot.classList.add("is-drop-target");
}

function onEquipmentDragLeave(event) {
  if (ui.equipmentSlots.contains(event.relatedTarget)) return;
  clearEquipmentDropTarget();
}

function onInventoryDrop(event) {
  const slot = event.target.closest(".bag-slot");
  const payload = readDragPayload(event);
  if (!slot || !payload?.key) return;
  event.preventDefault();
  moveInventoryItem(payload.key, Number(slot.dataset.slot));
  playSfx("ui", 0.66);
  renderInventoryPanel();
  renderQuickbar();
}

function onEquipmentDrop(event) {
  const slot = event.target.closest("[data-equip-slot]");
  const payload = readDragPayload(event);
  const item = itemForKey(payload?.key);
  if (!slot || !item || !canEquipItemInSlot(item, slot.dataset.equipSlot)) return;
  event.preventDefault();
  clearEquipmentDropTarget();
  equipItem(payload.key);
}

function onQuickbarDrop(event) {
  const slot = event.target.closest(".quick-slot");
  const payload = readDragPayload(event);
  if (!slot || !payload?.key || !itemForKey(payload.key)) return;
  event.preventDefault();
  const targetIndex = Number(slot.dataset.slot);
  if (payload.source === "quickbar" && payload.index !== targetIndex) {
    const displaced = quickSlots[targetIndex] || null;
    quickSlots[targetIndex] = payload.key;
    quickSlots[payload.index] = displaced;
  } else {
    quickSlots[targetIndex] = payload.key;
  }
  selectedSlot = targetIndex;
  quickSlots = sanitizeQuickSlots(quickSlots);
  if (itemForKey(payload.key)?.kind === "weapon") {
    equippedItems.weapon = payload.key;
    saveEquipment();
  }
  saveQuickSlots();
  playSfx("ui", 0.72);
  renderQuickbar();
  renderAbilityBar();
  renderWeaponSummary();
  ui.actionLine.textContent = `${itemForKey(payload.key).name} assigned to quick slot ${targetIndex + 1}.`;
}

function onItemDragEnd() {
  dragPayload = null;
  clearEquipmentDropTarget();
  ui.inventorySlots.querySelectorAll(".is-dragging").forEach((item) => item.classList.remove("is-dragging"));
  ui.quickbar.querySelectorAll(".is-dragging").forEach((item) => item.classList.remove("is-dragging"));
}

function clearEquipmentDropTarget() {
  ui.equipmentSlots.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
}

function readDragPayload(event) {
  try {
    return JSON.parse(event.dataTransfer.getData("text/plain")) || dragPayload;
  } catch {
    return dragPayload;
  }
}

function moveInventoryItem(key, targetIndex) {
  inventoryLayout = sanitizeInventoryLayout(inventoryLayout);
  const fromIndex = inventoryLayout.indexOf(key);
  if (fromIndex < 0) return;
  const next = [...inventoryLayout];
  const toIndex = clamp(targetIndex, 0, BAG_SLOT_COUNT - 1);
  if (fromIndex === toIndex) return;
  const displaced = next[toIndex] || null;
  next[toIndex] = key;
  next[fromIndex] = displaced;
  inventoryLayout = sanitizeInventoryLayout(next);
  saveInventoryLayout();
}

function equipmentSlotForItem(item) {
  if (item?.kind === "weapon") return "weapon";
  return item?.slot || null;
}

function isEquippableItem(item) {
  return Boolean(equipmentSlotForItem(item));
}

function canEquipItemInSlot(item, slotId) {
  return Boolean(slotId && equipmentSlotForItem(item) === slotId);
}

function isEquippedItem(item) {
  if (!item) return false;
  if (item.kind === "weapon") return currentWeapon().key === item.key;
  return equippedItems[equipmentSlotForItem(item)] === item.key;
}

function equipItem(key, options = {}) {
  const item = itemForKey(key);
  const slotId = equipmentSlotForItem(item);
  if (!item || !slotId) {
    playSfx("error");
    return false;
  }

  equippedItems[slotId] = item.key;
  saveEquipment();

  if (item.kind === "weapon") {
    const existingIndex = quickSlots.indexOf(item.key);
    if (existingIndex >= 0) {
      selectedSlot = existingIndex;
    }
  }

  syncPlayerStats();
  if (!options.silent) playSfx("complete", 0.68);
  hideItemPopover();
  renderQuickbar();
  renderAbilityBar();
  renderInventoryPanel();
  updateHud();
  if (!options.silent) ui.actionLine.textContent = `${item.name} equipped. Health ${player.hp}/${player.maxHp}.`;
  return true;
}

function showItemPopover(item) {
  playSfx("ui", 0.54);
  if (item.kind === "weapon") {
    ui.itemPopoverIcon.className = `weapon-prop weapon-${item.id} item-popover-weapon`;
    ui.itemPopoverIcon.style.setProperty("--item-color", item.color);
    ui.itemPopoverIcon.textContent = "";
  } else {
    ui.itemPopoverIcon.className = `item-icon ${item.className}`;
    ui.itemPopoverIcon.style.removeProperty("--item-color");
    ui.itemPopoverIcon.textContent = "";
  }
  ui.itemPopoverName.textContent = item.name;
  ui.itemPopoverType.textContent = `${item.displayType || item.type} - ${itemLevelText(item)}`;
  ui.itemPopoverDesc.textContent = item.desc;
  ui.itemPopoverLevel.textContent = itemLevel(item);
  ui.itemPopoverCount.textContent = item.kind === "resource" || item.kind === "consumable" ? item.count : "1";
  const isEquippable = isEquippableItem(item);
  const equipped = isEquippedItem(item);
  ui.itemPopoverAction.hidden = item.kind !== "consumable" && !isEquippable;
  ui.itemPopoverAction.dataset.item = item.key;
  ui.itemPopoverAction.dataset.action = isEquippable ? "equip" : "use";
  ui.itemPopoverAction.disabled = equipped;
  ui.itemPopoverAction.textContent = isEquippable ? (equipped ? "equipped" : "equip") : item.useLabel || "use";
  ui.itemPopover.classList.add("is-open");
  ui.itemPopover.setAttribute("aria-hidden", "false");
}

function hideItemPopover() {
  ui.itemPopover.classList.remove("is-open");
  ui.itemPopover.setAttribute("aria-hidden", "true");
  ui.itemPopoverAction.hidden = true;
  ui.itemPopoverAction.disabled = false;
  ui.itemPopoverAction.dataset.item = "";
  ui.itemPopoverAction.dataset.action = "";
}

function usePopoverItem() {
  const key = ui.itemPopoverAction.dataset.item;
  if (!key) return;
  if (ui.itemPopoverAction.dataset.action === "equip") {
    equipItem(key);
    return;
  }
  useInventoryItem(key);
}

function useInventoryItem(key) {
  const item = itemForKey(key);
  if (!item || item.kind !== "consumable") return false;
  if (key === "bandage") {
    if (player.hp >= player.maxHp) {
      playSfx("error");
      ui.actionLine.textContent = "You are already at full health.";
      return false;
    }
    inventory.bandage = Math.max(0, (inventory.bandage || 0) - 1);
    player.hp = Math.min(player.maxHp, player.hp + 2);
    saveJson(INV_KEY, inventory);
    inventoryLayout = sanitizeInventoryLayout(inventoryLayout);
    saveInventoryLayout();
    quickSlots = sanitizeQuickSlots(quickSlots);
    saveQuickSlots();
    hideItemPopover();
    renderQuickbar();
    renderAbilityBar();
    refreshInventoryPanel();
    updateHud();
    sparkle(player.x, player.y - 10, "#fff4c8", 18);
    addFloat(player.x, player.y - 38, "+2 hp");
    playSfx("complete", 0.72);
    ui.actionLine.textContent = `Bandage used. Health ${player.hp}/${player.maxHp}.`;
    return true;
  }
  return false;
}

function inventoryItems() {
  const nextLayout = sanitizeInventoryLayout(inventoryLayout);
  if (nextLayout.join("|") !== inventoryLayout.join("|")) {
    inventoryLayout = nextLayout;
    saveInventoryLayout();
  } else {
    inventoryLayout = nextLayout;
  }
  const equipped = new Set(equippedInventoryKeys());
  return inventoryLayout.map((key) => (equipped.has(key) ? null : itemForKey(key)));
}

function renderWeaponSummary() {
  // The dedicated weapon summary panel was removed; weapon state is shown in the body equipment layout.
}

function onKeyDown(event) {
  if (event.target?.tagName === "INPUT") return;
  if (event.key === "Shift") {
    player.sprintHeld = true;
    return;
  }
  if (event.key.toLowerCase() === "b") {
    event.preventDefault();
    setBuildMode(!buildMode);
    return;
  }
  if (event.key.toLowerCase() === "c") {
    event.preventDefault();
    setCraftOpen(!craftOpen);
    return;
  }
  if (event.key.toLowerCase() === "r" && buildMode) {
    event.preventDefault();
    rotateBuildPiece();
    return;
  }
  if (event.key.toLowerCase() === "i") {
    event.preventDefault();
    hideItemPopover();
    setInventoryOpen(!ui.inventoryPanel.classList.contains("is-open"));
    return;
  }
  if (event.key === "Escape" && ui.itemPopover.classList.contains("is-open")) {
    event.preventDefault();
    hideItemPopover();
    return;
  }
  if (event.key === "Escape" && (ui.inventoryPanel.classList.contains("is-open") || buildMode || craftOpen)) {
    event.preventDefault();
    setInventoryOpen(false);
    setBuildMode(false);
    setCraftOpen(false);
    return;
  }
  const key = Number(event.key);
  if (key >= 1 && key <= 9) {
    event.preventDefault();
    if (key - 1 === selectedSlot && currentQuickItem()?.kind === "consumable") {
      useInventoryItem(currentQuickItem().key);
      return;
    }
    selectSlot(key - 1);
    return;
  }
  const abilityIndex = abilityKeys.findIndex((item) => item.toLowerCase() === event.key.toLowerCase());
  if (abilityIndex >= 0 && !buildMode && !craftOpen) {
    event.preventDefault();
    useAbility(abilityIndex);
  }
}

function onKeyUp(event) {
  if (event.key === "Shift") {
    player.sprintHeld = false;
  }
}

function tick(time) {
  now = time;
  const dt = Math.min(0.04, (now - last) / 1000 || 0.016);
  last = now;

  if (!paused) {
    update(dt);
  }
  draw();
  requestAnimationFrame(tick);
}

function update(dt) {
  updateHeldRightMove();
  updateResources();
  updatePlayerCombat(dt);
  updateActor(player, dt, true);
  updatePlayerEnergy(dt);
  updateBots(dt);
  updateProjectiles(dt);
  updateParticles(dt);
  updateRemotePlayers();
  updateCamera(dt);
  updateHud();

  if (now % 120 < 18) announce("player");
}

function updateResources() {
  let changed = false;
  for (const res of resources) {
    const state = resourceState[res.id];
    if (state?.depletedUntil && state.depletedUntil <= Date.now()) {
      delete resourceState[res.id];
      sparkle(res.x, res.y, "#c9f28c", 18);
      changed = true;
    } else if (state && resourceDepletedNodes(res) >= resourceNodeCount(res) && !state.depletedUntil) {
      resourceState[res.id] = { ...state, depletedUntil: Date.now() + respawnMs(res) };
      changed = true;
    }
  }
  if (changed) saveResourceState();
}

function updatePlayerCombat(dt) {
  player.attackCooldown = Math.max(0, player.attackCooldown - dt);
  if (player.dazedUntil > now) {
    player.attackTargetId = null;
    player.tx = null;
    player.ty = null;
    return;
  }
  if (player.hp <= 0 && player.dazedUntil <= now) {
    player.hp = player.maxHp;
    sparkle(player.x, player.y, "#c9f28c", 20);
    ui.actionLine.textContent = "Back on your feet.";
  }

  const target = bots.find((bot) => bot.id === player.attackTargetId);
  if (!target || isBotDefeated(target)) {
    player.attackTargetId = null;
    return;
  }

  const weapon = currentWeapon();
  const d = dist(player.x, player.y, target.x, target.y);
  player.facing = Math.atan2(target.y - player.y, target.x - player.x);
  if (d > weapon.range) {
    player.attackTargetId = null;
    return;
  }

  player.tx = null;
  player.ty = null;
  if (player.attackCooldown <= 0) {
    useWeaponOnBot(target, weapon);
  }
}

function updateActor(actor, dt, isPlayer = false) {
  if (isPlayer) actor.sprinting = false;

  if (actor.action) {
    const res = resources.find((item) => item.id === actor.action.resourceId);
    if (!res || isDepleted(res)) {
      actor.action = null;
    } else {
      const nextNode = resourceNextNodeIndex(res);
      if (actor.action.nodeIndex == null) actor.action.nodeIndex = nextNode;
      if (actor.action.nodeIndex !== nextNode) {
        const multiplier = actor.isBot ? 1.35 : 1;
        actor.action = createGatherAction(res, multiplier);
      }
      const near = dist(actor.x, actor.y, res.x, res.y) <= resourceInteractionRadius(res);
      if (!near) {
        actor.action = null;
      } else {
        actor.action.elapsed += dt;
        actor.facing = Math.atan2(res.y - actor.y, res.x - actor.x);
        updateGatherAnimation(actor, res, dt);
        if (Math.random() < dt * 8) {
          const color = gatherColor(res);
          sparkle(res.x + randRange(-res.r, res.r), res.y + randRange(-res.r, res.r), color, 1);
        }
        if (actor.action.elapsed >= actor.action.duration) {
          completeGather(actor, res, isPlayer);
        }
      }
    }
  }

  if (!actor.action && actor.tx != null && actor.ty != null) {
    const dx = actor.tx - actor.x;
    const dy = actor.ty - actor.y;
    const d = Math.hypot(dx, dy);
    if (d < 5) {
      actor.tx = null;
      actor.ty = null;
      actor.vx *= 0.2;
      actor.vy *= 0.2;
    } else {
      const speed = actorMoveSpeed(actor, dt, isPlayer);
      const step = Math.min(d, speed * dt);
      const nx = actor.x + (dx / d) * step;
      const ny = actor.y + (dy / d) * step;
      const nudged = resolveBlockedMove(actor.x, actor.y, nx, ny, 12);
      actor.x = nudged.x;
      actor.y = nudged.y;
      actor.vx = (dx / d) * speed;
      actor.vy = (dy / d) * speed;
      actor.facing = Math.atan2(dy, dx);
      if (Math.abs(nudged.x - nx) + Math.abs(nudged.y - ny) > 6) {
        actor.tx = null;
        actor.ty = null;
      }
    }
  } else {
    actor.vx *= 0.86;
    actor.vy *= 0.86;
  }

  actor.x = clamp(actor.x, 42, WORLD.w - 42);
  actor.y = clamp(actor.y, 42, WORLD.h - 42);
}

function actorMoveSpeed(actor, dt, isPlayer) {
  const baseSpeed = actor.speed || PLAYER_BASE_SPEED;
  if (!isPlayer || !canPlayerSprint()) return baseSpeed;

  actor.sprinting = true;
  actor.sprintBlocked = false;
  const energyBeforeSprint = actor.energy;
  actor.energy = clamp(actor.energy - PLAYER_SPRINT_DRAIN * dt, 0, actor.maxEnergy);
  if (energyBeforeSprint > 0 && actor.energy <= 0) {
    actor.sprintBlocked = true;
    actor.energyRegenBlockedUntil = now + PLAYER_ENERGY_DEPLETED_REGEN_DELAY;
    ui.actionLine.textContent = "Energy spent. Release Shift and catch your breath.";
  }
  if (Math.random() < dt * 10) {
    particles.push({
      x: actor.x - Math.cos(actor.facing) * randRange(8, 18),
      y: actor.y - Math.sin(actor.facing) * randRange(8, 18) + randRange(4, 12),
      vx: randRange(-8, 8),
      vy: randRange(-5, 6),
      r: randRange(1.2, 2.4),
      color: "rgba(255, 226, 123, 0.42)",
      life: randRange(0.32, 0.58),
      max: 0.58,
      gravity: 10,
    });
  }
  return baseSpeed * PLAYER_SPRINT_MULTIPLIER;
}

function canPlayerSprint() {
  if (!player.sprintHeld || player.action || player.dazedUntil > now) return false;
  if (player.energy <= 0) {
    if (!player.sprintBlocked) {
      player.energyRegenBlockedUntil = now + PLAYER_ENERGY_DEPLETED_REGEN_DELAY;
    }
    player.sprintBlocked = true;
    return false;
  }
  if (player.sprintBlocked && player.energy < PLAYER_SPRINT_RESUME_ENERGY) return false;
  return true;
}

function updatePlayerEnergy(dt) {
  if (player.sprinting) return;
  if (player.sprintBlocked && player.sprintHeld) return;
  if (now < player.energyRegenBlockedUntil) return;

  player.energy = clamp(player.energy + PLAYER_ENERGY_REGEN * dt, 0, player.maxEnergy);
  if (player.energy >= PLAYER_SPRINT_RESUME_ENERGY) player.sprintBlocked = false;
}

function updateBots(dt) {
  for (const bot of bots) {
    if (isBotDefeated(bot)) {
      bot.action = null;
      bot.tx = null;
      bot.ty = null;
      bot.vx *= 0.8;
      bot.vy *= 0.8;
      if (bot.defeatedUntil <= now) {
        respawnBot(bot);
      }
      continue;
    }

    bot.attackCooldown = Math.max(0, (bot.attackCooldown || 0) - dt);
    if (bot.aggroUntil > now) {
      updateBotCombat(bot);
      updateActor(bot, dt, false);
      continue;
    }

    bot.mood += dt;
    if (!bot.action && (bot.tx == null || Math.random() < dt * 0.08)) {
      const nearby = nearestResource(bot.x, bot.y, 330, (res) => !isDepleted(res));
      if (nearby && Math.random() < 0.72) {
        const p = pointNear(nearby.x, nearby.y, nearby.r + 25);
        bot.tx = p.x;
        bot.ty = p.y;
        bot.intent = nearby.id;
      } else {
        bot.tx = clamp(bot.x + randRange(-360, 360), 60, WORLD.w - 60);
        bot.ty = clamp(bot.y + randRange(-300, 300), 60, WORLD.h - 60);
      }
    }
    updateActor(bot, dt, false);
    if (!bot.action && bot.intent) {
      const res = resources.find((item) => item.id === bot.intent);
      if (res && !isDepleted(res) && dist(bot.x, bot.y, res.x, res.y) <= res.r + 33) {
        bot.action = createGatherAction(res, 1.35);
      }
    }
  }
}

function updateBotCombat(bot) {
  const d = dist(bot.x, bot.y, player.x, player.y);
  bot.action = null;
  bot.intent = null;
  bot.facing = Math.atan2(player.y - bot.y, player.x - bot.x);

  if (player.dazedUntil > now) {
    bot.aggroUntil = 0;
    bot.tx = null;
    bot.ty = null;
    return;
  }

  if (d > 145) {
    const p = pointNear(player.x, player.y, 96, bot.x, bot.y);
    bot.tx = p.x;
    bot.ty = p.y;
    return;
  }

  bot.tx = null;
  bot.ty = null;
  if (bot.attackCooldown <= 0) {
    bot.attackCooldown = 1.1 + Math.random() * 0.45;
    fireProjectile(bot, player, {
      id: "bot-pebble",
      name: "Pebble",
      damage: 1,
      speed: 420,
      range: 165,
      color: "#f0b66d",
      type: "pebble",
      level: 1,
    });
  }
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const shot = projectiles[i];
    shot.life -= dt;
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;

    if (shot.owner === "player") {
      if (shot.life <= 0) {
        projectiles.splice(i, 1);
        continue;
      }
      if (shot.damage <= 0) continue;
      const targets = shot.targetId ? bots.filter((bot) => bot.id === shot.targetId) : bots;
      for (const target of targets) {
        if (isBotDefeated(target)) continue;
        if (dist(shot.x, shot.y, target.x, target.y) < 17) {
          hitBot(target, shot.damage, shot.weaponName);
          projectiles.splice(i, 1);
          break;
        }
      }
    } else {
      if (shot.life <= 0 || player.dazedUntil > now) {
        projectiles.splice(i, 1);
        continue;
      }
      if (dist(shot.x, shot.y, player.x, player.y) < 17) {
        hitPlayer(shot.damage);
        projectiles.splice(i, 1);
      }
    }
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += (p.gravity || 0) * dt;
    if (p.life <= 0) particles.splice(i, 1);
  }

  for (let i = floatText.length - 1; i >= 0; i--) {
    const item = floatText[i];
    item.life -= dt;
    item.y -= 18 * dt;
    if (item.life <= 0) floatText.splice(i, 1);
  }

  if (Math.random() < dt * 12) {
    const p = screenToWorld(randRange(0, width), randRange(0, height));
    particles.push({
      x: p.x,
      y: p.y,
      vx: randRange(-6, 6),
      vy: randRange(-12, -4),
      r: randRange(1.2, 2.8),
      color: "rgba(246, 244, 179, 0.42)",
      life: randRange(1.8, 3.6),
      max: 3.6,
      gravity: -1,
    });
  }
}

function updateRemotePlayers() {
  const cutoff = Date.now() - 4200;
  for (const [id, remote] of others) {
    if (remote.lastSeen < cutoff) {
      others.delete(id);
    }
  }
}

function updateCamera(dt) {
  if (followSelf) {
    camera.x += (player.x - camera.x) * Math.min(1, dt * 5);
    camera.y += (player.y - camera.y) * Math.min(1, dt * 5);
  }
  camera.x = clamp(camera.x, 0, WORLD.w);
  camera.y = clamp(camera.y, 0, WORLD.h);
}

function completeGather(actor, res, isPlayer) {
  const label = resourceLabel(res);
  const totalNodes = resourceNodeCount(res);
  const completedNodes = resourceDepletedNodes(res);
  const nextCompletedNodes = Math.min(totalNodes, completedNodes + 1);
  const hasMoreNodes = nextCompletedNodes < totalNodes;

  const yields = {
    tree: { key: "wood", count: 2 + Math.floor(Math.random() * 3) },
    stone: { key: "stone", count: 1 + Math.floor(Math.random() * 2) },
    flower: { key: "flower", count: 1 },
    cotton: { key: "cotton", count: 1 + Math.floor(Math.random() * 2) },
  };
  const prize = yields[res.type];
  resourceState[res.id] = hasMoreNodes
    ? { ...resourceState[res.id], nodesDepleted: nextCompletedNodes }
    : { nodesDepleted: totalNodes, depletedUntil: Date.now() + respawnMs(res) };
  actor.action = hasMoreNodes ? createGatherAction(res, actor.isBot ? 1.35 : 1) : null;
  saveResourceState();
  announce("resource-update", { resourceId: res.id, state: resourceState[res.id] });

  gatherImpact(actor, res, 1.2);
  sparkle(res.x, res.y, gatherColor(res), 24);

  if (isPlayer) {
    inventory[prize.key] += prize.count;
    saveJson(INV_KEY, inventory);
    refreshInventoryPanel();
    if (craftOpen) renderCraftPanel();
    playSfx("complete");
    announceSfx("complete", res.x, res.y, 0.78, 840);
    showPickupToast({ [prize.key]: prize.count });
    ui.actionLine.textContent = hasMoreNodes
      ? `${label} node gathered. Continuing... ${totalNodes - nextCompletedNodes} left.`
      : `${label} gathered. The grove will grow it back soon.`;
  } else if (actor.inventory) {
    actor.inventory[prize.key] += prize.count;
  }
}

function startAttack(target) {
  if (!target?.isBot || isBotDefeated(target)) return;
  playSfx("ui", 0.55);
  selected = { kind: "player", id: target.id, actor: target };
  player.attackTargetId = target.id;
  player.action = null;
  ui.actionLine.textContent = `${currentWeapon().name} ready. Engaging ${target.name}.`;
  setFocusForPlayer(target);
}

function useWeaponOnBot(bot, weapon) {
  player.attackCooldown = weapon.cooldown;
  player.swingUntil = now + (weapon.type === "melee" ? 260 : 150);
  player.facing = Math.atan2(bot.y - player.y, bot.x - player.x);
  const sfxName = weapon.type === "melee" ? "melee" : weapon.type === "laser" ? "laser" : "shot";
  playSfx(sfxName);
  announceSfx(sfxName, player.x, player.y - 6, 0.84, weapon.type === "melee" ? 420 : 680);

  if (weapon.type === "melee") {
    hitBot(bot, weapon.damage, weapon.name);
  } else {
    fireProjectile(player, bot, weapon);
    if (weapon.type === "laser") {
      sparkle(player.x + Math.cos(player.facing) * 18, player.y + Math.sin(player.facing) * 18, weapon.color, 8);
    }
  }
}

function attackAt(world) {
  if (player.dazedUntil > now) return;
  const weapon = currentWeapon();
  const thing = pickWorldThing(world.x, world.y);
  const target = thing?.kind === "player" && thing.actor.isBot ? thing.actor : null;
  player.attackTargetId = null;
  player.action = null;
  player.facing = Math.atan2(world.y - player.y, world.x - player.x);

  if (target && !isBotDefeated(target)) {
    selected = thing;
    setFocusForPlayer(target);
    if (player.attackCooldown <= 0 && dist(player.x, player.y, target.x, target.y) <= weapon.range) useWeaponOnBot(target, weapon);
    else if (player.attackCooldown <= 0) attackAtPoint(world, weapon);
    return;
  }

  if (player.attackCooldown > 0) return;
  attackAtPoint(world, weapon);
}

function attackAtPoint(world, weapon) {
  player.attackTargetId = null;
  player.attackCooldown = weapon.cooldown;
  player.swingUntil = now + (weapon.type === "melee" ? 260 : 150);
  const sfxName = weapon.type === "melee" ? "melee" : weapon.type === "laser" ? "laser" : "shot";
  playSfx(sfxName);
  announceSfx(sfxName, player.x, player.y - 6, 0.84, weapon.type === "melee" ? 420 : 680);

  if (weapon.type === "melee") {
    const bot = findMeleeHit(weapon, player.facing);
    if (bot) hitBot(bot, weapon.damage, weapon.name);
    else ui.actionLine.textContent = `${weapon.name} swing.`;
  } else {
    fireProjectileAt(player, world.x, world.y, weapon);
    if (weapon.type === "laser") {
      sparkle(player.x + Math.cos(player.facing) * 18, player.y + Math.sin(player.facing) * 18, weapon.color, 8);
    }
    ui.actionLine.textContent = `${weapon.name} fired.`;
  }
}

function useAbility(index) {
  if (player.dazedUntil > now) return;
  const abilityItem = currentAbilities()[index];
  if (!abilityItem) return;
  const remaining = Math.max(0, (abilityCooldowns[abilityItem.id] || 0) - now);
  if (remaining > 0) {
    ui.actionLine.textContent = `${abilityItem.name} ready in ${Math.ceil(remaining / 1000)}s.`;
    return;
  }
  player.action = null;
  player.attackTargetId = null;
  const used = abilityItem.run();
  if (used === false) return;
  playSfx("ability");
  announceSfx("ability", player.x, player.y - 8, 0.86, 720);
  abilityCooldowns[abilityItem.id] = now + abilityItem.cooldown * 1000;
  updateAbilityBar();
}

function abilityAimPoint(range = currentWeapon().range) {
  const raw = lastPointerWorld || {
    x: player.x + Math.cos(player.facing || 0) * range,
    y: player.y + Math.sin(player.facing || 0) * range,
  };
  const dx = raw.x - player.x;
  const dy = raw.y - player.y;
  const d = Math.hypot(dx, dy);
  if (d > 0.1) player.facing = Math.atan2(dy, dx);
  if (d <= range) return raw;
  return {
    x: player.x + (dx / d) * range,
    y: player.y + (dy / d) * range,
  };
}

function meleeAbility(name, range, cone, damage, color) {
  abilityAimPoint(range);
  player.swingUntil = now + 310;
  const hits = hitBotsInArc(range, cone, damage, name);
  sparkle(player.x + Math.cos(player.facing) * Math.min(range, 46), player.y + Math.sin(player.facing) * Math.min(range, 46), color, hits ? 16 : 8);
  ui.actionLine.textContent = hits ? `${name} clipped ${hits}.` : `${name} cuts the air.`;
  return true;
}

function dashStrikeAbility(name, dashDistance, range, cone, damage, color) {
  abilityAimPoint(dashDistance + range);
  dashPlayer(dashDistance, color);
  player.swingUntil = now + 340;
  const hits = hitBotsInArc(range, cone, damage, name);
  sparkle(player.x, player.y - 6, color, 18);
  ui.actionLine.textContent = hits ? `${name} lands.` : `${name} forward.`;
  return true;
}

function dashShotAbility(name, dashDistance, type, color, range, speed, damage) {
  const target = abilityAimPoint(range + dashDistance);
  dashPlayer(dashDistance, color);
  fireProjectileAt(player, target.x, target.y, { name, type, color, range, speed, damage });
  player.swingUntil = now + 160;
  sparkle(player.x, player.y - 8, color, 14);
  ui.actionLine.textContent = `${name}.`;
  return true;
}

function shotAbility(name, type, color, range, speed, damage) {
  const target = abilityAimPoint(range);
  fireProjectileAt(player, target.x, target.y, { name, type, color, range, speed, damage });
  player.swingUntil = now + 170;
  if (type === "laser") sparkle(player.x + Math.cos(player.facing) * 18, player.y + Math.sin(player.facing) * 18, color, 8);
  ui.actionLine.textContent = `${name} fired.`;
  return true;
}

function fanAbility(name, type, color, range, speed, damage, count, spread) {
  abilityAimPoint(range);
  const start = player.facing - spread / 2;
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    fireProjectileAngle(player, start + spread * t, { name, type, color, range, speed, damage });
  }
  player.swingUntil = now + 180;
  sparkle(player.x + Math.cos(player.facing) * 18, player.y + Math.sin(player.facing) * 18, color, 10);
  ui.actionLine.textContent = `${name}.`;
  return true;
}

function areaAbility(name, x, y, radius, damage, color) {
  player.swingUntil = now + 260;
  const hits = hitBotsInArea(x, y, radius, damage, name);
  sparkle(x, y, color, 26);
  ui.actionLine.textContent = hits ? `${name} hits ${hits}.` : `${name} blooms.`;
  return true;
}

function aimedAreaAbility(name, range, radius, damage, color) {
  const target = abilityAimPoint(range);
  return areaAbility(name, target.x, target.y, radius, damage, color);
}

function lineAbility(name, range, width, damage, color) {
  const target = abilityAimPoint(range);
  const hits = hitBotsOnLine(player.x, player.y, target.x, target.y, width, damage, name);
  player.swingUntil = now + 180;
  fireProjectileAngle(player, player.facing, { name, type: "laser", color, range, speed: 1700, damage: 0 });
  sparkle(target.x, target.y, color, hits ? 22 : 12);
  ui.actionLine.textContent = hits ? `${name} pierces ${hits}.` : `${name} flashes.`;
  return true;
}

function chainAbility(name, range, maxHits, damage, color) {
  abilityAimPoint(range);
  const targets = bots
    .filter((bot) => !isBotDefeated(bot) && dist(player.x, player.y, bot.x, bot.y) <= range)
    .sort((a, b) => dist(player.x, player.y, a.x, a.y) - dist(player.x, player.y, b.x, b.y))
    .slice(0, maxHits);
  for (const bot of targets) hitBot(bot, damage, name);
  sparkle(player.x + Math.cos(player.facing) * 28, player.y + Math.sin(player.facing) * 28, color, targets.length ? 18 : 8);
  ui.actionLine.textContent = targets.length ? `${name} jumps through ${targets.length}.` : `${name} finds no target.`;
  return true;
}

function guardAbility(name, duration, color) {
  player.guardUntil = Math.max(player.guardUntil, now + duration);
  sparkle(player.x, player.y, color, 18);
  addFloat(player.x, player.y - 38, "guard");
  ui.actionLine.textContent = `${name} raised.`;
  return true;
}

function smokeAbility(name, radius, damage, color) {
  player.guardUntil = Math.max(player.guardUntil, now + 1300);
  const hits = hitBotsInArea(player.x, player.y, radius, damage, name);
  sparkle(player.x, player.y, color, 30);
  ui.actionLine.textContent = hits ? `${name} pushes ${hits}.` : `${name} surrounds you.`;
  return true;
}

function hitBotsInArc(range, cone, damage, name) {
  let hits = 0;
  for (const bot of bots) {
    if (isBotDefeated(bot)) continue;
    const d = dist(player.x, player.y, bot.x, bot.y);
    if (d > range) continue;
    const a = Math.atan2(bot.y - player.y, bot.x - player.x);
    if (Math.abs(angleDelta(player.facing, a)) <= cone) {
      hitBot(bot, damage, name);
      hits += 1;
    }
  }
  return hits;
}

function hitBotsInArea(x, y, radius, damage, name) {
  let hits = 0;
  for (const bot of bots) {
    if (isBotDefeated(bot)) continue;
    if (dist(x, y, bot.x, bot.y) <= radius) {
      hitBot(bot, damage, name);
      hits += 1;
    }
  }
  return hits;
}

function hitBotsOnLine(x1, y1, x2, y2, width, damage, name) {
  let hits = 0;
  for (const bot of bots) {
    if (isBotDefeated(bot)) continue;
    if (pointSegmentDistance(bot.x, bot.y, x1, y1, x2, y2) <= width) {
      hitBot(bot, damage, name);
      hits += 1;
    }
  }
  return hits;
}

function dashPlayer(distance, color) {
  const steps = 8;
  for (let i = 0; i < steps; i++) {
    const nx = player.x + Math.cos(player.facing) * (distance / steps);
    const ny = player.y + Math.sin(player.facing) * (distance / steps);
    const nudged = resolveBlockedMove(player.x, player.y, nx, ny, 12);
    if (nudged.x === player.x && nudged.y === player.y) break;
    player.x = clamp(nudged.x, 42, WORLD.w - 42);
    player.y = clamp(nudged.y, 42, WORLD.h - 42);
  }
  player.tx = null;
  player.ty = null;
  moveGuideTarget = null;
  sparkle(player.x, player.y, color, 12);
}

function fireProjectileAngle(source, angle, weapon) {
  const speed = weapon.speed || 1;
  projectiles.push({
    x: source.x + Math.cos(angle) * 16,
    y: source.y + Math.sin(angle) * 16 - 6,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    targetId: null,
    owner: source.id === player.id ? "player" : "bot",
    damage: weapon.damage,
    weaponName: weapon.name,
    color: weapon.color,
    type: weapon.type,
    life: Math.max(0.18, weapon.range / speed),
  });
}

function findMeleeHit(weapon, angle) {
  let best = null;
  let bestD = weapon.range + 12;
  for (const bot of bots) {
    if (isBotDefeated(bot)) continue;
    const d = dist(player.x, player.y, bot.x, bot.y);
    if (d > bestD) continue;
    const a = Math.atan2(bot.y - player.y, bot.x - player.x);
    const delta = Math.abs(angleDelta(angle, a));
    if (delta < 0.9) {
      best = bot;
      bestD = d;
    }
  }
  return best;
}

function fireProjectile(source, target, weapon) {
  fireProjectileAt(source, target.x, target.y, weapon, target.id);
}

function fireProjectileAt(source, targetX, targetY, weapon, targetId = null) {
  const a = Math.atan2(targetY - source.y, targetX - source.x);
  const speed = weapon.speed || 1;
  if (source.id !== player.id) {
    playWorldSfx(weapon.type === "laser" ? "laser" : "shot", source.x, source.y, 0.48, 560);
  }
  projectiles.push({
    x: source.x + Math.cos(a) * 16,
    y: source.y + Math.sin(a) * 16 - 6,
    vx: Math.cos(a) * speed,
    vy: Math.sin(a) * speed,
    targetId,
    owner: source.id === player.id ? "player" : "bot",
    damage: weapon.damage,
    weaponName: weapon.name,
    color: weapon.color,
    type: weapon.type,
    life: Math.max(0.18, weapon.range / speed),
  });
}

function hitBot(bot, damage = 1, weaponName = "Sword") {
  bot.hp = Math.max(0, bot.hp - damage);
  bot.hitUntil = now + 180;
  bot.aggroUntil = now + 9000;
  bot.action = null;
  bot.intent = null;

  const a = Math.atan2(bot.y - player.y, bot.x - player.x);
  bot.x = clamp(bot.x + Math.cos(a) * (9 + damage * 4), 42, WORLD.w - 42);
  bot.y = clamp(bot.y + Math.sin(a) * (9 + damage * 4), 42, WORLD.h - 42);
  bot.facing = a + Math.PI;
  sparkle(bot.x, bot.y - 12, "#fff0a6", 18);
  addFloat(bot.x, bot.y - 36, `-${damage}`);
  playSfx("hit", Math.min(1.4, 0.7 + damage * 0.16));
  announceSfx("hit", bot.x, bot.y - 12, Math.min(1, 0.54 + damage * 0.1), 620);

  if (bot.hp <= 0) {
    dropBotLoot(bot);
    bot.defeatedUntil = now + 5200;
    bot.tx = null;
    bot.ty = null;
    player.attackTargetId = null;
    addFloat(bot.x, bot.y - 40, "resting");
    playSfx("defeat");
    announceSfx("defeat", bot.x, bot.y, 0.72, 760);
    ui.actionLine.textContent = `${bot.name} is resting.`;
  } else {
    ui.actionLine.textContent = `${weaponName} hit ${bot.name}.`;
  }
}

function hitPlayer(damage = 1) {
  if (player.dazedUntil > now) return;
  if (player.guardUntil > now) {
    player.guardUntil = 0;
    sparkle(player.x, player.y - 8, "#fff0a6", 18);
    addFloat(player.x, player.y - 38, "blocked");
    playSfx("guard");
    ui.actionLine.textContent = "Guard blocked the hit.";
    return;
  }
  player.hp = Math.max(0, player.hp - damage);
  player.hitUntil = now + 220;
  sparkle(player.x, player.y - 10, "#f0b66d", 16);
  addFloat(player.x, player.y - 38, `-${damage}`);
  playSfx("playerHit");

  if (player.hp <= 0) {
    player.dazedUntil = now + 2600;
    player.attackTargetId = null;
    player.tx = null;
    player.ty = null;
    ui.actionLine.textContent = "You are dazed. Recovering...";
  } else {
    ui.actionLine.textContent = `Ouch. Health ${player.hp}/${player.maxHp}.`;
  }
}

function dropBotLoot(bot) {
  if (!bot.inventory || inventoryTotal(bot.inventory) <= 0) return;
  const loot = {
    id: `loot-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    x: bot.x + randRange(-12, 12),
    y: bot.y + randRange(-10, 10),
    items: { ...bot.inventory },
    from: bot.name,
    bornAt: now,
  };
  droppedLoot.push(loot);
  bot.inventory = emptyInventory();
  sparkle(loot.x, loot.y, "#ffe27b", 26);
  addFloat(loot.x, loot.y - 28, "loot");
  playSfx("loot", 0.76);
  announceSfx("loot", loot.x, loot.y, 0.52, 520);
}

function collectLoot(loot) {
  for (const key of Object.keys(loot.items)) {
    inventory[key] = (inventory[key] || 0) + loot.items[key];
  }
  saveJson(INV_KEY, inventory);
  refreshInventoryPanel();
  if (craftOpen) renderCraftPanel();
  const index = droppedLoot.findIndex((item) => item.id === loot.id);
  if (index >= 0) droppedLoot.splice(index, 1);
  sparkle(loot.x, loot.y, "#f8e58b", 22);
  showPickupToast(loot.items);
  playSfx("loot");
  ui.actionLine.textContent = `Picked up ${inventorySummary(loot.items)}.`;
  selected = null;
}

function respawnBot(bot) {
  bot.hp = bot.maxHp;
  bot.defeatedUntil = 0;
  bot.hitUntil = 0;
  bot.x = WORLD.w / 2 + randRange(-700, 700);
  bot.y = WORLD.h / 2 + randRange(-520, 520);
  bot.tx = null;
  bot.ty = null;
  bot.intent = null;
  bot.inventory = emptyInventory();
  bot.aggroUntil = 0;
  bot.attackCooldown = 0;
  sparkle(bot.x, bot.y, "#c9f28c", 24);
  playSfx("plant", 0.45);
}

function isBotDefeated(bot) {
  return Boolean(bot?.isBot && bot.hp <= 0);
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  drawTerrain();
  drawLakes();
  drawBuildings("floor");
  drawResources("behind");
  drawParticles(false);
  drawProjectiles();
  drawBuildings("wall");
  drawResources("front");
  drawLoot();
  drawBuildPreview();
  drawTravelers();
  drawResourceNodeOverlays();
  drawParticles(true);
  drawFloatText();

  ctx.restore();
}

function drawTerrain() {
  const base = ctx.createLinearGradient(0, 0, WORLD.w, WORLD.h);
  base.addColorStop(0, "#88b678");
  base.addColorStop(0.42, "#7eaa6c");
  base.addColorStop(1, "#93ba78");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);

  const view = visibleBounds(120);
  const cell = 96;
  const x0 = Math.max(0, Math.floor(view.x / cell) * cell);
  const y0 = Math.max(0, Math.floor(view.y / cell) * cell);
  const x1 = Math.min(WORLD.w, view.x + view.w);
  const y1 = Math.min(WORLD.h, view.y + view.h);

  for (let y = y0; y < y1; y += cell) {
    for (let x = x0; x < x1; x += cell) {
      const n = Math.sin(x * 0.017 + y * 0.009) + Math.cos(y * 0.014 - x * 0.006);
      ctx.fillStyle = n > 0.55 ? "rgba(196, 219, 137, 0.16)" : "rgba(55, 101, 60, 0.08)";
      roundedBlob(x + 8, y + 10, 78, 62, 0.5, 0.3);
      ctx.fill();

      const seed = Math.abs(Math.sin(x * 12.9898 + y * 78.233)) * 43758.5453;
      if (seed % 1 > 0.24) {
        drawGrassTuft(x + 18 + (seed % 37), y + 18 + ((seed * 1.7) % 45), 0.72 + (seed % 1) * 0.55);
      }
      if (seed % 1 > 0.68) {
        drawGrassTuft(x + 54 + ((seed * 2.3) % 28), y + 50 + ((seed * 1.3) % 24), 0.55);
      }
    }
  }

  ctx.strokeStyle = "rgba(50, 91, 55, 0.1)";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 34; i++) {
    const x = (i * 397) % WORLD.w;
    const y = (i * 233) % WORLD.h;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x + 130, y - 70, x + 240, y + 90, x + 390, y + 12);
    ctx.stroke();
  }
}

function drawGrassTuft(x, y, scale) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = "rgba(57, 108, 59, 0.28)";
  ctx.lineWidth = 1.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 5);
  ctx.quadraticCurveTo(-4, -1, -2, -7);
  ctx.moveTo(0, 5);
  ctx.quadraticCurveTo(0, -2, 2, -9);
  ctx.moveTo(1, 5);
  ctx.quadraticCurveTo(5, 0, 6, -6);
  ctx.stroke();
  ctx.strokeStyle = "rgba(184, 220, 132, 0.28)";
  ctx.beginPath();
  ctx.moveTo(-3, 4);
  ctx.quadraticCurveTo(-6, 0, -7, -4);
  ctx.moveTo(4, 4);
  ctx.quadraticCurveTo(8, 1, 9, -3);
  ctx.stroke();
  ctx.restore();
}

function drawLakes() {
  for (const lake of lakes) {
    ctx.save();
    ctx.translate(lake.x, lake.y);
    ctx.rotate(lake.a);
    ctx.fillStyle = "rgba(42, 74, 68, 0.18)";
    ctx.beginPath();
    ctx.ellipse(8, 14, lake.rx + 20, lake.ry + 18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.water;
    ctx.beginPath();
    ctx.ellipse(0, 0, lake.rx, lake.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.waterDeep;
    ctx.beginPath();
    ctx.ellipse(lake.rx * 0.1, lake.ry * 0.05, lake.rx * 0.68, lake.ry * 0.58, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(244, 255, 232, 0.34)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(-lake.rx * 0.2, -lake.ry * 0.22, lake.rx * 0.42, lake.ry * 0.2, 0, 0.08, Math.PI * 0.82);
    ctx.stroke();
    ctx.restore();
  }
}

function drawResources(layer) {
  const view = visibleBounds(160);
  const items = resources
    .filter((res) => res.x > view.x && res.x < view.x + view.w && res.y > view.y && res.y < view.y + view.h)
    .sort((a, b) => a.y - b.y);

  for (const res of items) {
    const depleted = isDepleted(res);
    if (res.type === "tree" && layer === "behind") drawTree(res, depleted);
    if (res.type !== "tree" && layer === "front") drawSmallResource(res, depleted);
  }
}

function drawResourceNodeOverlays() {
  if (!player.action) return;
  const res = resources.find((item) => item.id === player.action.resourceId);
  if (!res || isDepleted(res)) return;
  drawActiveResourceOverlay(res);
}

function drawActiveResourceOverlay(res) {
  const nodeCount = resourceNodeCount(res);
  if (nodeCount <= 0) return;

  const anchorY = resourceNodeAnchorY(res);
  const label = resourceMaterialLabel(res);
  const remaining = resourceRemainingNodes(res);
  const count = `${remaining}/${nodeCount}`;
  const countW = Math.max(54, Math.min(104, nodeCount * 10 + 22));
  const countH = 22;
  const fillW = Math.max(0, (countW - 10) * (remaining / nodeCount));

  ctx.save();
  ctx.translate(res.x, res.y + anchorY);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.font = "600 13px Inter, system-ui, sans-serif";
  drawShadowText(label, 0, -16, "#f6ffe8");

  ctx.fillStyle = "rgba(31, 27, 40, 0.58)";
  roundRect(-countW / 2, 0, countW, countH, 4);
  ctx.fill();

  ctx.save();
  roundRect(-countW / 2 + 5, 4, countW - 10, countH - 8, 3);
  ctx.clip();
  ctx.fillStyle = "rgba(239, 240, 255, 0.17)";
  ctx.fillRect(-countW / 2 + 5, 4, countW - 10, countH - 8);
  if (fillW > 0) {
    ctx.fillStyle = "#23c83b";
    ctx.fillRect(-countW / 2 + 5, 4, fillW, countH - 8);
  }
  ctx.strokeStyle = "rgba(21, 28, 24, 0.34)";
  ctx.lineWidth = 1;
  for (let i = 1; i < nodeCount; i++) {
    const x = -countW / 2 + 5 + ((countW - 10) / nodeCount) * i;
    ctx.beginPath();
    ctx.moveTo(x, 4);
    ctx.lineTo(x, countH - 4);
    ctx.stroke();
  }
  ctx.restore();

  if (remaining > 0 && remaining < nodeCount) {
    const markerX = -countW / 2 + 5 + fillW;
    ctx.fillStyle = "#ecff57";
    roundRect(markerX - 2, 4, 4, countH - 8, 1.5);
    ctx.fill();
  }
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  drawShadowText(count, 0, 11, "#f4f1ff");
  ctx.restore();
}

function drawBuildings(layer) {
  const view = visibleBounds(180);
  const items = buildings
    .filter((building) => building.x > view.x && building.x < view.x + view.w && building.y > view.y && building.y < view.y + view.h)
    .filter((building) => (layer === "floor" ? building.type === "foundation" : building.type !== "foundation"))
    .sort((a, b) => a.y - b.y);

  for (const building of items) drawBuilding(building, false);
}

function drawBuildPreview() {
  if (!buildMode || !buildPreview) return;
  ctx.save();
  ctx.globalAlpha = buildPreview.valid ? 0.74 : 0.45;
  drawBuilding(
    {
      type: buildPreview.piece.id,
      x: buildPreview.x,
      y: buildPreview.y,
      w: buildPreview.w,
      h: buildPreview.h,
      rot: buildRotation,
      color: buildPreview.valid ? buildPreview.piece.color : "#d16f6f",
    },
    true,
  );
  ctx.globalAlpha = 1;
  ctx.strokeStyle = buildPreview.valid ? "rgba(255, 226, 123, 0.85)" : "rgba(255, 136, 118, 0.9)";
  ctx.lineWidth = 2;
  const r = buildRect(buildPreview);
  roundRect(r.x - r.w / 2, r.y - r.h / 2, r.w, r.h, 7);
  ctx.stroke();
  ctx.restore();
}

function drawBuilding(building, preview) {
  ctx.save();
  ctx.translate(building.x, building.y);
  if (building.type !== "foundation") ctx.rotate((building.rot || 0) * (Math.PI / 2));

  const piece = buildPieces.find((item) => item.id === building.type) || buildPieces[0];
  const w = piece.id === "foundation" ? building.w : piece.w;
  const h = piece.id === "foundation" ? building.h : piece.h;
  ctx.fillStyle = preview ? "rgba(34, 43, 29, 0.14)" : palette.shadow;
  ctx.beginPath();
  ctx.ellipse(4, h * 0.32, w * 0.42, Math.max(5, h * 0.24), 0, 0, Math.PI * 2);
  ctx.fill();

  if (building.type === "foundation") {
    ctx.fillStyle = building.color || piece.color;
    roundRect(-w / 2, -h / 2, w, h, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(84, 57, 34, 0.18)";
    ctx.lineWidth = 2;
    for (let x = -w / 2 + 12; x < w / 2; x += 12) {
      ctx.beginPath();
      ctx.moveTo(x, -h / 2 + 5);
      ctx.lineTo(x, h / 2 - 5);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,230,0.16)";
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 7, -h / 2 + 8);
    ctx.lineTo(w / 2 - 7, -h / 2 + 8);
    ctx.stroke();
  } else {
    ctx.fillStyle = building.color || piece.color;
    roundRect(-w / 2, -h / 2, w, h, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,230,0.14)";
    roundRect(-w / 2 + 5, -h / 2 + 3, w - 10, 4, 3);
    ctx.fill();

    if (building.type === "door") {
      ctx.fillStyle = "rgba(47, 34, 24, 0.5)";
      roundRect(-8, -h / 2 + 2, 16, h - 4, 4);
      ctx.fill();
    }

    if (building.type === "window") {
      ctx.fillStyle = "rgba(159, 233, 255, 0.66)";
      roundRect(-13, -h / 2 + 3, 26, h - 6, 4);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawTree(res, depleted) {
  ctx.save();
  ctx.translate(res.x, res.y);
  ctx.fillStyle = palette.shadow;
  ctx.beginPath();
  ctx.ellipse(6, 13, res.r * 0.92, res.r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();

  if (depleted) {
    ctx.fillStyle = "#9c734c";
    roundRect(-11, -6, 22, 18, 6);
    ctx.fill();
    ctx.fillStyle = "#c49764";
    ctx.beginPath();
    ctx.ellipse(0, -5, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.fillStyle = "#835c3d";
  roundRect(-8, -2, 16, 30, 7);
  ctx.fill();
  const tint = res.tint;
  ctx.fillStyle = tint;
  blobCircle(-13, -24, res.r * 0.58);
  blobCircle(15, -26, res.r * 0.62);
  blobCircle(0, -43, res.r * 0.68);
  blobCircle(-1, -18, res.r * 0.74);
  ctx.fillStyle = "rgba(255, 255, 230, 0.15)";
  blobCircle(-13, -39, res.r * 0.22);
  ctx.restore();
}

function drawSmallResource(res, depleted) {
  ctx.save();
  ctx.translate(res.x, res.y);
  ctx.fillStyle = palette.shadow;
  ctx.beginPath();
  ctx.ellipse(3, 8, res.r * 1.1, res.r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  if (res.type === "stone") {
    ctx.fillStyle = depleted ? "#798474" : "#d8ddd0";
    roundedBlob(-res.r, -res.r * 0.8, res.r * 2, res.r * 1.55, 0.42, 0.5);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    blobCircle(-res.r * 0.22, -res.r * 0.42, res.r * 0.24);
  } else if (res.type === "cotton") {
    ctx.strokeStyle = depleted ? "rgba(85, 104, 69, 0.45)" : "#5d955f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.quadraticCurveTo(5, -4, 1, -14);
    ctx.stroke();
    if (!depleted) {
      ctx.fillStyle = "#fffdf2";
      blobCircle(-4, -15, 5.6);
      blobCircle(4, -16, 5.3);
      blobCircle(0, -10, 6.2);
      ctx.fillStyle = "rgba(245, 230, 190, 0.38)";
      blobCircle(-2, -12, 2.4);
    }
  } else {
    ctx.strokeStyle = depleted ? "rgba(85, 104, 69, 0.45)" : "#4d8b56";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.quadraticCurveTo(-6, -4, -2, -13);
    ctx.stroke();
    if (!depleted) {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.fillStyle = res.tint;
        blobCircle(Math.cos(a) * 5, -15 + Math.sin(a) * 5, 5);
      }
      ctx.fillStyle = "#ffe27b";
      blobCircle(0, -15, 3.5);
    }
  }
  ctx.restore();
}

function drawProjectiles() {
  for (const shot of projectiles) {
    const a = Math.atan2(shot.vy, shot.vx);
    ctx.save();
    ctx.translate(shot.x, shot.y);
    ctx.rotate(a);
    ctx.lineCap = "round";

    if (shot.type === "laser") {
      ctx.strokeStyle = "rgba(159, 233, 255, 0.34)";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(14, 0);
      ctx.stroke();
      ctx.strokeStyle = shot.color;
      ctx.lineWidth = 2.4;
    } else if (shot.type === "arrow") {
      ctx.strokeStyle = "#6b4b35";
      ctx.lineWidth = 2.2;
    } else if (shot.type === "spark") {
      ctx.strokeStyle = shot.color;
      ctx.lineWidth = 4;
    } else {
      ctx.strokeStyle = shot.color;
      ctx.lineWidth = shot.type === "pebble" ? 5 : 3;
    }

    ctx.beginPath();
    ctx.moveTo(-8, 0);
    ctx.lineTo(8, 0);
    ctx.stroke();

    if (shot.type === "arrow") {
      ctx.fillStyle = "#eef3df";
      ctx.beginPath();
      ctx.moveTo(10, 0);
      ctx.lineTo(3, -3);
      ctx.lineTo(3, 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawLoot() {
  for (const loot of droppedLoot) {
    const pulse = Math.sin(now * 0.006 + loot.x * 0.02) * 0.5 + 0.5;
    ctx.save();
    ctx.translate(loot.x, loot.y);
    ctx.fillStyle = "rgba(34, 43, 29, 0.2)";
    ctx.beginPath();
    ctx.ellipse(3, 8, 16, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.22 + pulse * 0.16;
    ctx.fillStyle = "#ffe27b";
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#b9854e";
    roundedBlob(-10, -8, 20, 18, 0.38, 0.2);
    ctx.fill();
    ctx.fillStyle = "#e0b874";
    roundRect(-7, -10, 14, 5, 3);
    ctx.fill();

    const dots = lootDots(loot.items);
    dots.forEach((dot, index) => {
      ctx.fillStyle = dot.color;
      ctx.beginPath();
      ctx.arc(-6 + index * 6, 2, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
}

function drawTravelers() {
  const travelers = [...bots.filter((bot) => !isBotDefeated(bot)), ...others.values(), player].sort((a, b) => a.y - b.y);
  for (const actor of travelers) drawActor(actor, actor.id === player.id);
}

function drawActor(actor, isSelf) {
  const bob = Math.sin(now * 0.008 + actor.x * 0.03) * 2;
  const gatheringRes = actor.action ? resources.find((item) => item.id === actor.action.resourceId) : null;
  ctx.save();
  ctx.translate(actor.x, actor.y + bob);

  if (actor.tx != null && isSelf) {
    const guide = moveGuideTarget || { x: actor.tx, y: actor.ty };
    const guideDx = guide.x - actor.x;
    const guideDy = guide.y - actor.y;
    const guideDist = Math.hypot(guideDx, guideDy);
    const guideScale = guideDist > MOVE_GUIDE_MAX ? MOVE_GUIDE_MAX / guideDist : 1;
    ctx.strokeStyle = "rgba(244, 251, 226, 0.34)";
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(guideDx * guideScale, guideDy * guideScale);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = "rgba(34, 43, 29, 0.22)";
  ctx.beginPath();
  ctx.ellipse(4, 12, 15, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  if (isSelf) {
    ctx.strokeStyle = "rgba(255, 250, 180, 0.42)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 3, 21, 15, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isSelf && player.guardUntil > now) {
    ctx.strokeStyle = "rgba(255, 246, 189, 0.58)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 2, 26 + Math.sin(now * 0.012) * 2, 19, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (gatheringRes) drawGatherLink(actor, gatheringRes, bob);

  drawHumanTraveler(actor, isSelf);

  if (gatheringRes) drawGatherTool(actor, gatheringRes);

  if (actor.hitUntil > now) {
    ctx.globalAlpha = 0.42;
    ctx.fillStyle = "#fff0a6";
    ctx.beginPath();
    ctx.ellipse(0, -2, 18, 22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (isSelf) drawPlayerManaCircle(actor, bob);

  if (isSelf || actor.isBot || dist(actor.x, actor.y, player.x, player.y) < 360) {
    ctx.save();
    ctx.translate(actor.x, actor.y - 32 + bob);
    ctx.fillStyle = "rgba(18, 27, 23, 0.52)";
    const label = actor.name || "Traveler";
    ctx.font = "11px Inter, system-ui, sans-serif";
    const metrics = ctx.measureText(label);
    roundRect(-metrics.width / 2 - 7, -12, metrics.width + 14, 18, 7);
    ctx.fill();
    ctx.fillStyle = "rgba(252,255,241,0.88)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 0, -3);
    ctx.restore();
  }

  if (actor.isBot && actor.maxHp) {
    const hp = clamp(actor.hp / actor.maxHp, 0, 1);
    ctx.save();
    ctx.translate(actor.x, actor.y + 35 + bob);
    ctx.fillStyle = "rgba(20, 29, 25, 0.48)";
    roundRect(-14, -3, 28, 6, 3);
    ctx.fill();
    ctx.fillStyle = hp > 0.45 ? "#bfe878" : "#f0b66d";
    roundRect(-14, -3, 28 * hp, 6, 3);
    ctx.fill();
    ctx.restore();
  }

  if (isSelf) {
    const hp = clamp(player.hp / player.maxHp, 0, 1);
    ctx.save();
    ctx.translate(actor.x, actor.y + 35 + bob);
    ctx.fillStyle = "rgba(20, 29, 25, 0.48)";
    roundRect(-17, -3, 34, 6, 3);
    ctx.fill();
    ctx.fillStyle = hp > 0.45 ? "#bfe878" : "#f0b66d";
    roundRect(-17, -3, 34 * hp, 6, 3);
    ctx.fill();
    ctx.restore();
  }

  if (isSelf && waveUntil > now) {
    ctx.save();
    ctx.translate(actor.x + 13, actor.y - 23);
    ctx.strokeStyle = "rgba(255, 245, 160, 0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 8 + Math.sin(now * 0.016) * 3, -0.5, 1.2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPlayerManaCircle(actor, bob) {
  const mana = clamp(player.energy / player.maxEnergy, 0, 1);
  if (mana >= 0.999) return;

  const x = actor.x + 24;
  const y = actor.y - 15 + bob;
  const radius = 8;
  const start = -Math.PI / 2;
  const end = start + Math.PI * 2 * mana;

  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(18, 27, 23, 0.48)";
  ctx.beginPath();
  ctx.arc(0, 0, radius + 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(159, 233, 255, 0.2)";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = mana > 0.22 ? "#9fe9ff" : "#ffe27b";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, radius, start, end);
  ctx.stroke();

  ctx.fillStyle = "rgba(244, 251, 226, 0.72)";
  ctx.beginPath();
  ctx.arc(0, 0, 2.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawHumanTraveler(actor, isSelf) {
  const tunic = actor.color || "#f3cf75";
  const skin = actor.skin || "#f0c59b";
  const hair = actor.hair || "#5a3929";
  const pants = actor.pants || "#516d75";
  const stride = Math.sin(now * 0.014 + actor.x * 0.02) * clamp(Math.hypot(actor.vx || 0, actor.vy || 0) / 170, 0, 1);
  const lookX = Math.cos(actor.facing || 0) * 1.6;
  const lookY = Math.sin(actor.facing || 0) * 1.1;

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(-11, -1 + stride * 0.8, 4.2, 8, -0.4, 0, Math.PI * 2);
  ctx.ellipse(11, -1 - stride * 0.8, 4.2, 8, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = pants;
  ctx.beginPath();
  ctx.ellipse(-5, 10 + stride * 2, 4.6, 8.6, -0.12, 0, Math.PI * 2);
  ctx.ellipse(5, 10 - stride * 2, 4.6, 8.6, 0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = tunic;
  ctx.beginPath();
  ctx.ellipse(0, 1, isSelf ? 11.5 : 10.5, isSelf ? 13.5 : 12.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.26)";
  ctx.beginPath();
  ctx.ellipse(-3, -4, 4.2, 3.4, -0.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.arc(lookX * 0.35, -14 + lookY * 0.35, isSelf ? 8.2 : 7.6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hair;
  ctx.beginPath();
  ctx.ellipse(-0.8 + lookX * 0.25, -18 + lookY * 0.25, 8.8, 5.6, 0.02, Math.PI * 0.98, Math.PI * 2.12);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-4 + lookX * 0.15, -19, 4.1, 0, Math.PI * 2);
  ctx.arc(3 + lookX * 0.15, -20, 4.3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#27342e";
  ctx.beginPath();
  ctx.arc(-2.5 + lookX, -13 + lookY, 1.2, 0, Math.PI * 2);
  ctx.arc(3 + lookX, -13 + lookY, 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(39, 52, 46, 0.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0.5 + lookX, -10.4 + lookY, 2.1, 0.2, Math.PI - 0.2);
  ctx.stroke();

  if (isSelf && !actor.action) drawSword(actor);
}

function drawSword(actor) {
  const weapon = currentWeapon();
  const active = actor.swingUntil > now;
  const swing = active ? Math.sin((1 - (actor.swingUntil - now) / 260) * Math.PI) : 0;
  const base = actor.facing || 0;
  const angle = base - 0.72 + swing * 1.45;
  const gripX = 10;
  const gripY = -1;
  const length = weapon.id === "hammer" ? 18 : weapon.id === "spear" ? 28 : weapon.type === "melee" ? 24 : 20;
  const tipX = gripX + Math.cos(angle) * length;
  const tipY = gripY + Math.sin(angle) * length;
  const guardX = Math.cos(angle + Math.PI / 2);
  const guardY = Math.sin(angle + Math.PI / 2);

  ctx.lineCap = "round";
  if (weapon.type === "arrow") {
    ctx.strokeStyle = "#6b4b35";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(gripX + Math.cos(base) * 8, gripY + Math.sin(base) * 8, 10, base - 1.05, base + 1.05);
    ctx.stroke();
  } else if (weapon.type === "bullet" || weapon.type === "laser" || weapon.type === "spark") {
    ctx.strokeStyle = "rgba(39, 48, 45, 0.44)";
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(gripX, gripY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.strokeStyle = weapon.color;
    ctx.lineWidth = weapon.type === "laser" ? 3.5 : 2.8;
    ctx.beginPath();
    ctx.moveTo(gripX, gripY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(39, 48, 45, 0.42)";
    ctx.lineWidth = weapon.id === "hammer" ? 7 : 5;
    ctx.beginPath();
    ctx.moveTo(gripX, gripY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.strokeStyle = weapon.color;
    ctx.lineWidth = weapon.id === "hammer" ? 4.4 : 2.6;
    ctx.beginPath();
    ctx.moveTo(gripX, gripY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();

    ctx.strokeStyle = "#d4a857";
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(gripX - guardX * 4, gripY - guardY * 4);
    ctx.lineTo(gripX + guardX * 4, gripY + guardY * 4);
    ctx.stroke();
  }

  if (active) {
    ctx.strokeStyle = weapon.type === "laser" ? "rgba(159, 233, 255, 0.58)" : "rgba(255, 244, 166, 0.52)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -2, 28, base - 1.15, base + 0.45);
    ctx.stroke();
  }
}

function drawParticles(front) {
  for (const p of particles) {
    if (front !== p.front) continue;
    const alpha = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = alpha;
    if (p.kind === "ring") {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.lineWidth || 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + (1 - alpha) * (p.grow || 18), 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawFloatText() {
  ctx.font = "12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const item of floatText) {
    ctx.globalAlpha = clamp(item.life / item.max, 0, 1);
    ctx.fillStyle = "rgba(24, 34, 29, 0.56)";
    const w = ctx.measureText(item.text).width + 16;
    roundRect(item.x - w / 2, item.y - 12, w, 20, 7);
    ctx.fill();
    ctx.fillStyle = "#fbffe9";
    ctx.fillText(item.text, item.x, item.y - 2);
    ctx.globalAlpha = 1;
  }
}

function drawShadowText(text, x, y, color) {
  ctx.fillStyle = "rgba(16, 22, 20, 0.72)";
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function onPointerDown(event) {
  const world = screenToWorld(event.clientX, event.clientY);
  lastPointerWorld = world;
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 2) {
    rightMove = {
      id: event.pointerId,
      sx: event.clientX,
      sy: event.clientY,
      x: event.clientX,
      y: event.clientY,
      startedAt: now,
      moved: false,
      holdMove: false,
    };
  }
  pointer = {
    id: event.pointerId,
    button: event.button,
    sx: event.clientX,
    sy: event.clientY,
    lx: event.clientX,
    ly: event.clientY,
    startedAt: now,
    moved: false,
    holdMove: false,
  };
}

function onPointerMove(event) {
  const world = screenToWorld(event.clientX, event.clientY);
  lastPointerWorld = world;
  hover = pickWorldThing(world.x, world.y);
  if (buildMode) updateBuildPreview(world);

  if (rightMove && typeof event.buttons === "number" && !(event.buttons & 2)) {
    stopHeldRightMove(event.pointerId);
  }
  if (rightMove && (event.buttons & 2)) {
    rightMove.x = event.clientX;
    rightMove.y = event.clientY;
    const rdx = event.clientX - rightMove.sx;
    const rdy = event.clientY - rightMove.sy;
    if (Math.hypot(rdx, rdy) > 5) {
      rightMove.moved = true;
      rightMove.holdMove = true;
      setHeldMoveTarget();
    }
  }

  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.sx;
  const dy = event.clientY - pointer.sy;
  if (Math.hypot(dx, dy) > 5) {
    pointer.moved = true;
  }
}

function onPointerUp(event) {
  if (event.type === "pointercancel") {
    pointer = null;
    stopHeldRightMove();
    return;
  }

  const world = screenToWorld(event.clientX, event.clientY);
  lastPointerWorld = world;
  if (event.button === 2) {
    const wasHoldMove = stopHeldRightMove(event.pointerId);
    if (pointer?.id === event.pointerId) pointer = null;
    if (wasHoldMove) {
      announce("player");
      return;
    }
    handleWorldCommand(world);
    announce("player");
    return;
  }

  if (!pointer || pointer.id !== event.pointerId) return;
  const button = pointer.button;
  pointer = null;

  if (buildMode && button === 0) {
    updateBuildPreview(world);
    placeCurrentBuild();
    return;
  }
  if (button === 0) {
    announce("player");
    return;
  }
}

function onMouseDown(event) {
  if (event.button !== 0 || buildMode) return;
  event.preventDefault();
  const world = screenToWorld(event.clientX, event.clientY);
  lastPointerWorld = world;
  attackAt(world);
  announce("player");
}

function updateHeldRightMove() {
  if (!rightMove) return;
  if (rightMove.holdMove || now - rightMove.startedAt > 140) {
    rightMove.holdMove = true;
    if (now - lastHoldMoveAt > 65) {
      setHeldMoveTarget();
    }
  }
}

function stopHeldRightMove(pointerId = null) {
  if (!rightMove || (pointerId != null && rightMove.id !== pointerId)) return false;
  const wasHoldMove = Boolean(rightMove.holdMove);
  rightMove = null;
  if (!wasHoldMove) return false;
  player.tx = null;
  player.ty = null;
  player.vx = 0;
  player.vy = 0;
  moveGuideTarget = null;
  return true;
}

function setHeldMoveTarget() {
  const cursorWorld = screenToWorld(rightMove.x, rightMove.y);
  lastPointerWorld = cursorWorld;
  moveGuideTarget = cursorWorld;
  const dx = cursorWorld.x - player.x;
  const dy = cursorWorld.y - player.y;
  const d = Math.hypot(dx, dy);
  if (d < 4) {
    setPlayerMoveTarget(cursorWorld, "hold");
    return;
  }
  setPlayerMoveTarget(
    {
      x: player.x + (dx / d) * (d + HELD_MOVE_LEAD),
      y: player.y + (dy / d) * (d + HELD_MOVE_LEAD),
    },
    "hold",
  );
}

function setPlayerMoveTarget(world, mode = "click") {
  selected = null;
  player.attackTargetId = null;
  player.action = null;
  if (mode !== "hold") moveGuideTarget = null;
  player.tx = clamp(world.x, 28, WORLD.w - 28);
  player.ty = clamp(world.y, 28, WORLD.h - 28);
  followSelf = true;
  lastHoldMoveAt = now;
  if (mode !== "hold") {
    playSfx("move", 0.65);
    ui.actionLine.textContent = "Moving. Hold Shift to sprint.";
    ui.focusName.textContent = "Grove Focus";
    ui.focusDetail.textContent = "Right-click resources or loot. Left-click bots to attack.";
  }
}

function handleWorldCommand(world) {
  const thing = pickWorldThing(world.x, world.y);
  if (thing?.kind === "loot") {
    player.attackTargetId = null;
    selected = thing;
    walkToLoot(thing.loot);
    setFocusForLoot(thing.loot);
  } else if (thing?.kind === "resource") {
    player.attackTargetId = null;
    selected = thing;
    walkToResource(thing.resource);
    setFocusForResource(thing.resource);
  } else if (thing?.kind === "player") {
    player.attackTargetId = null;
    selected = thing;
    setFocusForPlayer(thing.actor);
    followSelf = true;
  } else {
    setPlayerMoveTarget(world);
  }
}

function walkToResource(res) {
  if (isDepleted(res)) {
    playSfx("error");
    ui.actionLine.textContent = `${resourceLabel(res)} is resting. Try another patch.`;
    return;
  }
  const p = chooseResourceApproach(res, player.x, player.y);
  moveGuideTarget = null;
  player.tx = p.x;
  player.ty = p.y;
  player.action = null;
  playSfx("move", 0.58);
  ui.actionLine.textContent = `Moving to ${resourceLabel(res).toLowerCase()}.`;

  const check = () => {
    if (selected?.resource?.id !== res.id || isDepleted(res)) return;
    if (dist(player.x, player.y, res.x, res.y) <= resourceInteractionRadius(res)) {
      player.tx = null;
      player.ty = null;
      player.action = createGatherAction(res);
      ui.actionLine.textContent = `${actionVerb(res)} ${resourceLabel(res).toLowerCase()}...`;
      return;
    }
    if (player.tx == null && player.ty == null) {
      const next = chooseResourceApproach(res, player.x, player.y);
      player.tx = next.x;
      player.ty = next.y;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

function walkToLoot(loot) {
  player.action = null;
  if (dist(player.x, player.y, loot.x, loot.y) <= 28) {
    collectLoot(loot);
    return;
  }
  moveGuideTarget = null;
  player.tx = loot.x;
  player.ty = loot.y;
  playSfx("move", 0.58);
  ui.actionLine.textContent = `Moving to ${inventorySummary(loot.items)}.`;

  const check = () => {
    if (selected?.loot?.id !== loot.id || !droppedLoot.some((item) => item.id === loot.id)) return;
    if (dist(player.x, player.y, loot.x, loot.y) <= 28) {
      player.tx = null;
      player.ty = null;
      collectLoot(loot);
      return;
    }
    requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}

function updateBuildPreview(world = lastPointerWorld || { x: player.x + 56, y: player.y }) {
  lastPointerWorld = world;
  const piece = currentBuildPiece();
  const x = snapToGrid(world.x);
  const y = snapToGrid(world.y);
  buildPreview = { ...buildFootprint(piece, x, y, buildRotation), piece, valid: canPlaceBuilding(piece, x, y, buildRotation) };
}

function placeCurrentBuild() {
  if (!buildPreview) updateBuildPreview();
  if (!buildPreview.valid) {
    playSfx("error");
    ui.actionLine.textContent = inventory.wood < currentBuildPiece().cost ? "Not enough wood." : "Can't build there.";
    return;
  }

  const piece = currentBuildPiece();
  const footprint = buildFootprint(piece, buildPreview.x, buildPreview.y, buildRotation);
  const building = {
    id: `build-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    type: piece.id,
    x: buildPreview.x,
    y: buildPreview.y,
    rot: buildRotation,
    w: footprint.w,
    h: footprint.h,
    blocks: piece.blocks,
    color: piece.color,
  };
  buildings.push(building);
  inventory.wood -= piece.cost;
  saveJson(INV_KEY, inventory);
  refreshInventoryPanel();
  if (craftOpen) renderCraftPanel();
  saveBuildings();
  sparkle(building.x, building.y, "#d4ad62", 18);
  playSfx("build");
  announceSfx("build", building.x, building.y, 0.86, 720);
  ui.actionLine.textContent = `${piece.name} placed.`;
  updateBuildPreview(lastPointerWorld);
  renderBuildPanel();
}

function canPlaceBuilding(piece, x, y, rot) {
  if (inventory.wood < piece.cost) return false;
  const fp = buildFootprint(piece, x, y, rot);
  if (x < 24 || y < 24 || x > WORLD.w - 24 || y > WORLD.h - 24) return false;
  if (inAnyLake(x, y, Math.max(fp.w, fp.h) * 0.45)) return false;
  if (piece.blocks && rectCircleIntersects(fp, player.x, player.y, 17)) return false;

  for (const res of resources) {
    if (isDepleted(res) || res.type === "flower" || res.type === "cotton") continue;
    if (rectCircleIntersects(fp, res.x, res.y, res.r * (res.type === "tree" ? 0.56 : 0.72))) return false;
  }

  for (const building of buildings) {
    const other = buildRect(building);
    const canOverlapFoundation = piece.id !== "foundation" && building.type === "foundation";
    if (!canOverlapFoundation && rectsOverlap(fp, other)) return false;
  }
  return true;
}

function buildFootprint(piece, x, y, rot) {
  const rotated = piece.id !== "foundation" && rot % 2 === 1;
  return {
    x,
    y,
    w: rotated ? piece.h : piece.w,
    h: rotated ? piece.w : piece.h,
  };
}

function buildRect(building) {
  return { x: building.x, y: building.y, w: building.w, h: building.h };
}

function saveBuildings() {
  saveJson(BUILD_KEY, buildings);
}

function plantTree() {
  const p = pointNear(player.x, player.y, 46);
  if (inventory.wood < 3) {
    playSfx("error");
    ui.actionLine.textContent = "Planting a young tree needs 3 wood.";
    return;
  }
  if (isBlocked(p.x, p.y, 34)) {
    playSfx("error");
    ui.actionLine.textContent = "That patch is too crowded for a sapling.";
    return;
  }
  inventory.wood -= 3;
  const id = `planted-${Date.now()}-${Math.floor(Math.random() * 9999)}`;
  resources.push({ id, type: "tree", x: p.x, y: p.y, r: 28, tint: "#79ad67", planted: true });
  saveJson(INV_KEY, inventory);
  refreshInventoryPanel();
  if (craftOpen) renderCraftPanel();
  sparkle(p.x, p.y, "#bdf28f", 30);
  addFloat(p.x, p.y - 30, "sapling");
  playSfx("plant");
  announceSfx("plant", p.x, p.y, 0.82, 760);
  ui.actionLine.textContent = "A young tree takes root.";
}

function setFocusForResource(res) {
  ui.focusName.textContent = resourceLabel(res);
  const state = isDepleted(res) ? "resting" : `${actionVerb(res)} ready`;
  const time = isDepleted(res) ? `${Math.ceil((resourceState[res.id].depletedUntil - Date.now()) / 1000)}s` : "";
  const remaining = resourceRemainingNodes(res);
  const nodes = isDepleted(res) ? "" : ` ${remaining}/${resourceNodeCount(res)} nodes remain.`;
  ui.focusDetail.textContent = `${state}${time ? `, returns in ${time}.` : "."}${nodes} Right-click to gather.`;
}

function setFocusForLoot(loot) {
  ui.focusName.textContent = "Dropped loot";
  const from = loot.from ? ` from ${loot.from}` : "";
  ui.focusDetail.textContent = `${inventorySummary(loot.items)}${from}. Right-click to pick up.`;
}

function setFocusForPlayer(actor) {
  ui.focusName.textContent = actor.name || "Traveler";
  if (actor.id === player.id) {
    const weapon = currentWeapon();
    const state = player.dazedUntil > now ? "Recovering" : `${weapon.name} ${itemLevelText(weapon)} equipped`;
    ui.focusDetail.textContent = `${state}. Health ${player.hp}/${player.maxHp}. Energy ${Math.ceil(player.energy)}/${player.maxEnergy}.`;
  } else if (actor.isBot) {
    const rest = isBotDefeated(actor) ? "Resting" : `Health ${actor.hp}/${actor.maxHp}`;
    const aggro = actor.aggroUntil > now ? " Fighting back." : "";
    ui.focusDetail.textContent = `${rest}.${aggro} Left-click to fight.`;
  } else {
    ui.focusDetail.textContent = "Another traveler in the shared grove.";
  }
}

function updateHud() {
  ui.online.textContent = 1 + others.size;
  ui.wood.textContent = inventory.wood;
  ui.stone.textContent = inventory.stone;
  ui.flower.textContent = inventory.flower;
  ui.cotton.textContent = inventory.cotton;
  const energyPct = clamp(player.energy / player.maxEnergy, 0, 1);
  ui.energyProgress.style.width = `${Math.round(energyPct * 100)}%`;
  ui.energyCount.textContent = `${Math.ceil(player.energy)}/${player.maxEnergy}`;
  updateAbilityBar();
  renderBuildPanel();
  if (craftOpen) renderCraftPanel();
  updateGatherHud();

  if (player.action) {
    const progress = clamp(player.action.elapsed / player.action.duration, 0, 1);
    ui.actionProgress.style.width = `${Math.round(progress * 100)}%`;
  } else {
    ui.actionProgress.style.width = "0%";
  }

  if (selected?.kind === "resource") setFocusForResource(selected.resource);
  if (selected?.kind === "player") setFocusForPlayer(selected.actor);
  if (selected?.kind === "loot") setFocusForLoot(selected.loot);
}

function updateGatherHud() {
  const action = player.action;
  const res = action ? resources.find((item) => item.id === action.resourceId) : null;
  if (!action || !res || isDepleted(res)) {
    ui.gatherHud.hidden = true;
    ui.gatherHud.setAttribute("aria-hidden", "true");
    ui.gatherProgress.style.width = "0%";
    return;
  }

  const progress = clamp(action.elapsed / action.duration, 0, 1);
  const resourceKey = resourceItemKey(res);

  ui.gatherHud.hidden = false;
  ui.gatherHud.setAttribute("aria-hidden", "false");
  ui.gatherIcon.className = `item-icon ${resourceKey}`;
  ui.gatherName.textContent = resourceMaterialLabel(res);
  ui.gatherProgress.style.width = `${Math.round(progress * 100)}%`;
}

function makeResources() {
  const items = [];
  const rng = mulberry32(73041);
  const specs = [
    { type: "tree", count: 155, r: [24, 37] },
    { type: "stone", count: 54, r: [13, 24] },
    { type: "flower", count: 88, r: [9, 15] },
    { type: "cotton", count: 58, r: [10, 16] },
  ];

  for (const spec of specs) {
    let made = 0;
    let guard = 0;
    while (made < spec.count && guard < spec.count * 80) {
      guard += 1;
      const nearLake = rng() < (spec.type === "flower" || spec.type === "cotton" ? 0.52 : 0.22);
      const lake = pick(lakes, rng);
      const angle = rng() * Math.PI * 2;
      const spread = nearLake ? randRangeSeed(rng, 150, spec.type === "flower" || spec.type === "cotton" ? 420 : 560) : 0;
      const x = nearLake ? lake.x + Math.cos(angle) * (lake.rx + spread) : randRangeSeed(rng, 90, WORLD.w - 90);
      const y = nearLake ? lake.y + Math.sin(angle) * (lake.ry + spread * 0.7) : randRangeSeed(rng, 90, WORLD.h - 90);
      const r = randRangeSeed(rng, spec.r[0], spec.r[1]);
      if (x < 70 || y < 70 || x > WORLD.w - 70 || y > WORLD.h - 70) continue;
      if (inAnyLake(x, y, r + 12)) continue;
      if (items.some((item) => dist(item.x, item.y, x, y) < item.r + r + 18)) continue;
      items.push({
        id: `${spec.type}-${made}`,
        type: spec.type,
        x,
        y,
        r,
        tint: tintFor(spec.type, rng),
      });
      made += 1;
    }
  }
  return items;
}

function makeBots() {
  const names = ["Mika", "Tavi", "Jun", "Pip", "Nora", "Sol", "Ivo", "Lumi", "Bea"];
  for (let i = 0; i < 9; i++) {
    bots.push({
      id: `bot-${i}`,
      name: names[i],
      x: WORLD.w / 2 + randRange(-700, 700),
      y: WORLD.h / 2 + randRange(-520, 520),
      tx: null,
      ty: null,
      speed: randRange(120, 165),
      color: pick(["#eeb1ba", "#f0d16f", "#95d7e8", "#b8db86", "#cfb2ed"]),
      skin: pick(["#f0c59b", "#dba577", "#c98b65", "#f4d2ad"]),
      hair: pick(["#5a3929", "#75543d", "#2f2a25", "#c08245", "#e2c06f"]),
      pants: pick(["#516d75", "#6b7351", "#665d7e", "#5b6c54"]),
      facing: randRange(-Math.PI, Math.PI),
      action: null,
      intent: null,
      hp: 3,
      maxHp: 3,
      defeatedUntil: 0,
      hitUntil: 0,
      aggroUntil: 0,
      attackCooldown: randRange(0.4, 1.2),
      inventory: emptyInventory(),
      mood: Math.random() * 5,
      isBot: true,
    });
  }
}

function pickWorldThing(x, y) {
  const actors = [...bots, ...others.values(), player];
  let bestActor = null;
  let bestActorD = 9999;
  for (const actor of actors) {
    if (isBotDefeated(actor)) continue;
    const d = dist(x, y, actor.x, actor.y);
    const radius = actor.isBot ? 52 : 24;
    if (d < radius && d < bestActorD) {
      bestActor = actor;
      bestActorD = d;
    }
  }
  if (bestActor) return { kind: "player", id: bestActor.id, actor: bestActor };

  let bestLoot = null;
  let bestLootD = 9999;
  for (const loot of droppedLoot) {
    const d = dist(x, y, loot.x, loot.y);
    if (d < 34 && d < bestLootD) {
      bestLoot = loot;
      bestLootD = d;
    }
  }
  if (bestLoot) return { kind: "loot", loot: bestLoot };

  let best = null;
  let bestD = 9999;
  for (const res of resources) {
    const d = dist(x, y, res.x, res.y);
    if (d < resourceClickRadius(res) && d < bestD) {
      best = res;
      bestD = d;
    }
  }
  return best ? { kind: "resource", resource: best } : null;
}

function nearestResource(x, y, radius, filter) {
  let best = null;
  let bestD = radius;
  for (const res of resources) {
    if (filter && !filter(res)) continue;
    const d = dist(x, y, res.x, res.y);
    if (d < bestD) {
      best = res;
      bestD = d;
    }
  }
  return best;
}

function resolveBlockedMove(ox, oy, nx, ny, radius) {
  if (!isBlocked(nx, ny, radius)) return { x: nx, y: ny };
  if (!isBlocked(nx, oy, radius)) return { x: nx, y: oy };
  if (!isBlocked(ox, ny, radius)) return { x: ox, y: ny };
  return { x: ox, y: oy };
}

function isBlocked(x, y, radius) {
  if (inAnyLake(x, y, radius)) return true;
  for (const building of buildings) {
    if (!building.blocks) continue;
    if (rectCircleIntersects(buildRect(building), x, y, radius)) return true;
  }
  for (const res of resources) {
    if (isDepleted(res) || res.type === "flower" || res.type === "cotton") continue;
    if (dist(x, y, res.x, res.y) < radius + res.r * (res.type === "tree" ? 0.52 : 0.68)) return true;
  }
  return false;
}

function inAnyLake(x, y, radius) {
  return lakes.some((lake) => {
    const ca = Math.cos(-lake.a);
    const sa = Math.sin(-lake.a);
    const dx = x - lake.x;
    const dy = y - lake.y;
    const rx = dx * ca - dy * sa;
    const ry = dx * sa + dy * ca;
    const v = (rx * rx) / ((lake.rx + radius) ** 2) + (ry * ry) / ((lake.ry + radius) ** 2);
    return v < 1;
  });
}

function isDepleted(res) {
  return Boolean(resourceState[res.id]?.depletedUntil && resourceState[res.id].depletedUntil > Date.now());
}

function resourceTier(res) {
  return res.tier || 1;
}

function resourceNodeCount(res) {
  if (res.type === "tree") return resourceTier(res) + 1;
  if (res.type === "stone") return 2;
  return 1;
}

function resourceDepletedNodes(res) {
  const state = resourceState[res.id];
  if (!state) return 0;
  if (state.depletedUntil && state.depletedUntil > Date.now()) return resourceNodeCount(res);
  return clamp(state.nodesDepleted || 0, 0, resourceNodeCount(res));
}

function resourceRemainingNodes(res) {
  return Math.max(0, resourceNodeCount(res) - resourceDepletedNodes(res));
}

function resourceNextNodeIndex(res) {
  return clamp(resourceDepletedNodes(res), 0, resourceNodeCount(res) - 1);
}

function createGatherAction(res, multiplier = 1) {
  return {
    resourceId: res.id,
    nodeIndex: resourceNextNodeIndex(res),
    elapsed: 0,
    duration: gatherDuration(res) * multiplier,
  };
}

function resourceNodeAnchorY(res) {
  if (res.type === "tree") return -res.r * 2.2 - 18;
  if (res.type === "stone") return -res.r * 1.28 - 22;
  return -res.r * 2 - 18;
}

function gatherDuration(res) {
  if (res.type === "tree") return 4.2;
  if (res.type === "stone") return 3.1;
  return 1.45;
}

function respawnMs(res) {
  if (res.type === "tree") return 45000;
  if (res.type === "stone") return 32000;
  return 18000;
}

function actionVerb(res) {
  if (res.type === "tree") return "Chopping";
  if (res.type === "stone") return "Mining";
  return "Picking";
}

function resourceInteractionRadius(res) {
  if (res.type === "tree") return res.r + 54;
  if (res.type === "stone") return res.r + 38;
  return res.r + 30;
}

function resourceClickRadius(res) {
  if (isDepleted(res) && res.type === "tree") return 18;
  if (res.type === "tree") return res.r + 36;
  if (res.type === "stone") return res.r + 14;
  return res.r + 12;
}

function resourceApproachDistance(res) {
  if (res.type === "tree") return res.r + 46;
  if (res.type === "stone") return res.r + 30;
  return res.r + 22;
}

function chooseResourceApproach(res, fromX = player.x, fromY = player.y) {
  const radius = resourceApproachDistance(res);
  const base = Math.atan2(fromY - res.y, fromX - res.x) || 0;
  const offsets = [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, Math.PI];
  let best = null;
  let bestScore = Infinity;

  for (const offset of offsets) {
    const a = base + offset;
    const candidate = {
      x: clamp(res.x + Math.cos(a) * radius, 28, WORLD.w - 28),
      y: clamp(res.y + Math.sin(a) * radius, 28, WORLD.h - 28),
    };
    if (isBlocked(candidate.x, candidate.y, 12)) continue;
    const score = dist(fromX, fromY, candidate.x, candidate.y) + Math.abs(offset) * 18;
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best || pointNear(res.x, res.y, radius, fromX, fromY);
}

function resourceLabel(res) {
  if (res.type === "tree") return isDepleted(res) ? "Soft stump" : "Roundleaf tree";
  if (res.type === "stone") return "Moss stone";
  if (res.type === "cotton") return "Cotton tuft";
  return "Glowflower";
}

function resourceMaterialLabel(res) {
  if (res.type === "tree") return "Wood";
  if (res.type === "stone") return "Stone";
  if (res.type === "cotton") return "Cotton";
  return "Flower";
}

function resourceItemKey(res) {
  if (res.type === "tree") return "wood";
  if (res.type === "stone") return "stone";
  if (res.type === "cotton") return "cotton";
  return "flower";
}

function gatherColor(res) {
  if (res.type === "tree") return "#d2aa69";
  if (res.type === "stone") return "#e3e5db";
  if (res.type === "cotton") return "#fff8df";
  return "#ffd6ea";
}

function gatherGlow(res, alpha) {
  if (res.type === "tree") return `rgba(210, 170, 105, ${alpha})`;
  if (res.type === "stone") return `rgba(227, 229, 219, ${alpha})`;
  if (res.type === "cotton") return `rgba(255, 248, 223, ${alpha})`;
  return `rgba(255, 214, 234, ${alpha})`;
}

function updateGatherAnimation(actor, res) {
  const action = actor.action;
  if (!action) return;
  if (action.nextImpactAt == null) action.nextImpactAt = 0.12;

  const cadence = res.type === "tree" ? 0.42 : res.type === "stone" ? 0.34 : 0.24;
  while (action.elapsed >= action.nextImpactAt) {
    gatherImpact(actor, res, clamp(action.elapsed / action.duration, 0, 1));
    action.nextImpactAt += cadence;
  }
}

function gatherImpact(actor, res, progress = 0) {
  const color = gatherColor(res);
  const toActor = Math.atan2(actor.y - res.y, actor.x - res.x);
  const hitRadius = res.r * (res.type === "tree" ? 0.48 : res.type === "stone" ? 0.3 : 0.7);
  const hitX = res.x + Math.cos(toActor) * hitRadius + randRange(-3, 3);
  const hitY = res.y + Math.sin(toActor) * hitRadius + randRange(-3, 3);
  const count = res.type === "flower" || res.type === "cotton" ? 3 : 5;
  const sfxName = res.type === "tree" ? "chop" : res.type === "stone" ? "mine" : "pick";
  const sfxIntensity = 0.82 + progress * 0.25;
  if (actor.id === player.id) {
    playSfx(sfxName, sfxIntensity);
    announceSfx(sfxName, hitX, hitY, sfxIntensity * 0.88, res.type === "flower" || res.type === "cotton" ? 520 : 760);
  } else {
    playWorldSfx(sfxName, hitX, hitY, sfxIntensity * 0.72, res.type === "flower" || res.type === "cotton" ? 480 : 720);
  }

  particles.push({
    kind: "ring",
    x: hitX,
    y: hitY,
    vx: 0,
    vy: 0,
    r: res.type === "flower" || res.type === "cotton" ? 6 : 9,
    grow: res.type === "stone" ? 10 : 14,
    color: gatherGlow(res, 0.58),
    life: 0.34,
    max: 0.34,
    lineWidth: res.type === "stone" ? 1.7 : 2.2,
    gravity: 0,
    front: true,
  });

  for (let i = 0; i < count; i++) {
    const spread = randRange(-0.86, 0.86);
    const speed = res.type === "flower" || res.type === "cotton" ? randRange(18, 34) : randRange(34, 78);
    particles.push({
      x: hitX + randRange(-4, 4),
      y: hitY + randRange(-4, 4),
      vx: Math.cos(toActor + spread) * speed,
      vy: Math.sin(toActor + spread) * speed - randRange(8, 24),
      r: res.type === "flower" || res.type === "cotton" ? randRange(1.8, 3.1) : randRange(1.3, 2.8),
      color: i === 0 && progress > 0.86 ? "#fff4a6" : color,
      life: res.type === "flower" || res.type === "cotton" ? randRange(0.52, 0.9) : randRange(0.34, 0.7),
      max: 0.9,
      gravity: res.type === "flower" || res.type === "cotton" ? -4 : 42,
      front: true,
    });
  }
}

function drawGatherLink(actor, res, bob) {
  const dx = res.x - actor.x;
  const dy = res.y - (actor.y + bob);
  const d = Math.hypot(dx, dy);
  if (d <= 0) return;

  const progress = clamp(actor.action.elapsed / actor.action.duration, 0, 1);
  const pulse = Math.sin(now * 0.014 + actor.x * 0.02) * 0.5 + 0.5;
  const a = Math.atan2(dy, dx);
  const start = 16;
  const end = Math.max(start + 8, d - res.r * 0.45);

  ctx.save();
  ctx.rotate(a);
  ctx.setLineDash([3 + pulse * 4, 8]);
  ctx.lineCap = "round";
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = gatherGlow(res, 0.18 + pulse * 0.18);
  ctx.beginPath();
  ctx.moveTo(start, -2);
  ctx.lineTo(end, -2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.save();
  ctx.translate(dx, dy);
  ctx.strokeStyle = gatherGlow(res, 0.3 + pulse * 0.32);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, res.r * (0.58 + pulse * 0.18), -Math.PI * 0.25, Math.PI * (1.2 + progress * 0.35));
  ctx.stroke();
  ctx.restore();
}

function drawGatherTool(actor, res) {
  const angle = Math.atan2(res.y - actor.y, res.x - actor.x);
  const pulse = Math.sin(now * (res.type === "stone" ? 0.024 : 0.018) + actor.x * 0.015);
  const reachX = Math.cos(angle) * 10;
  const reachY = Math.sin(angle) * 7 - 3;

  ctx.save();
  ctx.translate(reachX, reachY);

  if (res.type === "flower" || res.type === "cotton") {
    ctx.rotate(angle);
    ctx.strokeStyle = gatherGlow(res, 0.58);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(8, -2, 9 + pulse * 2, -0.9, 0.88);
    ctx.stroke();
    ctx.fillStyle = res.type === "cotton" ? "#fffdf2" : "#ffd6ea";
    for (let i = 0; i < 3; i++) {
      const t = now * 0.004 + i * 2.1;
      ctx.beginPath();
      ctx.ellipse(11 + Math.cos(t) * 5, -3 + Math.sin(t) * 4, 2.2, 3.4, t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  ctx.rotate(angle - 0.75 + pulse * 0.58);
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(39, 48, 45, 0.5)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-2, 2);
  ctx.lineTo(20, 0);
  ctx.stroke();
  ctx.strokeStyle = "#8c6040";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-2, 2);
  ctx.lineTo(20, 0);
  ctx.stroke();

  ctx.strokeStyle = res.type === "tree" ? "#e9dfb5" : "#f2f5e8";
  ctx.lineWidth = res.type === "tree" ? 4 : 3;
  ctx.beginPath();
  if (res.type === "tree") {
    ctx.moveTo(17, -7);
    ctx.quadraticCurveTo(26, -5, 24, 4);
  } else {
    ctx.moveTo(15, -8);
    ctx.lineTo(27, -2);
    ctx.moveTo(18, 6);
    ctx.lineTo(27, -2);
  }
  ctx.stroke();
  ctx.restore();
}

function pointNear(x, y, radius, fromX = player.x, fromY = player.y) {
  const a = Math.atan2(fromY - y, fromX - x) || Math.random() * Math.PI * 2;
  return {
    x: clamp(x + Math.cos(a) * radius, 28, WORLD.w - 28),
    y: clamp(y + Math.sin(a) * radius, 28, WORLD.h - 28),
  };
}

function visibleBounds(pad = 0) {
  const w = width / camera.zoom;
  const h = height / camera.zoom;
  return { x: camera.x - w / 2 - pad, y: camera.y - h / 2 - pad, w: w + pad * 2, h: h + pad * 2 };
}

function screenToWorld(x, y) {
  return {
    x: camera.x + (x - width / 2) / camera.zoom,
    y: camera.y + (y - height / 2) / camera.zoom,
  };
}

function worldToScreen(x, y) {
  return {
    x: (x - camera.x) * camera.zoom + width / 2,
    y: (y - camera.y) * camera.zoom + height / 2,
  };
}

function sparkle(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = randRange(12, 60);
    particles.push({
      x: x + randRange(-8, 8),
      y: y + randRange(-8, 8),
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - randRange(8, 26),
      r: randRange(1.6, 3.6),
      color,
      life: randRange(0.45, 1.1),
      max: 1.1,
      gravity: 46,
      front: true,
    });
  }
}

function addFloat(x, y, text) {
  floatText.push({ x, y, text, life: 1.5, max: 1.5 });
}

function announce(type, payload = {}) {
  if (!channel) return;
  const message = { id: CLIENT_ID, type, ...payload };
  if (type === "hello" || type === "player") {
    message.player = {
      id: player.id,
      name: player.name,
      x: player.x,
      y: player.y,
      tx: player.tx,
      ty: player.ty,
      color: player.color,
      skin: player.skin,
      hair: player.hair,
      pants: player.pants,
      facing: player.facing,
      action: player.action,
    };
  }
  channel.postMessage(message);
}

function saveResourceState() {
  saveJson(RESOURCE_VERSION, resourceState);
}

function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function openNameModal() {
  ui.nameInput.value = player.name;
  ui.nameModal.classList.add("is-open");
  ui.nameModal.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    ui.nameInput.focus();
    ui.nameInput.select();
  }, 30);
}

function tintFor(type, rng) {
  if (type === "tree") return pick(["#6ea45c", "#78ae68", "#83b66e", "#639858"], rng);
  if (type === "stone") return "#d8ddd0";
  if (type === "cotton") return "#fffdf2";
  return pick(["#f7a8c8", "#ffd36c", "#b9ec85", "#aacdf8"], rng);
}

function emptyInventory() {
  return {
    wood: 0,
    stone: 0,
    flower: 0,
    cotton: 0,
    wood_block: 0,
    stone_brick: 0,
    cloth: 0,
    petal_extract: 0,
    bandage: 0,
    cloth_cap: 0,
    padded_vest: 0,
    wooden_shield: 0,
    trail_boots: 0,
    petal_charm: 0,
  };
}

function normalizeInventory(items = {}) {
  return { ...emptyInventory(), ...items };
}

function inventoryTotal(items = emptyInventory()) {
  return Object.values(normalizeInventory(items)).reduce((total, count) => total + (Number(count) || 0), 0);
}

function inventorySummary(items = emptyInventory()) {
  const normalized = normalizeInventory(items);
  const parts = Object.keys(normalized)
    .filter((key) => normalized[key] > 0)
    .map((key) => countLabel(key, normalized[key]));
  return parts.length ? parts.join(", ") : "nothing";
}

function showPickupToast(items = emptyInventory()) {
  if (!ui.pickupToasts) return;
  const entries = Object.entries(normalizeInventory(items)).filter(([, count]) => count > 0);
  if (!entries.length) return;

  const toast = document.createElement("div");
  toast.className = "pickup-toast";
  toast.setAttribute("role", "status");

  const firstItem = itemForKey(entries[0][0], { includeLocked: true });
  const firstIcon = document.createElement("span");
  firstIcon.className = `item-icon ${firstItem?.className || entries[0][0].replaceAll("_", "-")}`;
  firstIcon.setAttribute("aria-hidden", "true");

  const body = document.createElement("div");
  body.className = "pickup-toast-body";

  const list = document.createElement("div");
  list.className = "pickup-toast-items";
  for (const [key, count] of entries) {
    const item = itemForKey(key, { includeLocked: true });
    const row = document.createElement("span");
    const amount = document.createElement("strong");
    amount.textContent = `+ ${count}`;
    const name = document.createElement("span");
    name.textContent = count === 1 ? item?.singular || item?.name || key : item?.plural || item?.name || key;
    row.append(amount, name);
    list.appendChild(row);
  }
  body.appendChild(list);

  toast.append(firstIcon, body);
  ui.pickupToasts.appendChild(toast);

  while (ui.pickupToasts.children.length > MAX_PICKUP_TOASTS) {
    ui.pickupToasts.firstElementChild?.remove();
  }

  window.setTimeout(() => toast.classList.add("is-leaving"), PICKUP_TOAST_MS);
  window.setTimeout(() => toast.remove(), PICKUP_TOAST_MS + PICKUP_TOAST_EXIT_MS);
}

function lootDots(items) {
  const normalized = normalizeInventory(items);
  return [
    normalized.wood ? { color: "#d4ad62" } : null,
    normalized.stone ? { color: "#dfe3d4" } : null,
    normalized.flower ? { color: "#ffd0ee" } : null,
    normalized.cotton ? { color: "#fff8df" } : null,
    normalized.wood_block ? { color: "#c99756" } : null,
    normalized.stone_brick ? { color: "#cbd1c6" } : null,
    normalized.cloth ? { color: "#f0e6cb" } : null,
    normalized.petal_extract ? { color: "#f9bdd9" } : null,
    normalized.bandage ? { color: "#e8d9b4" } : null,
  ].filter(Boolean);
}

function countLabel(key, count) {
  const item = itemDefs.find((def) => def.key === key);
  const name = count === 1 ? item?.singular || item?.name || key : item?.plural || item?.name || key;
  return `${count} ${name}`;
}

function roundedBlob(x, y, w, h, wobble = 0.35, turn = 0) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  ctx.beginPath();
  for (let i = 0; i <= 18; i++) {
    const a = (i / 18) * Math.PI * 2 + turn;
    const r = 1 + Math.sin(a * 3.1 + x * 0.01) * wobble * 0.11 + Math.cos(a * 2.2 + y * 0.01) * wobble * 0.08;
    const px = cx + Math.cos(a) * (w / 2) * r;
    const py = cy + Math.sin(a) * (h / 2) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function blobCircle(x, y, r) {
  roundedBlob(x - r, y - r, r * 2, r * 2, 0.55, x * 0.01);
  ctx.fill();
}

function roundRect(x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function randomName() {
  return `${pick(["Moss", "Fern", "Pebble", "Clover", "Sunny", "Twig"])} ${Math.floor(randRange(10, 99))}`;
}

function mulberry32(seed) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(list, rng = Math.random) {
  return list[Math.floor(rng() * list.length)];
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function randRangeSeed(rng, min, max) {
  return min + rng() * (max - min);
}

function snapToGrid(value) {
  return Math.round(value / 24) * 24;
}

function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function rectCircleIntersects(rect, x, y, radius) {
  const nearestX = clamp(x, rect.x - rect.w / 2, rect.x + rect.w / 2);
  const nearestY = clamp(y, rect.y - rect.h / 2, rect.y + rect.h / 2);
  return dist(x, y, nearestX, nearestY) < radius;
}

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / lenSq, 0, 1);
  return dist(px, py, ax + dx * t, ay + dy * t);
}

function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
