import { createClient } from '@supabase/supabase-js';

const PLAYER_ID_STORAGE_KEY = 'mossvale_player_id';
const PLAYER_POSITION_STORAGE_PREFIX = 'mossvale_player_position';
const PLAYER_TABLE = 'mossvale_players';
const PLAYER_STATE_TABLE = 'mossvale_player_states';
const WORLD_TABLE = 'mossvale_worlds';
const ACTIVE_PLAYER_MS = 45000;
const EQUIPMENT_SLOTS = ['head', 'weapon', 'body', 'offhand', 'feet', 'charm'];

let warnedMissingConfig = false;
let saveTimer = null;
let pendingState = null;
let inFlightSave = null;
let positionSaveTimer = null;
let pendingPosition = null;
let inFlightPositionSave = null;
let worldSaveTimer = null;
let pendingWorldState = null;
let inFlightWorldSave = null;
let supabaseClient = null;
let supabaseClientKey = '';
let worldStateCache = {
  resources: {},
  buildings: [],
  planted_resources: [],
  bots: [],
  dropped_loot: [],
};

function safeId(value, maxLength) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value)
    ? value.slice(0, maxLength)
    : '';
}

function normalizeEquipment(equipment = {}, fallback = {}) {
  return Object.fromEntries(
    EQUIPMENT_SLOTS.map((slot) => {
      const hasEquipmentSlot = Object.prototype.hasOwnProperty.call(equipment || {}, slot);
      const raw = hasEquipmentSlot ? equipment?.[slot] : fallback?.[slot];
      return [slot, safeId(raw, 40) || null];
    }),
  );
}

function serializeQuickSlots(state = {}) {
  return {
    slots: Array.isArray(state.quickSlots) ? state.quickSlots : [],
    selectedSlot: Number.isInteger(state.selectedSlot) ? state.selectedSlot : 0,
  };
}

function normalizeSupabaseConfig() {
  const config = window.MOSSVALE_SUPABASE;
  if (!config?.url || !config?.publishableKey) {
    if (!warnedMissingConfig) {
      console.info('Mossvale cloud saves disabled: Supabase config is missing.');
      warnedMissingConfig = true;
    }
    return null;
  }

  let url;
  try {
    url = new URL(config.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co')) {
    return null;
  }

  return {
    url: url.href.replace(/\/$/, ''),
    publishableKey: String(config.publishableKey),
    worldId: safeId(config.worldId, 48) || 'main',
  };
}

function getSupabaseClient() {
  const config = normalizeSupabaseConfig();
  if (!config) return null;

  const key = `${config.url}|${config.publishableKey}`;
  if (!supabaseClient || supabaseClientKey !== key) {
    supabaseClient = createClient(config.url, config.publishableKey);
    supabaseClientKey = key;
  }
  return { client: supabaseClient, config };
}

export function loadStablePlayerId() {
  const existing = safeId(window.localStorage.getItem(PLAYER_ID_STORAGE_KEY), 80);
  if (existing) return existing;

  const sessionExisting = safeId(
    window.sessionStorage?.getItem(PLAYER_ID_STORAGE_KEY),
    80,
  );
  if (sessionExisting) {
    window.localStorage.setItem(PLAYER_ID_STORAGE_KEY, sessionExisting);
    return sessionExisting;
  }

  const raw =
    window.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.floor(Math.random() * 999999)}`;
  const next = `player-${raw}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  window.localStorage.setItem(PLAYER_ID_STORAGE_KEY, next);
  return next;
}

function restUrl(config, table, query = '') {
  return `${config.url}/rest/v1/${table}${query}`;
}

