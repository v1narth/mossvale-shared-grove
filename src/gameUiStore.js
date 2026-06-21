import { createStore } from 'zustand/vanilla';
import {
  BAG_SLOT_COUNT,
  PLAYER_NAME_STORAGE_KEY,
  QUICK_SLOT_COUNT,
  baseItemForKey,
  buildPieces,
  canEquipItemInSlot,
  countLabel,
  defaultOwnedWeapons,
  emptyEquipment,
  emptyInventory,
  equipmentSlotForItem,
  inventorySummary,
  itemLevelText,
  normalizeInventory,
  weaponDefs,
} from './gameUiData.js';
import { playSfx } from './audioRuntime.js';
import {
  flushCloudPlayerStateSave,
  flushCloudWorldStateSave,
  loadCloudPlayerState,
  loadCloudWorldState,
  scheduleCloudPlayerStateSave,
  scheduleCloudWorldStateSave,
} from './cloudPersistence.js';

const DEFAULT_QUICK_KEYS = ['stick', null, null, null, null, null, null, null, null];
const LOCAL_WORLD_SYNC_GRACE_MS = 15000;
const LOADING_STEPS = [
  { id: 'world', label: 'World', detail: 'Sync shared grove state.' },
  { id: 'player', label: 'Player', detail: 'Restore position and traveler stats.' },
  { id: 'inventory', label: 'Inventory', detail: 'Load equipment and quick slots.' },
  { id: 'server', label: 'Server', detail: 'Connect to the game server.' },
  { id: 'assets', label: 'Assets', detail: 'Load models, animations, and textures.' },
  { id: 'vegetation', label: 'Vegetation', detail: 'Prepare trees, rocks, and gatherable plants.' },
  { id: 'settle', label: 'Scene', detail: 'Warm up shadows and first frames.' },
];
const LOADING_PHRASES = {
  world: [
    'Unfolding the map...',
    'Convincing the grove to exist...',
    'Checking which trees remember you...',
    'Asking the stones where they were left...',
  ],
  player: [
    'Finding your boots...',
    'Remembering where you stood...',
    'Dusting off your traveler...',
    'Pointing your face the right way...',
  ],
  inventory: [
    'Counting sticks very seriously...',
    'Publishing inventory...',
    'Sorting pockets by mysterious logic...',
    'Checking that your axe is still yours...',
  ],
  server: [
    'Finding the game server...',
    'Opening the world gate...',
    'Waiting for the server handshake...',
    'Tuning the multiplayer thread...',
  ],
  assets: [
    'Sharpening polygons...',
    'Teaching animations to behave...',
    'Warming up the renderer...',
    'Loading heroic walking legs...',
  ],
  vegetation: [
    'Growing seeds...',
    'Planting suspiciously fast trees...',
    'Mossing the rocks...',
    'Watering cotton at unreasonable speed...',
  ],
  settle: [
    'Painting shadows...',
    'Letting sunlight find the floor...',
    'Waking up the GPU gently...',
    'Teaching leaves where the light is...',
  ],
  done: [
    'Opening the grove...',
    'Sweeping leaves off the camera...',
    'Almost there...',
  ],
};