function headers(config, extra = {}) {
  return {
    apikey: config.publishableKey,
    Authorization: `Bearer ${config.publishableKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

function normalizePlayerPosition(position = {}) {
  const x = Number(position.x);
  const z = Number(position.z ?? position.y);
  const facing = Number(position.facing);
  const actionSequence = Number(position.action_sequence ?? position.actionSequence);
  const updatedAt = Date.parse(position.updated_at ?? position.updatedAt ?? '');
  const equipment = normalizeEquipment(position.equipment, {
    weapon: position.weapon_id ?? position.weaponId,
    offhand: position.offhand_id ?? position.offhandId,
  });
  return {
    id: safeId(position.player_id ?? position.id, 80),
    x: Number.isFinite(x) ? x : 0,
    y: 0,
    z: Number.isFinite(z) ? z : 0,
    facing: Number.isFinite(facing) ? facing : 0,
    name: typeof position.name === 'string' ? position.name.slice(0, 40) : null,
    equipment,
    weaponId: equipment.weapon ?? (safeId(position.weapon_id ?? position.weaponId, 40) || 'stick'),
    offhandId: equipment.offhand,
    movementState:
      ['idle', 'walking', 'running'].includes(
        position.movement_state ?? position.movementState,
      )
        ? position.movement_state ?? position.movementState
        : 'idle',
    actionState:
      ['idle', 'attack', 'gather', 'block'].includes(
        position.action_state ?? position.actionState,
      )
        ? position.action_state ?? position.actionState
        : 'idle',
    actionTool: safeId(position.action_tool ?? position.actionTool, 40) || null,
    actionSequence: Number.isFinite(actionSequence) ? actionSequence : 0,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
  };
}

function localPlayerPositionKey(worldId = 'main', playerId = loadStablePlayerId()) {
  return `${PLAYER_POSITION_STORAGE_PREFIX}:${safeId(worldId, 48) || 'main'}:${playerId}`;
}

function saveLocalPlayerPosition(position, worldId) {
  const next = normalizePlayerPosition(position);
  window.localStorage.setItem(
    localPlayerPositionKey(worldId),
    JSON.stringify({
      ...next,
      updatedAt: Date.now(),
    }),
  );
}

function loadLocalPlayerPosition(worldId) {
  try {
    const raw = window.localStorage.getItem(localPlayerPositionKey(worldId));
    if (!raw) return null;
    const position = normalizePlayerPosition(JSON.parse(raw));
    return Number.isFinite(position.x) && Number.isFinite(position.z)
      ? position
      : null;
  } catch {
    return null;
  }
}

export async function loadCloudPlayerPosition() {
  const config = normalizeSupabaseConfig();
  if (!config) return loadLocalPlayerPosition();

  const playerId = loadStablePlayerId();
  const query = new URLSearchParams({
    select:
      'name,x,y,facing,weapon_id,offhand_id,equipment,movement_state,action_state,action_tool,action_sequence,updated_at',
    world_id: `eq.${config.worldId}`,
    player_id: `eq.${playerId}`,
    limit: '1',
  });

  try {
    const response = await fetch(restUrl(config, PLAYER_TABLE, `?${query}`), {
      headers: headers(config),
    });
    if (!response.ok) {
      throw new Error(`Cloud player position load failed: ${response.status}`);
    }

    const [position] = await response.json();
    return position
      ? normalizePlayerPosition(position)
      : loadLocalPlayerPosition(config.worldId);
  } catch (error) {
    const localPosition = loadLocalPlayerPosition(config.worldId);
    if (localPosition) return localPosition;
    throw error;
  }
}

async function saveCloudPlayerPositionNow(position) {
  const config = normalizeSupabaseConfig();
  saveLocalPlayerPosition(position, config?.worldId);
  if (!config) return false;

  const playerId = loadStablePlayerId();
  const next = normalizePlayerPosition(position);
  const response = await fetch(
    restUrl(config, PLAYER_TABLE, '?on_conflict=world_id,player_id'),
    {
      method: 'POST',
      headers: headers(config, {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify({
        world_id: config.worldId,
        player_id: playerId,
        name: next.name || 'Traveler',
        x: next.x,
        y: next.z,
        facing: next.facing,
        weapon_id: next.weaponId || 'stick',
        offhand_id: next.offhandId,
        equipment: next.equipment,
        movement_state: next.movementState || 'idle',
        action_state: next.actionState || 'idle',
        action_tool: next.actionTool,
        action_sequence: next.actionSequence || 0,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Cloud player position save failed: ${response.status}`);
  }
  return true;
}

export function scheduleCloudPlayerPositionSave(position, delayMs = 120) {
  pendingPosition = position;
  if (positionSaveTimer != null) return;

  positionSaveTimer = window.setTimeout(async () => {
    positionSaveTimer = null;
    if (inFlightPositionSave) await inFlightPositionSave.catch(() => {});
    const positionToSave = pendingPosition;
    pendingPosition = null;
    if (!positionToSave) return;

    inFlightPositionSave = saveCloudPlayerPositionNow(positionToSave)
      .catch((error) => {
        console.warn('Mossvale cloud player position save failed', error);
      })
      .finally(() => {
        inFlightPositionSave = null;
      });
  }, delayMs);
}

export function flushCloudPlayerPositionSave() {
  if (positionSaveTimer != null) {
    window.clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  }
  const positionToSave = pendingPosition;
  pendingPosition = null;
  if (!positionToSave) return;
  saveCloudPlayerPositionNow(positionToSave).catch((error) => {
    console.warn('Mossvale cloud player position save failed', error);
  });
}

export async function loadCloudPlayers() {
  const config = normalizeSupabaseConfig();
  if (!config) return [];

  const cutoff = new Date(Date.now() - ACTIVE_PLAYER_MS).toISOString();
  const query = new URLSearchParams({
    select:
      'player_id,name,x,y,facing,weapon_id,offhand_id,equipment,movement_state,action_state,action_tool,action_sequence,updated_at',
    world_id: `eq.${config.worldId}`,
    updated_at: `gte.${cutoff}`,
    order: 'updated_at.desc',
  });

  const response = await fetch(restUrl(config, PLAYER_TABLE, `?${query}`), {
    headers: headers(config),
  });
  if (!response.ok) {
    throw new Error(`Cloud player list load failed: ${response.status}`);
  }

  const players = await response.json();
  return Array.isArray(players) ? players.map(normalizePlayerPosition) : [];
}

export function subscribeCloudPlayers(onPlayerChange) {
  const setup = getSupabaseClient();
  if (!setup) return () => {};

  const { client, config } = setup;
  const channel = client
    .channel(`mossvale-players-${config.worldId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: PLAYER_TABLE,
        filter: `world_id=eq.${config.worldId}`,
      },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = safeId(payload.old?.player_id, 80);
          if (id) onPlayerChange({ type: 'remove', id });
          return;
        }
        const player = normalizePlayerPosition(payload.new || {});
        if (player.id) onPlayerChange({ type: 'upsert', player });
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('Mossvale realtime player subscription failed.');
      }
    });

  return () => {
    client.removeChannel(channel);
  };
}

export async function loadCloudPlayerState() {
  const config = normalizeSupabaseConfig();
  if (!config) return null;

  const playerId = loadStablePlayerId();
  const query = new URLSearchParams({
    select: 'inventory,owned_weapons,equipment,inventory_layout,quick_slots',
    world_id: `eq.${config.worldId}`,
    player_id: `eq.${playerId}`,
    limit: '1',
  });

  const response = await fetch(restUrl(config, PLAYER_STATE_TABLE, `?${query}`), {
    headers: headers(config),
  });
  if (!response.ok) {
    throw new Error(`Cloud player state load failed: ${response.status}`);
  }

  const [state] = await response.json();
  return state || null;
}

async function saveCloudPlayerStateNow(state) {
  const config = normalizeSupabaseConfig();
  if (!config) return false;

  const playerId = loadStablePlayerId();
  const response = await fetch(
    restUrl(config, PLAYER_STATE_TABLE, '?on_conflict=world_id,player_id'),
    {
      method: 'POST',
      headers: headers(config, {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify({
        world_id: config.worldId,
        player_id: playerId,
        inventory: state.inventory || {},
        owned_weapons: state.ownedWeapons || {},
        equipment: state.equipment || {},
        inventory_layout: state.inventoryLayout || [],
        quick_slots: serializeQuickSlots(state),
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Cloud player state save failed: ${response.status}`);
  }
  return true;
}

export function scheduleCloudPlayerStateSave(state, delayMs = 450) {
  pendingState = state;
  if (saveTimer != null) return;

  saveTimer = window.setTimeout(async () => {
    saveTimer = null;
    if (inFlightSave) await inFlightSave.catch(() => {});
    const stateToSave = pendingState;
    pendingState = null;
    if (!stateToSave) return;

    inFlightSave = saveCloudPlayerStateNow(stateToSave)
      .catch((error) => {
        console.warn('Mossvale cloud player state save failed', error);
      })
      .finally(() => {
        inFlightSave = null;
      });
  }, delayMs);
}