function createBuildId() {
  return `build-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

const pendingLocalBuildingIds = new Map();
const pendingDeletedBuildingIds = new Map();

function prunePendingBuildingSync(now = Date.now()) {
  for (const [id, expiresAt] of pendingLocalBuildingIds) {
    if (expiresAt <= now) pendingLocalBuildingIds.delete(id);
  }
  for (const [id, expiresAt] of pendingDeletedBuildingIds) {
    if (expiresAt <= now) pendingDeletedBuildingIds.delete(id);
  }
}

function markLocalBuildingPending(id) {
  prunePendingBuildingSync();
  pendingDeletedBuildingIds.delete(id);
  pendingLocalBuildingIds.set(id, Date.now() + LOCAL_WORLD_SYNC_GRACE_MS);
}

function markLocalBuildingDeleted(id) {
  prunePendingBuildingSync();
  pendingLocalBuildingIds.delete(id);
  pendingDeletedBuildingIds.set(id, Date.now() + LOCAL_WORLD_SYNC_GRACE_MS);
}

function mergeCloudBuildingsWithPending(cloudBuildings, currentBuildings) {
  prunePendingBuildingSync();

  const cloudIds = new Set(cloudBuildings.map((building) => building.id));
  for (const id of cloudIds) pendingLocalBuildingIds.delete(id);

  for (const id of pendingDeletedBuildingIds.keys()) {
    if (!cloudIds.has(id)) pendingDeletedBuildingIds.delete(id);
  }

  const preservedLocal = currentBuildings.filter(
    (building) => pendingLocalBuildingIds.has(building.id) && !cloudIds.has(building.id),
  );
  return [
    ...cloudBuildings.filter((building) => !pendingDeletedBuildingIds.has(building.id)),
    ...preservedLocal,
  ];
}

function initialLoadingSteps() {
  return LOADING_STEPS.map((step) => ({
    ...step,
    status: 'pending',
  }));
}

function loadingPhraseFor(id, status, loadingSteps, fallback) {
  if (status === 'error') {
    return fallback || 'Could not connect to the game server.';
  }
  if (status === 'complete') {
    const nextStep = loadingSteps.find(
      (step) => step.status === 'loading' || step.status === 'error',
    ) || loadingSteps.find((step) => step.status === 'pending');
    if (!nextStep) return pickLoadingPhrase('done');
    return pickLoadingPhrase(nextStep.id) || nextStep.detail;
  }
  return pickLoadingPhrase(id) || fallback || 'Loading Mossvale...';
}

function pickLoadingPhrase(id) {
  const phrases = LOADING_PHRASES[id];
  if (!phrases?.length) return '';
  return phrases[Math.floor(Math.random() * phrases.length)];
}

function buildingLevel(building) {
  return Math.max(0, Math.floor(Number(building?.level) || 0));
}

function sameBuildPlane(a, b) {
  return (
    a?.type !== 'foundation' &&
    b?.type !== 'foundation' &&
    Math.abs((a?.x || 0) - (b?.x || 0)) < 0.01 &&
    Math.abs((a?.z || 0) - (b?.z || 0)) < 0.01 &&
    Math.abs((a?.w || 0) - (b?.w || 0)) < 0.01 &&
    Math.abs((a?.h || 0) - (b?.h || 0)) < 0.01 &&
    ((a?.rot || 0) % 2) === ((b?.rot || 0) % 2)
  );
}

function loadPlayerName() {
  return window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || 'Sprout';
}

function snapFoundationCoordinate(value) {
  return Math.round((Number(value) || 0) / 40) * 40;
}

function sanitizeBuildings(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item && item.id && item.type)
    .map((item) => {
      const piece = buildPieces.find((buildPiece) => buildPiece.id === item.type) || buildPieces[0];
      const rot = Math.max(0, Math.floor(Number(item.rot) || 0)) % 4;
      const rotated = piece.id !== 'foundation' && rot % 2 === 1;
      const w = rotated ? piece.h : piece.w;
      const h = rotated ? piece.w : piece.h;
      const x = Number(item.x) || 0;
      const z = Number(item.z ?? item.y) || 0;
      const snappedX = piece.id === 'foundation' ? snapFoundationCoordinate(x) : x;
      const snappedZ = piece.id === 'foundation' ? snapFoundationCoordinate(z) : z;
      return {
        id: String(item.id).slice(0, 80),
        type: piece.id,
        x: snappedX,
        z: snappedZ,
        y: snappedZ,
        level: Math.max(0, Math.floor(Number(item.level) || 0)),
        rot,
        w,
        h,
        blocks: Boolean(item.blocks ?? piece.blocks),
        color: item.color || piece.color,
      };
    });
}

function sanitizeOwnedWeapons(source) {
  const next = defaultOwnedWeapons();
  for (const weapon of weaponDefs) {
    if (source?.[weapon.id] || weapon.starter) next[weapon.id] = true;
  }
  return next;
}

function isWeaponOwned(id, ownedWeapons) {
  return Boolean(ownedWeapons?.[id] || weaponDefs.find((weapon) => weapon.id === id)?.starter);
}

function itemForState(key, state, options = {}) {
  const item = baseItemForKey(key);
  if (!item) return null;
  if (item.kind === 'weapon') {
    if (!options.includeLocked && !isWeaponOwned(item.id, state.ownedWeapons)) return null;
    return item;
  }
  const count = state.inventory[item.key] || 0;
  if (!options.includeLocked && count <= 0) return null;
  return { ...item, count };
}

function ownedInventoryKeys(state) {
  return [
    ...weaponDefs.filter((weapon) => isWeaponOwned(weapon.id, state.ownedWeapons)).map((weapon) => weapon.id),
    ...Object.entries(state.inventory)
      .filter(([, count]) => count > 0)
      .map(([key]) => key),
  ];
}

function sanitizeEquipment(source = {}, state) {
  const next = emptyEquipment();
  for (const slotId of Object.keys(next)) {
    const key = typeof source?.[slotId] === 'string' ? source[slotId] : null;
    const item = itemForState(key, state);
    next[slotId] = item && canEquipItemInSlot(item, slotId) ? item.key : null;
  }
  return next;
}

function sanitizeInventoryLayout(layout, state) {
  const owned = ownedInventoryKeys(state);
  const equipped = new Set(Object.values(state.equipment || {}).filter(Boolean));
  const seen = new Set();
  const slots = Array.from({ length: BAG_SLOT_COUNT }, (_, index) => {
    const key = Array.isArray(layout) ? layout[index] : null;
    if (!key || equipped.has(key) || !owned.includes(key) || seen.has(key)) return null;
    seen.add(key);
    return key;
  });
  for (const key of owned) {
    if (equipped.has(key) || seen.has(key)) continue;
    const emptyIndex = slots.indexOf(null);
    if (emptyIndex < 0) break;
    slots[emptyIndex] = key;
    seen.add(key);
  }
  return slots;
}

function sanitizeQuickSlots(slots, state) {
  const owned = ownedInventoryKeys(state);
  const source = Array.isArray(slots) ? slots : DEFAULT_QUICK_KEYS;
  const next = Array.from({ length: QUICK_SLOT_COUNT }, (_, index) => {
    const key = source[index] ?? null;
    return key && owned.includes(key) ? key : null;
  });
  const hasWeapon = next.some((key) => itemForState(key, state)?.kind === 'weapon');
  if (!hasWeapon && isWeaponOwned('stick', state.ownedWeapons)) {
    const index = next.indexOf(null);
    next[index >= 0 ? index : 0] = 'stick';
  }
  return next;
}

function parseQuickSlotSave(value) {
  if (Array.isArray(value)) {
    return {
      slots: value,
      selectedSlot: null,
    };
  }
  if (!value || typeof value !== 'object') {
    return {
      slots: DEFAULT_QUICK_KEYS,
      selectedSlot: null,
    };
  }
  return {
    slots: Array.isArray(value.slots) ? value.slots : DEFAULT_QUICK_KEYS,
    selectedSlot:
      Number.isFinite(Number(value.selectedSlot))
        ? Math.floor(Number(value.selectedSlot))
        : null,
  };
}

function clampSelectedSlot(index) {
  return Math.max(0, Math.min(QUICK_SLOT_COUNT - 1, Math.floor(Number(index) || 0)));
}

function resolveSelectedSlot(state, options = {}) {
  const selectedSlot = clampSelectedSlot(state.selectedSlot);
  const selectedItem = itemForState(state.quickSlots?.[selectedSlot], state);
  if (options.preferSavedSlot && selectedItem) return selectedSlot;

  const equippedWeapon = state.equipment?.weapon;
  if (equippedWeapon) {
    const weaponSlot = state.quickSlots.findIndex((key) => key === equippedWeapon);
    if (weaponSlot >= 0) return weaponSlot;
  }

  return selectedSlot;
}

function syncHealth(state) {
  const max = 5 + Object.values(state.equipment || {}).reduce((total, key) => {
    const item = itemForState(key, state);
    return total + (item?.hpBonus || 0);
  }, 0);
  return {
    current: Math.min(max, state.health?.current || 5),
    max,
  };
}

function normalizeState(state, options = {}) {
  const withEquipment = {
    ...state,
    equipment: sanitizeEquipment(state.equipment, state),
  };
  withEquipment.health = syncHealth(withEquipment);
  withEquipment.inventoryLayout = sanitizeInventoryLayout(withEquipment.inventoryLayout, withEquipment);
  withEquipment.quickSlots = sanitizeQuickSlots(withEquipment.quickSlots, withEquipment);
  withEquipment.selectedSlot = options.resolveSelectedSlot
    ? resolveSelectedSlot(withEquipment, { preferSavedSlot: options.preferSavedSlot })
    : clampSelectedSlot(withEquipment.selectedSlot);
  withEquipment.buildings = sanitizeBuildings(withEquipment.buildings);
  return withEquipment;
}

function saveInventoryState(state) {
  scheduleCloudPlayerStateSave(state, 0);
}

function scheduleInventoryStateSave(state, delayMs = 1200) {
  scheduleCloudPlayerStateSave(state, delayMs);
}

function persistInventoryState(state, options = {}) {
  if (options.deferPersist) {
    scheduleInventoryStateSave(state, options.persistDelayMs);
    return;
  }
  saveInventoryState(state);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    flushCloudPlayerStateSave();
    flushCloudWorldStateSave();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushCloudPlayerStateSave();
      flushCloudWorldStateSave();
    }
  });
}

function saveBuildings(buildings) {
  scheduleCloudWorldStateSave({ buildings: sanitizeBuildings(buildings) });
}

function missingItems(recipe, inventory, quantity = 1) {
  return Object.entries(recipe.cost)
    .filter(([key, count]) => (inventory[key] || 0) < count * quantity)
    .map(([key, count]) => countLabel(key, count * quantity - (inventory[key] || 0)));
}

function maxCraftQuantity(recipe, inventory) {
  if (recipe.output.weapon || recipe.output.armor || recipe.output.equipment) return 1;
  const costs = Object.entries(recipe.cost);
  if (!costs.length) return 1;
  return Math.max(1, Math.min(...costs.map(([key, count]) => Math.floor((inventory[key] || 0) / count))));
}

function craftStatus(recipe, state, quantity = 1) {
  const item = itemForState(recipe.output.key, state, { includeLocked: true });
  if (recipe.output.weapon && isWeaponOwned(recipe.output.key, state.ownedWeapons)) {
    return { canCraft: false, label: 'owned', reason: `${item.name} is already in your bag.` };
  }
  if ((recipe.output.armor || recipe.output.equipment) && (state.inventory[recipe.output.key] || 0) > 0) {
    return { canCraft: false, label: 'owned', reason: `${item.name} is already in your bag.` };
  }
  const missing = missingItems(recipe, state.inventory, quantity);
  if (missing.length) return { canCraft: false, label: 'missing', reason: `Need ${missing.join(', ')}.` };
  return { canCraft: true, label: 'craft', reason: '' };
}

let nextToastId = 1;

const initialState = normalizeState({
  playerName: loadPlayerName(),
  health: { current: 5, max: 5 },
  energy: { current: 24, max: 24 },
  onlineCount: 1,
  actionLine: 'Right-click or tap to move or gather. Left-click or tap targets to attack.',
  gatherHud: null,
  inventory: normalizeInventory(emptyInventory()),
  ownedWeapons: sanitizeOwnedWeapons(null),
  equipment: { ...emptyEquipment(), weapon: 'stick' },
  inventoryLayout: [],
  quickSlots: DEFAULT_QUICK_KEYS,
  selectedSlot: 0,
  inventoryOpen: false,
  buildOpen: false,
  craftOpen: false,
  craftCategory: 'materials',
  craftRecipeId: null,
  craftQuantity: 1,
  selectedBuildIndex: 0,
  buildRotation: 0,
  buildings: [],
  dragPayload: null,
  abilityCooldownEnds: {},
  paused: false,
  selectedItemKey: null,
  pickupToasts: [],
  cloudResourceStates: null,
  loadingHidden: false,
  loadingDetail: 'Preparing Mossvale...',
  loadingSteps: initialLoadingSteps(),
});

export const gameUiStore = createStore((set, get) => ({
  ...initialState,

  itemForKey: (key, options = {}) => itemForState(key, get(), options),
  craftStatus: (recipe, quantity = 1) => craftStatus(recipe, get(), quantity),
  maxCraftQuantity: (recipe) => maxCraftQuantity(recipe, get().inventory),

  setPlayerName: (name) => {
    const next = name.trim().slice(0, 16) || 'Sprout';
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, next);
    set({ playerName: next });
  },
  setActionLine: (actionLine) => set({ actionLine }),
  setGatherHud: (gatherHud) => set({ gatherHud }),
  setInventoryOpen: (inventoryOpen) =>
    set({ inventoryOpen, craftOpen: inventoryOpen ? false : get().craftOpen, selectedItemKey: inventoryOpen ? get().selectedItemKey : null }),
  setBuildOpen: (buildOpen) => set({ buildOpen, craftOpen: buildOpen ? false : get().craftOpen }),
  setCraftOpen: (craftOpen) =>
    set({ craftOpen, buildOpen: craftOpen ? false : get().buildOpen, inventoryOpen: craftOpen ? false : get().inventoryOpen, selectedItemKey: null }),
  setPaused: (paused) => set({ paused }),
  setSelectedItemKey: (selectedItemKey) => set({ selectedItemKey }),
  damagePlayer: (amount = 1, sourceName = 'Something') => {
    const state = get();
    const damage = Math.max(0, Math.round(Number(amount) || 0));
    if (damage <= 0 || state.health.current <= 0) return false;
    const health = {
      ...state.health,
      current: Math.max(0, state.health.current - damage),
    };
    set({
      health,
      actionLine:
        health.current <= 0
          ? `${sourceName} knocked you down.`
          : `${sourceName} hit you. Health ${health.current}/${health.max}.`,
    });
    return true;
  },
  setCraftCategory: (craftCategory) => set({ craftCategory, craftRecipeId: null, craftQuantity: 1 }),
  setCraftRecipeId: (craftRecipeId) => set({ craftRecipeId, craftQuantity: 1 }),
  setCraftQuantity: (recipe, value) => {
    const max = maxCraftQuantity(recipe, get().inventory);
    set({ craftQuantity: Math.max(1, Math.min(max, Math.round(Number(value) || 1))) });
  },
  setSelectedBuildIndex: (selectedBuildIndex) => set({ selectedBuildIndex }),
  rotateBuild: () => {
    set((state) => ({
      buildRotation: (state.buildRotation + 1) % 4,
      actionLine: 'Build piece rotated.',
    }));
    playSfx('ui', 0.68);
  },
  setDragPayload: (dragPayload) => set({ dragPayload }),
  setLoadingDetail: (loadingDetail) => set({ loadingDetail }),
  setLoadingStep: (id, patch = {}) => {
    set((state) => {
      let matched = false;
      const previousStep = state.loadingSteps.find((step) => step.id === id);
      const loadingSteps = state.loadingSteps.map((step) => {
        if (step.id !== id) return step;
        matched = true;
        return { ...step, ...patch };
      });
      if (!matched) return state;
      const activeStep =
        loadingSteps.find((step) => step.status === 'loading') ||
        loadingSteps.find((step) => step.status === 'pending') ||
        loadingSteps.find((step) => step.status === 'error');
      const statusChanged =
        patch.status != null && previousStep?.status !== patch.status;
      return {
        loadingSteps,
        loadingDetail: statusChanged
          ? loadingPhraseFor(
              id,
              patch.status,
              loadingSteps,
              activeStep?.detail || state.loadingDetail,
            )
          : state.loadingDetail,
      };
    });
  },
  hideLoading: () => set({ loadingHidden: true }),
  showLoading: () => set({ loadingHidden: false }),

  applyCloudWorldState: (cloudWorld) => {
    const cloudBuildings = sanitizeBuildings(cloudWorld?.buildings);
    set((state) => ({
      buildings: mergeCloudBuildingsWithPending(cloudBuildings, state.buildings),
      cloudResourceStates:
        cloudWorld?.resources && typeof cloudWorld.resources === 'object'
          ? cloudWorld.resources
          : {},
    }));
  },

  hydrateCloudInventory: async () => {
    let cloudState;
    try {
      cloudState = await loadCloudPlayerState();
    } catch (error) {
      console.warn('Mossvale cloud player state load failed', error);
      return false;
    }

    const current = get();
    if (!cloudState) {
      scheduleCloudPlayerStateSave(current, 0);
      return false;
    }

    const quickSlotSave = parseQuickSlotSave(cloudState.quick_slots);
    const next = normalizeState({
      ...current,
      inventory: normalizeInventory(cloudState.inventory || current.inventory),
      ownedWeapons: sanitizeOwnedWeapons(cloudState.owned_weapons),
      equipment: cloudState.equipment || current.equipment,
      inventoryLayout: Array.isArray(cloudState.inventory_layout)
        ? cloudState.inventory_layout
        : current.inventoryLayout,
      quickSlots: quickSlotSave.slots,
      selectedSlot: quickSlotSave.selectedSlot ?? current.selectedSlot,
    }, {
      resolveSelectedSlot: true,
      preferSavedSlot: quickSlotSave.selectedSlot != null,
    });

    saveInventoryState(next);
    set(next);
    return true;
  },

  hydrateCloudWorld: async () => {
    let cloudWorld;
    try {
      cloudWorld = await loadCloudWorldState();
    } catch (error) {
      console.warn('Mossvale cloud world state load failed', error);
      return null;
    }

    if (!cloudWorld) {
      scheduleCloudWorldStateSave({ buildings: get().buildings }, 0);
      return null;
    }

    get().applyCloudWorldState(cloudWorld);
    return cloudWorld;
  },

  placeBuilding: (piece, footprint, rotation = 0) => {
    const state = get();
    if (!piece || !footprint) return false;
    if ((state.inventory.wood || 0) < piece.cost) {
      set({ actionLine: 'Not enough wood.' });
      playSfx('error');
      return false;
    }

    const inventory = {
      ...state.inventory,
      wood: Math.max(0, (state.inventory.wood || 0) - piece.cost),
    };
    const building = {
      id: createBuildId(),
      type: piece.id,
      x: footprint.x,
      z: footprint.z,
      y: footprint.z,
      level: Math.max(0, Math.floor(Number(footprint.level) || 0)),
      rot: Math.max(0, Math.floor(Number(rotation) || 0)) % 4,
      w: footprint.w,
      h: footprint.h,
      blocks: piece.blocks,
      color: piece.color,
    };
    const buildings = sanitizeBuildings([...state.buildings, building]);
    const next = normalizeState({ ...state, inventory, buildings });
    markLocalBuildingPending(building.id);
    set({
      ...next,
      actionLine: `${piece.name} placed.`,
    });
    saveInventoryState(next);
    saveBuildings(next.buildings);
    playSfx('build', 0.86);
    window.dispatchEvent(
      new CustomEvent('mossvale:building-update', {
        detail: { building },
      }),
    );
    return true;
  },

  destroyBuilding: (id) => {
    const state = get();
    const target = state.buildings.find((building) => building.id === id);
    if (!target) {
      playSfx('error');
      return false;
    }

    const destroyTarget =
      target.type === 'foundation'
        ? target
        : state.buildings
            .filter((building) => sameBuildPlane(building, target))
            .sort((a, b) => buildingLevel(b) - buildingLevel(a))[0] || target;
    const piece = buildPieces.find((item) => item.id === destroyTarget.type) || buildPieces[0];
    const inventory = {
      ...state.inventory,
      wood: (state.inventory.wood || 0) + piece.cost,
    };
    const buildings = sanitizeBuildings(state.buildings.filter((building) => building.id !== destroyTarget.id));
    const next = normalizeState({ ...state, inventory, buildings });
    markLocalBuildingDeleted(destroyTarget.id);
    set({
      ...next,
      actionLine: `${piece.name} removed. Refunded ${piece.cost} wood.`,
    });
    saveInventoryState(next);
    saveBuildings(next.buildings);
    playSfx('complete', 0.72);
    window.dispatchEvent(
      new CustomEvent('mossvale:building-destroy', {
        detail: { building: destroyTarget },
      }),
    );
    return true;
  },

  selectQuickSlot: (index) => {
    const state = get();
    const selectedSlot = Math.max(0, Math.min(QUICK_SLOT_COUNT - 1, index));
    const item = itemForState(state.quickSlots[selectedSlot], state);
    const patch = { selectedSlot };
    if (item?.kind === 'weapon') patch.equipment = { ...state.equipment, weapon: item.key };
    if (!item) patch.equipment = { ...state.equipment, weapon: null };
    const next = normalizeState({ ...state, ...patch });
    saveInventoryState(next);
    set({
      ...next,
      actionLine: item
        ? `${item.name} ${itemLevelText(item)} selected.`
        : `Quick slot ${selectedSlot + 1} is empty. Weapon unequipped.`,
    });
    playSfx('ui', 0.58);
  },

  moveInventoryItem: (key, targetIndex) => {
    const state = get();
    if (!itemForState(key, state)) return false;
    const fromIndex = state.inventoryLayout.indexOf(key);
    if (fromIndex < 0) return false;
    const toIndex = Math.max(0, Math.min(BAG_SLOT_COUNT - 1, Number(targetIndex) || 0));
    if (fromIndex === toIndex) return true;
    const inventoryLayout = [...state.inventoryLayout];
    const displaced = inventoryLayout[toIndex] || null;
    inventoryLayout[toIndex] = key;
    inventoryLayout[fromIndex] = displaced;
    const next = normalizeState({ ...state, inventoryLayout, dragPayload: null });
    saveInventoryState(next);
    set({ ...next });
    playSfx('ui', 0.66);
    return true;
  },

  assignQuickSlot: (key, targetIndex, sourceIndex = null) => {
    const state = get();
    const item = itemForState(key, state);
    if (!item) return false;
    const index = Math.max(0, Math.min(QUICK_SLOT_COUNT - 1, Number(targetIndex) || 0));
    const quickSlots = [...state.quickSlots];
    if (sourceIndex != null && sourceIndex !== index) {
      const displaced = quickSlots[index] || null;
      quickSlots[index] = key;
      quickSlots[sourceIndex] = displaced;
    } else {
      quickSlots[index] = key;
    }
    const patch = {
      quickSlots,
      selectedSlot: index,
      dragPayload: null,
      actionLine: `${item.name} assigned to quick slot ${index + 1}.`,
    };
    if (item.kind === 'weapon') patch.equipment = { ...state.equipment, weapon: item.key };
    const next = normalizeState({ ...state, ...patch });
    saveInventoryState(next);
    set({ ...next });
    playSfx('ui', 0.72);
    return true;
  },

  useAbility: (ability, index) => {
    const state = get();
    if (!ability) return false;
    const now = Date.now();
    const coolingUntil = state.abilityCooldownEnds[ability.id] || 0;
    if (coolingUntil > now) {
      set({ actionLine: `${ability.name} ready in ${Math.ceil((coolingUntil - now) / 1000)}s.` });
      playSfx('error');
      return false;
    }
    const abilityCooldownEnds = {
      ...state.abilityCooldownEnds,
      [ability.id]: now + ability.cooldown * 1000,
    };
    set({
      abilityCooldownEnds,
      actionLine: `${ability.name}.`,
    });
    playSfx('ability', 0.86);
    window.dispatchEvent(
      new CustomEvent('mossvale:ability', {
        detail: { ability, index },
      }),
    );
    return true;
  },

  equipItem: (key) => {
    const state = get();
    const item = itemForState(key, state);
    const slotId = equipmentSlotForItem(item);
    if (!item || !slotId) {
      playSfx('error');
      return false;
    }
    const weaponQuickSlot = item.kind === 'weapon' ? state.quickSlots.indexOf(item.key) : -1;
    const next = normalizeState({
      ...state,
      equipment: { ...state.equipment, [slotId]: item.key },
      selectedSlot: weaponQuickSlot >= 0 ? weaponQuickSlot : state.selectedSlot,
      selectedItemKey: null,
    });
    saveInventoryState(next);
    set({ ...next, actionLine: `${item.name} equipped. Health ${next.health.current}/${next.health.max}.` });
    playSfx('complete', 0.68);
    return true;
  },

  unequipItem: (slotId) => {
    const state = get();
    const item = itemForState(state.equipment?.[slotId], state);
    if (!slotId || !item || !Object.prototype.hasOwnProperty.call(state.equipment, slotId)) {
      playSfx('error');
      return false;
    }
    const next = normalizeState({
      ...state,
      equipment: { ...state.equipment, [slotId]: null },
      selectedItemKey: null,
    });
    saveInventoryState(next);
    set({ ...next, actionLine: `${item.name} unequipped. Health ${next.health.current}/${next.health.max}.` });
    playSfx('ui', 0.68);
    return true;
  },

  useItem: (key) => {
    const state = get();
    const item = itemForState(key, state);
    if (!item) return false;
    if (item.kind === 'weapon' || item.kind === 'armor' || equipmentSlotForItem(item)) return get().equipItem(key);
    if (key !== 'bandage') return false;
    if (state.health.current >= state.health.max) {
      set({ actionLine: 'You are already at full health.' });
      playSfx('error');
      return false;
    }
    const inventory = { ...state.inventory, bandage: Math.max(0, (state.inventory.bandage || 0) - 1) };
    const next = normalizeState({
      ...state,
      inventory,
      health: { ...state.health, current: Math.min(state.health.max, state.health.current + 2) },
      selectedItemKey: null,
    });
    saveInventoryState(next);
    set({ ...next, actionLine: `Bandage used. Health ${next.health.current}/${next.health.max}.` });
    playSfx('complete', 0.72);
    return true;
  },

  craftRecipe: (recipe, quantity = 1) => {
    const state = get();
    const max = maxCraftQuantity(recipe, state.inventory);
    const craftQuantity = Math.max(1, Math.min(max, Math.round(Number(quantity) || 1)));
    const status = craftStatus(recipe, state, craftQuantity);
    const item = itemForState(recipe.output.key, state, { includeLocked: true });
    if (!status.canCraft) {
      set({ actionLine: status.reason || `Can't craft ${item.name} yet.` });
      playSfx('error');
      return false;
    }

    const inventory = { ...state.inventory };
    for (const [key, count] of Object.entries(recipe.cost)) inventory[key] = Math.max(0, (inventory[key] || 0) - count * craftQuantity);
    const ownedWeapons = { ...state.ownedWeapons };
    const equipment = { ...state.equipment };
    if (recipe.output.weapon) {
      ownedWeapons[recipe.output.key] = true;
    } else {
      inventory[recipe.output.key] = (inventory[recipe.output.key] || 0) + (recipe.output.count || 1) * craftQuantity;
      if (recipe.output.armor || recipe.output.equipment) {
        const slotId = baseItemForKey(recipe.output.key)?.slot;
        if (slotId) equipment[slotId] = recipe.output.key;
      }
    }
    const next = normalizeState({ ...state, inventory, ownedWeapons, equipment, craftRecipeId: null, craftQuantity: 1 });
    saveInventoryState(next);
    set({ ...next, actionLine: craftQuantity > 1 ? `${craftQuantity} ${item.plural || item.name} crafted.` : `${item.name} crafted.` });
    playSfx('complete');
    return true;
  },

  addItems: (items = {}, options = {}) => {
    const normalized = normalizeInventory(items);
    const entries = Object.entries(normalized).filter(([, count]) => count > 0);
    if (!entries.length) return get().inventory;

    const state = get();
    const inventory = { ...state.inventory };
    for (const [key, count] of entries) inventory[key] = (inventory[key] || 0) + count;
    const toast = { id: nextToastId, items: normalized };
    nextToastId += 1;
    const next = normalizeState({ ...state, inventory });
    persistInventoryState(next, options);

    set({
      ...next,
      pickupToasts: [toast, ...state.pickupToasts].slice(0, 6),
      actionLine: options.message || `Gathered ${inventorySummary(normalized)}.`,
    });

    if (options.sound !== false) playSfx(options.sound || 'complete', options.intensity ?? 0.86);
    window.setTimeout(() => {
      set((current) => ({
        pickupToasts: current.pickupToasts.filter((item) => item.id !== toast.id),
      }));
    }, 3400);

    return next.inventory;
  },
}));

export function installGameUiApi() {
  const api = {
    addItems: (...args) => gameUiStore.getState().addItems(...args),
    buildings: () => gameUiStore.getState().buildings.map((building) => ({ ...building })),
    destroyBuilding: (id) => gameUiStore.getState().destroyBuilding(id),
    inventory: () => ({ ...gameUiStore.getState().inventory }),
    setActionLine: (message) => gameUiStore.getState().setActionLine(message),
    setGatherHud: (status = null) => gameUiStore.getState().setGatherHud(status),
    setLoadingDetail: (text) => gameUiStore.getState().setLoadingDetail(text),
    setLoadingStep: (id, patch) => gameUiStore.getState().setLoadingStep(id, patch),
    hideLoading: () => gameUiStore.getState().hideLoading(),
    showLoading: () => gameUiStore.getState().showLoading(),
    markWorldDataReady: () => {
      window.__MOSSVALE_WORLD_DATA_READY__ = true;
      window.dispatchEvent(new CustomEvent('mossvale:world-data-ready'));
    },
  };
  window.MOSSVALE_GAME_API = api;

  return () => {
    if (window.MOSSVALE_GAME_API === api) delete window.MOSSVALE_GAME_API;
  };
}