export function flushCloudPlayerStateSave() {
  if (saveTimer != null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  const stateToSave = pendingState;
  pendingState = null;
  if (!stateToSave) return;
  saveCloudPlayerStateNow(stateToSave).catch((error) => {
    console.warn('Mossvale cloud player state save failed', error);
  });
}

function normalizeWorldState(world = {}) {
  return {
    resources: world.resources && typeof world.resources === 'object'
      ? world.resources
      : {},
    buildings: Array.isArray(world.buildings) ? world.buildings : [],
    planted_resources: Array.isArray(world.planted_resources)
      ? world.planted_resources
      : [],
    bots: Array.isArray(world.bots) ? world.bots : [],
    dropped_loot: Array.isArray(world.dropped_loot) ? world.dropped_loot : [],
  };
}

export async function loadCloudWorldState() {
  const config = normalizeSupabaseConfig();
  if (!config) return null;

  const query = new URLSearchParams({
    select: 'resources,buildings,planted_resources,bots,dropped_loot',
    id: `eq.${config.worldId}`,
    limit: '1',
  });

  const response = await fetch(restUrl(config, WORLD_TABLE, `?${query}`), {
    headers: headers(config),
  });
  if (!response.ok) {
    throw new Error(`Cloud world state load failed: ${response.status}`);
  }

  const [state] = await response.json();
  if (!state) return null;
  worldStateCache = normalizeWorldState(state);
  return worldStateCache;
}

async function saveCloudWorldStateNow(state) {
  const config = normalizeSupabaseConfig();
  if (!config) return false;

  const next = normalizeWorldState(state);
  const response = await fetch(
    restUrl(config, WORLD_TABLE, '?on_conflict=id'),
    {
      method: 'POST',
      headers: headers(config, {
        Prefer: 'resolution=merge-duplicates,return=minimal',
      }),
      body: JSON.stringify({
        id: config.worldId,
        resources: next.resources,
        buildings: next.buildings,
        planted_resources: next.planted_resources,
        bots: next.bots,
        dropped_loot: next.dropped_loot,
        updated_at: new Date().toISOString(),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Cloud world state save failed: ${response.status}`);
  }
  worldStateCache = next;
  return true;
}

export function scheduleCloudWorldStateSave(patch, delayMs = 650) {
  pendingWorldState = normalizeWorldState({
    ...worldStateCache,
    ...pendingWorldState,
    ...patch,
  });
  if (worldSaveTimer != null) return;

  worldSaveTimer = window.setTimeout(async () => {
    worldSaveTimer = null;
    if (inFlightWorldSave) await inFlightWorldSave.catch(() => {});
    const stateToSave = pendingWorldState;
    pendingWorldState = null;
    if (!stateToSave) return;

    inFlightWorldSave = saveCloudWorldStateNow(stateToSave)
      .catch((error) => {
        console.warn('Mossvale cloud world state save failed', error);
      })
      .finally(() => {
        inFlightWorldSave = null;
      });
  }, delayMs);
}

export function flushCloudWorldStateSave() {
  if (worldSaveTimer != null) {
    window.clearTimeout(worldSaveTimer);
    worldSaveTimer = null;
  }
  const stateToSave = pendingWorldState;
  pendingWorldState = null;
  if (!stateToSave) return;
  saveCloudWorldStateNow(stateToSave).catch((error) => {
    console.warn('Mossvale cloud world state save failed', error);
  });
}

export function subscribeCloudWorldState(onWorldState) {
  const setup = getSupabaseClient();
  if (!setup) return () => {};

  const { client, config } = setup;
  const channel = client
    .channel(`mossvale-world-${config.worldId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: WORLD_TABLE,
        filter: `id=eq.${config.worldId}`,
      },
      (payload) => {
        const next = normalizeWorldState(payload.new || {});
        worldStateCache = next;
        onWorldState(next);
      },
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR') {
        console.warn('Mossvale realtime world subscription failed.');
      }
    });

  return () => {
    client.removeChannel(channel);
  };
}
