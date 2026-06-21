import {
  Canvas,
  extend,
  useFrame,
  useLoader,
  useThree,
} from '@react-three/fiber';
import {
  Clone,
  ContactShadows,
  Html,
  useProgress,
  useGLTF,
} from '@react-three/drei';
import {
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as THREE from 'three/webgpu';
import { WebGLRenderer } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { Sky } from 'three/addons/objects/Sky.js';
import Stats from 'three/addons/libs/stats.module.js';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  Fn,
  If,
  billboarding,
  deltaTime,
  hash,
  instanceIndex,
  instancedArray,
  time as tslTime,
  uint,
  uniform,
  uv,
  vec2,
} from 'three/tsl';
import { EQUIPMENT_SLOTS, buildPieces, weaponDefs } from './gameUiData.js';
import { playSfx } from './audioRuntime.js';
import {
  flushCloudWorldStateSave,
  scheduleCloudWorldStateSave,
} from './cloudPersistence.js';
import { gameRuntimeStore } from './gameRuntimeStore.js';
import { gameUiStore } from './gameUiStore.js';
import { useGameUiStore } from './useGameUiStore.js';

function useGameRuntimeStore(selector = (state) => state) {
  return useSyncExternalStore(
    gameRuntimeStore.subscribe,
    () => selector(gameRuntimeStore.getState()),
    () => selector(gameRuntimeStore.getInitialState()),
  );
}

extend(THREE);
RectAreaLightUniformsLib.init();
THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());

function normalizeAvatarEquipment(equipment = {}, weaponId = 'stick', offhandId = null) {
  const fallback = { weapon: weaponId, offhand: offhandId };
  return Object.fromEntries(
    EQUIPMENT_SLOTS.map((slot) => {
      const hasSlot = Object.prototype.hasOwnProperty.call(equipment || {}, slot);
      const raw = hasSlot ? equipment?.[slot] : fallback[slot];
      return [slot, typeof raw === 'string' ? raw : null];
    }),
  );
}

const WORLD_SIZE = { width: 7200, height: 5200 };
const PUBLIC_ASSET_BASE = `${import.meta.env.BASE_URL || '/'}assets/`;
const assetUrl = (path) => `${PUBLIC_ASSET_BASE}${path.replace(/^\/+/, '')}`;
const PLAYER_WALK_SPEED = 195;
const PLAYER_RUN_SPEED = 315;
const PLAYER_COLLISION_RADIUS = 26;
const PLAYER_COLLISION_SWEEP_STEP = PLAYER_COLLISION_RADIUS * 0.45;
const PLAYER_HEAD_TURN_LIMIT = THREE.MathUtils.degToRad(62);
const PLAYER_HEAD_LOOK_UP_LIMIT = THREE.MathUtils.degToRad(30);
const PLAYER_HEAD_LOOK_DOWN_LIMIT = THREE.MathUtils.degToRad(24);
const PLAYER_HEAD_YAW_BLEND = 0.74;
const PLAYER_HEAD_PITCH_BLEND = 0.58;
const PLAYER_HEAD_LOOK_DAMPING = 12;
const PLAYER_STORE_SYNC_INTERVAL = 0.05;
const PLAYER_STORE_SYNC_DISTANCE = 2.5;
const PLAYER_STORE_SYNC_FACING_DELTA = 0.025;
const REMOTE_PLAYER_INTERPOLATION_DELAY_MS = 110;
const REMOTE_PLAYER_MAX_EXTRAPOLATION_MS = 120;
const REMOTE_PLAYER_POSITION_DAMPING = 15;
const REMOTE_PLAYER_ROTATION_DAMPING = 18;
const REMOTE_PLAYER_SAMPLE_EPSILON = 0.75;
const REMOTE_PLAYER_MAX_PREDICT_SPEED = PLAYER_RUN_SPEED * 1.25;
const MOVE_TARGET_VISUAL_UPDATE_DISTANCE = 8;
const MOVE_TARGET_STORE_SYNC_INTERVAL_MS = 250;
const MOVE_TARGET_STORE_SYNC_DISTANCE = 80;
const NATURE_OBJ_BASE = assetUrl(
  'source-packs/Ultimate Nature Pack - Jun 2019/OBJ/',
);
const TREE_STUMP_FILE = 'TreeStump_Moss';
const FLOWER_RESOURCE_FILE = 'Flowers';
const COTTON_RESOURCE_FILE = 'Plant_1';
const ADVENTURER_ANIMATION_BASE = assetUrl(
  'source-packs/KayKit_Adventurers_2.0_FREE/Animations/gltf/Rig_Medium/',
);
const KAYKIT_WEAPON_MODEL_BASE = assetUrl(
  'source-packs/KayKit_Adventurers_2.0_FREE/Assets/gltf/',
);
const AXE_MODEL_URL = `${KAYKIT_WEAPON_MODEL_BASE}axe_1handed.gltf`;
const KNIGHT_MODEL_URL = assetUrl('models/adventurers/Knight.glb');
const SWORD_MODEL_URL = assetUrl('models/adventurers/sword_1handed.gltf');
const SHIELD_MODEL_URL = assetUrl('models/adventurers/shield_round.gltf');
const MONSTER_MODEL_URLS = Object.freeze({
  pinkBlob: assetUrl('models/monsters/PinkBlob.gltf'),
  orc: assetUrl('models/monsters/Orc.gltf'),
  mushnub: assetUrl('models/monsters/Mushnub.gltf'),
  dragon: assetUrl('models/monsters/Dragon.gltf'),
});
const KAYKIT_HELD_WEAPON_MODEL_URLS = Object.freeze({
  battle_axe: AXE_MODEL_URL,
  bow: `${KAYKIT_WEAPON_MODEL_BASE}bow_withString.gltf`,
  crossbow: `${KAYKIT_WEAPON_MODEL_BASE}crossbow_2handed.gltf`,
  dagger: `${KAYKIT_WEAPON_MODEL_BASE}dagger.gltf`,
  great_axe: `${KAYKIT_WEAPON_MODEL_BASE}axe_2handed.gltf`,
  staff: `${KAYKIT_WEAPON_MODEL_BASE}staff.gltf`,
  wand: `${KAYKIT_WEAPON_MODEL_BASE}wand.gltf`,
});
const ATTACK_ANIMATION_URL = assetUrl(
  'models/adventurers/animations/standing_melee_attack_horizontal.fbx',
);
const PICKAXE_ATTACK_ANIMATION_URL = assetUrl(
  'models/adventurers/animations/standing_melee_attack_downward.fbx',
);
const BLOCK_ANIMATION_URL = assetUrl(
  'models/adventurers/animations/standing_block_idle.fbx',
);
const DEATH_ANIMATION_URL = assetUrl(
  'models/adventurers/animations/sword_and_shield_death.fbx',
);
const GATHER_RANGE = 105;
const GATHER_IMPACT_ANIMATION_FRACTION = 0.45;
const CREATURE_ATTACK_RANGE = 88;
const CREATURE_ATTACK_COOLDOWN_MS = 1350;
const CREATURE_ATTACK_DAMAGE = 1;
const PICKAXE_HAND_SCALE = 0.9;
const DEFAULT_WEAPON_ATTACK = {
  range: 125,
  halfWidth: 22,
  cooldownMs: 560,
  impactMs: 150,
  animationDuration: 0.44,
  damage: 2,
};
const CREATURE_RESPAWN_MS = 8000;
const MAX_GATHER_PARTICLES = 96;
const GATHER_PARTICLE_MATERIALS = {
  tree: '#d6a35d',
  stone: '#e6eadf',
  flower: '#ffd6ea',
  cotton: '#fff8df',
};
const GROUND_TEXTURE_SIZE = 1024;
const TERRAIN_CHUNK_SIZE = 800;
const TERRAIN_CHUNK_SEGMENTS = 18;
const TERRAIN_EDGE_FADE = 420;
const TERRAIN_BASE_Y = -4;
const TERRAIN_MAX_RISE = 24;
const WORLD_RENDER_RADIUS = 3200;
const WORLD_RENDER_UPDATE_DISTANCE = 1400;
const MEADOW_FLOWER_COUNT = 900;
const MEADOW_LEAF_COUNT = 880;
const MEADOW_GLOW_COUNT = 180;
const WEBGPU_RAIN_DROP_COUNT = 200;
const CPU_RAIN_DROP_COUNT = 200;
const RAIN_FIELD_SIZE = 1120;
const RAIN_FIELD_HEIGHT = 680;
const GATHER_SWING_DURATION = 1.08;
const GATHER_ATTACK_TRIM_END = 0.16;
const GATHER_HUD_SYNC_INTERVAL = 1 / 12;
const RESOURCE_NODE_LABEL_Y_OFFSET = {
  tree: 196,
  stone: 88,
  flower: 46,
  cotton: 50,
};
const GATHER_RESOURCE_CONFIG = {
  tree: {
    itemKey: 'wood',
    label: 'Wood',
    nodeCount: 2,
    duration: 3.6,
    respawnMs: 45000,
    yield: () => 2 + Math.floor(Math.random() * 3),
  },
  stone: {
    itemKey: 'stone',
    label: 'Stone',
    nodeCount: 2,
    duration: 3.1,
    respawnMs: 32000,
    yield: () => 1 + Math.floor(Math.random() * 2),
  },
  flower: {
    itemKey: 'flower',
    label: 'Flowers',
    nodeCount: 1,
    duration: 1.45,
    respawnMs: 18000,
    yield: () => 1,
  },
  cotton: {
    itemKey: 'cotton',
    label: 'Cotton',
    nodeCount: 1,
    duration: 1.55,
    respawnMs: 18000,
    yield: () => 1 + Math.floor(Math.random() * 2),
  },
};
const MAX_CANVAS_DPR = 2;
const MAX_GROUND_COVER_COUNT = 5200;
const SETTINGS_STORAGE_KEY = 'mossvale.3dSettings.v6';
const WORLD_DATA_READY_EVENT = 'mossvale:world-data-ready';
const DEFAULT_RENDER_SETTINGS = {
  quality: 'balanced',
  renderScale: 1,
  groundCoverCount: 1600,
  mainShadows: true,
  contactShadows: true,
  showStats: false,
  fogEnabled: true,
  fogIntensity: 1,
};
const RENDER_PRESETS = {
  performance: {
    label: '60 FPS',
    settings: {
      quality: 'performance',
      renderScale: 1,
      groundCoverCount: 650,
      mainShadows: false,
      contactShadows: false,
      showStats: false,
      fogEnabled: true,
      fogIntensity: 1,
    },
  },
  balanced: {
    label: 'Balanced',
    settings: DEFAULT_RENDER_SETTINGS,
  },
  pretty: {
    label: 'Pretty',
    settings: {
      quality: 'pretty',
      renderScale: 2,
      groundCoverCount: 3600,
      mainShadows: true,
      contactShadows: true,
      showStats: false,
      fogEnabled: true,
      fogIntensity: 1,
    },
  },
};
const RENDER_QUALITY_CONFIG = {
  performance: {
    antialias: false,
    shadowMapSize: 1024,
    contactShadow: { opacity: 0.1, blur: 2, far: 420, resolution: 256 },
  },
  balanced: {
    antialias: true,
    shadowMapSize: 2048,
    contactShadow: { opacity: 0.12, blur: 2.6, far: 560, resolution: 512 },
  },
  custom: {
    antialias: true,
    shadowMapSize: 2048,
    contactShadow: { opacity: 0.12, blur: 2.6, far: 560, resolution: 512 },
  },
  pretty: {
    antialias: true,
    shadowMapSize: 4096,
    contactShadow: { opacity: 0.18, blur: 3.4, far: 820, resolution: 1024 },
  },
};
const AXE_HAND_DEFAULT_TRANSFORMS = {
  idle: {
    position: { x: -0.005, y: 0.075, z: 0.075 },
    rotation: { x: -11, y: -180, z: 4 },
  },
  chop: {
    position: { x: 0.01, y: 0.02, z: 0.075 },
    rotation: { x: -40, y: -81, z: -40 },
  },
};
const SWORD_HAND_TRANSFORMS = {
  idle: {
    position: { x: 0.005, y: 0.062, z: 0.082 },
    rotation: { x: -10, y: -178, z: -18 },
  },
  slash: {
    position: { x: 0.018, y: 0.026, z: 0.086 },
    rotation: { x: -34, y: -82, z: -48 },
  },
};
const GENERIC_WEAPON_HAND_TRANSFORM = {
  position: { x: 0.006, y: 0.064, z: 0.08 },
  rotation: { x: -10, y: -178, z: -14 },
};
const KAYKIT_HELD_WEAPON_CONFIG = Object.freeze({
  battle_axe: { scale: 0.92 },
  bow: {
    scale: 0.72,
    handTransform: {
      position: { x: 0.014, y: 0.058, z: 0.07 },
      rotation: { x: 82, y: -170, z: -10 },
    },
  },
  crossbow: {
    scale: 0.72,
    handTransform: {
      position: { x: 0.012, y: 0.06, z: 0.064 },
      rotation: { x: -2, y: -178, z: -8 },
    },
  },
  dagger: { scale: 0.88 },
  great_axe: { scale: 0.78 },
  staff: { scale: 0.62 },
  wand: { scale: 0.96 },
});
const SIMPLE_PICKAXE_TRANSFORMS = {
  idle: {
    position: { x: 0.01, y: 0.085, z: 0.04 },
    rotation: { x: -16, y: -180, z: 6 },
  },
  windup: {
    position: { x: 0.01, y: 0.085, z: 0.04 },
    rotation: { x: -16, y: -180, z: 6 },
  },
  strike: {
    position: { x: 0.01, y: 0.085, z: 0.04 },
    rotation: { x: -16, y: -180, z: 6 },
  },
  rebound: {
    position: { x: 0.01, y: 0.085, z: 0.04 },
    rotation: { x: -16, y: -180, z: 6 },
  },
};
const TORCH_HAND_TRANSFORM = {
  position: { x: -0.015, y: 0.055, z: 0.065 },
  rotation: { x: -12, y: -178, z: -4 },
};
const TORCH_HAND_SCALE = 0.92;
const SHIELD_HAND_TRANSFORM = {
  position: { x: 0.025, y: 0.05, z: 0.075 },
  rotation: { x: -2, y: 174, z: 8 },
};
const SHIELD_HAND_SCALE = 0.72;
const TORCH_LIGHT_BASE_INTENSITY = 760;
const TORCH_LIGHT_FLICKER_INTENSITY = 82;
const TORCH_LIGHT_DISTANCE = 860;
const TORCH_FILL_LIGHT_INTENSITY = 170;
const TORCH_FILL_LIGHT_DISTANCE = 620;
const CAMERA_LOOK_OFFSET = new THREE.Vector3(0, 18, 0);
const SCENE_WARMUP_MS = 1600;
const SCENE_WARMUP_FRAMES = 8;
const CAMERA_TUNING = {
  distance: 1600,
  angle: 60,
};
const INDOOR_CAMERA_TUNING = {
  distance: 1050,
  angle: 60,
};
const INDOOR_CAMERA_DAMPING = 5.2;
const BIOMES = [
  {
    id: 'sand',
    name: 'Sunspit Dunes',
    center: [2450, -1250],
    radius: [1700, 1150],
    feather: 0.34,
  },
  {
    id: 'rain',
    name: 'Rainmoss Hollow',
    center: [-2450, 1280],
    radius: [1750, 1280],
    feather: 0.36,
  },
];
const BASE_TREE_POINTS = [
  {
    id: 'tree-0',
    file: 'CommonTree_1',
    position: [-700, 0, -300],
    scale: 92,
    rotationY: -0.35,
  },
  {
    id: 'tree-1',
    file: 'PineTree_3',
    position: [-360, 0, 250],
    scale: 96,
    rotationY: 0.4,
  },
  {
    id: 'tree-2',
    file: 'BirchTree_4',
    position: [90, 0, -220],
    scale: 84,
    rotationY: -0.75,
  },
  {
    id: 'tree-3',
    file: 'Willow_2',
    position: [460, 0, 260],
    scale: 86,
    rotationY: 0.95,
  },
  {
    id: 'tree-4',
    file: 'CommonTree_Autumn_1',
    position: [790, 0, -360],
    scale: 88,
    rotationY: 0.25,
  },
  {
    id: 'tree-5',
    file: 'PineTree_1',
    position: [-950, 0, 440],
    scale: 94,
    rotationY: 1.1,
  },
  {
    id: 'tree-6',
    file: 'CommonTree_4',
    position: [1060, 0, 460],
    scale: 92,
    rotationY: -0.55,
  },
  {
    id: 'tree-7',
    file: 'BirchTree_2',
    position: [-1220, 0, -120],
    scale: 82,
    rotationY: 0.74,
  },
  {
    id: 'tree-8',
    file: 'CommonTree_5',
    position: [-520, 0, 690],
    scale: 88,
    rotationY: -1.08,
  },
  {
    id: 'tree-9',
    file: 'PineTree_5',
    position: [-80, 0, 620],
    scale: 96,
    rotationY: 0.18,
  },
  {
    id: 'tree-10',
    file: 'Willow_Autumn_3',
    position: [360, 0, 650],
    scale: 86,
    rotationY: -0.82,
  },
  {
    id: 'tree-11',
    file: 'CommonTree_2',
    position: [1280, 0, -80],
    scale: 90,
    rotationY: 0.68,
  },
  {
    id: 'tree-12',
    file: 'BirchTree_Autumn_2',
    position: [880, 0, 780],
    scale: 84,
    rotationY: 1.42,
  },
  {
    id: 'tree-13',
    file: 'PineTree_Autumn_4',
    position: [-1170, 0, 820],
    scale: 92,
    rotationY: -0.24,
  },
];

function createTreePoints(basePoints) {
  const random = seededRandom(925781);
  const points = basePoints.map((point, index) => ({
    ...point,
    id: point.id ?? `tree-${index}`,
    biome: dominantBiomeAt(point.position[0], point.position[2]),
  }));
  const meadowFiles = [
    'CommonTree_1',
    'CommonTree_3',
    'CommonTree_5',
    'PineTree_2',
    'PineTree_4',
    'BirchTree_3',
    'Willow_4',
    'CommonTree_Autumn_3',
  ];
  const sandFiles = [
    'Cactus_1',
    'Cactus_2',
    'Cactus_3',
    'Cactus_4',
    'Cactus_5',
    'PalmTree_1',
    'PalmTree_2',
    'PalmTree_3',
    'PalmTree_4',
  ];
  const rainFiles = [
    'Willow_1',
    'Willow_2',
    'Willow_5',
    'CommonTree_2',
    'CommonTree_4',
    'PineTree_1',
    'PineTree_5',
    'BirchTree_5',
  ];

  for (let index = 0; index < 30; index += 1) {
    const [x, z] = randomPointAcrossWorld(random, 360);
    if (Math.hypot(x, z) < 980) continue;
    if (dominantBiomeAt(x, z) !== 'meadow') continue;
    points.push({
      id: `tree-meadow-${index}`,
      file: pickArray(random, meadowFiles),
      position: [x, 0, z],
      scale: THREE.MathUtils.lerp(78, 100, random()),
      rotationY: random() * Math.PI * 2,
      biome: 'meadow',
    });
  }

  for (let index = 0; index < 34; index += 1) {
    const [x, z] = randomPointInBiome(random, BIOMES[0], 0.12);
    const file = pickArray(random, sandFiles);
    points.push({
      id: `tree-sand-${index}`,
      file,
      position: [x, 0, z],
      scale: file.startsWith('PalmTree')
        ? THREE.MathUtils.lerp(72, 92, random())
        : THREE.MathUtils.lerp(52, 76, random()),
      rotationY: random() * Math.PI * 2,
      biome: 'sand',
    });
  }

  for (let index = 0; index < 38; index += 1) {
    const [x, z] = randomPointInBiome(random, BIOMES[1], 0.08);
    points.push({
      id: `tree-rain-${index}`,
      file: pickArray(random, rainFiles),
      position: [x, 0, z],
      scale: THREE.MathUtils.lerp(86, 112, random()),
      rotationY: random() * Math.PI * 2,
      biome: 'rain',
    });
  }

  return points;
}

const TREE_POINTS = createTreePoints(BASE_TREE_POINTS);
const BASE_ROCK_POINTS = [
  {
    id: 'rock-0',
    file: 'Rock_Moss_4',
    position: [-420, 12, 330],
    scale: 74,
    radius: 44,
    rotationY: -0.42,
  },
  {
    id: 'rock-1',
    file: 'Rock_1',
    position: [-90, 8, -330],
    scale: 70,
    radius: 34,
    rotationY: 0.36,
  },
  {
    id: 'rock-2',
    file: 'Rock_Moss_7',
    position: [360, 12, -30],
    scale: 78,
    radius: 48,
    rotationY: 0.95,
  },
  {
    id: 'rock-3',
    file: 'Rock_4',
    position: [620, 9, 250],
    scale: 64,
    radius: 36,
    rotationY: -1.24,
  },
  {
    id: 'rock-4',
    file: 'Rock_Moss_2',
    position: [-820, 9, 115],
    scale: 66,
    radius: 38,
    rotationY: 1.7,
  },
  {
    id: 'rock-5',
    file: 'Rock_7',
    position: [905, 11, -175],
    scale: 72,
    radius: 45,
    rotationY: -0.74,
  },
  {
    id: 'rock-6',
    file: 'Rock_Moss_5',
    position: [170, 10, 410],
    scale: 62,
    radius: 35,
    rotationY: 0.12,
  },
  {
    id: 'rock-7',
    file: 'Rock_3',
    position: [-1015, 9, -520],
    scale: 68,
    radius: 39,
    rotationY: 2.16,
  },
];

function createRockPoints(basePoints) {
  const random = seededRandom(313377);
  const points = [...basePoints];
  const rockFilesByBiome = {
    meadow: ['Rock_Moss_1', 'Rock_Moss_2', 'Rock_Moss_4', 'Rock_2', 'Rock_5'],
    sand: ['Rock_1', 'Rock_2', 'Rock_4', 'Rock_6', 'Rock_7'],
    rain: ['Rock_Moss_3', 'Rock_Moss_5', 'Rock_Moss_6', 'Rock_Moss_7'],
  };

  for (let index = 0; index < 48; index += 1) {
    const biome = index < 16 ? 'sand' : index < 34 ? 'rain' : 'meadow';
    const [x, z] =
      biome === 'sand'
        ? randomPointInBiome(random, BIOMES[0], 0.18)
        : biome === 'rain'
          ? randomPointInBiome(random, BIOMES[1], 0.12)
          : randomPointAcrossWorld(random, 420);
    if (biome === 'meadow' && dominantBiomeAt(x, z) !== 'meadow') continue;
    const radius = THREE.MathUtils.lerp(
      30,
      biome === 'sand' ? 56 : 48,
      random(),
    );
    points.push({
      id: `rock-${biome}-${index}`,
      file: pickArray(random, rockFilesByBiome[biome]),
      position: [x, THREE.MathUtils.lerp(7, 14, random()), z],
      scale: THREE.MathUtils.lerp(58, biome === 'sand' ? 84 : 78, random()),
      radius,
      rotationY: random() * Math.PI * 2,
      biome,
    });
  }

  return points;
}

const ROCK_POINTS = createRockPoints(BASE_ROCK_POINTS);
const GROUND_COVER_VARIANTS = [
  { file: 'Grass_Short', scale: [36, 56], weight: 22 },
  { file: 'Grass', scale: [36, 58], weight: 19 },
  { file: 'Grass_2', scale: [32, 52], weight: 15 },
  { file: 'Plant_1', scale: [17, 27], weight: 9 },
  { file: 'Plant_2', scale: [15, 24], weight: 8 },
  { file: 'Plant_3', scale: [16, 25], weight: 8 },
  { file: 'Plant_4', scale: [14, 23], weight: 7 },
  { file: 'Wheat', scale: [18, 30], weight: 4 },
  { file: 'Bush_1', scale: [19, 31], weight: 3 },
  { file: 'Bush_2', scale: [18, 30], weight: 3 },
  { file: 'BushBerries_1', scale: [17, 28], weight: 2 },
  { file: 'BushBerries_2', scale: [17, 28], weight: 2 },
];
const BIOME_GROUND_COVER_VARIANTS = {
  meadow: GROUND_COVER_VARIANTS,
  sand: [
    { file: 'Grass_Short', scale: [18, 31], weight: 8 },
    { file: 'Plant_1', scale: [12, 21], weight: 10 },
    { file: 'Plant_2', scale: [11, 20], weight: 8 },
    { file: 'Wheat', scale: [13, 23], weight: 7 },
    { file: 'CactusFlower_1', scale: [13, 24], weight: 5 },
    { file: 'CactusFlowers_2', scale: [14, 26], weight: 3 },
    { file: 'CactusFlowers_4', scale: [14, 26], weight: 3 },
  ],
  rain: [
    { file: 'Grass', scale: [40, 66], weight: 18 },
    { file: 'Grass_2', scale: [38, 64], weight: 16 },
    { file: 'Bush_1', scale: [24, 40], weight: 9 },
    { file: 'Bush_2', scale: [24, 40], weight: 9 },
    { file: 'BushBerries_1', scale: [20, 34], weight: 5 },
    { file: 'BushBerries_2', scale: [20, 34], weight: 5 },
    { file: 'Plant_3', scale: [18, 30], weight: 7 },
    { file: 'Plant_4', scale: [18, 30], weight: 7 },
  ],
};
const GROUND_COVER_VARIANT_WEIGHT = GROUND_COVER_VARIANTS.reduce(
  (total, variant) => total + variant.weight,
  0,
);
const GROUND_COVER_CLUSTER_ANCHORS = [
  ...TREE_POINTS.map((tree) => ({
    x: tree.position[0],
    z: tree.position[2],
    radius: 88,
  })),
  ...ROCK_POINTS.map((rock) => ({
    x: rock.position[0],
    z: rock.position[2],
    radius: rock.radius + 16,
  })),
  { x: -560, z: 130, radius: 72 },
  { x: 210, z: 250, radius: 78 },
  { x: 850, z: 80, radius: 68 },
];
const GROUND_COVER_POINTS = createGroundCoverPoints();
const CREATURES = [
  {
    id: 'pink-blob',
    name: 'Pink Blob',
    url: MONSTER_MODEL_URLS.pinkBlob,
    position: [-360, 0, -120],
    scale: 26,
    tint: '#ff9fd7',
    drift: 90,
    animation: 'Walk',
    maxHp: 6,
    hitRadius: 42,
  },
  {
    id: 'orc',
    name: 'Orc',
    url: MONSTER_MODEL_URLS.orc,
    position: [410, 0, -210],
    scale: 24,
    tint: '#87c06a',
    drift: 70,
    animation: 'Walk',
    maxHp: 8,
    hitRadius: 40,
  },
  {
    id: 'mushnub',
    name: 'Mushnub',
    url: MONSTER_MODEL_URLS.mushnub,
    position: [720, 0, 250],
    scale: 26,
    tint: '#d7b8ff',
    drift: 60,
    animation: 'Walk',
    maxHp: 7,
    hitRadius: 42,
  },
  {
    id: 'dragon',
    name: 'Dragon',
    url: MONSTER_MODEL_URLS.dragon,
    position: [-720, 0, 250],
    scale: 24,
    tint: '#f4cf7c',
    drift: 105,
    animation: 'Flying_Idle',
    maxHp: 10,
    hitRadius: 58,
  },
];
const PROP_POINTS = [
  {
    url: SWORD_MODEL_URL,
    position: [185, 8, 225],
    scale: 44,
    rotation: [0, -0.65, -0.95],
  },
  {
    url: SHIELD_MODEL_URL,
    position: [245, 13, 245],
    scale: 46,
    rotation: [0.2, 0.5, -1.25],
  },
];
const BUILD_GRID_SIZE = 40;
const BUILD_EDGE_SNAP_DISTANCE = 88;
const BUILD_OVERLAP_TOLERANCE = 1.5;
const BUILD_FOUNDATION_HEIGHT = 6;
const BUILD_WALL_HEIGHT = 132;
const BUILD_ROOF_THICKNESS = 12;
const BUILD_STACK_HEIGHT = BUILD_WALL_HEIGHT;
const BUILD_MAX_STACK_LEVEL = 5;
const BUILD_DECAL_MATERIAL_PROPS = {
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
};
const PLAYER_OCCLUSION_OPACITY = 0.42;
const ROOF_INTERIOR_OPACITY = 0.02;
const PLAYER_OCCLUSION_TINT = new THREE.Color('#d7e6c2');
const PLAYER_OCCLUSION_TINT_STRENGTH = 0.22;
const PLAYER_OCCLUSION_TARGET_HEIGHT = 64;
const PLAYER_OCCLUSION_CHECK_INTERVAL = 0.08;
const PLAYER_OCCLUSION_SCREEN_PADDING = 0.035;
const SCENE_LIGHTING = {
  ambientColor: '#fff0c8',
  ambientIntensity: 0.62,
  hemisphereSky: '#fff1bf',
  hemisphereGround: '#6e7a3f',
  hemisphereIntensity: 0.78,
  sunColor: '#ffd28d',
  sunIntensity: 1.75,
  pointColor: '#ffb45f',
  pointIntensity: 68,
  pointDistance: 760,
  pointDecay: 1.55,
  spotColor: '#ffe0a3',
  spotIntensity: 42,
  spotDistance: 1120,
  spotAngle: 0.46,
  spotPenumbra: 0.78,
  spotDecay: 1.35,
  rectColor: '#ffd38a',
  rectIntensity: 2.1,
  rectWidth: 280,
  rectHeight: 165,
  contactShadowColor: '#3e4a23',
  backgroundColor: '#9ab66c',
  fogColor: '#a8bd82',
  fogNear: 1320,
  fogFar: 4300,
  toneMappingExposure: 0.94,
};
const SUN_SHADOW_OFFSET = new THREE.Vector3(-760, 1320, 860);
const NIGHT_SUN_SHADOW_OFFSET = new THREE.Vector3(560, 920, -760);
const DAY_NIGHT_CYCLE = {
  daySeconds: 60,
  nightSeconds: 60,
  ambientColor: '#c8d9ff',
  ambientIntensity: 0.48,
  hemisphereSky: '#9fb9e8',
  hemisphereGround: '#516246',
  hemisphereIntensity: 0.56,
  sunColor: '#b9cff7',
  sunIntensity: 0.72,
  pointIntensity: 118,
  spotIntensity: 62,
  rectIntensity: 3.4,
  backgroundColor: '#6f8199',
  fogColor: '#77899b',
  fogNear: 950,
  fogFar: 3600,
  toneMappingExposure: 0.82,
};
const WORLD_TIME_EPOCH_MS = Date.UTC(2026, 0, 1);
const SKY_SCALE = 450000;
const SKY_ATMOSPHERE = {
  turbidity: 8.2,
  rayleigh: 2.6,
  mieCoefficient: 0.005,
  mieDirectionalG: 0.74,
  showSunDisc: true,
};
const SUN_SHADOW_CAMERA = {
  halfWidth: 2800,
  halfHeight: 2300,
  near: 120,
  far: 3900,
  bias: -0.00008,
  normalBias: 0.78,
  radius: 4.8,
  blurSamples: 10,
};
const DETAILED_MODEL_SHADOW_OPTIONS = {
  shadowSide: THREE.BackSide,
};
const BUILD_RESOURCE_BLOCKERS = [
  ...TREE_POINTS.map((tree) => ({
    id: tree.id ?? tree.file,
    x: tree.position[0],
    z: tree.position[2],
    radius: 54,
  })),
  ...ROCK_POINTS.map((rock) => ({
    id: rock.id,
    x: rock.position[0],
    z: rock.position[2],
    radius: rock.radius,
  })),
];
const MEADOW_FLOWER_PALETTE = [
  '#f0dda2',
  '#dccb67',
  '#b9a2df',
  '#96bdd6',
  '#eaa970',
  '#c4cf9a',
];
const MEADOW_LEAF_PALETTE = ['#779a4b', '#9bb85d', '#5f8044', '#b3bf62'];
const MEADOW_GLOW_PALETTE = ['#fff2a6', '#f6d681', '#dff3b1'];
const MEADOW_FLOWER_POINTS = createMeadowScatter(
  MEADOW_FLOWER_COUNT,
  11231,
  MEADOW_FLOWER_PALETTE.length,
  4,
  9,
);
const MEADOW_LEAF_POINTS = createMeadowScatter(
  MEADOW_LEAF_COUNT,
  49217,
  MEADOW_LEAF_PALETTE.length,
  12,
  28,
);
const MEADOW_GLOW_POINTS = createMeadowScatter(
  MEADOW_GLOW_COUNT,
  81733,
  MEADOW_GLOW_PALETTE.length,
  8,
  15,
);
const GATHERABLE_PLANT_POINTS = createGatherablePlantPoints();
const VEGETATION_PRELOAD_FILES = Array.from(
  new Set([
    TREE_STUMP_FILE,
    FLOWER_RESOURCE_FILE,
    COTTON_RESOURCE_FILE,
    ...TREE_POINTS.map((tree) => tree.file),
    ...ROCK_POINTS.map((rock) => rock.file),
    ...GATHERABLE_PLANT_POINTS.map((plant) => plant.file),
  ]),
);

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(random, variants) {
  const total = variants.reduce((sum, variant) => sum + variant.weight, 0);
  let roll = random() * total;
  for (const variant of variants) {
    roll -= variant.weight;
    if (roll <= 0) return variant;
  }
  return variants[0];
}

function pickArray(random, items) {
  return items[Math.floor(random() * items.length)];
}

function biomeInfluenceAt(x, z, biome) {
  const dx = (x - biome.center[0]) / biome.radius[0];
  const dz = (z - biome.center[1]) / biome.radius[1];
  const distance = Math.sqrt(dx * dx + dz * dz);
  const hardEdge = 1 - biome.feather;
  return 1 - THREE.MathUtils.smoothstep(distance, hardEdge, 1);
}

function dominantBiomeAt(x, z) {
  const sand = biomeInfluenceAt(x, z, BIOMES[0]);
  const rain = biomeInfluenceAt(x, z, BIOMES[1]);
  if (sand > 0.28 && sand >= rain) return 'sand';
  if (rain > 0.28) return 'rain';
  return 'meadow';
}

function randomPointInBiome(random, biome, minCenterDistance = 0.08) {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(
    THREE.MathUtils.lerp(minCenterDistance, 0.92, random()),
  );
  return [
    biome.center[0] + Math.cos(angle) * biome.radius[0] * radius,
    biome.center[1] + Math.sin(angle) * biome.radius[1] * radius,
  ];
}

function randomPointAcrossWorld(random, margin = 220) {
  return [
    THREE.MathUtils.lerp(
      -WORLD_SIZE.width / 2 + margin,
      WORLD_SIZE.width / 2 - margin,
      random(),
    ),
    THREE.MathUtils.lerp(
      -WORLD_SIZE.height / 2 + margin,
      WORLD_SIZE.height / 2 - margin,
      random(),
    ),
  ];
}

function terrainEdgeFade(x, z) {
  const edgeDistance = Math.min(
    WORLD_SIZE.width / 2 - Math.abs(x),
    WORLD_SIZE.height / 2 - Math.abs(z),
  );
  return THREE.MathUtils.smoothstep(edgeDistance, 0, TERRAIN_EDGE_FADE);
}

function terrainMound(x, z, centerX, centerZ, radiusX, radiusZ, height) {
  const dx = (x - centerX) / radiusX;
  const dz = (z - centerZ) / radiusZ;
  const distance = dx * dx + dz * dz;
  if (distance >= 1) return 0;
  const falloff = 1 - distance;
  return height * falloff * falloff * (3 - 2 * falloff);
}

function getTerrainHeight(x, z) {
  const rolling =
    Math.sin(x * 0.0048 + z * 0.0022) * 3.8 +
    Math.sin(x * -0.0026 + z * 0.0064 + 1.7) * 3.2 +
    Math.cos(x * 0.0072 - z * 0.0031) * 1.7;
  const mounds =
    terrainMound(x, z, -940, -560, 470, 330, 14) +
    terrainMound(x, z, 620, -420, 520, 360, 16) +
    terrainMound(x, z, -220, 510, 560, 390, 13) +
    terrainMound(x, z, 1040, 620, 430, 310, 10);
  const height = THREE.MathUtils.clamp(
    TERRAIN_BASE_Y + rolling + mounds,
    -10,
    TERRAIN_MAX_RISE,
  );
  return height * terrainEdgeFade(x, z);
}

function getTerrainLocalNormal(x, z) {
  const sampleStep = 28;
  const heightLeft = getTerrainHeight(x - sampleStep, z);
  const heightRight = getTerrainHeight(x + sampleStep, z);
  const heightDown = getTerrainHeight(x, z - sampleStep);
  const heightUp = getTerrainHeight(x, z + sampleStep);
  const slopeX = (heightRight - heightLeft) / (sampleStep * 2);
  const slopeZ = (heightUp - heightDown) / (sampleStep * 2);
  return new THREE.Vector3(-slopeX, slopeZ, 1).normalize();
}

function getGroundTextureUv(x, z) {
  return [
    (x + WORLD_SIZE.width / 2) / WORLD_SIZE.width,
    (z + WORLD_SIZE.height / 2) / WORLD_SIZE.height,
  ];
}

function positionOnTerrain(position) {
  return [
    position[0],
    position[1] + getTerrainHeight(position[0], position[2]),
    position[2],
  ];
}

function getTerrainColor(x, z) {
  const sand = biomeInfluenceAt(x, z, BIOMES[0]);
  const rain = biomeInfluenceAt(x, z, BIOMES[1]);
  const wave =
    Math.sin(x * 0.007 + z * 0.003) * 0.08 +
    Math.cos(z * 0.009 - x * 0.004) * 0.06;
  const color = new THREE.Color('#7fa75a');
  color.offsetHSL(0.012, 0.02, wave);
  if (sand > 0) {
    color.lerp(new THREE.Color('#d9bd77').offsetHSL(0, 0.02, wave * 0.5), sand);
  }
  if (rain > 0) {
    color.lerp(
      new THREE.Color('#4f765d').offsetHSL(0.02, 0.04, wave * 0.45),
      rain,
    );
  }
  return color;
}

function getWorldTerrainBounds() {
  return {
    centerX: 0,
    centerZ: 0,
    width: WORLD_SIZE.width,
    depth: WORLD_SIZE.height,
  };
}

function createWorldTerrainGeometry() {
  const bounds = getWorldTerrainBounds();
  const segmentX = Math.max(
    24,
    Math.round((bounds.width / TERRAIN_CHUNK_SIZE) * TERRAIN_CHUNK_SEGMENTS),
  );
  const segmentZ = Math.max(
    24,
    Math.round((bounds.depth / TERRAIN_CHUNK_SIZE) * TERRAIN_CHUNK_SEGMENTS),
  );
  const geometry = new THREE.PlaneGeometry(
    bounds.width,
    bounds.depth,
    segmentX,
    segmentZ,
  );
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  const colors = [];
  const normals = [];

  for (let index = 0; index < positions.count; index += 1) {
    const x = bounds.centerX + positions.getX(index);
    const z = bounds.centerZ - positions.getY(index);
    const color = getTerrainColor(x, z);
    const normal = getTerrainLocalNormal(x, z);
    positions.setZ(index, getTerrainHeight(x, z));
    uvs.setXY(index, ...getGroundTextureUv(x, z));
    colors.push(color.r, color.g, color.b);
    normals.push(normal.x, normal.y, normal.z);
  }

  positions.needsUpdate = true;
  uvs.needsUpdate = true;
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

  return { bounds, geometry };
}

function pickGroundCoverVariant(random, clustered, biome = 'meadow') {
  const variants =
    BIOME_GROUND_COVER_VARIANTS[biome] ?? BIOME_GROUND_COVER_VARIANTS.meadow;
  if (clustered && random() > 0.78) {
    const denseVariants = variants.slice(Math.max(0, variants.length - 4));
    return denseVariants[Math.floor(random() * denseVariants.length)];
  }

  return pickWeighted(random, variants);
}

function createGroundCoverPoints() {
  const random = seededRandom(246813);
  const points = [];

  for (let index = 0; index < MAX_GROUND_COVER_COUNT; index += 1) {
    const clustered = index % 4 !== 1;
    let x;
    let z;

    if (clustered) {
      const anchor =
        GROUND_COVER_CLUSTER_ANCHORS[
          (index * 7 + Math.floor(random() * 3)) %
            GROUND_COVER_CLUSTER_ANCHORS.length
        ];
      const angle = random() * Math.PI * 2;
      const radius = (anchor.radius + random() * 132) * random() ** 0.62;
      x = anchor.x + Math.cos(angle) * radius;
      z = anchor.z + Math.sin(angle) * radius;
    } else {
      [x, z] = randomPointAcrossWorld(random, 72);
    }

    const clampedX = THREE.MathUtils.clamp(
      x,
      -WORLD_SIZE.width / 2 + 72,
      WORLD_SIZE.width / 2 - 72,
    );
    const clampedZ = THREE.MathUtils.clamp(
      z,
      -WORLD_SIZE.height / 2 + 72,
      WORLD_SIZE.height / 2 - 72,
    );
    const biome = dominantBiomeAt(clampedX, clampedZ);
    const variant = pickGroundCoverVariant(random, clustered, biome);
    const normalizedSeed = random();
    const scale =
      THREE.MathUtils.lerp(variant.scale[0], variant.scale[1], normalizedSeed) *
      (clustered ? 1.16 : 1.04) *
      (biome === 'sand' ? 0.92 : 1);

    points.push([
      variant.file,
      clampedX,
      clampedZ,
      scale,
      random() * Math.PI * 2,
      normalizedSeed,
      biome,
    ]);
  }

  return points;
}

function createMeadowScatter(count, seed, paletteSize, minSize, maxSize) {
  const points = [];
  for (let index = 0; index < count; index += 1) {
    const clusterRandom = seededRandom(seed + Math.floor(index / 5) * 977);
    const pointRandom = seededRandom(seed + index * 313);
    const clusterX = (clusterRandom() - 0.5) * WORLD_SIZE.width * 0.92;
    const clusterZ = (clusterRandom() - 0.5) * WORLD_SIZE.height * 0.92;
    const radius = (18 + clusterRandom() * 78) * pointRandom() ** 0.45;
    const angle = pointRandom() * Math.PI * 2;
    const x = THREE.MathUtils.clamp(
      clusterX + Math.cos(angle) * radius,
      -WORLD_SIZE.width / 2 + 64,
      WORLD_SIZE.width / 2 - 64,
    );
    const z = THREE.MathUtils.clamp(
      clusterZ + Math.sin(angle) * radius,
      -WORLD_SIZE.height / 2 + 64,
      WORLD_SIZE.height / 2 - 64,
    );
    const size = THREE.MathUtils.lerp(minSize, maxSize, pointRandom());
    const stretch = THREE.MathUtils.lerp(0.72, 1.42, pointRandom());
    points.push([
      x,
      z,
      size,
      stretch,
      pointRandom() * Math.PI * 2,
      Math.floor(pointRandom() * paletteSize),
    ]);
  }
  return points;
}

function createGatherablePlantPoints() {
  const random = seededRandom(684211);
  const points = [
    {
      id: 'flower-starter-0',
      type: 'flower',
      file: FLOWER_RESOURCE_FILE,
      position: [-180, 0, -120],
      scale: 46,
      radius: 52,
      rotationY: 0.35,
    },
    {
      id: 'flower-starter-1',
      type: 'flower',
      file: FLOWER_RESOURCE_FILE,
      position: [260, 0, 150],
      scale: 44,
      radius: 50,
      rotationY: 2.15,
    },
    {
      id: 'cotton-starter-0',
      type: 'cotton',
      file: COTTON_RESOURCE_FILE,
      position: [145, 0, -210],
      scale: 44,
      radius: 54,
      rotationY: 1.28,
    },
    {
      id: 'cotton-starter-1',
      type: 'cotton',
      file: COTTON_RESOURCE_FILE,
      position: [-320, 0, 190],
      scale: 42,
      radius: 52,
      rotationY: 2.8,
    },
  ];
  const specs = [
    {
      type: 'flower',
      count: 52,
      file: FLOWER_RESOURCE_FILE,
      scale: [30, 44],
      radius: [38, 50],
    },
    {
      type: 'cotton',
      count: 42,
      file: COTTON_RESOURCE_FILE,
      scale: [36, 46],
      radius: [40, 52],
    },
  ];

  for (const spec of specs) {
    let made = 0;
    let guard = 0;
    while (made < spec.count && guard < spec.count * 80) {
      guard += 1;
      const clustered = random() < 0.72;
      let x;
      let z;

      if (clustered && MEADOW_FLOWER_POINTS.length > 0) {
        const anchor =
          MEADOW_FLOWER_POINTS[
            Math.floor(random() * MEADOW_FLOWER_POINTS.length)
          ];
        const angle = random() * Math.PI * 2;
        const radius = THREE.MathUtils.lerp(18, 160, random() ** 0.6);
        x = anchor[0] + Math.cos(angle) * radius;
        z = anchor[1] + Math.sin(angle) * radius;
      } else {
        [x, z] = randomPointAcrossWorld(random, 120);
      }

      x = THREE.MathUtils.clamp(
        x,
        -WORLD_SIZE.width / 2 + 96,
        WORLD_SIZE.width / 2 - 96,
      );
      z = THREE.MathUtils.clamp(
        z,
        -WORLD_SIZE.height / 2 + 96,
        WORLD_SIZE.height / 2 - 96,
      );
      if (dominantBiomeAt(x, z) !== 'meadow') continue;
      if (
        points.some((point) => {
          const dx = point.position[0] - x;
          const dz = point.position[2] - z;
          return dx * dx + dz * dz < 76 * 76;
        })
      ) {
        continue;
      }

      points.push({
        id: `${spec.type}-${made}`,
        type: spec.type,
        file: spec.file,
        position: [x, 0, z],
        scale: THREE.MathUtils.lerp(spec.scale[0], spec.scale[1], random()),
        radius: THREE.MathUtils.lerp(spec.radius[0], spec.radius[1], random()),
        rotationY: random() * Math.PI * 2,
      });
      made += 1;
    }
  }

  return points;
}

function isPointVisibleInWindow(x, z, visibleWindow, padding = 0) {
  if (!visibleWindow) return true;
  const visibleRadius = visibleWindow.radius + padding;
  const dx = x - visibleWindow.x;
  const dz = z - visibleWindow.z;
  return dx * dx + dz * dz <= visibleRadius * visibleRadius;
}

function useVisibleWorldWindow(playerRef) {
  const [visibleWindow, setVisibleWindow] = useState({
    x: 0,
    z: 0,
    radius: WORLD_RENDER_RADIUS,
  });
  const lastCenterRef = useRef({ x: 0, z: 0 });

  useFrame(() => {
    const player = playerRef.current;
    if (!player) return;

    const nextX = player.position.x;
    const nextZ = player.position.z;
    const dx = nextX - lastCenterRef.current.x;
    const dz = nextZ - lastCenterRef.current.z;
    if (
      dx * dx + dz * dz <
      WORLD_RENDER_UPDATE_DISTANCE * WORLD_RENDER_UPDATE_DISTANCE
    ) {
      return;
    }

    lastCenterRef.current = { x: nextX, z: nextZ };
    startTransition(() => {
      setVisibleWindow({ x: nextX, z: nextZ, radius: WORLD_RENDER_RADIUS });
    });
  });

  return visibleWindow;
}

function drawSoftPatch(ctx, random, color, alpha, minRadius, maxRadius) {
  const x = random() * GROUND_TEXTURE_SIZE;
  const y = random() * GROUND_TEXTURE_SIZE;
  const radiusX = THREE.MathUtils.lerp(minRadius, maxRadius, random());
  const radiusY = radiusX * THREE.MathUtils.lerp(0.42, 1.1, random());
  const rotation = random() * Math.PI;
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);

  gradient.addColorStop(0, color);
  gradient.addColorStop(0.48, color);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(radiusX, radiusY);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGroundPebble(ctx, random, palette) {
  const x = random() * GROUND_TEXTURE_SIZE;
  const y = random() * GROUND_TEXTURE_SIZE;
  const radiusX = THREE.MathUtils.lerp(1.1, 4.6, random());
  const radiusY = radiusX * THREE.MathUtils.lerp(0.42, 0.86, random());
  const rotation = random() * Math.PI;
  const color = palette[Math.floor(random() * palette.length)];

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = 0.015 + random() * 0.035;
  ctx.fillStyle = '#4c6545';
  ctx.beginPath();
  ctx.ellipse(0.7, 1.2, radiusX * 1.08, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.18 + random() * 0.24;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.08 + random() * 0.12;
  ctx.fillStyle = '#fff7d8';
  ctx.beginPath();
  ctx.ellipse(
    -radiusX * 0.24,
    -radiusY * 0.34,
    radiusX * 0.32,
    radiusY * 0.28,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

function createMeadowGroundTexture() {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = GROUND_TEXTURE_SIZE;
  canvas.height = GROUND_TEXTURE_SIZE;
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(GROUND_TEXTURE_SIZE, GROUND_TEXTURE_SIZE);
  const random = seededRandom(60493);

  for (let y = 0; y < GROUND_TEXTURE_SIZE; y += 1) {
    for (let x = 0; x < GROUND_TEXTURE_SIZE; x += 1) {
      const offset = (y * GROUND_TEXTURE_SIZE + x) * 4;
      const broad =
        Math.sin(x * 0.015 + Math.sin(y * 0.008) * 1.6) +
        Math.sin((x + y) * 0.011 - 0.8) * 0.55 +
        Math.sin((x - y) * 0.019 + 1.4) * 0.32;
      const dry =
        Math.max(0, Math.sin(x * 0.012 + 2.1) * Math.sin(y * 0.01 - 0.7)) * 0.9;
      const grain = random() - 0.5;
      const light = broad * 4.8 + grain * 7;

      image.data[offset] = THREE.MathUtils.clamp(
        138 + light + dry * 14,
        0,
        255,
      );
      image.data[offset + 1] = THREE.MathUtils.clamp(
        174 + light * 1.12 + dry * 10,
        0,
        255,
      );
      image.data[offset + 2] = THREE.MathUtils.clamp(
        94 + light * 0.44 - dry * 6,
        0,
        255,
      );
      image.data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);

  for (let index = 0; index < 58; index += 1) {
    drawSoftPatch(
      ctx,
      random,
      random() > 0.5 ? 'rgba(184, 198, 88, 1)' : 'rgba(126, 156, 88, 1)',
      0.08 + random() * 0.1,
      46,
      152,
    );
  }

  for (let index = 0; index < 12; index += 1) {
    drawSoftPatch(
      ctx,
      random,
      random() > 0.48 ? 'rgba(184, 150, 126, 1)' : 'rgba(165, 143, 164, 1)',
      0.035 + random() * 0.045,
      36,
      126,
    );
  }

  for (let index = 0; index < 18; index += 1) {
    drawSoftPatch(
      ctx,
      random,
      random() > 0.54 ? 'rgba(94, 126, 72, 1)' : 'rgba(125, 119, 76, 1)',
      0.035 + random() * 0.055,
      28,
      112,
    );
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let index = 0; index < 9; index += 1) {
    const startX = random() * GROUND_TEXTURE_SIZE;
    const startY = random() * GROUND_TEXTURE_SIZE;
    const controlX = startX + (random() - 0.5) * GROUND_TEXTURE_SIZE * 0.55;
    const controlY = startY + (random() - 0.5) * GROUND_TEXTURE_SIZE * 0.55;
    const endX = startX + (random() - 0.5) * GROUND_TEXTURE_SIZE * 0.85;
    const endY = startY + (random() - 0.5) * GROUND_TEXTURE_SIZE * 0.85;

    ctx.globalAlpha = 0.045 + random() * 0.055;
    ctx.strokeStyle = random() > 0.5 ? '#7e754b' : '#8c795d';
    ctx.lineWidth = 24 + random() * 46;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    ctx.stroke();

    ctx.globalAlpha = 0.03 + random() * 0.04;
    ctx.strokeStyle = '#f2e8b7';
    ctx.lineWidth = 4 + random() * 12;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(controlX, controlY, endX, endY);
    ctx.stroke();
  }

  ctx.lineCap = 'round';
  for (let index = 0; index < 3200; index += 1) {
    const x = random() * GROUND_TEXTURE_SIZE;
    const y = random() * GROUND_TEXTURE_SIZE;
    const length = 3 + random() * 11;
    const angle = -0.75 + random() * 1.5;
    const tint = random();
    ctx.globalAlpha = 0.05 + random() * 0.12;
    ctx.strokeStyle =
      tint > 0.66 ? '#c7d879' : tint > 0.33 ? '#6f8f48' : '#93ac5d';
    ctx.lineWidth = 0.65 + random() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    ctx.stroke();
  }

  const pebblePalette = ['#b8beb2', '#d0c7a8', '#a8b09e', '#d6d8ca'];
  for (let index = 0; index < 420; index += 1) {
    drawGroundPebble(ctx, random, pebblePalette);
  }

  for (let index = 0; index < 520; index += 1) {
    const x = random() * GROUND_TEXTURE_SIZE;
    const y = random() * GROUND_TEXTURE_SIZE;
    const radius = 0.8 + random() * 2.2;
    const palette = ['#f4e9d4', '#e6d46d', '#bfa4ed', '#b9d3f2'];
    ctx.globalAlpha = 0.36 + random() * 0.28;
    ctx.fillStyle = palette[Math.floor(random() * palette.length)];
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 12;
  texture.needsUpdate = true;
  return texture;
}

function createMeadowDecalTexture(type) {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(255, 255, 255, 0.01)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(48, 48);

  if (type === 'flower') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    for (let index = 0; index < 5; index += 1) {
      ctx.save();
      ctx.rotate((index / 5) * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(0, -12, 5, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255, 227, 114, 0.78)';
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'leaf') {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    for (let index = 0; index < 4; index += 1) {
      ctx.save();
      ctx.rotate(-0.55 + index * 0.36);
      ctx.beginPath();
      ctx.ellipse(0, -20 - index * 3, 5.5, 27, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(8, -7);
    ctx.lineTo(34, 0);
    ctx.lineTo(8, 7);
    ctx.lineTo(0, 34);
    ctx.lineTo(-8, 7);
    ctx.lineTo(-34, 0);
    ctx.lineTo(-8, -7);
    ctx.closePath();
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function applyAxeHandTransform(axeObject, transform) {
  axeObject.position.set(
    transform.position.x,
    transform.position.y,
    transform.position.z,
  );
  axeObject.rotation.set(
    THREE.MathUtils.degToRad(transform.rotation.x),
    THREE.MathUtils.degToRad(transform.rotation.y),
    THREE.MathUtils.degToRad(transform.rotation.z),
  );
}

function applyBlockingPose(rig, weight) {
  if (weight <= 0.001) return;
  const w = THREE.MathUtils.clamp(weight, 0, 1);
  if (rig?.chest) {
    rig.chest.rotation.x += THREE.MathUtils.degToRad(4) * w;
    rig.chest.rotation.y += THREE.MathUtils.degToRad(5) * w;
  }
  if (rig?.upperLeftArm) {
    rig.upperLeftArm.rotation.x += THREE.MathUtils.degToRad(-34) * w;
    rig.upperLeftArm.rotation.y += THREE.MathUtils.degToRad(-12) * w;
    rig.upperLeftArm.rotation.z += THREE.MathUtils.degToRad(54) * w;
  }
  if (rig?.lowerLeftArm) {
    rig.lowerLeftArm.rotation.x += THREE.MathUtils.degToRad(-64) * w;
    rig.lowerLeftArm.rotation.z += THREE.MathUtils.degToRad(-16) * w;
  }
  if (rig?.upperRightArm) {
    rig.upperRightArm.rotation.x += THREE.MathUtils.degToRad(-16) * w;
    rig.upperRightArm.rotation.y += THREE.MathUtils.degToRad(10) * w;
    rig.upperRightArm.rotation.z += THREE.MathUtils.degToRad(-18) * w;
  }
  if (rig?.lowerRightArm) {
    rig.lowerRightArm.rotation.x += THREE.MathUtils.degToRad(-22) * w;
  }
}

function createUpperBodyAnimationClip(clip, name = `${clip?.name || 'UpperBody'}_Upper`) {
  if (!clip) return null;
  const upperBodyTrackNames = [
    'spine',
    'chest',
    'neck',
    'head',
    'shoulder',
    'upperarm',
    'lowerarm',
    'wrist',
    'hand',
    'handslot',
  ];
  const tracks = clip.tracks.filter((track) => {
    const trackName = track.name.toLowerCase();
    return upperBodyTrackNames.some((part) => trackName.includes(part));
  });
  return tracks.length ? new THREE.AnimationClip(name, clip.duration, tracks) : clip;
}

function createMiningPickaxeObject() {
  const pickaxe = new THREE.Group();
  pickaxe.name = 'custom_mining_pickaxe';

  const handleMaterial = new THREE.MeshStandardMaterial({
    color: '#8b5a32',
    roughness: 0.82,
    metalness: 0,
  });
  const gripMaterial = new THREE.MeshStandardMaterial({
    color: '#4c3327',
    roughness: 0.9,
    metalness: 0,
  });
  const metalMaterial = new THREE.MeshStandardMaterial({
    color: '#cdd5d1',
    roughness: 0.58,
    metalness: 0.18,
  });
  const darkMetalMaterial = new THREE.MeshStandardMaterial({
    color: '#6f7976',
    roughness: 0.64,
    metalness: 0.12,
  });

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.055, 1.16, 7),
    handleMaterial,
  );
  handle.position.y = 0.06;
  pickaxe.add(handle);

  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.067, 0.3, 7),
    gripMaterial,
  );
  grip.position.y = -0.43;
  pickaxe.add(grip);

  const collar = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.18, 0.17),
    darkMetalMaterial,
  );
  collar.position.y = 0.54;
  pickaxe.add(collar);

  const head = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.052, 0.88, 6),
    metalMaterial,
  );
  head.rotation.z = Math.PI / 2;
  head.position.y = 0.58;
  pickaxe.add(head);

  const leftTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.095, 0.28, 6),
    metalMaterial,
  );
  leftTip.rotation.z = Math.PI / 2;
  leftTip.position.set(-0.58, 0.58, 0);
  pickaxe.add(leftTip);

  const rightTip = new THREE.Mesh(
    new THREE.ConeGeometry(0.095, 0.26, 6),
    metalMaterial,
  );
  rightTip.rotation.z = -Math.PI / 2;
  rightTip.position.set(0.57, 0.58, 0);
  pickaxe.add(rightTip);

  const wedge = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.14),
    darkMetalMaterial,
  );
  wedge.rotation.z = -0.32;
  wedge.position.set(0.31, 0.56, 0);
  pickaxe.add(wedge);

  pickaxe.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      material.shadowSide = DETAILED_MODEL_SHADOW_OPTIONS.shadowSide;
      material.needsUpdate = true;
    });
  });

  return pickaxe;
}

function finishHeldWeaponObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      material.shadowSide = DETAILED_MODEL_SHADOW_OPTIONS.shadowSide;
      material.needsUpdate = true;
    });
  });
  return object;
}

function createKayKitHeldWeaponObject(weaponId, sourceScene) {
  if (!sourceScene) return null;
  const group = new THREE.Group();
  group.name = `kaykit_held_weapon_${weaponId}`;
  const model = sourceScene.clone(true);
  const config = KAYKIT_HELD_WEAPON_CONFIG[weaponId] || {};
  model.scale.setScalar(config.scale || 0.86);
  group.userData.handTransform =
    config.handTransform || GENERIC_WEAPON_HAND_TRANSFORM;
  group.add(model);
  return finishHeldWeaponObject(group);
}

function createEquipmentWearables(equipment = {}) {
  const root = new THREE.Group();
  root.name = 'custom_equipment_wearables';
  const cloth = new THREE.MeshStandardMaterial({
    color: '#8f986e',
    roughness: 0.78,
    metalness: 0,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: '#d8c58b',
    roughness: 0.62,
    metalness: 0.05,
  });
  const wood = new THREE.MeshStandardMaterial({
    color: '#8a5a35',
    roughness: 0.82,
    metalness: 0,
  });
  const charm = new THREE.MeshStandardMaterial({
    color: '#f2b7ff',
    emissive: '#6d2f74',
    emissiveIntensity: 0.42,
    roughness: 0.42,
    metalness: 0.08,
  });

  const addWearable = (slot, object) => {
    object.userData.equipmentSlot = slot;
    root.add(finishHeldWeaponObject(object));
  };

  if (equipment.head === 'cloth_cap') {
    const cap = new THREE.Group();
    cap.name = 'custom_cloth_cap';
    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), cloth);
    crown.scale.set(1.02, 0.5, 0.9);
    crown.position.set(0, 0.11, 0.01);
    cap.add(crown);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.11), trim);
    brim.position.set(0, 0.04, 0.13);
    cap.add(brim);
    addWearable('head', cap);
  }

  if (equipment.body === 'padded_vest') {
    const vest = new THREE.Group();
    vest.name = 'custom_padded_vest';
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.055), cloth);
    front.position.set(0, -0.05, 0.12);
    vest.add(front);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.055, 0.07), trim);
    belt.position.set(0, -0.21, 0.13);
    vest.add(belt);
    addWearable('body', vest);
  }

  if (equipment.feet === 'trail_boots') {
    for (const side of ['l', 'r']) {
      const boot = new THREE.Group();
      boot.name = `custom_trail_boot_${side}`;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.25), wood);
      foot.position.set(0, -0.02, 0.05);
      boot.add(foot);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.09, 0.14), trim);
      cuff.position.set(0, 0.05, -0.02);
      boot.add(cuff);
      addWearable(`foot.${side}`, boot);
    }
  }

  if (equipment.charm === 'petal_charm') {
    const pendant = new THREE.Group();
    pendant.name = 'custom_petal_charm';
    const cord = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.008, 6, 18, Math.PI * 1.25), trim);
    cord.rotation.set(Math.PI / 2, 0, 0);
    cord.position.set(0, 0.08, 0.14);
    pendant.add(cord);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), charm);
    gem.position.set(0, -0.08, 0.18);
    pendant.add(gem);
    addWearable('charm', pendant);
  }

  return root;
}

function createHeldWeaponObject(weaponId = 'stick') {
  const group = new THREE.Group();
  group.name = `custom_held_weapon_${weaponId}`;
  const weapon = weaponDefs.find((item) => item.id === weaponId);
  const accentColor = weapon?.color || '#d7a45c';
  const wood = new THREE.MeshStandardMaterial({
    color: '#9a663c',
    roughness: 0.82,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: '#3f342d',
    roughness: 0.76,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: '#d8ded5',
    roughness: 0.48,
    metalness: 0.18,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: accentColor,
    emissive: ['laser', 'blaster', 'wand'].includes(weaponId)
      ? accentColor
      : '#000000',
    emissiveIntensity: ['laser', 'blaster', 'wand'].includes(weaponId) ? 0.9 : 0,
    roughness: 0.5,
    metalness: ['pistol', 'rifle', 'laser', 'blaster'].includes(weaponId)
      ? 0.16
      : 0,
  });
  const addCylinder = (
    radius,
    height,
    material,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    segments = 7,
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, height, segments),
      material,
    );
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    group.add(mesh);
    return mesh;
  };
  const addBox = (size, material, position = [0, 0, 0], rotation = [0, 0, 0]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    group.add(mesh);
    return mesh;
  };
  const addCone = (
    radius,
    height,
    material,
    position = [0, 0, 0],
    rotation = [0, 0, 0],
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.ConeGeometry(radius, height, 7),
      material,
    );
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    group.add(mesh);
    return mesh;
  };

  if (weaponId === 'spear') {
    addCylinder(0.028, 1.18, wood, [0, 0.08, 0]);
    addCone(0.09, 0.22, metal, [0, 0.78, 0]);
    addBox([0.18, 0.035, 0.06], accent, [0, 0.62, 0]);
  } else if (weaponId === 'hammer') {
    addCylinder(0.038, 0.9, wood, [0, -0.03, 0]);
    addBox([0.42, 0.22, 0.2], metal, [0, 0.48, 0]);
    addBox([0.2, 0.08, 0.23], dark, [0, 0.34, 0]);
  } else if (weaponId === 'bow') {
    const bow = new THREE.Mesh(
      new THREE.TorusGeometry(0.36, 0.018, 7, 28, Math.PI * 1.35),
      wood,
    );
    bow.position.y = 0.16;
    bow.rotation.set(Math.PI / 2, 0, -0.68);
    group.add(bow);
    addCylinder(0.008, 0.74, accent, [0.22, 0.16, 0], [0, 0, 0], 5);
    addCylinder(0.018, 0.36, dark, [0, 0.08, 0], [0, 0, 0], 6);
  } else if (weaponId === 'pistol') {
    addBox([0.16, 0.18, 0.18], dark, [0, 0.12, 0]);
    addBox([0.12, 0.42, 0.12], metal, [0, 0.36, 0]);
    addBox([0.09, 0.24, 0.1], wood, [0, -0.08, 0], [0.42, 0, 0]);
    addBox([0.1, 0.05, 0.1], accent, [0, 0.61, 0]);
  } else if (weaponId === 'rifle') {
    addBox([0.12, 0.86, 0.12], metal, [0, 0.32, 0]);
    addBox([0.16, 0.34, 0.18], wood, [0, -0.12, 0]);
    addBox([0.08, 0.16, 0.16], dark, [0, 0.02, 0]);
    addCylinder(0.035, 0.34, accent, [0, 0.82, 0], [0, 0, 0], 8);
  } else if (weaponId === 'wand') {
    addCylinder(0.026, 0.88, wood, [0, 0.1, 0], [0, 0, 0], 7);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), accent);
    gem.position.y = 0.6;
    group.add(gem);
  } else if (weaponId === 'laser' || weaponId === 'blaster') {
    addBox([0.16, 0.46, 0.16], dark, [0, 0.18, 0]);
    addBox([0.12, 0.5, 0.12], metal, [0, 0.44, 0]);
    addBox([0.08, 0.2, 0.2], accent, [0, 0.68, 0]);
    addBox([0.09, 0.26, 0.1], wood, [0, -0.1, 0], [0.38, 0, 0]);
  } else {
    addCylinder(0.035, 1.0, wood, [0, 0.08, 0], [0, 0, 0], 7);
    addCylinder(0.045, 0.18, dark, [0, -0.3, 0], [0, 0, 0], 7);
    addCylinder(0.045, 0.13, accent, [0, 0.55, 0], [0, 0, 0], 7);
  }

  return finishHeldWeaponObject(group);
}

function createHeldTorchObject() {
  const torch = new THREE.Group();
  torch.name = 'custom_held_torch';

  const handleMaterial = new THREE.MeshStandardMaterial({
    color: '#81542f',
    roughness: 0.84,
    metalness: 0,
  });
  const wrapMaterial = new THREE.MeshStandardMaterial({
    color: '#34251d',
    roughness: 0.9,
    metalness: 0,
  });
  const emberMaterial = new THREE.MeshStandardMaterial({
    color: '#fff0a0',
    emissive: '#ff9b2f',
    emissiveIntensity: 2.6,
    roughness: 0.42,
    metalness: 0,
  });
  const flameMaterial = new THREE.MeshBasicMaterial({
    color: '#ffc15b',
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
  });

  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.055, 0.92, 7),
    handleMaterial,
  );
  handle.position.y = 0.02;
  torch.add(handle);

  const wrap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.065, 0.18, 7),
    wrapMaterial,
  );
  wrap.position.y = 0.49;
  torch.add(wrap);

  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 12, 8),
    emberMaterial,
  );
  ember.position.y = 0.62;
  torch.add(ember);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.115, 0.34, 10),
    flameMaterial,
  );
  flame.position.y = 0.81;
  torch.add(flame);

  const light = new THREE.PointLight(
    '#ffbd66',
    TORCH_LIGHT_BASE_INTENSITY,
    TORCH_LIGHT_DISTANCE,
    1.25,
  );
  light.position.set(0, 0.82, 0.02);
  torch.add(light);

  torch.userData.flame = flame;
  torch.userData.light = light;
  torch.userData.ember = ember;
  return torch;
}

function disposeObjectMaterialsAndGeometry(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => material?.dispose());
  });
}

function getPlayerOccluderRoot(object) {
  let current = object;
  while (current) {
    if (current.userData?.playerOccluder) return current;
    current = current.parent;
  }
  return null;
}

function ignoresPlayerOcclusion(object) {
  let current = object;
  while (current) {
    if (current.userData?.ignorePlayerOcclusion) return true;
    if (current.userData?.playerOccluder) return false;
    current = current.parent;
  }
  return false;
}

function cloneOccluderMaterials(root) {
  root.traverse((child) => {
    if (
      !child.isMesh ||
      child.userData.ignorePlayerOcclusion ||
      child.userData.occlusionMaterialsCloned
    ) {
      return;
    }
    if (Array.isArray(child.material)) {
      child.material = child.material.map(
        (material) => material?.clone?.() || material,
      );
    } else if (child.material?.clone) {
      child.material = child.material.clone();
    }
    child.userData.occlusionMaterialsCloned = true;
  });
}

function collectOccluderEntries(root) {
  const entries = [];
  root.traverse((child) => {
    if (
      !child.isMesh ||
      child.userData.ignorePlayerOcclusion ||
      !child.material
    )
      return;
    const meshMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of meshMaterials) {
      if (!material) continue;
      if (!material.userData.playerOcclusionOriginal) {
        material.userData.playerOcclusionOriginal = {
          opacity: material.opacity,
          transparent: material.transparent,
          depthWrite: material.depthWrite,
          color: material.color?.clone?.() || null,
          map: material.map || null,
          normalMap: material.normalMap || null,
          emissiveIntensity: material.emissiveIntensity,
          castShadow: child.castShadow,
        };
      }
      entries.push({
        mesh: child,
        material,
        original: material.userData.playerOcclusionOriginal,
      });
    }
  });
  return entries;
}

function restoreOcclusionEntry(entry) {
  const original =
    entry?.material?.userData?.playerOcclusionOriginal || entry?.original;
  if (!entry?.material || !original) return;

  entry.mesh.castShadow = original.castShadow;
  entry.material.opacity = original.opacity;
  entry.material.transparent = original.transparent;
  entry.material.depthWrite = original.depthWrite;
  if (original.color && entry.material.color)
    entry.material.color.copy(original.color);
  if ('map' in entry.material) entry.material.map = original.map;
  if ('normalMap' in entry.material)
    entry.material.normalMap = original.normalMap;
  if (typeof entry.material.emissiveIntensity === 'number') {
    entry.material.emissiveIntensity = original.emissiveIntensity;
  }
  delete entry.material.userData.playerOcclusionOriginal;
  entry.material.needsUpdate = true;
}

function fillOccluderWorldBox(root, box, meshBox) {
  box.makeEmpty();
  root.updateWorldMatrix(true, true);
  root.traverse((child) => {
    if (
      !child.isMesh ||
      child.userData.ignorePlayerOcclusion ||
      !child.geometry
    )
      return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    meshBox.copy(child.geometry.boundingBox).applyMatrix4(child.matrixWorld);
    box.union(meshBox);
  });
  return !box.isEmpty();
}

function occluderScreensPlayer(
  root,
  playerScreen,
  playerViewZ,
  camera,
  scratch,
) {
  if (!fillOccluderWorldBox(root, scratch.box, scratch.meshBox)) return false;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let closestViewZ = -Infinity;
  const { min, max } = scratch.box;
  const corners = scratch.boxCorners;

  corners[0].set(min.x, min.y, min.z);
  corners[1].set(min.x, min.y, max.z);
  corners[2].set(min.x, max.y, min.z);
  corners[3].set(min.x, max.y, max.z);
  corners[4].set(max.x, min.y, min.z);
  corners[5].set(max.x, min.y, max.z);
  corners[6].set(max.x, max.y, min.z);
  corners[7].set(max.x, max.y, max.z);

  for (const corner of corners) {
    scratch.projected.copy(corner).project(camera);
    minX = Math.min(minX, scratch.projected.x);
    maxX = Math.max(maxX, scratch.projected.x);
    minY = Math.min(minY, scratch.projected.y);
    maxY = Math.max(maxY, scratch.projected.y);

    scratch.viewPosition.copy(corner).applyMatrix4(camera.matrixWorldInverse);
    closestViewZ = Math.max(closestViewZ, scratch.viewPosition.z);
  }

  const padding = PLAYER_OCCLUSION_SCREEN_PADDING;
  if (
    playerScreen.x < minX - padding ||
    playerScreen.x > maxX + padding ||
    playerScreen.y < minY - padding ||
    playerScreen.y > maxY + padding
  ) {
    return false;
  }

  return closestViewZ > playerViewZ + 2;
}

function fadePlayerOccluder(root) {
  if (!root) return;
  cloneOccluderMaterials(root);
  root.userData.occlusionFaded = collectOccluderEntries(root);

  for (const entry of root.userData.occlusionFaded) {
    const original = entry.original;
    entry.material.transparent = true;
    const targetOpacity =
      root.userData?.playerOcclusionOpacity ?? PLAYER_OCCLUSION_OPACITY;
    entry.material.opacity = Math.min(original.opacity ?? 1, targetOpacity);
    entry.material.depthWrite = false;
    if (entry.material.color && original.color) {
      entry.material.color
        .copy(original.color)
        .lerp(PLAYER_OCCLUSION_TINT, PLAYER_OCCLUSION_TINT_STRENGTH);
    }
    if (
      typeof entry.material.emissiveIntensity === 'number' &&
      typeof original.emissiveIntensity === 'number'
    ) {
      entry.material.emissiveIntensity = original.emissiveIntensity * 0.35;
    }
    entry.material.needsUpdate = true;
  }
}

function restorePlayerOccluder(root) {
  if (!root) return;
  const faded = root.userData?.occlusionFaded || [];
  for (const entry of faded) restoreOcclusionEntry(entry);

  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    const meshMaterials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of meshMaterials) {
      restoreOcclusionEntry({ mesh: child, material });
    }
  });

  if (root.userData) {
    root.userData.occlusionFaded = null;
  }
}

function sanitizeRenderSettings(settings) {
  const quality = RENDER_QUALITY_CONFIG[settings?.quality]
    ? settings.quality
    : DEFAULT_RENDER_SETTINGS.quality;

  return {
    quality,
    renderScale: [1, 1.5, 2].includes(settings?.renderScale)
      ? settings.renderScale
      : DEFAULT_RENDER_SETTINGS.renderScale,
    groundCoverCount: THREE.MathUtils.clamp(
      Number(settings?.groundCoverCount) ||
        DEFAULT_RENDER_SETTINGS.groundCoverCount,
      0,
      MAX_GROUND_COVER_COUNT,
    ),
    mainShadows:
      typeof settings?.mainShadows === 'boolean'
        ? settings.mainShadows
        : DEFAULT_RENDER_SETTINGS.mainShadows,
    contactShadows:
      typeof settings?.contactShadows === 'boolean'
        ? settings.contactShadows
        : DEFAULT_RENDER_SETTINGS.contactShadows,
    showStats:
      typeof settings?.showStats === 'boolean'
        ? settings.showStats
        : DEFAULT_RENDER_SETTINGS.showStats,
    fogEnabled:
      typeof settings?.fogEnabled === 'boolean'
        ? settings.fogEnabled
        : DEFAULT_RENDER_SETTINGS.fogEnabled,
    fogIntensity: THREE.MathUtils.clamp(
      Number(settings?.fogIntensity) || DEFAULT_RENDER_SETTINGS.fogIntensity,
      0.5,
      2.5,
    ),
  };
}

function loadRenderSettings() {
  if (typeof window === 'undefined') return DEFAULT_RENDER_SETTINGS;

  try {
    return sanitizeRenderSettings(
      JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY)),
    );
  } catch {
    return DEFAULT_RENDER_SETTINGS;
  }
}

function getCameraOffset(tuning) {
  const angleRadians = THREE.MathUtils.degToRad(tuning.angle);
  return new THREE.Vector3(
    0,
    Math.sin(angleRadians) * tuning.distance,
    Math.cos(angleRadians) * tuning.distance,
  );
}

function getRoundedCameraOffset(tuning) {
  const offset = getCameraOffset(tuning);
  return {
    x: Math.round(offset.x),
    y: Math.round(offset.y),
    z: Math.round(offset.z),
  };
}

function shortestAngleDelta(target, current) {
  return Math.atan2(Math.sin(target - current), Math.cos(target - current));
}

function dampAngle(current, target, damping, delta) {
  return (
    current +
    shortestAngleDelta(target, current) * (1 - Math.exp(-damping * delta))
  );
}

function clampPlanarVelocity(vx, vz, maxSpeed) {
  const speed = Math.hypot(vx, vz);
  if (!Number.isFinite(speed) || speed <= maxSpeed) {
    return {
      vx: Number.isFinite(vx) ? vx : 0,
      vz: Number.isFinite(vz) ? vz : 0,
    };
  }
  const scale = maxSpeed / speed;
  return { vx: vx * scale, vz: vz * scale };
}

function currentFrameTime() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createCreatureCombatStates() {
  return Object.fromEntries(
    CREATURES.map((creature) => [
      creature.id,
      {
        hp: creature.maxHp,
        maxHp: creature.maxHp,
        hitUntil: 0,
        defeatedUntil: 0,
        lastDamage: 0,
        lastDamageAt: 0,
      },
    ]),
  );
}

function creatureCombatStateFor(creature, states) {
  return (
    states[creature.id] || {
      hp: creature.maxHp,
      maxHp: creature.maxHp,
      hitUntil: 0,
      defeatedUntil: 0,
      lastDamage: 0,
      lastDamageAt: 0,
    }
  );
}

function isCreatureStateDefeated(state, time = Date.now()) {
  return Boolean(state?.hp <= 0 && state.defeatedUntil > time);
}

function weaponAttackProfile(weapon) {
  const weaponType = weapon?.weaponType || 'melee';
  const isMelee = weaponType === 'melee';
  const range = isMelee
    ? Math.max(90, (Number(weapon?.range) || DEFAULT_WEAPON_ATTACK.range) + 72)
    : Math.max(160, (Number(weapon?.range) || DEFAULT_WEAPON_ATTACK.range) * 1.1);
  const halfWidth = isMelee
    ? weapon?.id === 'dagger'
      ? 16
      : weapon?.id === 'great_axe'
        ? 30
        : weapon?.id === 'battle_axe'
          ? 26
          : DEFAULT_WEAPON_ATTACK.halfWidth
    : weaponType === 'spark'
      ? 24
      : 18;
  return {
    animationDuration: isMelee ? 0.44 : 0.36,
    cooldownMs: Math.max(220, (Number(weapon?.cooldown) || 0.5) * 1000),
    damage: Math.max(1, Number(weapon?.damage) || DEFAULT_WEAPON_ATTACK.damage),
    halfWidth,
    impactMs: isMelee ? 150 : 110,
    range,
    sfx: isMelee ? 'melee' : weaponType === 'spark' ? 'laser' : 'shot',
    type: weaponType,
  };
}

function weaponAttackIntersects(entry, attack) {
  const dx = entry.position.x - attack.origin.x;
  const dz = entry.position.z - attack.origin.z;
  const forwardX = Math.sin(attack.facing);
  const forwardZ = Math.cos(attack.facing);
  const forwardDistance = dx * forwardX + dz * forwardZ;
  const distanceSq = dx * dx + dz * dz;
  const lateralSq = Math.max(
    0,
    distanceSq - forwardDistance * forwardDistance,
  );
  const hitRadius = entry.radius || 36;
  return (
    forwardDistance >= -hitRadius * 0.2 &&
    forwardDistance <= attack.profile.range + hitRadius * 0.45 &&
    Math.sqrt(lateralSq) <= attack.profile.halfWidth + hitRadius
  );
}

function findWeaponAttackHit(attackables, states, attack) {
  const time = Date.now();
  let best = null;
  let bestForwardDistance = Infinity;
  for (const entry of attackables.values()) {
    if (!entry) continue;
    if (entry.type === 'creature') {
      const state = states[entry.id];
      if (!state || isCreatureStateDefeated(state, time)) continue;
    } else if (entry.type === 'player') {
      if (entry.hp <= 0) continue;
    } else {
      continue;
    }
    if (!weaponAttackIntersects(entry, attack)) continue;
    const dx = entry.position.x - attack.origin.x;
    const dz = entry.position.z - attack.origin.z;
    const forwardDistance =
      dx * Math.sin(attack.facing) + dz * Math.cos(attack.facing);
    if (forwardDistance < bestForwardDistance) {
      best = entry;
      bestForwardDistance = forwardDistance;
    }
  }
  return best;
}

function awardGatheredResource(itemKey, count, label, options = {}) {
  gameUiStore.getState().addItems(
    { [itemKey]: count },
    {
      deferPersist: options.deferPersist,
      persistDelayMs: options.persistDelayMs,
      sound: 'complete',
      message: `Gathered ${count} ${label}.`,
    },
  );
}

function snapToBuildGrid(value) {
  return Math.round(value / BUILD_GRID_SIZE) * BUILD_GRID_SIZE;
}

function buildFootprint(piece, x, z, rot) {
  const rotated =
    piece.id !== 'foundation' && piece.id !== 'roof' && rot % 2 === 1;
  return {
    x,
    z,
    rot,
    w: rotated ? piece.h : piece.w,
    h: rotated ? piece.w : piece.h,
  };
}

function buildingLevel(building) {
  return Math.max(0, Math.floor(Number(building?.level) || 0));
}

function sameBuildPlane(a, b) {
  return (
    Math.abs(a.x - b.x) < 0.01 &&
    Math.abs(a.z - b.z) < 0.01 &&
    Math.abs(a.w - b.w) < 0.01 &&
    Math.abs(a.h - b.h) < 0.01 &&
    (a.rot || 0) % 2 === (b.rot || 0) % 2
  );
}

function rectsOverlap(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w - BUILD_OVERLAP_TOLERANCE &&
    Math.abs(a.z - b.z) * 2 < a.h + b.h - BUILD_OVERLAP_TOLERANCE
  );
}

function rectsShareEdge(a, b, padding = BUILD_OVERLAP_TOLERANCE) {
  const xEdgeDistance = Math.abs(Math.abs(a.x - b.x) - (a.w + b.w) / 2);
  const zEdgeDistance = Math.abs(Math.abs(a.z - b.z) - (a.h + b.h) / 2);
  const xOverlap = Math.abs(a.x - b.x) * 2 < a.w + b.w - padding;
  const zOverlap = Math.abs(a.z - b.z) * 2 < a.h + b.h - padding;
  return (
    (xEdgeDistance <= padding && zOverlap) ||
    (zEdgeDistance <= padding && xOverlap)
  );
}

function overlapRect(a, b) {
  const left = Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const right = Math.min(a.x + a.w / 2, b.x + b.w / 2);
  const top = Math.max(a.z - a.h / 2, b.z - b.h / 2);
  const bottom = Math.min(a.z + a.h / 2, b.z + b.h / 2);
  const width = right - left;
  const height = bottom - top;
  if (width <= BUILD_OVERLAP_TOLERANCE || height <= BUILD_OVERLAP_TOLERANCE)
    return null;
  return {
    centerX: (left + right) / 2,
    centerZ: (top + bottom) / 2,
    width,
    height,
  };
}

function isOverlapAtWallEnd(wall, overlap) {
  const horizontal = wall.w >= wall.h;
  const longSize = horizontal ? wall.w : wall.h;
  const overlapCenter = horizontal ? overlap.centerX : overlap.centerZ;
  const wallCenter = horizontal ? wall.x : wall.z;
  const overlapSize = horizontal ? overlap.width : overlap.height;
  const distanceToLongEnd = Math.abs(
    Math.abs(overlapCenter - wallCenter) - longSize / 2,
  );
  return distanceToLongEnd <= overlapSize / 2 + BUILD_OVERLAP_TOLERANCE;
}

function isAllowedWallJointOverlap(a, b) {
  if (
    a.type === 'foundation' ||
    b.type === 'foundation' ||
    a.type === 'roof' ||
    b.type === 'roof'
  )
    return false;
  if ((a.rot || 0) % 2 === (b.rot || 0) % 2) return false;

  const overlap = overlapRect(a, b);
  if (!overlap) return true;
  const maxJointWidth = Math.min(a.w, b.w) + BUILD_OVERLAP_TOLERANCE;
  const maxJointHeight = Math.min(a.h, b.h) + BUILD_OVERLAP_TOLERANCE;
  return (
    overlap.width <= maxJointWidth &&
    overlap.height <= maxJointHeight &&
    (isOverlapAtWallEnd(a, overlap) || isOverlapAtWallEnd(b, overlap))
  );
}

function worldToBuildLocal(building, x, z) {
  const dx = x - building.x;
  const dz = z - building.z;
  const rotation = -(building.rot || 0) * (Math.PI / 2);
  return {
    x: Math.cos(-rotation) * dx - Math.sin(-rotation) * dz,
    z: Math.sin(-rotation) * dx + Math.cos(-rotation) * dz,
  };
}

function hiddenWallJointFaces(building, buildings) {
  if (!isWallSupportBuilding(building)) return {};

  const hidden = {};
  for (const other of buildings || []) {
    if (other === building || other.id === building.id) continue;
    if (!isWallSupportBuilding(other)) continue;
    if (buildingLevel(other) !== buildingLevel(building)) continue;
    if ((other.rot || 0) % 2 === (building.rot || 0) % 2) continue;
    if (!isAllowedWallJointOverlap(building, other)) continue;

    const overlap = overlapRect(building, other);
    if (!overlap || !isOverlapAtWallEnd(building, overlap)) continue;

    const local = worldToBuildLocal(building, overlap.centerX, overlap.centerZ);
    hidden[local.x >= 0 ? 'px' : 'nx'] = true;
  }

  return hidden;
}

function rectCircleIntersects(rect, x, z, radius) {
  const closestX = THREE.MathUtils.clamp(
    x,
    rect.x - rect.w / 2,
    rect.x + rect.w / 2,
  );
  const closestZ = THREE.MathUtils.clamp(
    z,
    rect.z - rect.h / 2,
    rect.z + rect.h / 2,
  );
  const dx = x - closestX;
  const dz = z - closestZ;
  return dx * dx + dz * dz <= radius * radius;
}

function rectCircleIntersectsLocal(rect, x, z, radius) {
  const closestX = THREE.MathUtils.clamp(
    x,
    rect.x - rect.w / 2,
    rect.x + rect.w / 2,
  );
  const closestZ = THREE.MathUtils.clamp(
    z,
    rect.z - rect.h / 2,
    rect.z + rect.h / 2,
  );
  const dx = x - closestX;
  const dz = z - closestZ;
  return dx * dx + dz * dz <= radius * radius;
}

function hitsDoorFrame(building, x, z) {
  const piece =
    buildPieces.find((item) => item.id === building.type) || buildPieces[0];
  const doorWidth = Math.min(70, piece.w * 0.48);
  const sideWidth = Math.max(12, (piece.w - doorWidth) / 2);
  const dx = x - building.x;
  const dz = z - building.z;
  const rotation = -(building.rot || 0) * (Math.PI / 2);
  const localX = Math.cos(-rotation) * dx - Math.sin(-rotation) * dz;
  const localZ = Math.sin(-rotation) * dx + Math.cos(-rotation) * dz;
  const sidePostDistance = doorWidth / 2 + sideWidth / 2;
  return (
    rectCircleIntersectsLocal(
      { x: -sidePostDistance, z: 0, w: sideWidth, h: piece.h },
      localX,
      localZ,
      PLAYER_COLLISION_RADIUS,
    ) ||
    rectCircleIntersectsLocal(
      { x: sidePostDistance, z: 0, w: sideWidth, h: piece.h },
      localX,
      localZ,
      PLAYER_COLLISION_RADIUS,
    )
  );
}

function hitsBlockingBuilding(x, z, buildings) {
  const surfaceY = buildSurfaceHeightAt(x, z, buildings);
  return (buildings || []).some((building) => {
    const level = buildingLevel(building);
    const baseY =
      getTerrainHeight(building.x, building.z) + level * BUILD_STACK_HEIGHT;
    const topY = baseY + BUILD_WALL_HEIGHT;
    if (surfaceY < baseY - 2 || surfaceY >= topY - 2) return false;
    return building.type === 'door'
      ? hitsDoorFrame(building, x, z)
      : building.blocks &&
          rectCircleIntersects(building, x, z, PLAYER_COLLISION_RADIUS);
  });
}

function hitsBlockingResource(x, z, resourceStates) {
  const time = Date.now();
  for (const blocker of BUILD_RESOURCE_BLOCKERS) {
    if (resourceStates?.[blocker.id]?.depletedUntil > time) continue;
    const dx = x - blocker.x;
    const dz = z - blocker.z;
    const radius = PLAYER_COLLISION_RADIUS + blocker.radius;
    if (dx * dx + dz * dz <= radius * radius) return true;
  }
  return false;
}

function hitsBlockingWorld(x, z, buildings, resourceStates) {
  return (
    hitsBlockingBuilding(x, z, buildings) ||
    hitsBlockingResource(x, z, resourceStates)
  );
}

function resolvePlayerMove(startX, startZ, endX, endZ, buildings, resourceStates) {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const steps = Math.max(
    1,
    Math.ceil(
      Math.max(Math.abs(dx), Math.abs(dz)) / PLAYER_COLLISION_SWEEP_STEP,
    ),
  );
  const stepX = dx / steps;
  const stepZ = dz / steps;
  let x = startX;
  let z = startZ;
  let moved = false;

  for (let index = 0; index < steps; index += 1) {
    const nextX = x + stepX;
    const nextZ = z + stepZ;
    let movedThisStep = false;

    if (!hitsBlockingWorld(nextX, z, buildings, resourceStates)) {
      x = nextX;
      moved = true;
      movedThisStep = true;
    }
    if (!hitsBlockingWorld(x, nextZ, buildings, resourceStates)) {
      z = nextZ;
      moved = true;
      movedThisStep = true;
    }
    if (!movedThisStep) break;
  }

  return { x, z, moved };
}

function isPointInsideRect(rect, x, z, inset = 0) {
  return (
    x >= rect.x - rect.w / 2 + inset &&
    x <= rect.x + rect.w / 2 - inset &&
    z >= rect.z - rect.h / 2 + inset &&
    z <= rect.z + rect.h / 2 - inset
  );
}

function isWallSupportBuilding(building) {
  return building?.type !== 'foundation' && building?.type !== 'roof';
}

function supportingWallLevels(footprint, buildings) {
  return (buildings || [])
    .filter(
      (building) =>
        isWallSupportBuilding(building) && rectsOverlap(footprint, building),
    )
    .map((building) => buildingLevel(building) + 1);
}

function adjacentRoofLevels(footprint, buildings) {
  return (buildings || [])
    .filter(
      (building) =>
        building.type === 'roof' &&
        !rectsOverlap(footprint, building) &&
        rectsShareEdge(footprint, building, BUILD_GRID_SIZE / 2),
    )
    .map(buildingLevel);
}

function roofSupportsWall(footprint, roof) {
  return (
    roof?.type === 'roof' &&
    (rectsOverlap(footprint, roof) ||
      rectsShareEdge(footprint, roof, BUILD_GRID_SIZE / 2))
  );
}

function supportingRoofLevels(footprint, buildings) {
  return (buildings || [])
    .filter((building) => roofSupportsWall(footprint, building))
    .map(buildingLevel);
}

function hasRoofSupport(footprint, buildings, level) {
  return (
    supportingWallLevels(footprint, buildings).includes(level) ||
    adjacentRoofLevels(footprint, buildings).includes(level)
  );
}

function buildSurfaceHeightAt(x, z, buildings) {
  let height = getTerrainHeight(x, z);
  for (const building of buildings || []) {
    if (!isPointInsideRect(building, x, z, -2)) continue;
    const baseY = getTerrainHeight(building.x, building.z);
    if (building.type === 'foundation') {
      height = Math.max(height, baseY + BUILD_FOUNDATION_HEIGHT);
      continue;
    }
  }
  return height;
}

function isPlayerInsideBuildInterior(buildings, playerPosition) {
  if (!playerPosition) return false;
  const builtPieces = buildings || [];
  for (const building of builtPieces) {
    if (
      building.type === 'roof' &&
      isPointInsideRect(
        building,
        playerPosition.x,
        playerPosition.z,
        -PLAYER_COLLISION_RADIUS,
      )
    ) {
      return true;
    }
  }

  for (const foundation of builtPieces) {
    if (
      foundation.type !== 'foundation' ||
      !isPointInsideRect(
        foundation,
        playerPosition.x,
        playerPosition.z,
        -PLAYER_COLLISION_RADIUS,
      )
    ) {
      continue;
    }

    const hasDoor = builtPieces.some(
      (building) =>
        building.type === 'door' &&
        buildingLevel(building) === buildingLevel(foundation) &&
        rectsOverlap(foundation, building),
    );
    if (hasDoor) return true;
  }

  return false;
}

function resolveBuildLevel(piece, footprint, buildings) {
  if (piece.id === 'foundation') return 0;
  if (piece.id === 'roof') {
    const levels = [
      ...supportingWallLevels(footprint, buildings),
      ...adjacentRoofLevels(footprint, buildings),
    ];
    if (!levels.length) return 0;
    return Math.min(BUILD_MAX_STACK_LEVEL, Math.max(...levels));
  }
  const matching = buildings
    .filter(
      (building) =>
        isWallSupportBuilding(building) && sameBuildPlane(footprint, building),
    )
    .map(buildingLevel);
  const levels = [
    ...matching.map((level) => level + 1),
    ...supportingRoofLevels(footprint, buildings),
  ];
  if (!levels.length) return 0;
  return Math.min(BUILD_MAX_STACK_LEVEL, Math.max(...levels));
}

function snapRoofPosition(piece, x, z, rot, buildings) {
  const base = buildFootprint(
    piece,
    snapToBuildGrid(x),
    snapToBuildGrid(z),
    rot,
  );
  const candidates = [];

  for (const building of buildings) {
    if (building.type === 'roof') {
      candidates.push(
        buildFootprint(piece, building.x + piece.w, building.z, rot),
      );
      candidates.push(
        buildFootprint(piece, building.x - piece.w, building.z, rot),
      );
      candidates.push(
        buildFootprint(piece, building.x, building.z + piece.h, rot),
      );
      candidates.push(
        buildFootprint(piece, building.x, building.z - piece.h, rot),
      );
      continue;
    }

    if (isWallSupportBuilding(building)) {
      const horizontal = building.w >= building.h;
      if (horizontal) {
        const zOffset = piece.h / 2 - building.h / 2;
        candidates.push(
          buildFootprint(piece, building.x, building.z + zOffset, rot),
        );
        candidates.push(
          buildFootprint(piece, building.x, building.z - zOffset, rot),
        );
      } else {
        const xOffset = piece.w / 2 - building.w / 2;
        candidates.push(
          buildFootprint(piece, building.x + xOffset, building.z, rot),
        );
        candidates.push(
          buildFootprint(piece, building.x - xOffset, building.z, rot),
        );
      }
      continue;
    }

    if (building.type === 'foundation') {
      candidates.push(buildFootprint(piece, building.x, building.z, rot));
    }
  }

  let best = base;
  let bestDistance = Infinity;
  for (const candidate of [base, ...candidates]) {
    const distance = Math.hypot(candidate.x - x, candidate.z - z);
    if (distance <= BUILD_EDGE_SNAP_DISTANCE && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function snapBuildPosition(piece, x, z, rot, buildings) {
  const base = buildFootprint(
    piece,
    snapToBuildGrid(x),
    snapToBuildGrid(z),
    rot,
  );
  if (piece.id === 'foundation') return base;
  if (piece.id === 'roof') return snapRoofPosition(piece, x, z, rot, buildings);

  const foundationCandidates = [];
  const wallCandidates = [];
  const rotated = rot % 2 === 1;
  for (const building of buildings) {
    if (building.type === 'foundation') {
      if (rotated) {
        const xOffset = building.w / 2 - base.w / 2;
        foundationCandidates.push(
          buildFootprint(piece, building.x - xOffset, building.z, rot),
        );
        foundationCandidates.push(
          buildFootprint(piece, building.x + xOffset, building.z, rot),
        );
      } else {
        const zOffset = building.h / 2 - base.h / 2;
        foundationCandidates.push(
          buildFootprint(piece, building.x, building.z - zOffset, rot),
        );
        foundationCandidates.push(
          buildFootprint(piece, building.x, building.z + zOffset, rot),
        );
      }
      continue;
    }
    const sameRotation = (building.rot || 0) % 2 === rot % 2;
    if (sameRotation) {
      const longOffset = rotated
        ? (building.h + base.h) / 2
        : (building.w + base.w) / 2;
      const sideOffset = rotated
        ? (building.w + base.w) / 2
        : (building.h + base.h) / 2;
      wallCandidates.push(buildFootprint(piece, building.x, building.z, rot));
      wallCandidates.push(
        buildFootprint(
          piece,
          building.x + (rotated ? 0 : longOffset),
          building.z + (rotated ? longOffset : 0),
          rot,
        ),
      );
      wallCandidates.push(
        buildFootprint(
          piece,
          building.x - (rotated ? 0 : longOffset),
          building.z - (rotated ? longOffset : 0),
          rot,
        ),
      );
      wallCandidates.push(
        buildFootprint(
          piece,
          building.x + (rotated ? sideOffset : 0),
          building.z + (rotated ? 0 : sideOffset),
          rot,
        ),
      );
      wallCandidates.push(
        buildFootprint(
          piece,
          building.x - (rotated ? sideOffset : 0),
          building.z - (rotated ? 0 : sideOffset),
          rot,
        ),
      );
      continue;
    }

    const existingHorizontal = building.w >= building.h;
    if (existingHorizontal && rotated) {
      const xOffset = (building.w + base.w) / 2;
      const zOffset = (base.h - building.h) / 2;
      for (const endSign of [-1, 1]) {
        for (const sideSign of [-1, 1]) {
          wallCandidates.push(
            buildFootprint(
              piece,
              building.x + endSign * xOffset,
              building.z + sideSign * zOffset,
              rot,
            ),
          );
        }
      }
    } else if (!existingHorizontal && !rotated) {
      const zOffset = (building.h + base.h) / 2;
      const xOffset = (base.w - building.w) / 2;
      for (const endSign of [-1, 1]) {
        for (const sideSign of [-1, 1]) {
          wallCandidates.push(
            buildFootprint(
              piece,
              building.x + sideSign * xOffset,
              building.z + endSign * zOffset,
              rot,
            ),
          );
        }
      }
    }
  }

  const chooseNearest = (candidates, maxDistance) => {
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
      const distance = Math.hypot(candidate.x - x, candidate.z - z);
      if (distance <= maxDistance && distance < bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  };

  const wallSnap = chooseNearest(wallCandidates, BUILD_EDGE_SNAP_DISTANCE);
  if (wallSnap) return wallSnap;

  const foundationSnap = chooseNearest(
    foundationCandidates,
    BUILD_EDGE_SNAP_DISTANCE,
  );
  if (foundationSnap) return foundationSnap;

  let best = base;
  let bestDistance = Infinity;
  for (const candidate of [base, ...foundationCandidates, ...wallCandidates]) {
    const distance = Math.hypot(candidate.x - x, candidate.z - z);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function canPlaceBuilding(piece, footprint, buildings, inventoryWood) {
  if (!piece || !footprint) return false;
  if ((inventoryWood || 0) < piece.cost) return false;
  const level = buildingLevel(footprint);
  if (
    footprint.x < -WORLD_SIZE.width / 2 + 30 ||
    footprint.x > WORLD_SIZE.width / 2 - 30 ||
    footprint.z < -WORLD_SIZE.height / 2 + 30 ||
    footprint.z > WORLD_SIZE.height / 2 - 30
  ) {
    return false;
  }
  if (level > BUILD_MAX_STACK_LEVEL) return false;
  if (piece.id === 'roof') {
    if (level <= 0 || !hasRoofSupport(footprint, buildings, level))
      return false;
  } else if (level > 0) {
    const supported = buildings.some(
      (building) =>
        (isWallSupportBuilding(building) &&
          buildingLevel(building) === level - 1 &&
          sameBuildPlane(footprint, building)) ||
        (buildingLevel(building) === level &&
          roofSupportsWall(footprint, building)),
    );
    if (!supported) return false;
  }
  if (level === 0) {
    for (const blocker of BUILD_RESOURCE_BLOCKERS) {
      if (rectCircleIntersects(footprint, blocker.x, blocker.z, blocker.radius))
        return false;
    }
  }
  for (const building of buildings) {
    const canOverlapFoundation =
      piece.id !== 'foundation' && building.type === 'foundation';
    const canOverlapRoofSupport =
      piece.id === 'roof' &&
      isWallSupportBuilding(building) &&
      buildingLevel(building) === level - 1;
    const canStackOnFootprint =
      piece.id !== 'foundation' &&
      building.type !== 'foundation' &&
      sameBuildPlane(footprint, building) &&
      buildingLevel(building) !== level;
    const canOverlapRoofSurface =
      piece.id !== 'foundation' &&
      buildingLevel(building) === level &&
      roofSupportsWall(footprint, building);
    const canOverlapWallJoint =
      piece.id !== 'foundation' &&
      buildingLevel(building) === level &&
      isAllowedWallJointOverlap(footprint, building);
    if (
      !canOverlapFoundation &&
      !canOverlapRoofSupport &&
      !canStackOnFootprint &&
      !canOverlapRoofSurface &&
      !canOverlapWallJoint &&
      buildingLevel(building) === level &&
      rectsOverlap(footprint, building)
    ) {
      return false;
    }
  }
  return true;
}

function setHudActionLine(message) {
  gameUiStore.getState().setActionLine(message);
  const actionLine = document.getElementById('actionLine');
  if (actionLine) actionLine.textContent = message;
}

function setGatherHud(status) {
  gameUiStore.getState().setGatherHud(status);
}

function emitGatherParticles(
  particles,
  type,
  resourcePosition,
  actorPosition,
  intensity = 1,
) {
  const config = GATHER_RESOURCE_CONFIG[type];
  if (!config) return;

  const isTree = type === 'tree';
  const isStone = type === 'stone';
  const count = Math.round((isTree ? 12 : isStone ? 10 : 7) * intensity);
  const toActor = new THREE.Vector3().subVectors(
    actorPosition,
    resourcePosition,
  );
  toActor.y = 0;
  if (toActor.lengthSq() < 0.001) toActor.set(0, 0, 1);
  toActor.normalize();

  const tangent = new THREE.Vector3(-toActor.z, 0, toActor.x);
  const hitDistance = isTree ? 30 : isStone ? 18 : 12;
  const hitHeight = isTree ? 42 : isStone ? 24 : 18;
  const base = resourcePosition.clone().addScaledVector(toActor, hitDistance);
  base.y = hitHeight;

  for (let index = 0; index < count; index += 1) {
    const side = (Math.random() - 0.5) * (isTree ? 48 : isStone ? 26 : 20);
    const outward = 22 + Math.random() * (isTree ? 62 : isStone ? 44 : 30);
    const upward = isTree
      ? 55 + Math.random() * 86
      : isStone
        ? 38 + Math.random() * 58
        : 28 + Math.random() * 38;
    const life = isTree
      ? 0.58 + Math.random() * 0.32
      : isStone
        ? 0.48 + Math.random() * 0.28
        : 0.42 + Math.random() * 0.22;
    particles.push({
      type,
      x: base.x + tangent.x * side + (Math.random() - 0.5) * 8,
      y: base.y + (Math.random() - 0.5) * 14,
      z: base.z + tangent.z * side + (Math.random() - 0.5) * 8,
      vx: toActor.x * outward + tangent.x * side * 0.9,
      vy: upward,
      vz: toActor.z * outward + tangent.z * side * 0.9,
      rotationX: Math.random() * Math.PI,
      rotationY: Math.random() * Math.PI,
      rotationZ: Math.random() * Math.PI,
      spinX: (Math.random() - 0.5) * 8,
      spinY: (Math.random() - 0.5) * 9,
      spinZ: (Math.random() - 0.5) * 8,
      size: isTree
        ? 4.4 + Math.random() * 5.4
        : isStone
          ? 3.8 + Math.random() * 4.6
          : 2.8 + Math.random() * 3.2,
      life,
      maxLife: life,
    });
  }

  if (particles.length > MAX_GATHER_PARTICLES) {
    particles.splice(0, particles.length - MAX_GATHER_PARTICLES);
  }
}

function VisibleTerrain({ groundTexture }) {
  const terrain = useMemo(createWorldTerrainGeometry, []);

  useEffect(() => () => terrain.geometry.dispose(), [terrain]);

  return (
    <mesh
      position={[terrain.bounds.centerX, 0, terrain.bounds.centerZ]}
      rotation-x={-Math.PI / 2}
      receiveShadow
    >
      <primitive object={terrain.geometry} attach='geometry' />
      <meshStandardMaterial map={groundTexture} roughness={0.97} vertexColors />
    </mesh>
  );
}

function Ground({
  isBuildMode,
  isDestroyMode,
  inputReady,
  onAttack,
  onBuildPlace,
  onBuildPointer,
  onMoveTarget,
}) {
  const { camera, gl } = useThree();
  const groundTexture = useMemo(createMeadowGroundTexture, []);
  const navigationScratch = useMemo(
    () => ({
      groundPlane: new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      pointer: new THREE.Vector2(),
      raycaster: new THREE.Raycaster(),
      target: new THREE.Vector3(),
    }),
    [],
  );
  const rightNavigationRef = useRef({
    active: false,
    clientX: 0,
    clientY: 0,
    hasPointer: false,
    pointerId: null,
  });
  const buildPointerFrameRef = useRef(null);
  const buildPointerRef = useRef({ x: 0, z: 0 });

  useEffect(() => () => groundTexture?.dispose(), [groundTexture]);
  useEffect(
    () => () => {
      if (buildPointerFrameRef.current != null) {
        window.cancelAnimationFrame(buildPointerFrameRef.current);
      }
    },
    [],
  );

  const scheduleBuildPointer = (x, z) => {
    buildPointerRef.current = { x, z };
    if (buildPointerFrameRef.current != null) return;
    buildPointerFrameRef.current = window.requestAnimationFrame(() => {
      buildPointerFrameRef.current = null;
      onBuildPointer(buildPointerRef.current.x, buildPointerRef.current.z);
    });
  };

  const clearRightNavigation = (event) => {
    const navigation = rightNavigationRef.current;
    if (navigation.pointerId != null) {
      event?.target?.releasePointerCapture?.(navigation.pointerId);
    }

    rightNavigationRef.current = {
      active: false,
      clientX: 0,
      clientY: 0,
      hasPointer: false,
      pointerId: null,
    };
  };

  const syncRightNavigationPointer = (event) => {
    const source = event.nativeEvent ?? event.sourceEvent ?? event;
    const clientX = Number(source.clientX ?? event.clientX);
    const clientY = Number(source.clientY ?? event.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;

    const navigation = rightNavigationRef.current;
    navigation.clientX = clientX;
    navigation.clientY = clientY;
    navigation.hasPointer = true;
    return true;
  };

  const projectRightNavigationPoint = () => {
    const navigation = rightNavigationRef.current;
    if (!navigation.active || !navigation.hasPointer) return null;

    const rect = gl.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    navigationScratch.pointer.set(
      ((navigation.clientX - rect.left) / rect.width) * 2 - 1,
      -((navigation.clientY - rect.top) / rect.height) * 2 + 1,
    );
    navigationScratch.raycaster.setFromCamera(
      navigationScratch.pointer,
      camera,
    );
    return navigationScratch.raycaster.ray.intersectPlane(
      navigationScratch.groundPlane,
      navigationScratch.target,
    );
  };

  useFrame(() => {
    if (!inputReady) {
      clearRightNavigation();
      return;
    }
    const target = projectRightNavigationPoint();
    if (!target) return;
    onMoveTarget(target.x, target.z);
  });

  const handlePointerDown = (event) => {
    if (!inputReady) {
      clearRightNavigation(event);
      event.stopPropagation();
      return;
    }
    if (event.button !== 0 && event.button !== 2) return;
    event.stopPropagation();

    if (isBuildMode && event.button === 0) {
      if (buildPointerFrameRef.current != null) {
        window.cancelAnimationFrame(buildPointerFrameRef.current);
        buildPointerFrameRef.current = null;
      }
      onBuildPointer(event.point.x, event.point.z);
      if (!isDestroyMode) onBuildPlace(event.point.x, event.point.z);
      return;
    }

    if (event.button === 0) {
      onAttack(event.point.x, event.point.z);
      return;
    }

    clearRightNavigation(event);
    rightNavigationRef.current = {
      active: true,
      clientX: 0,
      clientY: 0,
      hasPointer: false,
      pointerId: event.pointerId,
    };
    syncRightNavigationPointer(event);
    event.target?.setPointerCapture?.(event.pointerId);
    onMoveTarget(event.point.x, event.point.z);
  };

  const handlePointerMove = (event) => {
    if (!inputReady) {
      clearRightNavigation(event);
      return;
    }
    if (isBuildMode) scheduleBuildPointer(event.point.x, event.point.z);

    const navigation = rightNavigationRef.current;
    if (!navigation.active) return;
    if (typeof event.buttons === 'number' && !(event.buttons & 2)) {
      clearRightNavigation(event);
      return;
    }

    event.stopPropagation();
    syncRightNavigationPointer(event);
    onMoveTarget(event.point.x, event.point.z);
  };

  const handlePointerUp = (event) => {
    const navigation = rightNavigationRef.current;
    if (event.button !== 2 || !navigation.active) return;

    event.stopPropagation();
    clearRightNavigation(event);
  };

  const handlePointerCancel = (event) => {
    if (!rightNavigationRef.current.active) return;
    clearRightNavigation(event);
  };

  return (
    <group
      onPointerCancel={handlePointerCancel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <VisibleTerrain groundTexture={groundTexture} />
      <GroundMeadowDetails />
    </group>
  );
}

function PlayerTorchFillLight({ playerRef, torchEquipped }) {
  const lightRef = useRef(null);

  useFrame(({ clock }) => {
    const light = lightRef.current;
    const playerPosition = playerRef.current?.position;
    if (!light) return;

    light.visible = Boolean(torchEquipped && playerPosition);
    if (!light.visible) return;

    const terrainY = getTerrainHeight(playerPosition.x, playerPosition.z);
    const flicker =
      1 +
      Math.sin(clock.elapsedTime * 7.8) * 0.04 +
      Math.sin(clock.elapsedTime * 17.4) * 0.025;
    light.position.set(playerPosition.x, terrainY + 82, playerPosition.z);
    light.intensity = TORCH_FILL_LIGHT_INTENSITY * flicker;
  });

  return (
    <pointLight
      ref={lightRef}
      color='#ffc178'
      decay={1.42}
      distance={TORCH_FILL_LIGHT_DISTANCE}
      intensity={0}
      visible={false}
    />
  );
}

function MeadowDecalBatch({
  alphaTest = 0.18,
  color,
  opacity = 0.86,
  points,
  texture,
}) {
  const meshRef = useRef(null);
  const scratch = useMemo(
    () => ({
      object: new THREE.Object3D(),
    }),
    [],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    points.forEach(([x, z, size, stretch, rotation, colorIndex], index) => {
      scratch.object.position.set(
        x,
        getTerrainHeight(x, z) + 0.32 + (index % 4) * 0.012,
        z,
      );
      scratch.object.rotation.set(-Math.PI / 2, 0, rotation);
      scratch.object.scale.set(size * stretch, size, 1);
      scratch.object.updateMatrix();
      mesh.setMatrixAt(index, scratch.object.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  }, [points, scratch]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, points.length]}
      frustumCulled={false}
      raycast={() => null}
      renderOrder={2}
    >
      <planeGeometry args={[1, 1]} />
      <meshBasicMaterial
        alphaTest={alphaTest}
        color={color}
        depthWrite={false}
        map={texture}
        opacity={opacity}
        side={THREE.DoubleSide}
        toneMapped={false}
        transparent
      />
    </instancedMesh>
  );
}

function MeadowDecalLayer({
  alphaTest = 0.18,
  opacity = 0.86,
  palette,
  points,
  texture,
}) {
  const batches = useMemo(
    () =>
      palette
        .map((color, colorIndex) => ({
          color,
          points: points.filter(
            (point) => point[5] % palette.length === colorIndex,
          ),
        }))
        .filter((batch) => batch.points.length > 0),
    [palette, points],
  );

  return batches.map((batch) => (
    <MeadowDecalBatch
      key={batch.color}
      alphaTest={alphaTest}
      color={batch.color}
      opacity={opacity}
      points={batch.points}
      texture={texture}
    />
  ));
}

function GroundMeadowDetails() {
  const flowerTexture = useMemo(() => createMeadowDecalTexture('flower'), []);
  const leafTexture = useMemo(() => createMeadowDecalTexture('leaf'), []);
  const glowTexture = useMemo(() => createMeadowDecalTexture('glow'), []);

  useEffect(
    () => () => {
      flowerTexture?.dispose();
      leafTexture?.dispose();
      glowTexture?.dispose();
    },
    [flowerTexture, glowTexture, leafTexture],
  );

  return (
    <>
      <MeadowDecalLayer
        palette={MEADOW_LEAF_PALETTE}
        points={MEADOW_LEAF_POINTS}
        texture={leafTexture}
        opacity={0.52}
        alphaTest={0.12}
      />
      <MeadowDecalLayer
        palette={MEADOW_FLOWER_PALETTE}
        points={MEADOW_FLOWER_POINTS}
        texture={flowerTexture}
        opacity={0.74}
        alphaTest={0.16}
      />
      <MeadowDecalLayer
        palette={MEADOW_GLOW_PALETTE}
        points={MEADOW_GLOW_POINTS}
        texture={glowTexture}
        opacity={0.72}
        alphaTest={0.26}
      />
    </>
  );
}

function enableShadows(object, options = {}) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    if (options.shadowSide === undefined) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      material.shadowSide = options.shadowSide;
      material.needsUpdate = true;
    });
  });
}

function getNatureMaterialColor(materialName = '') {
  const name = materialName.toLowerCase();
  if (name.includes('rock')) return '#b9c1b8';
  if (name.includes('cyan')) return '#4abac0';
  if (name.includes('pink')) return '#d66aa4';
  if (name.includes('yellow')) return '#d2c05f';
  if (name.includes('darkgreen')) return '#4f8650';
  if (name.includes('leaves')) return '#68824a';
  if (name.includes('orange')) return '#a86537';
  if (name.includes('white')) return '#d8dece';
  if (name.includes('black')) return '#3e453b';
  if (name.includes('berry')) return '#b85d58';
  if (name.includes('wood')) return '#8b5e3f';
  if (name.includes('green')) return '#5f9e55';
  return null;
}

function normalizeNatureMaterials(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach((material) => {
      const color = getNatureMaterialColor(material?.name);
      if (color) material.color.set(color);
      if (typeof material.shininess === 'number') material.shininess = 0;
      if (typeof material.roughness === 'number') material.roughness = 0.92;
      if (typeof material.metalness === 'number') material.metalness = 0;
      if (material.specular) material.specular.set('#172217');
      material.needsUpdate = true;
    });
  });
}

function windSeedFromName(name) {
  let seed = 0;
  for (let index = 0; index < name.length; index += 1) {
    seed = (seed * 31 + name.charCodeAt(index)) % 997;
  }
  return seed / 997;
}

function WorldModel({ url, position, scale = 1, rotation = [0, 0, 0] }) {
  const { scene } = useGLTF(url);

  useMemo(() => {
    enableShadows(scene);
  }, [scene]);

  return (
    <group
      position={position}
      rotation={rotation}
      scale={scale}
      userData={{ playerOccluder: true }}
    >
      <Clone object={scene} />
    </group>
  );
}

function NatureTree({
  file,
  id,
  position,
  scale,
  rotationY = 0,
  onResourceCommand,
}) {
  const root = useRef(null);
  const materialUrl = `${NATURE_OBJ_BASE}${file}.mtl`;
  const objectUrl = `${NATURE_OBJ_BASE}${file}.obj`;
  const materials = useLoader(MTLLoader, materialUrl);
  const object = useLoader(OBJLoader, objectUrl, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  useMemo(() => {
    enableShadows(object);
    normalizeNatureMaterials(object);
  }, [object]);

  useEffect(() => {
    const treeRoot = root.current;
    return () => restorePlayerOccluder(treeRoot);
  }, []);

  const wind = useMemo(
    () => ({
      phase:
        windSeedFromName(file) * Math.PI * 2 +
        position[0] * 0.006 +
        position[2] * 0.004,
      strength: 0.012 + windSeedFromName(`${file}-strength`) * 0.007,
    }),
    [file, position],
  );

  useFrame(({ clock }) => {
    if (!root.current) return;
    const t = clock.elapsedTime;
    const primary = Math.sin(t * 1.15 + wind.phase);
    const flutter = Math.sin(t * 2.35 + wind.phase * 1.7) * 0.35;
    const sway = (primary + flutter) * wind.strength;
    root.current.rotation.set(sway * 0.42, rotationY, sway);
  });

  const handlePointerDown = (event) => {
    if (![0, 2].includes(event.button)) return;
    event.stopPropagation();
    if (!onResourceCommand) return;
    onResourceCommand({
      id,
      type: 'tree',
      file,
      position,
      scale,
      rotationY,
    });
  };

  return (
    <group
      ref={root}
      position={position}
      rotation-y={rotationY}
      scale={scale}
      onPointerDown={handlePointerDown}
      userData={{ playerOccluder: true }}
    >
      <Clone object={object} />
      <mesh
        position={[0, 1.08, 0]}
        scale={[0.78, 1.9, 0.78]}
        onPointerDown={handlePointerDown}
        userData={{ ignorePlayerOcclusion: true }}
      >
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function NatureStump({
  id,
  position,
  scale,
  rotationY = 0,
  onResourceCommand,
}) {
  const root = useRef(null);
  const materialUrl = `${NATURE_OBJ_BASE}${TREE_STUMP_FILE}.mtl`;
  const objectUrl = `${NATURE_OBJ_BASE}${TREE_STUMP_FILE}.obj`;
  const materials = useLoader(MTLLoader, materialUrl);
  const object = useLoader(OBJLoader, objectUrl, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  useMemo(() => {
    enableShadows(object);
    normalizeNatureMaterials(object);
  }, [object]);

  useEffect(() => {
    const stumpRoot = root.current;
    return () => restorePlayerOccluder(stumpRoot);
  }, []);

  const handlePointerDown = (event) => {
    if (![0, 2].includes(event.button)) return;
    event.stopPropagation();
    onResourceCommand?.({ id, type: 'tree', position, scale, rotationY });
  };

  return (
    <group
      ref={root}
      position={position}
      rotation-y={rotationY}
      scale={scale * 0.38}
      onPointerDown={handlePointerDown}
      userData={{ playerOccluder: true }}
    >
      <Clone object={object} />
      <mesh
        position={[0, 0.3, 0]}
        scale={[0.78, 0.62, 0.78]}
        onPointerDown={handlePointerDown}
        userData={{ ignorePlayerOcclusion: true }}
      >
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function NatureObjectPreloader({ file, onReady }) {
  const materialUrl = `${NATURE_OBJ_BASE}${file}.mtl`;
  const objectUrl = `${NATURE_OBJ_BASE}${file}.obj`;
  const materials = useLoader(MTLLoader, materialUrl);
  const object = useLoader(OBJLoader, objectUrl, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  useMemo(() => {
    enableShadows(object);
    normalizeNatureMaterials(object);
  }, [object]);

  useEffect(() => {
    onReady?.(file);
  }, [file, onReady]);

  return null;
}

function CoreAssetPreloader({ onReady }) {
  useGLTF(KNIGHT_MODEL_URL);
  useGLTF(AXE_MODEL_URL);
  useGLTF(SWORD_MODEL_URL);
  useGLTF(`${ADVENTURER_ANIMATION_BASE}Rig_Medium_MovementBasic.glb`);
  useGLTF(`${ADVENTURER_ANIMATION_BASE}Rig_Medium_General.glb`);
  useGLTF(MONSTER_MODEL_URLS.pinkBlob);
  useGLTF(MONSTER_MODEL_URLS.orc);
  useGLTF(MONSTER_MODEL_URLS.mushnub);
  useGLTF(MONSTER_MODEL_URLS.dragon);
  useGLTF(SHIELD_MODEL_URL);
  useLoader(FBXLoader, ATTACK_ANIMATION_URL);
  useLoader(FBXLoader, PICKAXE_ATTACK_ANIMATION_URL);
  useLoader(FBXLoader, BLOCK_ANIMATION_URL);
  useLoader(FBXLoader, DEATH_ANIMATION_URL);

  useEffect(() => {
    setLoadingStep('assets', {
      status: 'complete',
      detail: 'Models and animations ready.',
    });
    onReady();
  }, [onReady]);

  return null;
}

function VegetationAssetPreloader({ onReady }) {
  const loadedFilesRef = useRef(new Set());
  const markFileReady = useCallback(
    (file) => {
      loadedFilesRef.current.add(file);
      const loaded = loadedFilesRef.current.size;
      const total = VEGETATION_PRELOAD_FILES.length;
      if (loaded < total) {
        setLoadingStep('vegetation', {
          status: 'loading',
          detail: `Preparing vegetation (${loaded}/${total})...`,
        });
        return;
      }

      setLoadingStep('vegetation', {
        status: 'complete',
        detail: 'Vegetation ready.',
      });
      onReady();
    },
    [onReady],
  );

  return (
    <>
      {VEGETATION_PRELOAD_FILES.map((file) => (
        <NatureObjectPreloader file={file} key={file} onReady={markFileReady} />
      ))}
    </>
  );
}

function LoadingProgressBridge() {
  const { active, loaded, total, progress } = useProgress();

  useEffect(() => {
    if (!active || total <= 0) return;
    setLoadingStep('assets', {
      status: 'loading',
      detail: `Loading models and animations (${loaded}/${total}, ${Math.round(progress)}%)...`,
    });
  }, [active, loaded, progress, total]);

  return null;
}

function TreeStumpFallback({ position, scale, rotationY = 0 }) {
  return (
    <group position={position} rotation-y={rotationY} scale={scale}>
      <mesh position={[0, 0.16, 0]} scale={[0.15, 0.32, 0.15]} castShadow>
        <cylinderGeometry args={[1, 1.18, 1, 10]} />
        <meshStandardMaterial color='#8b6546' roughness={0.92} />
      </mesh>
      <mesh position={[0, 0.34, 0]} scale={[0.17, 0.045, 0.17]}>
        <cylinderGeometry args={[1, 1, 1, 18]} />
        <meshStandardMaterial color='#c09058' roughness={0.88} />
      </mesh>
    </group>
  );
}

function LowPolyRock({
  depleted = false,
  id,
  position,
  scale = 1,
  onResourceCommand,
}) {
  const handlePointerDown = (event) => {
    if (![0, 2].includes(event.button) || depleted) return;
    event.stopPropagation();
    onResourceCommand?.({ id, type: 'stone', position, scale });
  };

  return (
    <mesh
      position={position}
      scale={[34 * scale, depleted ? 6 * scale : 20 * scale, 28 * scale]}
      castShadow={!depleted}
      onPointerDown={handlePointerDown}
      userData={{ playerOccluder: !depleted }}
    >
      <dodecahedronGeometry args={[1, 0]} />
      <meshStandardMaterial
        color={depleted ? '#7f8b7c' : '#cfd7c8'}
        roughness={0.95}
        transparent={depleted}
        opacity={depleted ? 0.36 : 1}
      />
    </mesh>
  );
}

function NatureRock({
  file,
  id,
  position,
  radius,
  rotationY = 0,
  scale = 1,
  onResourceCommand,
}) {
  const materialUrl = `${NATURE_OBJ_BASE}${file}.mtl`;
  const objectUrl = `${NATURE_OBJ_BASE}${file}.obj`;
  const materials = useLoader(MTLLoader, materialUrl);
  const object = useLoader(OBJLoader, objectUrl, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  useMemo(() => {
    enableShadows(object);
    normalizeNatureMaterials(object);
  }, [object]);

  const handlePointerDown = (event) => {
    if (![0, 2].includes(event.button)) return;
    event.stopPropagation();
    onResourceCommand?.({ id, type: 'stone', position, scale: radius });
  };

  return (
    <group
      position={position}
      rotation-y={rotationY}
      scale={scale}
      onPointerDown={handlePointerDown}
      userData={{ playerOccluder: true }}
    >
      <Clone object={object} />
      <mesh
        position={[0, 0.22, 0]}
        scale={[radius / scale, 0.82, radius / scale]}
        onPointerDown={handlePointerDown}
        userData={{ ignorePlayerOcclusion: true }}
      >
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function NaturePlantResource({
  file,
  id,
  type,
  position,
  radius,
  rotationY = 0,
  scale = 1,
  onResourceCommand,
}) {
  const materialUrl = `${NATURE_OBJ_BASE}${file}.mtl`;
  const objectUrl = `${NATURE_OBJ_BASE}${file}.obj`;
  const materials = useLoader(MTLLoader, materialUrl);
  const object = useLoader(OBJLoader, objectUrl, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  useMemo(() => {
    enableShadows(object);
    normalizeNatureMaterials(object);
  }, [object]);

  const handlePointerDown = (event) => {
    if (![0, 2].includes(event.button)) return;
    event.stopPropagation();
    onResourceCommand?.({
      id,
      type,
      position,
      scale,
      radius,
      rotationY,
    });
  };

  return (
    <group
      position={position}
      rotation-y={rotationY}
      scale={scale}
      onPointerDown={handlePointerDown}
    >
      <Clone object={object} />
      {type === 'flower' ? (
        <group position={[0, 0.84, 0]}>
          {[-0.28, -0.12, 0.08, 0.26].map((offset, index) => (
            <group
              key={`flower-${index}`}
              position={[offset, 0, (index % 2) * 0.22 - 0.11]}
            >
              <mesh position={[0, -0.32, 0]} scale={[0.035, 0.46, 0.035]}>
                <cylinderGeometry args={[1, 1, 1, 6]} />
                <meshStandardMaterial color='#5e8f4d' roughness={0.82} />
              </mesh>
              <mesh position={[0, 0.08, 0]} scale={[0.16, 0.08, 0.16]}>
                <sphereGeometry args={[1, 8, 6]} />
                <meshStandardMaterial
                  color={index % 2 ? '#ffd6ea' : '#f5e58c'}
                  roughness={0.72}
                />
              </mesh>
            </group>
          ))}
        </group>
      ) : (
        <group position={[0, 0.12, 0]}>
          {[
            [-0.3, 0.34, -0.16, 0.16, -0.16],
            [-0.12, 0.48, 0.12, 0.18, 0.1],
            [0.12, 0.54, -0.02, 0.2, -0.04],
            [0.3, 0.38, 0.18, 0.16, 0.18],
            [0.02, 0.3, 0.3, 0.15, 0.02],
          ].map(([x, y, z, size, lean], index) => (
            <group
              key={`cotton-${index}`}
              position={[x, 0, z]}
              rotation-z={lean}
            >
              <mesh position={[0, y * 0.48, 0]} scale={[0.024, y, 0.024]}>
                <cylinderGeometry args={[1, 0.82, 1, 6]} />
                <meshStandardMaterial color='#5d8a4d' roughness={0.82} />
              </mesh>
              <mesh
                position={[-0.07, y * 0.58, 0.02]}
                rotation={[0.2, 0.1, -0.72]}
                scale={[0.12, 0.035, 0.075]}
              >
                <sphereGeometry args={[1, 8, 5]} />
                <meshStandardMaterial color='#6f9d58' roughness={0.86} />
              </mesh>
              <mesh
                position={[0.08, y * 0.7, -0.02]}
                rotation={[0.1, -0.22, 0.68]}
                scale={[0.11, 0.032, 0.07]}
              >
                <sphereGeometry args={[1, 8, 5]} />
                <meshStandardMaterial color='#6a9452' roughness={0.86} />
              </mesh>
              <group position={[0, y + 0.05, 0]}>
                {[
                  [0, 0, 0],
                  [-size * 0.55, -size * 0.08, size * 0.16],
                  [size * 0.5, -size * 0.05, -size * 0.14],
                  [0.02, size * 0.24, 0.02],
                ].map(([bollX, bollY, bollZ], bollIndex) => (
                  <mesh
                    key={`boll-${bollIndex}`}
                    position={[bollX, bollY, bollZ]}
                    scale={[
                      size * (bollIndex === 3 ? 0.82 : 1),
                      size * 0.72,
                      size * (bollIndex === 3 ? 0.82 : 1),
                    ]}
                  >
                    <sphereGeometry args={[1, 10, 8]} />
                    <meshStandardMaterial color='#fff8df' roughness={0.62} />
                  </mesh>
                ))}
              </group>
            </group>
          ))}
        </group>
      )}
      <mesh
        position={[0, 0.42, 0]}
        scale={[radius / scale, 0.84, radius / scale]}
        onPointerDown={handlePointerDown}
        userData={{ ignorePlayerOcclusion: true }}
      >
        <cylinderGeometry args={[1, 1, 1, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
    </group>
  );
}

function GatherParticleMesh({ particlesRef, type }) {
  const meshRef = useRef(null);
  const scratch = useMemo(
    () => ({
      object: new THREE.Object3D(),
    }),
    [],
  );

  useEffect(() => {
    if (meshRef.current) meshRef.current.count = 0;
  }, []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const particles = particlesRef.current;
    let visibleCount = 0;

    for (let index = particles.length - 1; index >= 0; index -= 1) {
      const particle = particles[index];
      if (particle.type !== type) continue;
      particle.life -= delta;
      if (particle.life <= 0) {
        particles.splice(index, 1);
        continue;
      }

      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.z += particle.vz * delta;
      particle.vx *= 0.94;
      particle.vz *= 0.94;
      particle.vy -= 155 * delta;
      particle.rotationX += particle.spinX * delta;
      particle.rotationY += particle.spinY * delta;
      particle.rotationZ += particle.spinZ * delta;

      if (visibleCount >= MAX_GATHER_PARTICLES) continue;

      const lifePct = THREE.MathUtils.clamp(
        particle.life / particle.maxLife,
        0,
        1,
      );
      const scale = particle.size * (0.32 + lifePct * 0.68);
      scratch.object.position.set(
        particle.x,
        Math.max(2, particle.y),
        particle.z,
      );
      scratch.object.rotation.set(
        particle.rotationX,
        particle.rotationY,
        particle.rotationZ,
      );
      scratch.object.scale.set(scale, scale * 0.62, scale);
      scratch.object.updateMatrix();
      mesh.setMatrixAt(visibleCount, scratch.object.matrix);
      visibleCount += 1;
    }

    mesh.count = visibleCount;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, MAX_GATHER_PARTICLES]}
      frustumCulled={false}
    >
      <boxGeometry args={[1.25, 0.34, 0.58]} />
      <meshBasicMaterial
        color={GATHER_PARTICLE_MATERIALS[type]}
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function GatherParticles({ particlesRef }) {
  return (
    <>
      <GatherParticleMesh particlesRef={particlesRef} type='tree' />
      <GatherParticleMesh particlesRef={particlesRef} type='stone' />
      <GatherParticleMesh particlesRef={particlesRef} type='flower' />
      <GatherParticleMesh particlesRef={particlesRef} type='cotton' />
    </>
  );
}

function ResourceNodeOverlay({ active, position, state, type }) {
  const config = GATHER_RESOURCE_CONFIG[type];
  if (!active || !config) return null;

  const gathered = THREE.MathUtils.clamp(
    state?.nodesGathered || 0,
    0,
    config.nodeCount,
  );
  const remaining =
    state?.depletedUntil > Date.now() ? 0 : config.nodeCount - gathered;
  const labelY = position[1] + RESOURCE_NODE_LABEL_Y_OFFSET[type];

  return (
    <Html
      center
      distanceFactor={960}
      position={[position[0], labelY, position[2]]}
      transform={false}
      zIndexRange={[20, 0]}
    >
      <div className={`resource-node-label ${config.itemKey}`}>
        <strong>{config.label}</strong>
        <span>
          {remaining}/{config.nodeCount}
        </span>
      </div>
    </Html>
  );
}

function cloneInstancedMaterial(material) {
  if (Array.isArray(material)) return material.map(cloneInstancedMaterial);
  const next = material.clone();
  next.needsUpdate = true;
  return next;
}

function disposeInstancedMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach(disposeInstancedMaterial);
    return;
  }
  material?.dispose?.();
}

function GroundCoverVariantBatch({ file, points }) {
  const materialUrl = `${NATURE_OBJ_BASE}${file}.mtl`;
  const objectUrl = `${NATURE_OBJ_BASE}${file}.obj`;
  const meshRefs = useRef([]);
  const scratch = useMemo(() => ({ object: new THREE.Object3D() }), []);
  const materials = useLoader(MTLLoader, materialUrl);
  const object = useLoader(OBJLoader, objectUrl, (loader) => {
    materials.preload();
    loader.setMaterials(materials);
  });

  const meshes = useMemo(() => {
    normalizeNatureMaterials(object);
    object.updateMatrixWorld(true);

    const nextMeshes = [];
    object.traverse((child) => {
      if (!child.isMesh || !child.geometry || !child.material) return;
      const geometry = child.geometry.clone();
      geometry.applyMatrix4(child.matrixWorld);
      geometry.computeBoundingSphere();

      const material = cloneInstancedMaterial(child.material);
      nextMeshes.push({ geometry, material, name: child.name });
    });
    return nextMeshes;
  }, [object]);

  useLayoutEffect(() => {
    meshRefs.current.forEach((mesh) => {
      if (!mesh) return;

      points.forEach(([, x, z, scale, rotationY, seed], index) => {
        const staticSway = Math.sin(index * 1.37 + seed * 3) * 0.014;
        scratch.object.position.set(x, getTerrainHeight(x, z), z);
        scratch.object.rotation.set(staticSway * 0.35, rotationY, staticSway);
        scratch.object.scale.setScalar(scale);
        scratch.object.updateMatrix();
        mesh.setMatrixAt(index, scratch.object.matrix);
      });

      mesh.count = points.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }, [points, scratch]);

  useEffect(
    () => () => {
      meshes.forEach(({ geometry, material }) => {
        geometry.dispose();
        disposeInstancedMaterial(material);
      });
    },
    [meshes],
  );

  return (
    <group>
      {meshes.map(({ geometry, material, name }, index) => (
        <instancedMesh
          key={`${name || 'mesh'}-${index}`}
          ref={(mesh) => {
            meshRefs.current[index] = mesh;
          }}
          args={[geometry, material, points.length]}
          castShadow={false}
          receiveShadow={false}
          raycast={skipRaycast}
        />
      ))}
    </group>
  );
}

function WebGpuRainWeather({ playerRef }) {
  const { gl } = useThree();
  const groupRef = useRef(null);
  const rainOrigin = useMemo(() => {
    const [x, z] = BIOMES[1].center;
    return new THREE.Vector3(x, getTerrainHeight(x, z) + 44, z);
  }, []);
  const setup = useMemo(() => {
    const positionBuffer = instancedArray(WEBGPU_RAIN_DROP_COUNT, 'vec3');
    const velocityBuffer = instancedArray(WEBGPU_RAIN_DROP_COUNT, 'vec3');
    const origin = uniform(new THREE.Vector3());
    const randUint = () => uint(Math.random() * 0xffffff);
    const halfField = RAIN_FIELD_SIZE / 2;

    const computeInit = Fn(() => {
      const position = positionBuffer.element(instanceIndex);
      const velocity = velocityBuffer.element(instanceIndex);
      const randX = hash(instanceIndex);
      const randY = hash(instanceIndex.add(randUint()));
      const randZ = hash(instanceIndex.add(randUint()));

      position.x = randX.mul(RAIN_FIELD_SIZE).add(-halfField);
      position.y = randY.mul(RAIN_FIELD_HEIGHT);
      position.z = randZ.mul(RAIN_FIELD_SIZE).add(-halfField);
      velocity.y = randX.mul(-18).add(-34);
    })().compute(WEBGPU_RAIN_DROP_COUNT);

    const computeUpdate = Fn(() => {
      const position = positionBuffer.element(instanceIndex);
      const velocity = velocityBuffer.element(instanceIndex);

      position.y = position.y.add(velocity.y.mul(deltaTime).mul(60));

      If(position.y.lessThan(0), () => {
        position.y = RAIN_FIELD_HEIGHT;
        position.x = hash(instanceIndex.add(tslTime))
          .mul(RAIN_FIELD_SIZE)
          .add(-halfField);
        position.z = hash(instanceIndex.add(tslTime.add(randUint())))
          .mul(RAIN_FIELD_SIZE)
          .add(-halfField);
      });
    })()
      .compute(WEBGPU_RAIN_DROP_COUNT)
      .setName('Rain Particles');

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = uv()
      .distance(vec2(0.5, 0))
      .oneMinus()
      .mul(3)
      .exp()
      .mul(0.48);
    material.vertexNode = billboarding({
      position: positionBuffer.toAttribute().add(origin),
    });
    material.color.set('#d7f2ff');
    material.opacity = 0.72;
    material.side = THREE.DoubleSide;
    material.forceSinglePass = true;
    material.depthWrite = false;
    material.depthTest = true;
    material.transparent = true;

    const geometry = new THREE.PlaneGeometry(0.21, 8.6);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.count = WEBGPU_RAIN_DROP_COUNT;
    mesh.frustumCulled = false;
    mesh.raycast = skipRaycast;
    mesh.renderOrder = 6;

    return { computeInit, computeUpdate, geometry, material, mesh, origin };
  }, []);
  const initializedRef = useRef(false);

  useEffect(() => {
    let canceled = false;

    gl.computeAsync(setup.computeInit)
      .then(() => {
        if (!canceled) initializedRef.current = true;
      })
      .catch((error) => {
        console.warn('WebGPU rain initialization failed.', error);
      });

    return () => {
      canceled = true;
      setup.geometry.dispose();
      setup.material.dispose();
    };
  }, [gl, setup]);

  useFrame(() => {
    const group = groupRef.current;
    const player = playerRef.current;
    if (!group || !player) return;

    const intensity = biomeInfluenceAt(
      player.position.x,
      player.position.z,
      BIOMES[1],
    );
    if (intensity < 0.08) {
      group.visible = false;
      return;
    }

    group.visible = true;
    group.position.set(0, 0, 0);
    setup.origin.value.copy(rainOrigin);
    setup.material.opacity = THREE.MathUtils.lerp(0.38, 0.82, intensity);
    setup.mesh.count = Math.floor(
      WEBGPU_RAIN_DROP_COUNT * THREE.MathUtils.clamp(intensity, 0.24, 1),
    );

    if (initializedRef.current) gl.compute(setup.computeUpdate);
  });

  return (
    <group ref={groupRef}>
      <primitive object={setup.mesh} />
    </group>
  );
}

function CpuRainWeather({ playerRef }) {
  const meshRef = useRef(null);
  const materialRef = useRef(null);
  const rainOrigin = useMemo(() => {
    const [x, z] = BIOMES[1].center;
    return new THREE.Vector3(x, getTerrainHeight(x, z) + 55, z);
  }, []);
  const drops = useMemo(() => {
    const random = seededRandom(771913);
    return Array.from({ length: CPU_RAIN_DROP_COUNT }, () => ({
      x: random(),
      z: random(),
      fall: random(),
      speed: THREE.MathUtils.lerp(1.05, 1.9, random()),
      length: THREE.MathUtils.lerp(4.2, 8.4, random()),
      sway: THREE.MathUtils.lerp(-0.18, 0.18, random()),
    }));
  }, []);
  const scratch = useMemo(
    () => ({
      object: new THREE.Object3D(),
    }),
    [],
  );

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    const player = playerRef.current;
    if (!mesh || !player) return;

    const intensity = biomeInfluenceAt(
      player.position.x,
      player.position.z,
      BIOMES[1],
    );
    if (intensity < 0.08) {
      mesh.visible = false;
      mesh.count = 0;
      return;
    }

    mesh.visible = true;
    const dropCount = Math.floor(
      CPU_RAIN_DROP_COUNT * THREE.MathUtils.clamp(intensity, 0.22, 1),
    );
    const time = clock.elapsedTime;
    if (materialRef.current) {
      materialRef.current.opacity = THREE.MathUtils.lerp(0.34, 0.72, intensity);
    }

    for (let index = 0; index < dropCount; index += 1) {
      const drop = drops[index];
      const wrappedX = (drop.x + time * drop.sway * 0.018 + 1) % 1;
      const wrappedZ = (drop.z + time * 0.035 + 1) % 1;
      const fall = (drop.fall - time * drop.speed + 20) % 1;
      scratch.object.position.set(
        rainOrigin.x + (wrappedX - 0.5) * RAIN_FIELD_SIZE,
        rainOrigin.y + fall * RAIN_FIELD_HEIGHT,
        rainOrigin.z + (wrappedZ - 0.5) * RAIN_FIELD_SIZE,
      );
      scratch.object.rotation.set(0.22, 0, drop.sway);
      scratch.object.scale.set(0.16, drop.length, 0.16);
      scratch.object.updateMatrix();
      mesh.setMatrixAt(index, scratch.object.matrix);
    }

    mesh.count = dropCount;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[null, null, CPU_RAIN_DROP_COUNT]}
      frustumCulled={false}
      raycast={() => null}
      renderOrder={6}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial
        ref={materialRef}
        color='#d7f2ff'
        depthWrite={false}
        opacity={0.34}
        transparent
        toneMapped={false}
      />
    </instancedMesh>
  );
}

function RainWeather({ playerRef }) {
  const { gl } = useThree();
  return isWebGPURenderer(gl) ? (
    <WebGpuRainWeather playerRef={playerRef} />
  ) : (
    <CpuRainWeather playerRef={playerRef} />
  );
}

function CanvasCursorTracker({ cursorLookRef, inputReady }) {
  const { gl } = useThree();

  useEffect(() => {
    const element = gl.domElement;
    if (!element) return undefined;

    const syncPointer = (event) => {
      if (!inputReady) {
        cursorLookRef.current.hasPointer = false;
        return;
      }
      if (event.pointerType === 'touch') return;

      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const state = cursorLookRef.current;
      state.hasPointer = true;
      state.lastMovedAt = performance.now();
      state.ndc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };

    const clearPointer = () => {
      cursorLookRef.current.hasPointer = false;
    };

    element.addEventListener('pointerdown', syncPointer);
    element.addEventListener('pointermove', syncPointer);
    element.addEventListener('pointerleave', clearPointer);
    return () => {
      element.removeEventListener('pointerdown', syncPointer);
      element.removeEventListener('pointermove', syncPointer);
      element.removeEventListener('pointerleave', clearPointer);
    };
  }, [cursorLookRef, gl, inputReady]);

  return null;
}

function PlayerAvatar({
  attackRequestRef,
  attackTimingRef,
  children,
  cursorLookRef,
  headLookOverrideRef,
  initialPosition = null,
  isBlockingRef,
  isDeadRef,
  isMovingRef,
  isRunningRef,
  playerRef,
  publishHeadLook,
  equipment = null,
  equippedWeaponId = 'stick',
  torchEquipped,
  toolStateRef,
}) {
  const { camera } = useThree();
  const avatarRootRef = useRef(null);
  const axeRef = useRef(null);
  const pickaxeRef = useRef(null);
  const swordRef = useRef(null);
  const genericWeaponRef = useRef(null);
  const shieldRef = useRef(null);
  const torchRef = useRef(null);
  const miningRigRef = useRef(null);
  const mixerRef = useRef(null);
  const actionsRef = useRef({
    idle: null,
    walk: null,
    run: null,
    attack: null,
    pickaxeAttack: null,
    gatherAttack: null,
    gatherPickaxeAttack: null,
    block: null,
    death: null,
  });
  const movementBlendRef = useRef(0);
  const runBlendRef = useRef(0);
  const blockBlendRef = useRef(0);
  const gatherAnimationStateRef = useRef({
    sequence: 0,
    tool: 'axe',
  });
  const attackStateRef = useRef({
    sequence: 0,
    cancelSequence: 0,
    startedAt: -Infinity,
    duration: 0,
    tool: 'axe',
  });
  const deathStateRef = useRef({ dead: false });
  const { scene } = useGLTF(KNIGHT_MODEL_URL);
  const { animations: movementClips } = useGLTF(
    `${ADVENTURER_ANIMATION_BASE}Rig_Medium_MovementBasic.glb`,
  );
  const { animations: generalClips } = useGLTF(
    `${ADVENTURER_ANIMATION_BASE}Rig_Medium_General.glb`,
  );
  const attackAnimation = useLoader(FBXLoader, ATTACK_ANIMATION_URL);
  const pickaxeAttackAnimation = useLoader(
    FBXLoader,
    PICKAXE_ATTACK_ANIMATION_URL,
  );
  const blockAnimation = useLoader(FBXLoader, BLOCK_ANIMATION_URL);
  const deathAnimation = useLoader(FBXLoader, DEATH_ANIMATION_URL);
  const { scene: axeScene } = useGLTF(AXE_MODEL_URL);
  const { scene: swordScene } = useGLTF(SWORD_MODEL_URL);
  const { scene: battleAxeScene } = useGLTF(KAYKIT_HELD_WEAPON_MODEL_URLS.battle_axe);
  const { scene: bowScene } = useGLTF(KAYKIT_HELD_WEAPON_MODEL_URLS.bow);
  const { scene: crossbowScene } = useGLTF(KAYKIT_HELD_WEAPON_MODEL_URLS.crossbow);
  const { scene: daggerScene } = useGLTF(KAYKIT_HELD_WEAPON_MODEL_URLS.dagger);
  const { scene: greatAxeScene } = useGLTF(KAYKIT_HELD_WEAPON_MODEL_URLS.great_axe);
  const { scene: staffScene } = useGLTF(KAYKIT_HELD_WEAPON_MODEL_URLS.staff);
  const { scene: wandScene } = useGLTF(KAYKIT_HELD_WEAPON_MODEL_URLS.wand);
  const { scene: shieldScene } = useGLTF(SHIELD_MODEL_URL);
  const avatarEquipment = normalizeAvatarEquipment(
    equipment,
    equippedWeaponId,
    torchEquipped ? 'torch' : null,
  );
  const avatarScene = useMemo(() => cloneSkeleton(scene), [scene]);
  const axeObject = useMemo(() => axeScene.clone(true), [axeScene]);
  const swordObject = useMemo(() => swordScene.clone(true), [swordScene]);
  const shieldObject = useMemo(() => shieldScene.clone(true), [shieldScene]);
  const kayKitWeaponScenes = useMemo(
    () => ({
      battle_axe: battleAxeScene,
      bow: bowScene,
      crossbow: crossbowScene,
      dagger: daggerScene,
      great_axe: greatAxeScene,
      staff: staffScene,
      wand: wandScene,
    }),
    [
      battleAxeScene,
      bowScene,
      crossbowScene,
      daggerScene,
      greatAxeScene,
      staffScene,
      wandScene,
    ],
  );
  const genericWeaponObject = useMemo(
    () =>
      createKayKitHeldWeaponObject(
        equippedWeaponId,
        kayKitWeaponScenes[equippedWeaponId],
      ) || createHeldWeaponObject(equippedWeaponId),
    [equippedWeaponId, kayKitWeaponScenes],
  );
  const equipmentWearablesObject = useMemo(
    () => createEquipmentWearables(avatarEquipment),
    [
      avatarEquipment.body,
      avatarEquipment.charm,
      avatarEquipment.feet,
      avatarEquipment.head,
    ],
  );
  const pickaxeObject = useMemo(() => createMiningPickaxeObject(), []);
  const torchObject = useMemo(() => createHeldTorchObject(), []);
  const headLookRef = useRef({ yaw: 0, pitch: 0 });
  const lastPublishedHeadLookRef = useRef({ at: 0, yaw: 0, pitch: 0 });
  const headLookScratch = useMemo(
    () => ({
      direction: new THREE.Vector3(),
      headLocal: new THREE.Vector3(),
      headWorld: new THREE.Vector3(),
      raycaster: new THREE.Raycaster(),
      targetLocal: new THREE.Vector3(),
      targetWorld: new THREE.Vector3(),
    }),
    [],
  );

  useMemo(() => {
    enableShadows(avatarScene, DETAILED_MODEL_SHADOW_OPTIONS);
  }, [avatarScene]);

  useMemo(() => {
    enableShadows(axeObject, DETAILED_MODEL_SHADOW_OPTIONS);
  }, [axeObject]);

  useMemo(() => {
    enableShadows(swordObject, DETAILED_MODEL_SHADOW_OPTIONS);
  }, [swordObject]);

  useMemo(() => {
    enableShadows(shieldObject, DETAILED_MODEL_SHADOW_OPTIONS);
  }, [shieldObject]);

  useMemo(() => {
    enableShadows(genericWeaponObject, DETAILED_MODEL_SHADOW_OPTIONS);
  }, [genericWeaponObject]);

  useMemo(() => {
    enableShadows(equipmentWearablesObject, DETAILED_MODEL_SHADOW_OPTIONS);
  }, [equipmentWearablesObject]);

  useEffect(() => {
    const avatarRoot = avatarRootRef.current;
    const rightHandSlot =
      avatarScene.getObjectByName('handslotr') ??
      avatarScene.getObjectByName('handslot.r');
    const leftHandSlot =
      avatarScene.getObjectByName('handslotl') ??
      avatarScene.getObjectByName('handslot.l') ??
      avatarScene.getObjectByName('hand.l');
    const equipmentSlots = {
      body: avatarScene.getObjectByName('chest') || avatarScene,
      charm: avatarScene.getObjectByName('chest') || avatarScene,
      head: avatarScene.getObjectByName('head') || avatarScene,
      'foot.l':
        avatarScene.getObjectByName('foot.l') ??
        avatarScene.getObjectByName('toe.l') ??
        avatarScene.getObjectByName('ankle.l') ??
        avatarScene,
      'foot.r':
        avatarScene.getObjectByName('foot.r') ??
        avatarScene.getObjectByName('toe.r') ??
        avatarScene.getObjectByName('ankle.r') ??
        avatarScene,
    };
    if (!avatarRoot || !rightHandSlot) return undefined;

    axeObject.visible = false;
    applyAxeHandTransform(axeObject, AXE_HAND_DEFAULT_TRANSFORMS.idle);
    axeObject.scale.setScalar(1);
    rightHandSlot.add(axeObject);
    axeRef.current = axeObject;

    swordObject.visible = false;
    applyAxeHandTransform(swordObject, SWORD_HAND_TRANSFORMS.idle);
    swordObject.scale.setScalar(0.82);
    rightHandSlot.add(swordObject);
    swordRef.current = swordObject;

    genericWeaponObject.visible = false;
    applyAxeHandTransform(
      genericWeaponObject,
      genericWeaponObject.userData.handTransform || GENERIC_WEAPON_HAND_TRANSFORM,
    );
    rightHandSlot.add(genericWeaponObject);
    genericWeaponRef.current = genericWeaponObject;

    pickaxeObject.visible = false;
    applyAxeHandTransform(pickaxeObject, SIMPLE_PICKAXE_TRANSFORMS.idle);
    pickaxeObject.scale.setScalar(PICKAXE_HAND_SCALE);
    rightHandSlot.add(pickaxeObject);
    pickaxeRef.current = pickaxeObject;

    torchObject.visible = false;
    applyAxeHandTransform(torchObject, TORCH_HAND_TRANSFORM);
    torchObject.scale.setScalar(TORCH_HAND_SCALE);
    (leftHandSlot || rightHandSlot).add(torchObject);
    torchRef.current = torchObject;

    shieldObject.visible = false;
    applyAxeHandTransform(shieldObject, SHIELD_HAND_TRANSFORM);
    shieldObject.scale.setScalar(SHIELD_HAND_SCALE);
    (leftHandSlot || rightHandSlot).add(shieldObject);
    shieldRef.current = shieldObject;

    const attachedWearables = [];
    for (const wearable of [...equipmentWearablesObject.children]) {
      const target = equipmentSlots[wearable.userData.equipmentSlot];
      if (!target) continue;
      target.add(wearable);
      attachedWearables.push({ target, wearable });
    }

    miningRigRef.current = {
      chest: avatarScene.getObjectByName('chest'),
      head: avatarScene.getObjectByName('head'),
      upperRightArm: avatarScene.getObjectByName('upperarm.r'),
      lowerRightArm: avatarScene.getObjectByName('lowerarm.r'),
      rightWrist: avatarScene.getObjectByName('wrist.r'),
      rightHand: avatarScene.getObjectByName('hand.r'),
      upperLeftArm: avatarScene.getObjectByName('upperarm.l'),
      lowerLeftArm: avatarScene.getObjectByName('lowerarm.l'),
      leftWrist: avatarScene.getObjectByName('wrist.l'),
      leftHand: avatarScene.getObjectByName('hand.l'),
    };

    return () => {
      rightHandSlot.remove(axeObject);
      rightHandSlot.remove(swordObject);
      rightHandSlot.remove(genericWeaponObject);
      rightHandSlot.remove(pickaxeObject);
      (leftHandSlot || rightHandSlot).remove(torchObject);
      (leftHandSlot || rightHandSlot).remove(shieldObject);
      attachedWearables.forEach(({ target, wearable }) => target.remove(wearable));
      axeRef.current = null;
      swordRef.current = null;
      genericWeaponRef.current = null;
      pickaxeRef.current = null;
      torchRef.current = null;
      shieldRef.current = null;
      miningRigRef.current = null;
    };
  }, [
    avatarScene,
    axeObject,
    equipmentWearablesObject,
    genericWeaponObject,
    pickaxeObject,
    shieldObject,
    swordObject,
    torchObject,
  ]);

  useEffect(() => {
    return () => {
      disposeObjectMaterialsAndGeometry(pickaxeObject);
      disposeObjectMaterialsAndGeometry(genericWeaponObject);
      disposeObjectMaterialsAndGeometry(equipmentWearablesObject);
      disposeObjectMaterialsAndGeometry(torchObject);
    };
  }, [equipmentWearablesObject, genericWeaponObject, pickaxeObject, torchObject]);

  useEffect(() => {
    if (!avatarRootRef.current) return undefined;
    const animationRoot = avatarRootRef.current;
    const idleClip = generalClips.find((clip) => clip.name === 'Idle_A');
    const walkClip = movementClips.find((clip) => clip.name === 'Walking_A');
    const runClip = movementClips.find((clip) => clip.name === 'Running_B');
    const attackClip = attackAnimation.animations[0];
    const pickaxeAttackClip = pickaxeAttackAnimation.animations[0];
    const blockClip = createUpperBodyAnimationClip(
      blockAnimation.animations[0],
      'Standing_Block_Upper',
    );
    const deathClip = deathAnimation.animations[0];
    if (!idleClip || !walkClip || !runClip) return undefined;

    const mixer = new THREE.AnimationMixer(animationRoot);
    const idle = mixer.clipAction(idleClip);
    const walk = mixer.clipAction(walkClip);
    const run = mixer.clipAction(runClip);
    const attack = attackClip ? mixer.clipAction(attackClip) : null;
    const pickaxeAttack = pickaxeAttackClip
      ? mixer.clipAction(pickaxeAttackClip)
      : null;
    const block = blockClip ? mixer.clipAction(blockClip) : null;
    const death = deathClip ? mixer.clipAction(deathClip) : null;
    const gatherAttackClip = attackClip
      ? THREE.AnimationUtils.subclip(
          attackClip,
          'Gather_Axe_Loop',
          0,
          Math.max(
            1,
            Math.floor((attackClip.duration - GATHER_ATTACK_TRIM_END) * 30),
          ),
          30,
        )
      : null;
    const gatherPickaxeAttackClip = pickaxeAttackClip
      ? THREE.AnimationUtils.subclip(
          pickaxeAttackClip,
          'Gather_Pickaxe_Loop',
          0,
          Math.max(
            1,
            Math.floor(
              (pickaxeAttackClip.duration - GATHER_ATTACK_TRIM_END) * 30,
            ),
          ),
          30,
        )
      : null;
    const gatherAttack = gatherAttackClip
      ? mixer.clipAction(gatherAttackClip)
      : null;
    const gatherPickaxeAttack = gatherPickaxeAttackClip
      ? mixer.clipAction(gatherPickaxeAttackClip)
      : null;

    idle.enabled = true;
    walk.enabled = true;
    run.enabled = true;
    idle.setLoop(THREE.LoopRepeat);
    walk.setLoop(THREE.LoopRepeat);
    run.setLoop(THREE.LoopRepeat);
    idle.setEffectiveWeight(1);
    walk.setEffectiveWeight(0);
    run.setEffectiveWeight(0);
    walk.timeScale = 1.1;
    run.timeScale = 1;
    idle.play();
    walk.play();
    run.play();

    if (attack) {
      attack.enabled = true;
      attack.clampWhenFinished = false;
      attack.setLoop(THREE.LoopOnce, 1);
      attack.setEffectiveWeight(0);
      attack.timeScale = 1;
      attackTimingRef.current.duration =
        attack.getClip().duration / attack.timeScale;
    }
    if (pickaxeAttack) {
      pickaxeAttack.enabled = true;
      pickaxeAttack.clampWhenFinished = false;
      pickaxeAttack.setLoop(THREE.LoopOnce, 1);
      pickaxeAttack.setEffectiveWeight(0);
      pickaxeAttack.timeScale = 1;
    }
    if (gatherAttack) {
      gatherAttack.enabled = true;
      gatherAttack.clampWhenFinished = false;
      gatherAttack.setLoop(THREE.LoopRepeat);
      gatherAttack.setEffectiveWeight(0);
      gatherAttack.timeScale =
        gatherAttack.getClip().duration / GATHER_SWING_DURATION;
      gatherAttack.play();
    }
    if (gatherPickaxeAttack) {
      gatherPickaxeAttack.enabled = true;
      gatherPickaxeAttack.clampWhenFinished = false;
      gatherPickaxeAttack.setLoop(THREE.LoopRepeat);
      gatherPickaxeAttack.setEffectiveWeight(0);
      gatherPickaxeAttack.timeScale =
        gatherPickaxeAttack.getClip().duration / GATHER_SWING_DURATION;
      gatherPickaxeAttack.play();
    }
    if (block) {
      block.enabled = true;
      block.clampWhenFinished = false;
      block.setLoop(THREE.LoopRepeat);
      block.setEffectiveWeight(0);
      block.timeScale = 1;
      block.play();
    }
    if (death) {
      death.enabled = true;
      death.clampWhenFinished = true;
      death.setLoop(THREE.LoopOnce, 1);
      death.setEffectiveWeight(0);
      death.timeScale = 1;
    }

    mixerRef.current = mixer;
    actionsRef.current = {
      idle,
      walk,
      run,
      attack,
      pickaxeAttack,
      gatherAttack,
      gatherPickaxeAttack,
      block,
      death,
    };

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(animationRoot);
      mixerRef.current = null;
      actionsRef.current = {
        idle: null,
        walk: null,
        run: null,
        attack: null,
        pickaxeAttack: null,
        gatherAttack: null,
        gatherPickaxeAttack: null,
        block: null,
        death: null,
      };
      attackTimingRef.current.duration = 1;
      deathStateRef.current = { dead: false };
    };
  }, [
    attackAnimation,
    blockAnimation,
    deathAnimation,
    attackTimingRef,
    generalClips,
    movementClips,
    pickaxeAttackAnimation,
  ]);

  useFrame(({ clock }, delta) => {
    if (!avatarRootRef.current || !mixerRef.current) return;

    const rig = miningRigRef.current;
    if (rig?.head) {
      rig.head.rotation.y -= headLookRef.current.yaw * PLAYER_HEAD_YAW_BLEND;
      rig.head.rotation.x +=
        headLookRef.current.pitch * PLAYER_HEAD_PITCH_BLEND;
    }
    if (rig?.chest) {
      rig.chest.rotation.y -= headLookRef.current.yaw * 0.12;
      rig.chest.rotation.x += headLookRef.current.pitch * 0.08;
    }

    const isGathering = Boolean(toolStateRef.current.gathering);
    const isDead = Boolean(isDeadRef?.current);
    const isBlocking = Boolean(isBlockingRef?.current && !isDead);
    const swordEquipped = equippedWeaponId === 'sword';
    const shieldEquipped = avatarEquipment.offhand === 'wooden_shield';
    const torchVisible = avatarEquipment.offhand === 'torch';
    const configuredTool = toolStateRef.current.tool || 'axe';
    const activeTool =
      isGathering || toolStateRef.current.axeVisible
        ? configuredTool
        : swordEquipped
          ? 'sword'
          : configuredTool;
    const visible = Boolean(
      toolStateRef.current.axeVisible ||
        (swordEquipped && !isGathering) ||
        (isBlocking && swordEquipped),
    );
    const genericWeaponVisible = Boolean(
      equippedWeaponId &&
        equippedWeaponId !== 'sword' &&
        !isGathering &&
        !toolStateRef.current.axeVisible,
    );
    const isGatherPickaxeTool = visible && activeTool === 'pickaxe';
    const attack = actionsRef.current.attack;
    const pickaxeAttack = actionsRef.current.pickaxeAttack;
    const gatherAttack = actionsRef.current.gatherAttack;
    const gatherPickaxeAttack = actionsRef.current.gatherPickaxeAttack;
    const block = actionsRef.current.block;
    const death = actionsRef.current.death;
    const attackRequest = attackRequestRef.current;
    if (
      attackRequest.cancelSequence !== attackStateRef.current.cancelSequence
    ) {
      attack?.stop();
      pickaxeAttack?.stop();
      attackStateRef.current = {
        ...attackStateRef.current,
        cancelSequence: attackRequest.cancelSequence,
        startedAt: -Infinity,
        duration: 0,
      };
    }

    const requestedTool = attackRequest.tool || activeTool;
    const requestedAttack =
      requestedTool === 'pickaxe' ? pickaxeAttack : attack;
    const otherAttack = requestedTool === 'pickaxe' ? attack : pickaxeAttack;
    if (
      requestedAttack &&
      attackRequest.sequence !== attackStateRef.current.sequence
    ) {
      otherAttack?.stop();
      requestedAttack.reset();
      requestedAttack.setLoop(THREE.LoopOnce, 1);
      requestedAttack.setEffectiveWeight(1);
      const clipDuration = requestedAttack.getClip().duration;
      const trimEnd = attackRequest.trimEnd || 0;
      const requestedDuration = Math.max(
        0.1,
        attackRequest.duration || clipDuration - trimEnd,
      );
      requestedAttack.timeScale = clipDuration / (requestedDuration + trimEnd);
      requestedAttack.play();
      attackStateRef.current = {
        sequence: attackRequest.sequence,
        cancelSequence: attackRequest.cancelSequence,
        startedAt: clock.elapsedTime,
        tool: requestedTool,
        duration: requestedDuration,
      };
    }

    const attackElapsed = clock.elapsedTime - attackStateRef.current.startedAt;
    const activeAttack =
      attackStateRef.current.tool === 'pickaxe' ? pickaxeAttack : attack;
    const attackWeight =
      !isGathering &&
      activeAttack &&
      attackElapsed >= 0 &&
      attackElapsed < attackStateRef.current.duration
        ? 1
        : 0;
    const gatherWeight = isGathering ? 1 : 0;
    const gatherAxeWeight =
      gatherWeight > 0 && activeTool === 'axe' ? gatherWeight : 0;
    const gatherPickaxeWeight =
      gatherWeight > 0 && activeTool === 'pickaxe' ? gatherWeight : 0;
    const isPickaxeTool = isGatherPickaxeTool;
    const isSwordTool = visible && activeTool === 'sword';

    if (death) {
      if (isDead && !deathStateRef.current.dead) {
        attack?.stop();
        pickaxeAttack?.stop();
        gatherAttack?.stop();
        gatherPickaxeAttack?.stop();
        block?.stop();
        death.reset();
        death.setLoop(THREE.LoopOnce, 1);
        death.setEffectiveWeight(1);
        death.play();
        deathStateRef.current.dead = true;
      } else if (!isDead && deathStateRef.current.dead) {
        death.stop();
        death.setEffectiveWeight(0);
        block?.reset().play();
        deathStateRef.current.dead = false;
      }
    }

    if (pickaxeAttack) {
      if (attackStateRef.current.tool !== 'pickaxe' || attackWeight <= 0) {
        pickaxeAttack.stop();
      }
    }
    if (isDead) {
      attack?.stop();
      pickaxeAttack?.stop();
      gatherAttack?.stop();
      gatherPickaxeAttack?.stop();
      gatherAnimationStateRef.current = {
        sequence: toolStateRef.current.gatherSwingSequence || 0,
        tool: activeTool,
      };
    } else if (isGathering) {
      attack?.stop();
      pickaxeAttack?.stop();
      const gatherSequence = toolStateRef.current.gatherSwingSequence || 0;
      const shouldResetGatherAction =
        gatherSequence !== gatherAnimationStateRef.current.sequence ||
        activeTool !== gatherAnimationStateRef.current.tool;
      const activeGatherAction =
        activeTool === 'pickaxe' ? gatherPickaxeAttack : gatherAttack;
      if (
        activeGatherAction &&
        (shouldResetGatherAction || !activeGatherAction.isRunning())
      ) {
        activeGatherAction.reset().play();
      }
      gatherAnimationStateRef.current = {
        sequence: gatherSequence,
        tool: activeTool,
      };
    } else {
      gatherAttack?.stop();
      gatherPickaxeAttack?.stop();
      gatherAnimationStateRef.current = {
        sequence: toolStateRef.current.gatherSwingSequence || 0,
        tool: activeTool,
      };
    }

    if (
      axeRef.current ||
      genericWeaponRef.current ||
      pickaxeRef.current ||
      swordRef.current
    ) {
      const transform =
        (attackWeight > 0 || gatherAxeWeight > 0) && activeTool === 'axe'
          ? AXE_HAND_DEFAULT_TRANSFORMS.chop
          : AXE_HAND_DEFAULT_TRANSFORMS.idle;
      if (axeRef.current) {
        applyAxeHandTransform(axeRef.current, transform);
        axeRef.current.visible = visible && activeTool === 'axe';
      }
      if (swordRef.current) {
        const swordTransform =
          attackWeight > 0 && attackStateRef.current.tool === 'sword'
            ? SWORD_HAND_TRANSFORMS.slash
            : SWORD_HAND_TRANSFORMS.idle;
        applyAxeHandTransform(swordRef.current, swordTransform);
        swordRef.current.scale.setScalar(0.82);
        swordRef.current.visible = isSwordTool;
      }
      if (genericWeaponRef.current) {
        applyAxeHandTransform(
          genericWeaponRef.current,
          genericWeaponRef.current.userData.handTransform ||
            GENERIC_WEAPON_HAND_TRANSFORM,
        );
        genericWeaponRef.current.visible = genericWeaponVisible;
      }
      if (pickaxeRef.current) {
        pickaxeRef.current.scale.setScalar(PICKAXE_HAND_SCALE);
        applyAxeHandTransform(
          pickaxeRef.current,
          SIMPLE_PICKAXE_TRANSFORMS.idle,
        );
        pickaxeRef.current.visible = isPickaxeTool;
      }
    }

    if (torchRef.current) {
      torchRef.current.visible = torchVisible;
      if (torchVisible) {
        const flicker =
          1 +
          Math.sin(clock.elapsedTime * 12.7) * 0.055 +
          Math.sin(clock.elapsedTime * 23.1) * 0.035;
        const flame = torchRef.current.userData.flame;
        const light = torchRef.current.userData.light;
        const ember = torchRef.current.userData.ember;
        flame?.scale.set(
          0.92 + flicker * 0.08,
          1.02 + flicker * 0.14,
          0.92 + flicker * 0.08,
        );
        if (light) {
          light.intensity =
            TORCH_LIGHT_BASE_INTENSITY +
            flicker * TORCH_LIGHT_FLICKER_INTENSITY;
        }
        if (ember?.material)
          ember.material.emissiveIntensity = 2.2 + flicker * 0.7;
      }
    }

    if (activeAttack && attackWeight <= 0 && activeAttack.isRunning()) {
      activeAttack.stop();
    }

    const targetBlend = isDead ? 0 : isMovingRef.current ? 1 : 0;
    movementBlendRef.current = THREE.MathUtils.damp(
      movementBlendRef.current,
      targetBlend,
      12,
      delta,
    );
    runBlendRef.current = THREE.MathUtils.damp(
      runBlendRef.current,
      isMovingRef.current && isRunningRef.current ? 1 : 0,
      12,
      delta,
    );
    blockBlendRef.current = THREE.MathUtils.damp(
      blockBlendRef.current,
      isBlocking ? 1 : 0,
      14,
      delta,
    );
    const locomotionWeight = movementBlendRef.current;
    const runWeight = locomotionWeight * runBlendRef.current;
    const walkWeight = locomotionWeight - runWeight;
    const idleWeight = 1 - locomotionWeight;
    const axeAttackWeight =
      isGathering || attackStateRef.current.tool === 'pickaxe'
        ? 0
        : attackWeight;
    const pickaxeAttackWeight =
      attackStateRef.current.tool === 'pickaxe' && !isGathering
        ? attackWeight
        : 0;
    const clipAttackWeight = Math.max(
      axeAttackWeight,
      pickaxeAttackWeight,
      gatherAxeWeight,
      gatherPickaxeWeight,
    );
    const blockActionWeight =
      !isDead && !isGathering && attackWeight <= 0.01 ? blockBlendRef.current : 0;
    const deathWeight = isDead && death ? 1 : 0;
    const baseWeight = 1 - Math.max(clipAttackWeight, deathWeight);
    actionsRef.current.idle?.setEffectiveWeight(idleWeight * baseWeight);
    actionsRef.current.walk?.setEffectiveWeight(walkWeight * baseWeight);
    actionsRef.current.run?.setEffectiveWeight(runWeight * baseWeight);
    attack?.setEffectiveWeight(axeAttackWeight);
    pickaxeAttack?.setEffectiveWeight(pickaxeAttackWeight);
    gatherAttack?.setEffectiveWeight(gatherAxeWeight);
    gatherPickaxeAttack?.setEffectiveWeight(gatherPickaxeWeight);
    block?.setEffectiveWeight(blockActionWeight);
    death?.setEffectiveWeight(deathWeight);
    mixerRef.current.update(delta);
    if (!block) applyBlockingPose(rig, blockBlendRef.current);
    const strideRate = THREE.MathUtils.lerp(12, 16, runBlendRef.current);
    const stride = Math.sin(clock.elapsedTime * strideRate);
    avatarRootRef.current.position.y =
      Math.max(0, stride) * 2.2 * locomotionWeight;
    avatarRootRef.current.rotation.x = 0;
    avatarRootRef.current.rotation.z = stride * 0.025 * locomotionWeight;

    const playerRoot = playerRef.current;
    const cursorLook = cursorLookRef?.current;
    const headLookOverride = headLookOverrideRef?.current;
    let targetYaw = 0;
    let targetPitch = 0;

    const canFollowCursor =
      attackWeight <= 0.01 && gatherWeight <= 0.01 && !isBlocking;

    if (canFollowCursor && headLookOverride) {
      targetYaw = THREE.MathUtils.clamp(
        Number(headLookOverride.yaw) || 0,
        -PLAYER_HEAD_TURN_LIMIT,
        PLAYER_HEAD_TURN_LIMIT,
      );
      targetPitch = THREE.MathUtils.clamp(
        Number(headLookOverride.pitch) || 0,
        -PLAYER_HEAD_LOOK_DOWN_LIMIT,
        PLAYER_HEAD_LOOK_UP_LIMIT,
      );
    } else if (canFollowCursor && rig?.head && playerRoot && cursorLook?.hasPointer) {
      avatarRootRef.current.updateWorldMatrix(true, true);
      rig.head.getWorldPosition(headLookScratch.headWorld);
      headLookScratch.raycaster.setFromCamera(cursorLook.ndc, camera);
      headLookScratch.raycaster.ray.closestPointToPoint(
        headLookScratch.headWorld,
        headLookScratch.targetWorld,
      );

      if (
        headLookScratch.targetWorld.distanceToSquared(
          headLookScratch.headWorld,
        ) < 4
      ) {
        headLookScratch.raycaster.ray.at(480, headLookScratch.targetWorld);
      }

      headLookScratch.headLocal.copy(headLookScratch.headWorld);
      playerRoot.worldToLocal(headLookScratch.headLocal);
      headLookScratch.targetLocal.copy(headLookScratch.targetWorld);
      playerRoot.worldToLocal(headLookScratch.targetLocal);
      headLookScratch.direction.subVectors(
        headLookScratch.targetLocal,
        headLookScratch.headLocal,
      );

      if (headLookScratch.direction.lengthSq() > 0.001) {
        headLookScratch.direction.normalize();
        const flatDistance = Math.hypot(
          headLookScratch.direction.x,
          headLookScratch.direction.z,
        );
        targetYaw = THREE.MathUtils.clamp(
          Math.atan2(headLookScratch.direction.x, headLookScratch.direction.z),
          -PLAYER_HEAD_TURN_LIMIT,
          PLAYER_HEAD_TURN_LIMIT,
        );
        targetPitch = THREE.MathUtils.clamp(
          Math.atan2(headLookScratch.direction.y, flatDistance),
          -PLAYER_HEAD_LOOK_DOWN_LIMIT,
          PLAYER_HEAD_LOOK_UP_LIMIT,
        );
      }
    }

    if (canFollowCursor) {
      headLookRef.current.yaw = dampAngle(
        headLookRef.current.yaw,
        targetYaw,
        PLAYER_HEAD_LOOK_DAMPING,
        delta,
      );
      headLookRef.current.pitch = THREE.MathUtils.damp(
        headLookRef.current.pitch,
        targetPitch,
        PLAYER_HEAD_LOOK_DAMPING,
        delta,
      );
    } else {
      headLookRef.current.yaw = 0;
      headLookRef.current.pitch = 0;
    }

    if (rig?.head) {
      rig.head.rotation.y += headLookRef.current.yaw * PLAYER_HEAD_YAW_BLEND;
      rig.head.rotation.x -=
        headLookRef.current.pitch * PLAYER_HEAD_PITCH_BLEND;
    }
    if (rig?.chest) {
      rig.chest.rotation.y += headLookRef.current.yaw * 0.12;
      rig.chest.rotation.x -= headLookRef.current.pitch * 0.08;
    }

    if (shieldRef.current) {
      applyAxeHandTransform(shieldRef.current, SHIELD_HAND_TRANSFORM);
      shieldRef.current.scale.setScalar(SHIELD_HAND_SCALE);
      shieldRef.current.visible = shieldEquipped;
    }

    if (publishHeadLook) {
      const last = lastPublishedHeadLookRef.current;
      const changed =
        Math.abs(headLookRef.current.yaw - last.yaw) > 0.025 ||
        Math.abs(headLookRef.current.pitch - last.pitch) > 0.025;
      if (changed && clock.elapsedTime - last.at > 0.05) {
        last.at = clock.elapsedTime;
        last.yaw = headLookRef.current.yaw;
        last.pitch = headLookRef.current.pitch;
        gameRuntimeStore.getState().setLocalPresence({
          headYaw: headLookRef.current.yaw,
          headPitch: headLookRef.current.pitch,
        });
      }
    }
  });

  return (
    <group
      ref={playerRef}
      position={
        initialPosition
          ? [initialPosition.x, initialPosition.y, initialPosition.z]
          : [0, 0, 0]
      }
      rotation-y={initialPosition?.facing || 0}
    >
      <group ref={avatarRootRef} scale={42}>
        <primitive object={avatarScene} />
      </group>
      {children}
    </group>
  );
}

function PlayerFallback({ initialPosition = null, playerRef }) {
  const marker = useRef(null);

  useFrame(({ clock }, delta) => {
    if (!marker.current) return;
    marker.current.rotation.y += delta * 1.15;
    marker.current.position.y = 32 + Math.sin(clock.elapsedTime * 2.2) * 2;
  });

  return (
    <group
      ref={playerRef}
      position={
        initialPosition
          ? [initialPosition.x, initialPosition.y, initialPosition.z]
          : [0, 0, 0]
      }
      rotation-y={initialPosition?.facing || 0}
    >
      <group ref={marker} position={[0, 32, 0]}>
        <mesh castShadow receiveShadow>
          <capsuleGeometry args={[16, 28, 6, 12]} />
          <meshStandardMaterial color='#6fb8ff' roughness={0.62} />
        </mesh>
        <mesh position={[0, 26, 0]} castShadow receiveShadow>
          <sphereGeometry args={[14, 16, 12]} />
          <meshStandardMaterial color='#ffd7ad' roughness={0.7} />
        </mesh>
      </group>
    </group>
  );
}

function RemotePlayerNameplate({ player }) {
  return (
    <Html center distanceFactor={960} position={[0, 124, 0]} zIndexRange={[18, 0]}>
      <div
        style={{
          alignItems: 'center',
          background: 'rgba(18, 27, 23, 0.72)',
          border: '1px solid rgba(250, 255, 232, 0.3)',
          borderRadius: 6,
          boxShadow: '0 8px 22px rgba(0, 0, 0, 0.2)',
          color: '#fbffe9',
          display: 'flex',
          flexDirection: 'column',
          font: '700 10px Inter, system-ui, sans-serif',
          gap: 3,
          lineHeight: 1,
          minWidth: 92,
          padding: '6px 8px',
          pointerEvents: 'none',
          textAlign: 'center',
          whiteSpace: 'nowrap',
        }}
      >
        <span>{player.name || 'Traveler'}</span>
      </div>
    </Html>
  );
}

function RemotePlayerAvatar({ attackableRegistryRef, buildings, onAttack, player }) {
  const playerEquipment = normalizeAvatarEquipment(
    player.equipment,
    player.weaponId === undefined ? 'stick' : player.weaponId,
    player.offhandId || null,
  );
  const playerWeaponId = playerEquipment.weapon;
  const playerRef = useRef(null);
  const sampleHistoryRef = useRef([
    {
      x: Number(player.x) || 0,
      z: Number(player.z) || 0,
      facing: Number(player.facing) || 0,
      vx: 0,
      vz: 0,
      receivedAt: currentFrameTime(),
    },
  ]);
  const renderTargetRef = useRef(
    new THREE.Vector3(Number(player.x) || 0, 0, Number(player.z) || 0),
  );
  const isMovingRef = useRef(false);
  const isRunningRef = useRef(false);
  const isBlockingRef = useRef(false);
  const isDeadRef = useRef((player.hp ?? player.maxHp ?? 5) <= 0);
  const cursorLookRef = useRef({ hasPointer: false, ndc: new THREE.Vector2() });
  const headLookOverrideRef = useRef({ yaw: 0, pitch: 0 });
  const attackTimingRef = useRef({ duration: 1 });
  const lastActionSequenceRef = useRef(player.actionSequence || 0);
  const attackRequestRef = useRef({
    sequence: 0,
    cancelSequence: 0,
    duration: 0,
    tool: 'axe',
    x: player.x,
    z: player.z,
  });
  const toolStateRef = useRef({
    axeVisible: false,
    tool: 'axe',
    gathering: false,
    gatherSwingSequence: 0,
  });
  const attackableEntryRef = useRef({
    id: player.id,
    type: 'player',
    name: player.name || 'Traveler',
    radius: 36,
    hp: player.hp ?? player.maxHp ?? 5,
    maxHp: player.maxHp ?? 5,
    position: new THREE.Vector3(player.x, 0, player.z),
  });

  useLayoutEffect(() => {
    const root = playerRef.current;
    if (!root) return;
    const surfaceY = buildSurfaceHeightAt(player.x, player.z, buildings);
    root.position.set(player.x, surfaceY, player.z);
    root.rotation.y = player.facing || 0;
  }, [player.id]);

  useEffect(() => {
    const entry = attackableEntryRef.current;
    attackableRegistryRef?.current?.set(player.id, entry);
    return () => {
      attackableRegistryRef?.current?.delete(player.id);
    };
  }, [attackableRegistryRef, player.id]);

  useEffect(() => {
    const history = sampleHistoryRef.current;
    const last = history[history.length - 1];
    const receivedAt = currentFrameTime();
    const x = Number(player.x) || 0;
    const z = Number(player.z) || 0;
    const facing = Number(player.facing) || 0;
    const movedSq = (x - last.x) ** 2 + (z - last.z) ** 2;
    const turned = Math.abs(shortestAngleDelta(facing, last.facing));

    if (
      movedSq > REMOTE_PLAYER_SAMPLE_EPSILON * REMOTE_PLAYER_SAMPLE_EPSILON ||
      turned > 0.01
    ) {
      const dt = Math.max(0.001, (receivedAt - last.receivedAt) / 1000);
      const velocity = clampPlanarVelocity(
        (x - last.x) / dt,
        (z - last.z) / dt,
        REMOTE_PLAYER_MAX_PREDICT_SPEED,
      );
      history.push({ x, z, facing, ...velocity, receivedAt });
      if (history.length > 10) history.splice(0, history.length - 10);
    } else if (player.movementState === 'idle') {
      last.vx = 0;
      last.vz = 0;
    }

    headLookOverrideRef.current = {
      yaw: Number(player.headYaw) || 0,
      pitch: Number(player.headPitch) || 0,
    };
    isDeadRef.current = (player.hp ?? player.maxHp ?? 5) <= 0;
    attackableEntryRef.current.name = player.name || 'Traveler';
    attackableEntryRef.current.hp = player.hp ?? player.maxHp ?? 5;
    attackableEntryRef.current.maxHp = player.maxHp ?? 5;
  }, [
    player.facing,
    player.headPitch,
    player.headYaw,
    player.hp,
    player.maxHp,
    player.name,
    player.movementState,
    player.x,
    player.z,
  ]);

  useEffect(() => {
    const actionSequence = player.actionSequence || 0;
    if (player.actionState === 'gather') {
      isBlockingRef.current = false;
      toolStateRef.current = {
        axeVisible: true,
        tool: player.actionTool === 'pickaxe' ? 'pickaxe' : 'axe',
        gathering: true,
        gatherSwingSequence: actionSequence,
      };
      lastActionSequenceRef.current = actionSequence;
      return;
    }

    isBlockingRef.current = Boolean(player.blocking || player.actionState === 'block');
    toolStateRef.current = {
      ...toolStateRef.current,
      axeVisible: false,
      tool:
        player.actionTool ||
        (playerWeaponId === 'sword' ? 'sword' : 'weapon'),
      gathering: false,
    };

    if (
      player.actionState === 'attack' &&
      actionSequence !== lastActionSequenceRef.current
    ) {
      attackRequestRef.current = {
        sequence: attackRequestRef.current.sequence + 1,
        cancelSequence: attackRequestRef.current.cancelSequence,
        duration: weaponAttackProfile(
          weaponDefs.find((weapon) => weapon.id === playerWeaponId),
        ).animationDuration,
        trimEnd: 0,
        tool:
          player.actionTool ||
          (playerWeaponId === 'sword' ? 'sword' : 'weapon'),
        x: player.x,
        z: player.z,
      };
      lastActionSequenceRef.current = actionSequence;
    }
  }, [
    player.actionSequence,
    player.actionState,
    player.actionTool,
    player.blocking,
    playerWeaponId,
    player.x,
    player.z,
  ]);

  useFrame((_, delta) => {
    const root = playerRef.current;
    if (!root) return;

    const history = sampleHistoryRef.current;
    const renderAt = currentFrameTime() - REMOTE_PLAYER_INTERPOLATION_DELAY_MS;
    let previous = history[0];
    let next = null;

    for (let index = 1; index < history.length; index += 1) {
      if (history[index].receivedAt >= renderAt) {
        next = history[index];
        break;
      }
      previous = history[index];
    }

    let targetX = previous.x;
    let targetZ = previous.z;
    let targetFacing = previous.facing;
    let targetSpeed = Math.hypot(previous.vx || 0, previous.vz || 0);

    if (next) {
      const span = Math.max(1, next.receivedAt - previous.receivedAt);
      const amount = THREE.MathUtils.clamp(
        (renderAt - previous.receivedAt) / span,
        0,
        1,
      );
      targetX = THREE.MathUtils.lerp(previous.x, next.x, amount);
      targetZ = THREE.MathUtils.lerp(previous.z, next.z, amount);
      targetFacing =
        previous.facing + shortestAngleDelta(next.facing, previous.facing) * amount;
      targetSpeed = Math.hypot(next.vx || 0, next.vz || 0);
    } else {
      const extrapolateSeconds =
        Math.min(
          REMOTE_PLAYER_MAX_EXTRAPOLATION_MS,
          Math.max(0, renderAt - previous.receivedAt),
        ) / 1000;
      targetX += (previous.vx || 0) * extrapolateSeconds;
      targetZ += (previous.vz || 0) * extrapolateSeconds;
    }

    const target = renderTargetRef.current;
    target.set(targetX, 0, targetZ);
    const surfaceY = buildSurfaceHeightAt(target.x, target.z, buildings);
    const distanceSq =
      (root.position.x - target.x) ** 2 + (root.position.z - target.z) ** 2;

    if (distanceSq > 700 * 700) {
      root.position.set(target.x, surfaceY, target.z);
    } else {
      const alpha = 1 - Math.exp(-REMOTE_PLAYER_POSITION_DAMPING * delta);
      root.position.x = THREE.MathUtils.lerp(root.position.x, target.x, alpha);
      root.position.z = THREE.MathUtils.lerp(root.position.z, target.z, alpha);
      root.position.y = THREE.MathUtils.damp(root.position.y, surfaceY, 24, delta);
    }

    root.rotation.y = dampAngle(
      root.rotation.y,
      targetFacing || 0,
      REMOTE_PLAYER_ROTATION_DAMPING,
      delta,
    );
    const movingByState = player.movementState !== 'idle';
    isMovingRef.current = movingByState || targetSpeed > 12 || distanceSq > 8 * 8;
    isRunningRef.current = player.movementState === 'running';
    attackableEntryRef.current.position.copy(root.position);
  });

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    const root = playerRef.current;
    onAttack?.(root?.position.x ?? player.x, root?.position.z ?? player.z, {
      targetId: player.id,
    });
  };

  return (
    <PlayerAvatar
      attackRequestRef={attackRequestRef}
      attackTimingRef={attackTimingRef}
      cursorLookRef={cursorLookRef}
      equipment={playerEquipment}
      equippedWeaponId={playerWeaponId}
      headLookOverrideRef={headLookOverrideRef}
      isBlockingRef={isBlockingRef}
      isDeadRef={isDeadRef}
      isMovingRef={isMovingRef}
      isRunningRef={isRunningRef}
      playerRef={playerRef}
      torchEquipped={playerEquipment.offhand === 'torch'}
      toolStateRef={toolStateRef}
    >
      <mesh onPointerDown={handlePointerDown} position={[0, 58, 0]}>
        <boxGeometry args={[64, 116, 64]} />
        <meshBasicMaterial transparent opacity={0.001} depthWrite={false} />
      </mesh>
      <RemotePlayerNameplate player={player} />
    </PlayerAvatar>
  );
}

function RemotePlayers({ attackableRegistryRef, buildings, onAttack, players, visibleWindow }) {
  const visiblePlayers = useMemo(
    () =>
      players.filter((player) =>
        isPointVisibleInWindow(player.x, player.z, visibleWindow, 620),
      ),
    [players, visibleWindow],
  );

  return (
    <>
      {visiblePlayers.map((player) => (
        <RemotePlayerAvatar
          attackableRegistryRef={attackableRegistryRef}
          buildings={buildings}
          key={player.id}
          onAttack={onAttack}
          player={player}
        />
      ))}
    </>
  );
}

function DestinationRing({ ringRef }) {
  useFrame(({ clock }) => {
    if (!ringRef.current || !ringRef.current.visible) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 8) * 0.06;
    ringRef.current.scale.setScalar(pulse);
  });

  return (
    <group ref={ringRef} visible={false} position={[0, 3, 0]}>
      <mesh rotation-x={-Math.PI / 2}>
        <torusGeometry args={[28, 2.4, 8, 36]} />
        <meshBasicMaterial color='#f1ff9c' transparent opacity={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <circleGeometry args={[18, 28]} />
        <meshBasicMaterial color='#f1ff9c' transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

function CombatFloater({ item, playerRef }) {
  const rootRef = useRef(null);

  useFrame(() => {
    if (item.follow !== 'player' || !rootRef.current || !playerRef.current) return;
    const playerPosition = playerRef.current.position;
    const rotation = playerRef.current.rotation.y || 0;
    const offset = item.offset || {};
    const side = Number(offset.side) || 0;
    const forward = Number(offset.forward) || 0;
    const sideAngle = rotation + Math.PI / 2;
    rootRef.current.position.set(
      playerPosition.x + Math.sin(sideAngle) * side + Math.sin(rotation) * forward,
      playerPosition.y + (Number(offset.y) || 0),
      playerPosition.z + Math.cos(sideAngle) * side + Math.cos(rotation) * forward,
    );
  });

  return (
    <group ref={rootRef} position={item.position}>
      <Html
        center
        distanceFactor={560}
        zIndexRange={[100, 0]}
      >
        <div className={`combat-floater is-${item.kind}`}>{item.text}</div>
      </Html>
    </group>
  );
}

function CombatFloaters({ items, playerRef }) {
  return items.map((item) => (
    <CombatFloater item={item} key={item.id} playerRef={playerRef} />
  ));
}

function Creature({
  attackableRegistryRef,
  combatState,
  creature,
  index,
  onAttack,
}) {
  const root = useRef(null);
  const mixerRef = useRef(null);
  const attackableEntryRef = useRef({
    id: creature.id,
    type: 'creature',
    name: creature.name,
    radius: creature.hitRadius,
    position: new THREE.Vector3(),
  });
  const { animations, scene } = useGLTF(creature.url);
  const creatureScene = useMemo(() => cloneSkeleton(scene), [scene]);

  useMemo(() => {
    enableShadows(creatureScene, DETAILED_MODEL_SHADOW_OPTIONS);
  }, [creatureScene]);

  useEffect(() => {
    if (!animations.length) return undefined;

    const clip =
      animations.find((animation) => animation.name === creature.animation) ??
      animations.find((animation) => animation.name === 'Idle') ??
      animations[0];
    const mixer = new THREE.AnimationMixer(creatureScene);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat);
    action.play();
    mixerRef.current = mixer;

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(creatureScene);
      mixerRef.current = null;
    };
  }, [animations, creature.animation, creatureScene]);

  useEffect(() => {
    const entry = attackableEntryRef.current;
    attackableRegistryRef.current.set(creature.id, entry);
    return () => {
      attackableRegistryRef.current.delete(creature.id);
    };
  }, [attackableRegistryRef, creature.id]);

  useFrame(({ clock }, delta) => {
    if (!root.current) return;
    const defeated = isCreatureStateDefeated(combatState);
    root.current.visible = !defeated;
    attackableEntryRef.current.defeated = defeated;
    attackableEntryRef.current.hp = combatState.hp;
    attackableEntryRef.current.maxHp = combatState.maxHp;
    if (defeated) return;

    mixerRef.current?.update(delta);
    const t = getSharedWorldTimeSeconds() * (0.42 + index * 0.03);
    const orbit = creature.drift;
    root.current.position.x =
      creature.position[0] + Math.cos(t + index) * orbit;
    root.current.position.z =
      creature.position[2] + Math.sin(t * 0.9 + index) * orbit * 0.58;
    root.current.position.y =
      creature.position[1] +
      getTerrainHeight(root.current.position.x, root.current.position.z);
    root.current.rotation.y = Math.atan2(
      Math.cos(t * 0.9 + index),
      -Math.sin(t + index),
    );
    attackableEntryRef.current.position.copy(root.current.position);
  });

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    onAttack(event.point.x, event.point.z);
  };

  const showHealth = combatState.hp < combatState.maxHp;
  const hitRecently = combatState.hitUntil > Date.now();
  const hpPct = THREE.MathUtils.clamp(
    combatState.hp / Math.max(1, combatState.maxHp),
    0,
    1,
  );

  return (
    <group
      onPointerDown={handlePointerDown}
      ref={root}
      position={positionOnTerrain(creature.position)}
      scale={creature.scale}
    >
      <primitive object={creatureScene} />
      <mesh position={[0, 0.034, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.42, 24]} />
        <meshBasicMaterial
          color={hitRecently ? '#fff0a6' : creature.tint}
          transparent
          opacity={hitRecently ? 0.28 : 0.12}
          depthWrite={false}
        />
      </mesh>
      {showHealth && (
        <Html center distanceFactor={20} position={[0, 2.5, 0]}>
          <div
            style={{
              background: 'rgba(18, 27, 23, 0.72)',
              border: '1px solid rgba(250, 255, 232, 0.32)',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(0, 0, 0, 0.22)',
              minWidth: 86,
              padding: '5px 7px 6px',
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                color: '#fbffe9',
                font: '700 10px Inter, system-ui, sans-serif',
                lineHeight: 1,
                marginBottom: 5,
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {creature.name}
            </div>
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.15)',
                borderRadius: 999,
                height: 6,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  background: hpPct > 0.35 ? '#dff48d' : '#ffb06e',
                  height: '100%',
                  width: `${Math.round(hpPct * 100)}%`,
                }}
              />
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Creatures({
  attackableRegistryRef,
  creatureStates,
  onAttack,
  visibleWindow,
}) {
  return CREATURES.filter((creature) =>
    isPointVisibleInWindow(
      creature.position[0],
      creature.position[2],
      visibleWindow,
      creature.drift + 420,
    ),
  ).map((creature, index) => (
    <Creature
      attackableRegistryRef={attackableRegistryRef}
      combatState={creatureCombatStateFor(creature, creatureStates)}
      creature={creature}
      index={index}
      key={creature.id}
      onAttack={onAttack}
    />
  ));
}

function AnimatedDoorPanel({ building, piece, playerRef, preview }) {
  const hingeRef = useRef(null);
  const openAmountRef = useRef(0);
  const openSignRef = useRef(1);
  const previousLocalZRef = useRef(null);
  const wasNearDoorRef = useRef(false);
  const doorWidth = Math.min(70, piece.w * 0.48);
  const doorHeight = BUILD_WALL_HEIGHT - 30;
  const panelThickness = 4;
  const hingeX = -doorWidth / 2;

  useFrame((_, delta) => {
    if (!hingeRef.current || preview) return;
    const playerPosition = playerRef?.current?.position;
    if (!playerPosition) return;

    const dx = playerPosition.x - building.x;
    const dz = playerPosition.z - building.z;
    const rotation = -(building.rot || 0) * (Math.PI / 2);
    const localX = Math.cos(-rotation) * dx - Math.sin(-rotation) * dz;
    const localZ = Math.sin(-rotation) * dx + Math.cos(-rotation) * dz;
    const previousLocalZ = previousLocalZRef.current;
    const localVelocityZ = previousLocalZ == null ? 0 : localZ - previousLocalZ;
    const nearDoor =
      Math.abs(localX) < doorWidth * 0.8 &&
      Math.abs(localZ) < piece.h * 2.6 &&
      Math.hypot(localX, localZ) < 125;

    if (nearDoor && !wasNearDoorRef.current) {
      if (Math.abs(localVelocityZ) > 0.05) {
        openSignRef.current = localVelocityZ > 0 ? -1 : 1;
      } else if (Math.abs(localZ) > 1) {
        openSignRef.current = localZ > 0 ? -1 : 1;
      }
    }
    const targetOpen = nearDoor ? 1 : 0;
    openAmountRef.current = THREE.MathUtils.damp(
      openAmountRef.current,
      targetOpen,
      8,
      delta,
    );
    hingeRef.current.rotation.y =
      openSignRef.current * openAmountRef.current * Math.PI * 0.58;
    previousLocalZRef.current = localZ;
    wasNearDoorRef.current = nearDoor;
  });

  return (
    <group ref={hingeRef} position={[hingeX, doorHeight / 2, 0]}>
      <mesh
        position={[doorWidth / 2, 0, 0]}
        castShadow={!preview}
        receiveShadow={false}
      >
        <boxGeometry args={[doorWidth, doorHeight, panelThickness]} />
        <meshStandardMaterial
          color='#3b281c'
          roughness={0.86}
          transparent={preview}
          opacity={preview ? 0.34 : 0.86}
        />
      </mesh>
      <mesh
        position={[doorWidth / 2, doorHeight * 0.16, -panelThickness / 2 - 0.6]}
      >
        <sphereGeometry args={[3, 8, 6]} />
        <meshStandardMaterial
          color='#d9bd74'
          roughness={0.5}
          transparent={preview}
          opacity={preview ? 0.4 : 1}
        />
      </mesh>
      <mesh
        position={[doorWidth / 2, doorHeight * 0.16, panelThickness / 2 + 0.6]}
      >
        <sphereGeometry args={[3, 8, 6]} />
        <meshStandardMaterial
          color='#d9bd74'
          roughness={0.5}
          transparent={preview}
          opacity={preview ? 0.4 : 1}
        />
      </mesh>
    </group>
  );
}

function wallDepthBiasProps(building, preview) {
  if (preview || (building?.rot || 0) % 2 === 0) return {};
  return {
    polygonOffset: true,
    polygonOffsetFactor: -0.75,
    polygonOffsetUnits: -0.75,
  };
}

function createBoxGeometryWithoutFaces(width, height, depth, hiddenFaces = {}) {
  const hx = width / 2;
  const hy = height / 2;
  const hz = depth / 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const pushFace = (key, normal, corners) => {
    if (hiddenFaces[key]) return;
    const offset = positions.length / 3;
    for (const corner of corners) {
      positions.push(corner[0], corner[1], corner[2]);
      normals.push(normal[0], normal[1], normal[2]);
    }
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };

  pushFace('px', [1, 0, 0], [
    [hx, -hy, hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [hx, hy, hz],
  ]);
  pushFace('nx', [-1, 0, 0], [
    [-hx, -hy, -hz],
    [-hx, -hy, hz],
    [-hx, hy, hz],
    [-hx, hy, -hz],
  ]);
  pushFace('py', [0, 1, 0], [
    [-hx, hy, hz],
    [hx, hy, hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
  ]);
  pushFace('ny', [0, -1, 0], [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, -hy, hz],
    [-hx, -hy, hz],
  ]);
  pushFace('pz', [0, 0, 1], [
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ]);
  pushFace('nz', [0, 0, -1], [
    [hx, -hy, -hz],
    [-hx, -hy, -hz],
    [-hx, hy, -hz],
    [hx, hy, -hz],
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function BoxGeometryWithoutFaces({ args, hiddenFaces }) {
  const hiddenKey = ['px', 'nx', 'py', 'ny', 'pz', 'nz']
    .filter((face) => hiddenFaces?.[face])
    .join(',');
  const geometry = useMemo(
    () => createBoxGeometryWithoutFaces(args[0], args[1], args[2], hiddenFaces),
    [args, hiddenFaces, hiddenKey],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  return <primitive attach='geometry' object={geometry} />;
}

function DoorBuilding({
  building,
  color,
  onPointerDown,
  piece,
  playerRef,
  preview,
  hiddenFaces,
}) {
  const doorWidth = Math.min(70, piece.w * 0.48);
  const sideWidth = Math.max(12, (piece.w - doorWidth) / 2);
  const lintelHeight = 24;
  const openingHeight = BUILD_WALL_HEIGHT - lintelHeight;
  const materialProps = {
    color,
    roughness: 0.78,
    transparent: preview,
    opacity: preview ? 0.54 : 1,
    depthWrite: !preview,
    ...wallDepthBiasProps(building, preview),
  };

  return (
    <group onPointerDown={onPointerDown}>
      <mesh
        position={[-doorWidth / 2 - sideWidth / 2, BUILD_WALL_HEIGHT / 2, 0]}
        castShadow={!preview}
        receiveShadow={false}
      >
        <BoxGeometryWithoutFaces
          args={[sideWidth, BUILD_WALL_HEIGHT, piece.h]}
          hiddenFaces={hiddenFaces}
        />
        <meshStandardMaterial {...materialProps} />
      </mesh>
      <mesh
        position={[doorWidth / 2 + sideWidth / 2, BUILD_WALL_HEIGHT / 2, 0]}
        castShadow={!preview}
        receiveShadow={false}
      >
        <BoxGeometryWithoutFaces
          args={[sideWidth, BUILD_WALL_HEIGHT, piece.h]}
          hiddenFaces={hiddenFaces}
        />
        <meshStandardMaterial {...materialProps} />
      </mesh>
      <mesh
        position={[0, openingHeight + lintelHeight / 2, 0]}
        castShadow={!preview}
        receiveShadow={false}
      >
        <BoxGeometryWithoutFaces
          args={[doorWidth, lintelHeight, piece.h]}
          hiddenFaces={hiddenFaces}
        />
        <meshStandardMaterial {...materialProps} />
      </mesh>
      <mesh position={[0, BUILD_WALL_HEIGHT - 1, -piece.h / 2 - 0.4]}>
        <boxGeometry args={[piece.w - 8, 5, 2]} />
        <meshBasicMaterial
          color='#fff6d0'
          transparent
          opacity={preview ? 0.16 : 0.18}
          {...BUILD_DECAL_MATERIAL_PROPS}
        />
      </mesh>
      <AnimatedDoorPanel
        building={building}
        piece={piece}
        playerRef={playerRef}
        preview={preview}
      />
    </group>
  );
}

function BuildingMesh({
  allBuildings,
  building,
  onDestroy,
  playerRef,
  preview = false,
  valid = true,
}) {
  const piece =
    buildPieces.find((item) => item.id === building.type) || buildPieces[0];
  const color = preview && !valid ? '#d16f6f' : building.color || piece.color;
  const opacity = preview ? 0.54 : 1;
  const groupRotation =
    piece.id === 'foundation' || piece.id === 'roof'
      ? 0
      : -(building.rot || 0) * (Math.PI / 2);
  const level = buildingLevel(building);
  const terrainY = getTerrainHeight(building.x, building.z);
  const wallY = level * BUILD_STACK_HEIGHT;
  const wallFaceOffsets = [-piece.h / 2 - 1.2, piece.h / 2 + 1.2];
  const hiddenFaces = useMemo(
    () =>
      !preview && isWallSupportBuilding(building)
        ? hiddenWallJointFaces(building, allBuildings)
        : {},
    [allBuildings, building, preview],
  );
  const wallMaterialProps = {
    color,
    roughness: 0.78,
    transparent: preview,
    opacity,
    depthWrite: !preview,
    ...wallDepthBiasProps(building, preview),
  };
  const handlePointerDown = (event) => {
    if (!onDestroy || event.button !== 0) return;
    event.stopPropagation();
    onDestroy(building.id);
  };

  if (piece.id === 'foundation') {
    return (
      <group
        position={[building.x, terrainY, building.z]}
        onPointerDown={handlePointerDown}
      >
        <mesh position={[0, 3, 0]} castShadow={!preview} receiveShadow>
          <boxGeometry args={[building.w, 6, building.h]} />
          <meshStandardMaterial
            color={color}
            roughness={0.82}
            transparent={preview}
            opacity={opacity}
            depthWrite={!preview}
          />
        </mesh>
        <mesh position={[0, 6.4, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[building.w * 0.82, building.h * 0.82]} />
          <meshBasicMaterial
            color={preview && !valid ? '#ffb0a4' : '#fff6d0'}
            transparent
            opacity={preview ? 0.18 : 0.1}
            {...BUILD_DECAL_MATERIAL_PROPS}
          />
        </mesh>
      </group>
    );
  }

  if (piece.id === 'roof') {
    return (
      <group
        position={[building.x, terrainY + wallY, building.z]}
        onPointerDown={handlePointerDown}
        userData={{
          playerOccluder: !preview,
          playerOcclusionOpacity: ROOF_INTERIOR_OPACITY,
          roofInteriorFade: !preview,
          roofInteriorBounds: {
            x: building.x,
            z: building.z,
            w: building.w,
            h: building.h,
          },
          roofInteriorLevel: level,
        }}
      >
        <mesh
          position={[0, BUILD_ROOF_THICKNESS / 2, 0]}
          castShadow={!preview}
          receiveShadow={false}
        >
          <boxGeometry args={[building.w, BUILD_ROOF_THICKNESS, building.h]} />
          <meshStandardMaterial
            color={color}
            roughness={0.84}
            transparent={preview}
            opacity={opacity}
            depthWrite={!preview}
          />
        </mesh>
        <mesh
          position={[0, BUILD_ROOF_THICKNESS + 0.45, 0]}
          rotation-x={-Math.PI / 2}
        >
          <planeGeometry args={[building.w * 0.86, building.h * 0.86]} />
          <meshBasicMaterial
            color={preview && !valid ? '#ffb0a4' : '#f4d59d'}
            transparent
            opacity={preview ? 0.16 : 0.16}
            {...BUILD_DECAL_MATERIAL_PROPS}
          />
        </mesh>
        <mesh position={[0, BUILD_ROOF_THICKNESS + 1, -building.h / 2 + 6]}>
          <boxGeometry args={[building.w - 18, 4, 3]} />
          <meshBasicMaterial
            color='#fff1be'
            transparent
            opacity={preview ? 0.14 : 0.18}
            {...BUILD_DECAL_MATERIAL_PROPS}
          />
        </mesh>
      </group>
    );
  }

  return (
    <group
      position={[building.x, terrainY + wallY, building.z]}
      rotation-y={groupRotation}
      onPointerDown={handlePointerDown}
      userData={{ playerOccluder: !preview }}
    >
      {piece.id === 'door' ? (
        <DoorBuilding
          hiddenFaces={hiddenFaces}
          building={building}
          color={color}
          onPointerDown={handlePointerDown}
          piece={piece}
          playerRef={playerRef}
          preview={preview}
        />
      ) : (
        <>
          <mesh
            position={[0, BUILD_WALL_HEIGHT / 2, 0]}
            castShadow={!preview}
            receiveShadow={false}
          >
            <BoxGeometryWithoutFaces
              args={[piece.w, BUILD_WALL_HEIGHT, piece.h]}
              hiddenFaces={hiddenFaces}
            />
            <meshStandardMaterial {...wallMaterialProps} />
          </mesh>
          <mesh position={[0, BUILD_WALL_HEIGHT - 1, -piece.h / 2 - 0.4]}>
            <boxGeometry args={[piece.w - 8, 5, 2]} />
            <meshBasicMaterial
              color='#fff6d0'
              transparent
              opacity={preview ? 0.16 : 0.18}
              {...BUILD_DECAL_MATERIAL_PROPS}
            />
          </mesh>
          {piece.id === 'window'
            ? wallFaceOffsets.map((faceZ) => (
                <mesh
                  key={`window-${faceZ}`}
                  position={[0, BUILD_WALL_HEIGHT / 2 + 18, faceZ]}
                >
                  <boxGeometry args={[58, 42, 2.4]} />
                  <meshStandardMaterial
                    color='#9fe9ff'
                    emissive='#296474'
                    emissiveIntensity={preview ? 0.08 : 0.18}
                    transparent
                    opacity={preview ? 0.28 : 0.72}
                    {...BUILD_DECAL_MATERIAL_PROPS}
                  />
                </mesh>
              ))
            : null}
        </>
      )}
    </group>
  );
}

function BuildingPreview({ preview }) {
  if (!preview) return null;
  const terrainY = getTerrainHeight(preview.x, preview.z);
  const previewPlaneY =
    preview.type === 'roof'
      ? buildingLevel(preview) * BUILD_STACK_HEIGHT +
        BUILD_ROOF_THICKNESS +
        0.55
      : buildingLevel(preview) * BUILD_STACK_HEIGHT + 0.35;
  return (
    <group>
      <BuildingMesh building={preview} preview valid={preview.valid} />
      <mesh
        position={[preview.x, terrainY + previewPlaneY, preview.z]}
        rotation-x={-Math.PI / 2}
      >
        <planeGeometry args={[preview.w, preview.h]} />
        <meshBasicMaterial
          color={preview.valid ? '#ffe27b' : '#ff8876'}
          transparent
          opacity={preview.valid ? 0.16 : 0.22}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function SceneRuntime({
  buildings,
  cameraOffset,
  hydratedPlayerObjectRef,
  isPlayerBlockingRef,
  isPlayerDeadRef,
  isPlayerMovingRef,
  isPlayerRunningRef,
  initialPlayerPosition,
  playerRef,
  playerPositionAppliedRef,
  moveTargetRef,
  resourceStates,
  ringRef,
}) {
  const scratch = useMemo(
    () => ({
      target: new THREE.Vector3(),
      desiredCamera: new THREE.Vector3(),
      followAnchor: new THREE.Vector3(
        initialPlayerPosition.x,
        initialPlayerPosition.y,
        initialPlayerPosition.z,
      ),
      currentCameraOffset: cameraOffset.clone(),
      indoorCameraOffset: getCameraOffset(INDOOR_CAMERA_TUNING),
      lookTarget: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      lastStoreSync: 0,
      lastSyncedPlayer: null,
      lastMovementState: 'idle',
    }),
    [cameraOffset, initialPlayerPosition.x, initialPlayerPosition.y, initialPlayerPosition.z],
  );

	  useFrame(({ camera, clock }, delta) => {
	    if (!playerRef.current) return;
    if (hydratedPlayerObjectRef.current !== playerRef.current) return;
	    if (!playerPositionAppliedRef.current) return;

    scratch.target.set(moveTargetRef.current.x, 0, moveTargetRef.current.z);
    scratch.direction.subVectors(scratch.target, playerRef.current.position);
    scratch.direction.y = 0;

    const distance = scratch.direction.length();
    const isDisabled = Boolean(isPlayerDeadRef?.current);
    if (isDisabled) {
      moveTargetRef.current.copy(playerRef.current.position);
      isPlayerMovingRef.current = false;
      if (ringRef.current?.visible) ringRef.current.visible = false;
    } else if (distance > 5) {
      const speed = isPlayerRunningRef.current
        ? PLAYER_RUN_SPEED
        : PLAYER_WALK_SPEED;
      const step = Math.min(distance, speed * delta);
      scratch.direction.normalize();
      const nextX = playerRef.current.position.x + scratch.direction.x * step;
      const nextZ = playerRef.current.position.z + scratch.direction.z * step;
      const currentX = playerRef.current.position.x;
      const currentZ = playerRef.current.position.z;
      const movement = resolvePlayerMove(
        currentX,
        currentZ,
        nextX,
        nextZ,
        buildings,
        resourceStates,
      );

      playerRef.current.position.x = movement.x;
      playerRef.current.position.z = movement.z;
      isPlayerMovingRef.current = movement.moved;
      if (!movement.moved) {
        moveTargetRef.current.copy(playerRef.current.position);
        if (ringRef.current?.visible) ringRef.current.visible = false;
      }
      playerRef.current.rotation.y = Math.atan2(
        scratch.direction.x,
        scratch.direction.z,
      );
    } else {
      isPlayerMovingRef.current = false;
      if (ringRef.current?.visible) ringRef.current.visible = false;
    }

    const movementState = isPlayerMovingRef.current
      ? isPlayerRunningRef.current
        ? 'running'
        : 'walking'
      : 'idle';
    if (movementState !== scratch.lastMovementState) {
      scratch.lastMovementState = movementState;
      gameRuntimeStore.getState().setLocalPresence({ movementState });
    }

    const targetSurfaceY = buildSurfaceHeightAt(
      playerRef.current.position.x,
      playerRef.current.position.z,
      buildings,
    );
    playerRef.current.position.y = THREE.MathUtils.damp(
      playerRef.current.position.y,
      targetSurfaceY,
      16,
      delta,
    );

    scratch.followAnchor.lerp(
      playerRef.current.position,
      Math.min(1, delta * 4.8),
    );
    const targetCameraOffset = isPlayerInsideBuildInterior(
      buildings,
      playerRef.current.position,
    )
      ? scratch.indoorCameraOffset
      : cameraOffset;
    scratch.currentCameraOffset.lerp(
      targetCameraOffset,
      1 - Math.exp(-INDOOR_CAMERA_DAMPING * delta),
    );
    scratch.lookTarget.copy(scratch.followAnchor).add(CAMERA_LOOK_OFFSET);
    scratch.desiredCamera
      .copy(scratch.followAnchor)
      .add(scratch.currentCameraOffset);
    camera.position.copy(scratch.desiredCamera);
    camera.up.set(0, 1, 0);
    camera.lookAt(scratch.lookTarget);

    const lastSyncedPlayer = scratch.lastSyncedPlayer;
    const movedSinceSync = lastSyncedPlayer
      ? (playerRef.current.position.x - lastSyncedPlayer.x) ** 2 +
          (playerRef.current.position.z - lastSyncedPlayer.z) ** 2 >
        PLAYER_STORE_SYNC_DISTANCE * PLAYER_STORE_SYNC_DISTANCE
      : true;
    const yChangedSinceSync = lastSyncedPlayer
      ? Math.abs(playerRef.current.position.y - lastSyncedPlayer.y) > 1.5
      : true;
    const facingChangedSinceSync = lastSyncedPlayer
      ? Math.abs(
          Math.atan2(
            Math.sin(playerRef.current.rotation.y - lastSyncedPlayer.facing),
            Math.cos(playerRef.current.rotation.y - lastSyncedPlayer.facing),
          ),
        ) > PLAYER_STORE_SYNC_FACING_DELTA
      : true;

    if (
      clock.elapsedTime - scratch.lastStoreSync > PLAYER_STORE_SYNC_INTERVAL &&
      (movedSinceSync || yChangedSinceSync || facingChangedSinceSync)
    ) {
      scratch.lastStoreSync = clock.elapsedTime;
      const playerPosition = {
        x: playerRef.current.position.x,
        y: playerRef.current.position.y,
        z: playerRef.current.position.z,
        facing: playerRef.current.rotation.y,
      };
      scratch.lastSyncedPlayer = playerPosition;
      gameRuntimeStore.getState().setPlayer(playerPosition);
    }
  });

  return null;
}

function PlayerOcclusionFader({ playerRef }) {
  const { camera, scene } = useThree();
  const scratch = useMemo(
    () => ({
      raycaster: new THREE.Raycaster(),
      target: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      playerScreen: new THREE.Vector3(),
      playerViewPosition: new THREE.Vector3(),
      projected: new THREE.Vector3(),
      viewPosition: new THREE.Vector3(),
      box: new THREE.Box3(),
      meshBox: new THREE.Box3(),
      boxCorners: Array.from({ length: 8 }, () => new THREE.Vector3()),
      fadedRoots: new Set(),
      hitRoots: new Set(),
      roofRoots: [],
      roofQueue: [],
      lastCheck: 0,
    }),
    [],
  );

  useEffect(() => {
    const fadedRoots = scratch.fadedRoots;
    return () => {
      for (const root of fadedRoots) restorePlayerOccluder(root);
      fadedRoots.clear();
    };
  }, [scratch]);

  useFrame(({ clock }) => {
    if (clock.elapsedTime - scratch.lastCheck < PLAYER_OCCLUSION_CHECK_INTERVAL)
      return;
    scratch.lastCheck = clock.elapsedTime;

    const player = playerRef.current;
    if (!player) return;

    scratch.target.copy(player.position);
    scratch.target.y += PLAYER_OCCLUSION_TARGET_HEIGHT;
    scratch.playerScreen.copy(scratch.target).project(camera);
    scratch.playerViewPosition
      .copy(scratch.target)
      .applyMatrix4(camera.matrixWorldInverse);
    scratch.direction.subVectors(scratch.target, camera.position);
    const distanceToPlayer = scratch.direction.length();
    if (distanceToPlayer <= 1) return;

    scratch.direction.normalize();
    scratch.raycaster.set(camera.position, scratch.direction);
    scratch.raycaster.near = 0;
    scratch.raycaster.far = Math.max(1, distanceToPlayer - 18);

    scratch.hitRoots.clear();
    scratch.roofRoots.length = 0;
    scene.traverse((object) => {
      if (object.userData?.roofInteriorFade && object.visible) {
        scratch.roofRoots.push(object);
      }
    });
    for (const root of scratch.roofRoots) {
      if (playerIsInsideRoof(root, player.position)) {
        addConnectedRoofRoots(
          root,
          scratch.roofRoots,
          scratch.hitRoots,
          scratch.roofQueue,
        );
      }
    }

    const intersections = scratch.raycaster.intersectObjects(
      scene.children,
      true,
    );
    for (const hit of intersections) {
      if (ignoresPlayerOcclusion(hit.object)) continue;
      const root = getPlayerOccluderRoot(hit.object);
      if (!root || root === player || !root.visible) continue;
      if (
        !occluderScreensPlayer(
          root,
          scratch.playerScreen,
          scratch.playerViewPosition.z,
          camera,
          scratch,
        )
      ) {
        continue;
      }
      scratch.hitRoots.add(root);
    }

    for (const root of scratch.fadedRoots) {
      if (scratch.hitRoots.has(root)) continue;
      restorePlayerOccluder(root);
      scratch.fadedRoots.delete(root);
    }

    for (const root of scratch.hitRoots) {
      fadePlayerOccluder(root);
      scratch.fadedRoots.add(root);
    }
  });

  return null;
}

function playerIsInsideRoof(root, playerPosition) {
  const bounds = root?.userData?.roofInteriorBounds;
  if (!bounds || !playerPosition) return false;
  return isPointInsideRect(
    bounds,
    playerPosition.x,
    playerPosition.z,
    -PLAYER_COLLISION_RADIUS,
  );
}

function addConnectedRoofRoots(startRoot, roofRoots, hitRoots, queue) {
  queue.length = 0;
  queue.push(startRoot);
  hitRoots.add(startRoot);

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    for (const candidate of roofRoots) {
      if (hitRoots.has(candidate)) continue;
      if (!roofsAreInteriorConnected(current, candidate)) continue;
      hitRoots.add(candidate);
      queue.push(candidate);
    }
  }
}

function roofsAreInteriorConnected(a, b) {
  const aBounds = a?.userData?.roofInteriorBounds;
  const bBounds = b?.userData?.roofInteriorBounds;
  if (!aBounds || !bBounds) return false;
  if (
    (a.userData?.roofInteriorLevel ?? 0) !==
    (b.userData?.roofInteriorLevel ?? 0)
  ) {
    return false;
  }
  return (
    rectsOverlap(aBounds, bBounds) ||
    rectsShareEdge(aBounds, bBounds, BUILD_GRID_SIZE / 2)
  );
}

function isWorldDataReady() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.__MOSSVALE_WORLD_DATA_READY__)
  );
}

function setLoadingDetail(text) {
  if (typeof document === 'undefined') return;
  const updateStore = () => gameUiStore.getState().setLoadingDetail(text);
  window.setTimeout(updateStore, 0);
  const loadingScreen = document.getElementById('loadingScreen');
  if (!loadingScreen || loadingScreen.classList.contains('is-error')) return;
  const loadingDetail = document.getElementById('loadingDetail');
  if (loadingDetail) loadingDetail.textContent = text;
}

function setLoadingStep(id, patch) {
  const updateStore = () => gameUiStore.getState().setLoadingStep(id, patch);
  window.setTimeout(updateStore, 0);
}

function disposeMeshResources(object) {
  if (!object) return;
  object.geometry?.dispose?.();
  if (Array.isArray(object.material)) {
    object.material.forEach((material) => material?.dispose?.());
  } else {
    object.material?.dispose?.();
  }
}

function configureWebGlSky(sky, sunPosition) {
  sky.scale.setScalar(SKY_SCALE);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;

  const uniforms = sky.material.uniforms;
  uniforms.turbidity.value = SKY_ATMOSPHERE.turbidity;
  uniforms.rayleigh.value = SKY_ATMOSPHERE.rayleigh;
  uniforms.mieCoefficient.value = SKY_ATMOSPHERE.mieCoefficient;
  uniforms.mieDirectionalG.value = SKY_ATMOSPHERE.mieDirectionalG;
  uniforms.sunPosition.value.copy(sunPosition);
}

function configureSkyMesh(sky, sunPosition) {
  sky.scale.setScalar(SKY_SCALE);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.turbidity.value = SKY_ATMOSPHERE.turbidity;
  sky.rayleigh.value = SKY_ATMOSPHERE.rayleigh;
  sky.mieCoefficient.value = SKY_ATMOSPHERE.mieCoefficient;
  sky.mieDirectionalG.value = SKY_ATMOSPHERE.mieDirectionalG;
  sky.sunPosition.value.copy(sunPosition);

  if (sky.showSunDisc) sky.showSunDisc.value = SKY_ATMOSPHERE.showSunDisc;
}

function isWebGPURenderer(gl) {
  return Boolean(gl?.isWebGPURenderer || gl?.backend?.isWebGPUBackend);
}

function canUseWebGPU() {
  return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

async function canRequestWebGPUAdapter(powerPreference) {
  if (!canUseWebGPU()) return false;

  try {
    return Boolean(await navigator.gpu.requestAdapter({ powerPreference }));
  } catch (error) {
    console.warn(
      'WebGPU adapter request failed. Falling back to WebGL.',
      error,
    );
    return false;
  }
}

async function createThreeRenderer(props, qualityConfig) {
  const powerPreference = 'high-performance';
  const rendererProps = {
    ...props,
    antialias: qualityConfig.antialias,
    powerPreference,
  };

  if (await canRequestWebGPUAdapter(powerPreference)) {
    try {
      const renderer = new THREE.WebGPURenderer(rendererProps);
      await renderer.init();
      return renderer;
    } catch (error) {
      console.warn(
        'WebGPU renderer initialization failed. Falling back to WebGL.',
        error,
      );
    }
  }

  return new WebGLRenderer(rendererProps);
}

function skipRaycast() {
  return null;
}

function getSharedWorldTimeSeconds() {
  return (Date.now() - WORLD_TIME_EPOCH_MS) / 1000;
}

function getNightCycleAmount(elapsedTime) {
  const totalSeconds =
    DAY_NIGHT_CYCLE.daySeconds + DAY_NIGHT_CYCLE.nightSeconds;
  const progress = (elapsedTime % totalSeconds) / totalSeconds;
  return (1 - Math.cos(progress * Math.PI * 2)) / 2;
}

function mixCycleValue(dayValue, nightValue, nightAmount) {
  return THREE.MathUtils.lerp(dayValue, nightValue, nightAmount);
}

function getFogDistance(baseDistance, intensity) {
  return baseDistance / Math.max(0.5, intensity);
}

function getCycleSunOffset(target, nightAmount) {
  return target.lerpVectors(
    SUN_SHADOW_OFFSET,
    NIGHT_SUN_SHADOW_OFFSET,
    nightAmount,
  );
}

function WebGlSky() {
  const sky = useMemo(() => new Sky(), []);
  const scratch = useMemo(() => ({ sunPosition: new THREE.Vector3() }), []);

  useEffect(() => {
    const sunPosition = getCycleSunOffset(scratch.sunPosition, 0).normalize();
    configureWebGlSky(sky, sunPosition);
  }, [scratch, sky]);

  useFrame(({ clock }) => {
    const sunPosition = getCycleSunOffset(
      scratch.sunPosition,
      getNightCycleAmount(getSharedWorldTimeSeconds()),
    ).normalize();
    sky.material.uniforms.sunPosition.value.copy(sunPosition);
  });

  useEffect(() => () => disposeMeshResources(sky), [sky]);

  return <primitive object={sky} />;
}

function SkyMeshAtmosphere() {
  const [sky, setSky] = useState(null);
  const scratch = useMemo(() => ({ sunPosition: new THREE.Vector3() }), []);

  useEffect(() => {
    let disposed = false;
    let skyMesh = null;

    import('three/addons/objects/SkyMesh.js').then(({ SkyMesh }) => {
      if (disposed) return;
      skyMesh = new SkyMesh();
      const sunPosition = getCycleSunOffset(scratch.sunPosition, 0).normalize();
      configureSkyMesh(skyMesh, sunPosition);
      setSky(skyMesh);
    });

    return () => {
      disposed = true;
      disposeMeshResources(skyMesh);
    };
  }, [scratch]);

  useFrame(({ clock }) => {
    const sunPosition = getCycleSunOffset(
      scratch.sunPosition,
      getNightCycleAmount(getSharedWorldTimeSeconds()),
    ).normalize();
    sky?.sunPosition?.value?.copy(sunPosition);

    const timeUniform = sky?.material?.uniforms?.time;
    if (timeUniform) timeUniform.value = clock.elapsedTime;
  });

  return sky ? <primitive object={sky} /> : null;
}

function AtmosphericSky() {
  const { gl } = useThree();
  const shouldUseSkyMesh = isWebGPURenderer(gl);

  return shouldUseSkyMesh ? <SkyMeshAtmosphere /> : <WebGlSky />;
}

function SceneEnvironmentCycle({ settings }) {
  const { gl, scene } = useThree();
  const colors = useMemo(
    () => ({
      backgroundDay: new THREE.Color(SCENE_LIGHTING.backgroundColor),
      backgroundNight: new THREE.Color(DAY_NIGHT_CYCLE.backgroundColor),
      fogDay: new THREE.Color(SCENE_LIGHTING.fogColor),
      fogNight: new THREE.Color(DAY_NIGHT_CYCLE.fogColor),
    }),
    [],
  );

  useFrame(({ clock }) => {
    const nightAmount = getNightCycleAmount(getSharedWorldTimeSeconds());

    if (!scene.background?.isColor) {
      scene.background = new THREE.Color(SCENE_LIGHTING.backgroundColor);
    }
    scene.background.lerpColors(
      colors.backgroundDay,
      colors.backgroundNight,
      nightAmount,
    );

    if (!settings.fogEnabled) {
      scene.fog = null;
      gl.toneMappingExposure = mixCycleValue(
        SCENE_LIGHTING.toneMappingExposure,
        DAY_NIGHT_CYCLE.toneMappingExposure,
        nightAmount,
      );
      return;
    }

    if (!scene.fog) {
      scene.fog = new THREE.Fog(
        SCENE_LIGHTING.fogColor,
        getFogDistance(SCENE_LIGHTING.fogNear, settings.fogIntensity),
        getFogDistance(SCENE_LIGHTING.fogFar, settings.fogIntensity),
      );
    }
    scene.fog.color.lerpColors(colors.fogDay, colors.fogNight, nightAmount);
    scene.fog.near = getFogDistance(
      mixCycleValue(
        SCENE_LIGHTING.fogNear,
        DAY_NIGHT_CYCLE.fogNear,
        nightAmount,
      ),
      settings.fogIntensity,
    );
    scene.fog.far = getFogDistance(
      mixCycleValue(
        SCENE_LIGHTING.fogFar,
        DAY_NIGHT_CYCLE.fogFar,
        nightAmount,
      ),
      settings.fogIntensity,
    );
    gl.toneMappingExposure = mixCycleValue(
      SCENE_LIGHTING.toneMappingExposure,
      DAY_NIGHT_CYCLE.toneMappingExposure,
      nightAmount,
    );
  });

  return null;
}

function WebGlOnlyContactShadows({ qualityConfig }) {
  const { gl } = useThree();

  if (isWebGPURenderer(gl)) return null;

  return (
    <ContactShadows
      position={[0, 0.08, 0]}
      opacity={qualityConfig.contactShadow.opacity}
      scale={[WORLD_SIZE.width, WORLD_SIZE.height]}
      blur={qualityConfig.contactShadow.blur}
      far={qualityConfig.contactShadow.far}
      frames={1}
      resolution={qualityConfig.contactShadow.resolution}
      color={SCENE_LIGHTING.contactShadowColor}
    />
  );
}

function snapShadowAnchorToTexel(anchor, shadowMapSize) {
  const texelSize = (SUN_SHADOW_CAMERA.halfWidth * 2) / shadowMapSize;
  anchor.x = Math.round(anchor.x / texelSize) * texelSize;
  anchor.z = Math.round(anchor.z / texelSize) * texelSize;
  return anchor;
}

function FollowSunLight({ playerRef, qualityConfig, settings }) {
  const lightRef = useRef(null);
  const { scene } = useThree();
  const scratch = useMemo(
    () => ({
      anchor: new THREE.Vector3(),
      snappedAnchor: new THREE.Vector3(),
      target: new THREE.Vector3(),
      desiredLightPosition: new THREE.Vector3(),
      sunOffset: new THREE.Vector3(),
      dayColor: new THREE.Color(SCENE_LIGHTING.sunColor),
      nightColor: new THREE.Color(DAY_NIGHT_CYCLE.sunColor),
    }),
    [],
  );

  useEffect(() => {
    const light = lightRef.current;
    if (!light) return undefined;

    scene.add(light.target);
    const camera = light.shadow.camera;
    camera.left = -SUN_SHADOW_CAMERA.halfWidth;
    camera.right = SUN_SHADOW_CAMERA.halfWidth;
    camera.top = SUN_SHADOW_CAMERA.halfHeight;
    camera.bottom = -SUN_SHADOW_CAMERA.halfHeight;
    camera.near = SUN_SHADOW_CAMERA.near;
    camera.far = SUN_SHADOW_CAMERA.far;
    camera.updateProjectionMatrix();
    light.shadow.blurSamples = SUN_SHADOW_CAMERA.blurSamples;

    return () => {
      scene.remove(light.target);
    };
  }, [scene]);

  useFrame((_, delta) => {
    const light = lightRef.current;
    if (!light) return;
    const nightAmount = getNightCycleAmount(getSharedWorldTimeSeconds());

    const playerPosition = playerRef.current?.position;
    if (playerPosition) {
      scratch.target.set(playerPosition.x, 0, playerPosition.z);
    } else {
      scratch.target.set(0, 0, 0);
    }
    scratch.anchor.lerp(scratch.target, Math.min(1, delta * 5));
    scratch.snappedAnchor.copy(scratch.anchor);
    snapShadowAnchorToTexel(
      scratch.snappedAnchor,
      qualityConfig.shadowMapSize,
    );
    scratch.desiredLightPosition
      .copy(scratch.snappedAnchor)
      .add(getCycleSunOffset(scratch.sunOffset, nightAmount));
    light.position.copy(scratch.desiredLightPosition);
    light.target.position.copy(scratch.snappedAnchor);
    light.target.updateMatrixWorld();
    light.color.lerpColors(scratch.dayColor, scratch.nightColor, nightAmount);
    light.intensity = mixCycleValue(
      SCENE_LIGHTING.sunIntensity,
      DAY_NIGHT_CYCLE.sunIntensity,
      nightAmount,
    );
  });

  return (
    <directionalLight
      ref={lightRef}
      castShadow={settings.mainShadows}
      color={SCENE_LIGHTING.sunColor}
      intensity={SCENE_LIGHTING.sunIntensity}
      shadow-bias={SUN_SHADOW_CAMERA.bias}
      shadow-normalBias={SUN_SHADOW_CAMERA.normalBias}
      shadow-radius={SUN_SHADOW_CAMERA.radius}
      shadow-mapSize={[
        qualityConfig.shadowMapSize,
        qualityConfig.shadowMapSize,
      ]}
    />
  );
}

function SceneLightingRig({ playerRef, qualityConfig, settings }) {
  const ambientRef = useRef(null);
  const hemisphereRef = useRef(null);
  const pointRef = useRef(null);
  const spotRef = useRef(null);
  const rectRef = useRef(null);
  const { scene } = useThree();
  const colors = useMemo(
    () => ({
      ambientDay: new THREE.Color(SCENE_LIGHTING.ambientColor),
      ambientNight: new THREE.Color(DAY_NIGHT_CYCLE.ambientColor),
      hemisphereSkyDay: new THREE.Color(SCENE_LIGHTING.hemisphereSky),
      hemisphereSkyNight: new THREE.Color(DAY_NIGHT_CYCLE.hemisphereSky),
      hemisphereGroundDay: new THREE.Color(SCENE_LIGHTING.hemisphereGround),
      hemisphereGroundNight: new THREE.Color(DAY_NIGHT_CYCLE.hemisphereGround),
    }),
    [],
  );

  useEffect(() => {
    const spot = spotRef.current;
    if (!spot) return undefined;

    spot.target.position.set(180, 0, 120);
    scene.add(spot.target);

    return () => {
      scene.remove(spot.target);
    };
  }, [scene]);

  useEffect(() => {
    rectRef.current?.lookAt(70, 22, 105);
  }, []);

  useFrame(({ clock }) => {
    const nightAmount = getNightCycleAmount(getSharedWorldTimeSeconds());

    if (ambientRef.current) {
      ambientRef.current.color.lerpColors(
        colors.ambientDay,
        colors.ambientNight,
        nightAmount,
      );
      ambientRef.current.intensity = mixCycleValue(
        SCENE_LIGHTING.ambientIntensity,
        DAY_NIGHT_CYCLE.ambientIntensity,
        nightAmount,
      );
    }

    if (hemisphereRef.current) {
      hemisphereRef.current.color.lerpColors(
        colors.hemisphereSkyDay,
        colors.hemisphereSkyNight,
        nightAmount,
      );
      hemisphereRef.current.groundColor.lerpColors(
        colors.hemisphereGroundDay,
        colors.hemisphereGroundNight,
        nightAmount,
      );
      hemisphereRef.current.intensity = mixCycleValue(
        SCENE_LIGHTING.hemisphereIntensity,
        DAY_NIGHT_CYCLE.hemisphereIntensity,
        nightAmount,
      );
    }

    if (pointRef.current) {
      pointRef.current.intensity = mixCycleValue(
        SCENE_LIGHTING.pointIntensity,
        DAY_NIGHT_CYCLE.pointIntensity,
        nightAmount,
      );
    }

    if (spotRef.current) {
      spotRef.current.intensity = mixCycleValue(
        SCENE_LIGHTING.spotIntensity,
        DAY_NIGHT_CYCLE.spotIntensity,
        nightAmount,
      );
    }

    if (rectRef.current) {
      rectRef.current.intensity = mixCycleValue(
        SCENE_LIGHTING.rectIntensity,
        DAY_NIGHT_CYCLE.rectIntensity,
        nightAmount,
      );
    }
  });

  return (
    <>
      <ambientLight
        ref={ambientRef}
        color={SCENE_LIGHTING.ambientColor}
        intensity={SCENE_LIGHTING.ambientIntensity}
      />
      <hemisphereLight
        ref={hemisphereRef}
        args={[
          SCENE_LIGHTING.hemisphereSky,
          SCENE_LIGHTING.hemisphereGround,
          SCENE_LIGHTING.hemisphereIntensity,
        ]}
      />
      <FollowSunLight
        playerRef={playerRef}
        qualityConfig={qualityConfig}
        settings={settings}
      />
      <pointLight
        ref={pointRef}
        color={SCENE_LIGHTING.pointColor}
        decay={SCENE_LIGHTING.pointDecay}
        distance={SCENE_LIGHTING.pointDistance}
        intensity={SCENE_LIGHTING.pointIntensity}
        position={[120, 150, 150]}
      />
      <spotLight
        ref={spotRef}
        angle={SCENE_LIGHTING.spotAngle}
        color={SCENE_LIGHTING.spotColor}
        decay={SCENE_LIGHTING.spotDecay}
        distance={SCENE_LIGHTING.spotDistance}
        intensity={SCENE_LIGHTING.spotIntensity}
        penumbra={SCENE_LIGHTING.spotPenumbra}
        position={[-420, 520, 650]}
      />
      <rectAreaLight
        ref={rectRef}
        args={[
          SCENE_LIGHTING.rectColor,
          SCENE_LIGHTING.rectIntensity,
          SCENE_LIGHTING.rectWidth,
          SCENE_LIGHTING.rectHeight,
        ]}
        position={[330, 185, 360]}
      />
    </>
  );
}

function SceneContent({ cameraOffset, qualityConfig, settings }) {
  const inputReady = useGameUiStore((state) => state.loadingHidden);
  const buildOpen = useGameUiStore((state) => state.buildOpen);
  const buildRotation = useGameUiStore((state) => state.buildRotation);
  const buildings = useGameUiStore((state) => state.buildings);
  const equipment = useGameUiStore((state) => state.equipment);
  const cloudResourceStates = useGameUiStore(
    (state) => state.cloudResourceStates,
  );
  const torchEquipped = equipment.offhand === 'torch';
  const equippedWeaponId = equipment.weapon;
  const equippedWeapon =
    weaponDefs.find((weapon) => weapon.id === equippedWeaponId) ||
    weaponDefs.find((weapon) => weapon.id === 'stick') ||
    weaponDefs[0];
  const playerHealth = useGameUiStore((state) => state.health.current);
  const playerDead = playerHealth <= 0;
  const [combatFloaters, setCombatFloaters] = useState([]);
  const remotePlayers = useGameRuntimeStore((state) => state.remotePlayers);
  const inventoryWood = useGameUiStore((state) => state.inventory.wood || 0);
  const selectedBuildIndex = useGameUiStore(
    (state) => state.selectedBuildIndex,
  );
  const currentBuildPiece = buildPieces[selectedBuildIndex] || buildPieces[0];
  const initialPlayerPosition = useMemo(() => {
    const player = gameRuntimeStore.getState().player;
    return {
      x: Number(player.x) || 0,
      y: Number(player.y) || 0,
      z: Number(player.z) || 0,
      facing: Number(player.facing) || 0,
    };
  }, []);
  const playerRef = useRef(null);
  const isPlayerMovingRef = useRef(false);
  const isPlayerRunningRef = useRef(false);
  const isPlayerBlockingRef = useRef(false);
  const isPlayerDeadRef = useRef(playerDead);
  const previousPlayerHealthRef = useRef(playerHealth);
  const moveTargetRef = useRef(
    new THREE.Vector3(initialPlayerPosition.x, 0, initialPlayerPosition.z),
  );
  const moveTargetCommandRef = useRef({
    storeAt: 0,
    storeX: initialPlayerPosition.x,
    storeZ: initialPlayerPosition.z,
  });
  const hydratedPlayerObjectRef = useRef(null);
  const playerPositionAppliedRef = useRef(false);
  const cursorLookRef = useRef({
    hasPointer: false,
    lastMovedAt: 0,
    ndc: new THREE.Vector2(),
  });
  const attackRequestRef = useRef({
    sequence: 0,
    cancelSequence: 0,
    duration: 0,
    tool: 'axe',
    x: 0,
    z: 0,
  });
  const attackTimingRef = useRef({ duration: 1 });
  const attackableRegistryRef = useRef(new Map());
  const attackCooldownUntilRef = useRef(0);
  const creatureAttackCooldownsRef = useRef({});
  const pendingWeaponAttackRef = useRef(null);
  const gatherTargetRef = useRef(null);
  const gatherParticlesRef = useRef([]);
  const gatherHudSyncRef = useRef({ lastAt: 0, progress: -1 });
  const ringRef = useRef(null);
  const toolStateRef = useRef({
    axeVisible: false,
    tool: 'axe',
    gathering: false,
    gatherSwingSequence: 0,
  });
  const [resourceStates, setResourceStates] = useState({});
  const [creatureStates, setCreatureStates] = useState(
    createCreatureCombatStates,
  );
  const [activeResourceId, setActiveResourceId] = useState(null);
  const [buildPreview, setBuildPreview] = useState(null);
  const [destroyModifier, setDestroyModifier] = useState(false);
  const resourceStatesRef = useRef(resourceStates);
  const creatureStatesRef = useRef(creatureStates);
  const buildPreviewRef = useRef(buildPreview);
  const destroyModifierRef = useRef(false);
  const buildStateRef = useRef({
    buildOpen,
    buildRotation,
    buildings,
    currentBuildPiece,
    inventoryWood,
  });
  const respawnCheckRef = useRef(0);
  const creatureRespawnCheckRef = useRef(0);
  const resourceCommandRef = useRef(null);
  const isGameInputReady = () =>
    inputReady && gameUiStore.getState().loadingHidden && !isPlayerDeadRef.current;
  const handleResourceCommand = useCallback((resource) => {
    if (!isGameInputReady()) return;
    resourceCommandRef.current?.(resource);
  }, [inputReady]);
  const applyRuntimePlayerPosition = useCallback(() => {
    const playerObject = playerRef.current;
    if (!playerObject || hydratedPlayerObjectRef.current === playerObject) {
      return Boolean(playerObject && playerPositionAppliedRef.current);
    }

    const runtime = gameRuntimeStore.getState();
    if (!runtime.playerPositionReady) return false;

    const next = runtime.player;
    const surfaceY = buildSurfaceHeightAt(
      next.x,
      next.z,
      buildStateRef.current.buildings,
    );
    playerObject.position.set(next.x, surfaceY, next.z);
    playerObject.rotation.y = next.facing || 0;
    moveTargetRef.current.set(next.x, 0, next.z);
    moveTargetCommandRef.current.storeX = next.x;
    moveTargetCommandRef.current.storeZ = next.z;
    moveTargetCommandRef.current.storeAt =
      typeof performance === 'undefined' ? Date.now() : performance.now();
    hydratedPlayerObjectRef.current = playerObject;
    playerPositionAppliedRef.current = true;
    return true;
  }, []);
  useLayoutEffect(() => {
    applyRuntimePlayerPosition();
  }, [applyRuntimePlayerPosition]);
  const groundCoverPoints = useMemo(
    () =>
      GROUND_COVER_POINTS.slice(
        0,
        Math.max(0, Math.min(settings.groundCoverCount, MAX_GROUND_COVER_COUNT)),
      ),
    [settings.groundCoverCount],
  );
  const visibleWindow = useVisibleWorldWindow(playerRef);
  const visibleTreePoints = useMemo(
    () =>
      TREE_POINTS.filter((tree) =>
        isPointVisibleInWindow(
          tree.position[0],
          tree.position[2],
          visibleWindow,
          420,
        ),
      ),
    [visibleWindow],
  );
  const visibleRockPoints = useMemo(
    () =>
      ROCK_POINTS.filter((rock) =>
        isPointVisibleInWindow(
          rock.position[0],
          rock.position[2],
          visibleWindow,
          360,
        ),
      ),
    [visibleWindow],
  );
  const visiblePlantResourcePoints = useMemo(
    () =>
      GATHERABLE_PLANT_POINTS.filter((plant) =>
        isPointVisibleInWindow(
          plant.position[0],
          plant.position[2],
          visibleWindow,
          320,
        ),
      ),
    [visibleWindow],
  );
  const visibleBuildings = useMemo(
    () =>
      buildings.filter((building) =>
        isPointVisibleInWindow(
          building.x,
          building.z,
          visibleWindow,
          Math.max(building.w || 0, building.h || 0) + 420,
        ),
      ),
    [buildings, visibleWindow],
  );
  const visibleProps = useMemo(
    () =>
      PROP_POINTS.filter((prop) =>
        isPointVisibleInWindow(
          prop.position[0],
          prop.position[2],
          visibleWindow,
          420,
        ),
      ),
    [visibleWindow],
  );

  useEffect(() => {
    resourceStatesRef.current = resourceStates;
  }, [resourceStates]);

  useEffect(() => {
    creatureStatesRef.current = creatureStates;
  }, [creatureStates]);

  useEffect(
    () => () => {
      flushCloudWorldStateSave();
    },
    [],
  );

  const commitResourceStates = (nextStates, options = {}) => {
    resourceStatesRef.current = nextStates;
    const update = () => setResourceStates(nextStates);
    if (options.transition) startTransition(update);
    else update();
    if (!options.skipCloudSave) {
      scheduleCloudWorldStateSave({ resources: nextStates });
    }
  };

  useEffect(() => {
    if (cloudResourceStates == null) return;
    commitResourceStates(cloudResourceStates, { skipCloudSave: true });
  }, [cloudResourceStates]);

  useEffect(() => {
    buildPreviewRef.current = buildPreview;
  }, [buildPreview]);

  useEffect(() => {
    destroyModifierRef.current = destroyModifier;
  }, [destroyModifier]);

  useEffect(() => {
    buildStateRef.current = {
      buildOpen,
      buildRotation,
      buildings,
      currentBuildPiece,
      inventoryWood,
    };
  }, [buildOpen, buildRotation, buildings, currentBuildPiece, inventoryWood]);

  useEffect(() => {
    if (inputReady) return;
    isPlayerRunningRef.current = false;
    isPlayerBlockingRef.current = false;
    isPlayerMovingRef.current = false;
    gatherTargetRef.current = null;
    pendingWeaponAttackRef.current = null;
    toolStateRef.current.axeVisible = false;
    toolStateRef.current.gathering = false;
    if (playerRef.current) moveTargetRef.current.copy(playerRef.current.position);
    if (ringRef.current) ringRef.current.visible = false;
    setBuildPreview(null);
    setDestroyModifier(false);
    setActiveResourceId(null);
    setGatherHud(null);
    gameRuntimeStore.getState().setLocalPresence({
      actionState: 'idle',
      actionTool: null,
      blocking: false,
      movementState: 'idle',
    });
  }, [inputReady]);

  useEffect(() => {
    isPlayerDeadRef.current = playerDead;
    if (!playerDead) return;

    isPlayerRunningRef.current = false;
    isPlayerBlockingRef.current = false;
    isPlayerMovingRef.current = false;
    gatherTargetRef.current = null;
    pendingWeaponAttackRef.current = null;
    toolStateRef.current.axeVisible = false;
    toolStateRef.current.gathering = false;
    if (playerRef.current) moveTargetRef.current.copy(playerRef.current.position);
    if (ringRef.current) ringRef.current.visible = false;
    setDestroyModifier(false);
    setActiveResourceId(null);
    setGatherHud(null);
    gameRuntimeStore.getState().setLocalPresence({
      actionState: 'idle',
      actionTool: null,
      blocking: false,
      movementState: 'idle',
    });
  }, [playerDead]);

  const cancelAttack = () => {
    attackRequestRef.current = {
      ...attackRequestRef.current,
      cancelSequence: attackRequestRef.current.cancelSequence + 1,
    };
  };

  const startBlocking = () => {
    if (!isGameInputReady()) return;
    if (buildStateRef.current.buildOpen || isPlayerBlockingRef.current) return;
    isPlayerBlockingRef.current = true;
    gatherTargetRef.current = null;
    if (activeResourceId) setActiveResourceId(null);
    toolStateRef.current.axeVisible = false;
    toolStateRef.current.tool = equippedWeaponId === 'sword' ? 'sword' : 'weapon';
    toolStateRef.current.gathering = false;
    setGatherHud(null);
    cancelAttack();
    pendingWeaponAttackRef.current = null;
    const runtime = gameRuntimeStore.getState();
    runtime.setLocalPresence({
      actionState: 'block',
      actionTool: 'guard',
      actionSequence: (runtime.localPresence.actionSequence || 0) + 1,
      blocking: true,
    });
    playSfx('guard', 0.58);
    setHudActionLine('Blocking.');
  };

  const stopBlocking = () => {
    if (!isPlayerBlockingRef.current) return;
    isPlayerBlockingRef.current = false;
    const runtime = gameRuntimeStore.getState();
    if (runtime.localPresence.actionState === 'block') {
      runtime.setLocalPresence({
        actionState: 'idle',
        actionTool: null,
        blocking: false,
      });
    } else {
      runtime.setLocalPresence({ blocking: false });
    }
  };

  const createBuildPreview = (x, z) => {
    const state = buildStateRef.current;
    const piece = state.currentBuildPiece;
    const snapped = snapBuildPosition(
      piece,
      x,
      z,
      state.buildRotation,
      state.buildings,
    );
    const level = resolveBuildLevel(piece, snapped, state.buildings);
    const footprint = { ...snapped, level };
    return {
      ...footprint,
      type: piece.id,
      rot: state.buildRotation,
      blocks: piece.blocks,
      color: piece.color,
      valid: canPlaceBuilding(
        piece,
        footprint,
        state.buildings,
        state.inventoryWood,
        playerRef.current?.position,
      ),
    };
  };

  const updateBuildPreview = (x, z) => {
    if (!buildStateRef.current.buildOpen) {
      setBuildPreview(null);
      return null;
    }
    const next = createBuildPreview(x, z);
    setBuildPreview((current) => {
      if (
        current &&
        current.x === next.x &&
        current.z === next.z &&
        current.level === next.level &&
        current.rot === next.rot &&
        current.type === next.type &&
        current.valid === next.valid
      ) {
        return current;
      }
      return next;
    });
    return next;
  };

  const placeCurrentBuild = (x, z) => {
    if (!isGameInputReady()) return;
    const preview = updateBuildPreview(x, z);
    const state = buildStateRef.current;
    if (!preview?.valid) {
      gameUiStore
        .getState()
        .setActionLine(
          state.inventoryWood < state.currentBuildPiece.cost
            ? 'Not enough wood.'
            : "Can't build there.",
        );
      playSfx('error');
      return;
    }
    gameUiStore
      .getState()
      .placeBuilding(state.currentBuildPiece, preview, state.buildRotation);
  };

  const destroyCurrentBuild = (id) => {
    if (!isGameInputReady()) return;
    if (!buildStateRef.current.buildOpen || !destroyModifierRef.current) return;
    gameUiStore.getState().destroyBuilding(id);
  };

  useEffect(() => {
    const setModifier = (active) => {
      destroyModifierRef.current = active;
      setDestroyModifier(active);
    };
	    const isTypingTarget = (target) =>
	      target instanceof HTMLInputElement ||
	      target instanceof HTMLTextAreaElement ||
	      target instanceof HTMLSelectElement ||
	      target?.isContentEditable;
	    const onKeyDown = (event) => {
	      if (event.repeat || isTypingTarget(event.target)) return;
      if (!isGameInputReady()) {
        isPlayerRunningRef.current = false;
        setModifier(false);
        stopBlocking();
        return;
      }
	      if (event.key === 'Shift') {
	        isPlayerRunningRef.current = true;
        return;
      }
      if (event.key.toLowerCase() === 'x') {
        if (buildStateRef.current.buildOpen) setModifier(true);
        else startBlocking();
      }
    };
    const onKeyUp = (event) => {
      if (event.key === 'Shift') {
        isPlayerRunningRef.current = false;
        return;
      }
      if (event.key.toLowerCase() === 'x') {
        setModifier(false);
        stopBlocking();
      }
    };
    const onBlur = () => {
      isPlayerRunningRef.current = false;
      setModifier(false);
      stopBlocking();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [activeResourceId, equippedWeaponId, inputReady]);

  useEffect(() => {
    if (!buildOpen) {
      setBuildPreview(null);
      return;
    }

    const current = buildPreviewRef.current;
    const fallback = playerRef.current?.position || { x: 72, z: 0 };
    updateBuildPreview(current?.x ?? fallback.x + 72, current?.z ?? fallback.z);
  }, [buildOpen, buildRotation, currentBuildPiece, buildings, inventoryWood]);

  useEffect(() => {
    if (!buildOpen) return;
    if (destroyModifier) {
      setHudActionLine('Destroy mode: click a built piece to remove it.');
      return;
    }
    setHudActionLine(
      `Build mode: ${currentBuildPiece.name}. Left-click places, hold X + click removes, right-click moves.`,
    );
  }, [buildOpen, currentBuildPiece, destroyModifier]);

  const requestMoveTarget = (
    x,
    z,
    { forceStoreSync = false, showRing = true } = {},
  ) => {
    if (!isGameInputReady()) return;
    const clampedX = THREE.MathUtils.clamp(
      x,
      -WORLD_SIZE.width / 2 + 60,
      WORLD_SIZE.width / 2 - 60,
    );
    const clampedZ = THREE.MathUtils.clamp(
      z,
      -WORLD_SIZE.height / 2 + 60,
      WORLD_SIZE.height / 2 - 60,
    );
    const currentDx = clampedX - moveTargetRef.current.x;
    const currentDz = clampedZ - moveTargetRef.current.z;
    if (
      currentDx * currentDx + currentDz * currentDz <
      MOVE_TARGET_VISUAL_UPDATE_DISTANCE * MOVE_TARGET_VISUAL_UPDATE_DISTANCE
    ) {
      return;
    }

    moveTargetRef.current.set(clampedX, 0, clampedZ);
    cancelAttack();
    pendingWeaponAttackRef.current = null;

    const command = moveTargetCommandRef.current;
    const now =
      typeof performance === 'undefined' ? Date.now() : performance.now();
    const storeDx = clampedX - command.storeX;
    const storeDz = clampedZ - command.storeZ;
    const shouldSyncStore =
      forceStoreSync ||
      now - command.storeAt >= MOVE_TARGET_STORE_SYNC_INTERVAL_MS ||
      storeDx * storeDx + storeDz * storeDz >=
        MOVE_TARGET_STORE_SYNC_DISTANCE * MOVE_TARGET_STORE_SYNC_DISTANCE;
    if (shouldSyncStore) {
      command.storeAt = now;
      command.storeX = clampedX;
      command.storeZ = clampedZ;
      gameRuntimeStore.getState().setMoveTarget({ x: clampedX, z: clampedZ });
    }

    if (ringRef.current && showRing) {
      const ringY = buildSurfaceHeightAt(
        clampedX,
        clampedZ,
        buildStateRef.current.buildings,
      );
      ringRef.current.position.set(clampedX, ringY + 3, clampedZ);
      ringRef.current.visible = true;
      ringRef.current.scale.setScalar(1);
    } else if (ringRef.current) {
      ringRef.current.visible = false;
    }
  };

	  const setMoveTarget = (x, z) => {
    if (!isGameInputReady()) return;
	    const wasGathering =
      Boolean(gatherTargetRef.current) ||
      Boolean(activeResourceId) ||
      toolStateRef.current.gathering;
    gatherTargetRef.current = null;
    if (activeResourceId) setActiveResourceId(null);
    toolStateRef.current.axeVisible = false;
    toolStateRef.current.tool = 'axe';
    toolStateRef.current.gathering = false;
    if (wasGathering) setGatherHud(null);
    requestMoveTarget(x, z);
  };

  const commitCreatureStates = (nextStates) => {
    creatureStatesRef.current = nextStates;
    setCreatureStates(nextStates);
  };

  const emitCombatFloater = ({ follow = null, kind = 'hit', offset = null, position, text }) => {
    if (!position || !text) return;
    const source = Array.isArray(position)
      ? new THREE.Vector3(position[0] || 0, position[1] || 0, position[2] || 0)
      : position;
    const worldPosition = source.clone
      ? source.clone()
      : new THREE.Vector3(source.x || 0, source.y || 0, source.z || 0);
    const id = `combat-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const yOffset = follow === 'player' ? 0 : kind === 'miss' ? 70 : 112;
    const floater = {
      follow,
      id,
      kind,
      offset,
      text,
      position: [worldPosition.x, worldPosition.y + yOffset, worldPosition.z],
    };
    setCombatFloaters((items) => [...items.slice(-8), floater]);
    window.setTimeout(() => {
      setCombatFloaters((items) => items.filter((item) => item.id !== id));
    }, 1800);
  };

  useEffect(() => {
    const previousHealth = previousPlayerHealthRef.current;
    previousPlayerHealthRef.current = playerHealth;
    if (playerHealth >= previousHealth) return;

    const damage = previousHealth - playerHealth;
    if (!playerRef.current || damage <= 0) return;

    emitCombatFloater({
      follow: 'player',
      kind: 'taken',
      offset: { side: 42, y: 112 },
      position: playerRef.current.position,
      text: `-${damage}`,
    });
  }, [playerHealth]);

  const damageCreature = (entry, attack) => {
    const creature = CREATURES.find((item) => item.id === entry.id);
    if (!creature) return;

    const time = Date.now();
    const current =
      creatureStatesRef.current[entry.id] ||
      creatureCombatStateFor(creature, creatureStatesRef.current);
    if (isCreatureStateDefeated(current, time)) return;

    const damage = Math.max(1, Number(attack.profile.damage) || 1);
    const nextHp = Math.max(0, current.hp - damage);
    const defeated = nextHp <= 0;
    const nextStates = {
      ...creatureStatesRef.current,
      [entry.id]: {
        ...current,
        hp: nextHp,
        hitUntil: time + 260,
        defeatedUntil: defeated ? time + CREATURE_RESPAWN_MS : 0,
        lastDamage: damage,
        lastDamageAt: time,
      },
    };
    commitCreatureStates(nextStates);

    playSfx(defeated ? 'defeat' : 'hit', defeated ? 0.9 : 0.78);
    emitCombatFloater({
      kind: defeated ? 'defeat' : 'hit',
      position: entry.position,
      text: `-${damage}`,
    });
    setHudActionLine(
      defeated
        ? `${creature.name} is down.`
        : `Hit: ${attack.weapon.name} hit ${creature.name}.`,
    );
  };

  const sendPvpWeaponAttack = (entry, attack) => {
    const sent = window.MOSSVALE_GAME_API?.sendPvpAttack?.({
      weaponId: attack.weapon.id,
      targetId: entry.id,
      targetX: entry.position.x,
      targetZ: entry.position.z,
      facing: attack.facing,
    });

    if (sent) {
      const damage = Math.max(1, Number(attack.profile.damage) || 1);
      emitCombatFloater({
        kind: 'hit',
        position: entry.position,
        text: `-${damage}`,
      });
      setHudActionLine(`Hit: ${attack.weapon.name} attack at ${entry.name || 'Traveler'}.`);
      return;
    }

    playSfx('error', 0.54);
    setHudActionLine('PvP server unavailable.');
  };

  const resolvePendingWeaponAttack = () => {
    const attack = pendingWeaponAttackRef.current;
    if (!attack || performance.now() < attack.impactAt) return;
    pendingWeaponAttackRef.current = null;

    const hit = findWeaponAttackHit(
      attackableRegistryRef.current,
      creatureStatesRef.current,
      attack,
    );
    if (hit) {
      if (hit.type === 'creature') {
        damageCreature(hit, attack);
      } else {
        sendPvpWeaponAttack(hit, attack);
      }
      return;
    }

    const missPosition = attack.origin
      ? attack.origin.clone().lerp(attack.target, 0.55)
      : attack.target;
    missPosition.y = getTerrainHeight(missPosition.x, missPosition.z);
    emitCombatFloater({
      kind: 'miss',
      position: missPosition,
      text: 'Miss',
    });
    setHudActionLine(`Miss: ${attack.weapon.name} attack missed.`);
  };

  const resolveCreatureAttacks = () => {
    if (isPlayerDeadRef.current) return;
    if (!playerRef.current) return;
    const nowMs = performance.now();
    const playerPosition = playerRef.current.position;
    for (const entry of attackableRegistryRef.current.values()) {
      if (!entry || entry.type !== 'creature') continue;
      const state = creatureStatesRef.current[entry.id];
      if (!state || isCreatureStateDefeated(state)) continue;
      if (state.hp >= state.maxHp && state.hitUntil <= Date.now()) continue;
      const cooldownUntil = creatureAttackCooldownsRef.current[entry.id] || 0;
      if (nowMs < cooldownUntil) continue;
      const dx = entry.position.x - playerPosition.x;
      const dz = entry.position.z - playerPosition.z;
      const attackDistance =
        CREATURE_ATTACK_RANGE + Math.max(0, (entry.radius || 42) - 36);
      if (dx * dx + dz * dz > attackDistance * attackDistance) continue;

      creatureAttackCooldownsRef.current[entry.id] =
        nowMs + CREATURE_ATTACK_COOLDOWN_MS;
      if (isPlayerBlockingRef.current) {
        playSfx('guard', 0.86);
        setHudActionLine(`${entry.name || 'Creature'} hit your block.`);
        continue;
      }

      if (
        gameUiStore
          .getState()
          .damagePlayer(CREATURE_ATTACK_DAMAGE, entry.name || 'Creature')
      ) {
        playSfx('hit', 0.74);
      }
    }
  };

  const triggerAttack = (x, z, options = {}) => {
    if (!isGameInputReady()) return;
    if (isPlayerBlockingRef.current) {
      setHudActionLine('Release X to attack.');
      return;
    }

    const nowMs = performance.now();
    const attackWeapon =
      equippedWeapon ||
      weaponDefs.find((weapon) => weapon.id === 'stick') ||
      weaponDefs[0];
    const profile = weaponAttackProfile(attackWeapon);
    if (nowMs < attackCooldownUntilRef.current) {
      playSfx('error', 0.54);
      setHudActionLine(`${attackWeapon.name} recovering.`);
      return;
    }

    if (playerRef.current) {
      const dx = x - playerRef.current.position.x;
      const dz = z - playerRef.current.position.z;
      if (Math.hypot(dx, dz) > 0.001) {
        playerRef.current.rotation.y = Math.atan2(dx, dz);
      }
      moveTargetRef.current.copy(playerRef.current.position);
    }

    gatherTargetRef.current = null;
    if (activeResourceId) setActiveResourceId(null);
    toolStateRef.current.axeVisible = false;
    toolStateRef.current.tool = attackWeapon.id === 'sword' ? 'sword' : 'weapon';
    toolStateRef.current.gathering = false;
    setGatherHud(null);
    isPlayerMovingRef.current = false;
    if (ringRef.current) ringRef.current.visible = false;

    const origin = playerRef.current
      ? playerRef.current.position.clone()
      : new THREE.Vector3(0, 0, 0);
    const facing = playerRef.current?.rotation.y || 0;
    attackCooldownUntilRef.current = nowMs + profile.cooldownMs;
    pendingWeaponAttackRef.current = {
      weapon: attackWeapon,
      profile,
      origin,
      facing,
      impactAt: nowMs + profile.impactMs,
      target: new THREE.Vector3(x, getTerrainHeight(x, z), z),
    };

    attackRequestRef.current = {
      sequence: attackRequestRef.current.sequence + 1,
      cancelSequence: attackRequestRef.current.cancelSequence,
      duration: options.duration || profile.animationDuration,
      trimEnd: options.trimEnd || 0,
      tool: attackWeapon.id === 'sword' ? 'sword' : 'weapon',
      x,
      z,
    };
    const runtime = gameRuntimeStore.getState();
    runtime.setLocalPresence({
      actionState: 'attack',
      actionTool: attackWeapon.id === 'sword' ? 'sword' : 'weapon',
      actionSequence: (runtime.localPresence.actionSequence || 0) + 1,
    });
    playSfx(profile.sfx, 0.8);
    setHudActionLine(`${attackWeapon.name} attack.`);
  };

  const startGatherSwing = (target, config, elapsedTime) => {
    const swingDuration = Math.min(config.duration, GATHER_SWING_DURATION);
    toolStateRef.current.gatherSwingSequence =
      (toolStateRef.current.gatherSwingSequence || 0) + 1;
    target.animationStarted = true;
    target.pendingImpactAt =
      elapsedTime + swingDuration * GATHER_IMPACT_ANIMATION_FRACTION;
    target.nextSwingAt = elapsedTime + swingDuration;
    target.swingEndsAt = elapsedTime + swingDuration;
    const runtime = gameRuntimeStore.getState();
    runtime.setLocalPresence({
      actionState: 'gather',
      actionTool: target.type === 'stone' ? 'pickaxe' : 'axe',
      actionSequence: (runtime.localPresence.actionSequence || 0) + 1,
    });
  };

  const updateGatherHud = (config, progress, elapsedTime) => {
    const hudSync = gatherHudSyncRef.current;
    if (
      progress < 1 &&
      elapsedTime - hudSync.lastAt < GATHER_HUD_SYNC_INTERVAL &&
      Math.abs(progress - hudSync.progress) < 0.025
    ) {
      return;
    }

    hudSync.lastAt = elapsedTime;
    hudSync.progress = progress;
    setGatherHud({
      resourceKey: config.itemKey,
      name: config.label,
      progress,
    });
  };

  const completeGatherTarget = (target, elapsedTime) => {
    const config = GATHER_RESOURCE_CONFIG[target.type];
    if (!config) return;

    const currentState = resourceStatesRef.current[target.id] || {};
    const nextGathered = Math.min(
      config.nodeCount,
      (currentState.nodesGathered || 0) + 1,
    );
    const depleted = nextGathered >= config.nodeCount;
    const nextState = depleted
      ? {
          nodesGathered: config.nodeCount,
          depletedUntil: Date.now() + config.respawnMs,
        }
      : { nodesGathered: nextGathered };
    const nextStates = {
      ...resourceStatesRef.current,
      [target.id]: nextState,
    };

    const count = config.yield();
    if (depleted) {
      commitResourceStates(nextStates);
      awardGatheredResource(config.itemKey, count, config.label, {
        deferPersist: true,
        persistDelayMs: 1600,
      });
      gatherTargetRef.current = null;
      gatherHudSyncRef.current = { lastAt: 0, progress: -1 };
      setActiveResourceId(null);
      toolStateRef.current.axeVisible = false;
      toolStateRef.current.tool = 'axe';
      toolStateRef.current.gathering = false;
      setGatherHud(null);
      return;
    }

    commitResourceStates(nextStates, { transition: true });
    awardGatheredResource(config.itemKey, count, config.label, {
      deferPersist: true,
      persistDelayMs: 1600,
    });

    const nextTarget = {
      ...target,
      startedAt: elapsedTime,
      animationStarted: false,
      pendingImpactAt: null,
      nextSwingAt: elapsedTime,
      swingEndsAt: null,
    };
    gatherTargetRef.current = nextTarget;
    gatherHudSyncRef.current = { lastAt: 0, progress: -1 };
    startGatherSwing(nextTarget, config, elapsedTime);
  };

  const commandGatherResource = (resource) => {
    if (!isGameInputReady()) return;
    if (!playerRef.current) return;
    if (isPlayerBlockingRef.current) {
      setHudActionLine('Release X to gather.');
      return;
    }
    if (resourceStatesRef.current[resource.id]?.depletedUntil > Date.now()) {
      setHudActionLine('That resource is regrowing.');
      return;
    }

    const config = GATHER_RESOURCE_CONFIG[resource.type];
    if (!config) return;

    const resourcePosition = new THREE.Vector3(
      resource.position[0],
      0,
      resource.position[2],
    );
    const awayFromResource = new THREE.Vector3().subVectors(
      playerRef.current.position,
      resourcePosition,
    );
    awayFromResource.y = 0;
    if (awayFromResource.lengthSq() < 0.001) awayFromResource.set(0, 0, 1);
    awayFromResource.normalize();

    const approach = resourcePosition
      .clone()
      .addScaledVector(awayFromResource, GATHER_RANGE * 0.82);
    gatherTargetRef.current = {
      id: resource.id,
      type: resource.type,
      position: resourcePosition,
      startedAt: null,
      animationStarted: false,
      pendingImpactAt: null,
      nextSwingAt: null,
      swingEndsAt: null,
    };
    setActiveResourceId(resource.id);
    toolStateRef.current.axeVisible = true;
    toolStateRef.current.tool = resource.type === 'stone' ? 'pickaxe' : 'axe';
    toolStateRef.current.gathering = false;
    setHudActionLine(`Moving to gather ${config.label}.`);
    requestMoveTarget(approach.x, approach.z, { forceStoreSync: true });
  };
  resourceCommandRef.current = commandGatherResource;

	  useFrame(({ clock }) => {
    if (
      !playerPositionAppliedRef.current ||
      hydratedPlayerObjectRef.current !== playerRef.current
    ) {
	      applyRuntimePlayerPosition();
	    }
    if (!isGameInputReady()) return;

    resolvePendingWeaponAttack();
    resolveCreatureAttacks();
    if (
      !pendingWeaponAttackRef.current &&
      gameRuntimeStore.getState().localPresence.actionState === 'attack' &&
      performance.now() >= attackCooldownUntilRef.current
    ) {
      gameRuntimeStore.getState().setLocalPresence({
        actionState: 'idle',
        actionTool: null,
      });
    }

    if (clock.elapsedTime - respawnCheckRef.current > 0.75) {
      respawnCheckRef.current = clock.elapsedTime;
      const time = Date.now();
      if (
        Object.values(resourceStatesRef.current).some(
          (state) => state.depletedUntil <= time,
        )
      ) {
        commitResourceStates(
          Object.fromEntries(
            Object.entries(resourceStatesRef.current).filter(
              ([, state]) => state.depletedUntil > time,
            ),
          ),
        );
      }
    }

    if (clock.elapsedTime - creatureRespawnCheckRef.current > 0.5) {
      creatureRespawnCheckRef.current = clock.elapsedTime;
      const time = Date.now();
      let changed = false;
      const nextStates = { ...creatureStatesRef.current };
      for (const creature of CREATURES) {
        const state = creatureCombatStateFor(creature, nextStates);
        if (state.hp <= 0 && state.defeatedUntil <= time) {
          nextStates[creature.id] = {
            hp: creature.maxHp,
            maxHp: creature.maxHp,
            hitUntil: 0,
            defeatedUntil: 0,
            lastDamage: 0,
            lastDamageAt: 0,
          };
          changed = true;
        }
      }
      if (changed) commitCreatureStates(nextStates);
    }

    const gatherTarget = gatherTargetRef.current;
    if (!gatherTarget || !playerRef.current) {
      if (gameRuntimeStore.getState().localPresence.actionState === 'gather') {
        gameRuntimeStore.getState().setLocalPresence({
          actionState: 'idle',
          actionTool: null,
        });
      }
      return;
    }

    if (
      resourceStatesRef.current[gatherTarget.id]?.depletedUntil > Date.now()
    ) {
      gatherTargetRef.current = null;
      gatherHudSyncRef.current = { lastAt: 0, progress: -1 };
      setActiveResourceId(null);
      toolStateRef.current.axeVisible = false;
      toolStateRef.current.tool = 'axe';
      toolStateRef.current.gathering = false;
      setGatherHud(null);
      return;
    }

    const config = GATHER_RESOURCE_CONFIG[gatherTarget.type];
    const distance = playerRef.current.position.distanceTo(
      gatherTarget.position,
    );
    if (distance > GATHER_RANGE) {
      gatherTarget.animationStarted = false;
      gatherTarget.startedAt = null;
      gatherTarget.pendingImpactAt = null;
      gatherTarget.nextSwingAt = null;
      gatherTarget.swingEndsAt = null;
      toolStateRef.current.gathering = false;
      cancelAttack();
      gatherHudSyncRef.current = { lastAt: 0, progress: -1 };
      setGatherHud(null);
      return;
    }

    moveTargetRef.current.copy(playerRef.current.position);
    isPlayerMovingRef.current = false;
    toolStateRef.current.axeVisible = true;
    toolStateRef.current.tool =
      gatherTarget.type === 'stone' ? 'pickaxe' : 'axe';
    toolStateRef.current.gathering = true;

    const dx = gatherTarget.position.x - playerRef.current.position.x;
    const dz = gatherTarget.position.z - playerRef.current.position.z;
    if (Math.hypot(dx, dz) > 0.001) {
      playerRef.current.rotation.y = Math.atan2(dx, dz);
    }

    if (
      gatherTarget.pendingImpactAt &&
      clock.elapsedTime >= gatherTarget.pendingImpactAt
    ) {
      emitGatherParticles(
        gatherParticlesRef.current,
        gatherTarget.type,
        gatherTarget.position,
        playerRef.current.position,
        1.15,
      );
      gatherTarget.pendingImpactAt = null;
    }

    if (gatherTarget.startedAt == null) {
      gatherTarget.startedAt = clock.elapsedTime;
      gatherTarget.animationStarted = false;
      gatherTarget.nextSwingAt = clock.elapsedTime;
      gatherTarget.swingEndsAt = null;
      setHudActionLine(`Gathering ${config.label}...`);
    }

    const gatherProgress = THREE.MathUtils.clamp(
      (clock.elapsedTime - gatherTarget.startedAt) / config.duration,
      0,
      1,
    );
    updateGatherHud(config, gatherProgress, clock.elapsedTime);

    if (gatherProgress >= 1) {
      completeGatherTarget(gatherTarget, clock.elapsedTime);
      return;
    }

    if (
      gatherTarget.nextSwingAt == null ||
      clock.elapsedTime >= gatherTarget.nextSwingAt
    ) {
      startGatherSwing(gatherTarget, config, clock.elapsedTime);
    }
  });

  const groundCoverElements = useMemo(
    () =>
      Array.from(
        groundCoverPoints.reduce((groups, point) => {
          const file = point[0];
          if (!groups.has(file)) groups.set(file, []);
          groups.get(file).push(point);
          return groups;
        }, new Map()),
        ([file, points]) => (
          <Suspense fallback={null} key={file}>
            <GroundCoverVariantBatch file={file} points={points} />
          </Suspense>
        ),
      ),
    [groundCoverPoints],
  );

  const buildingElements = useMemo(
    () => (
      <>
        {visibleBuildings
          .filter((building) => building.type === 'foundation')
          .map((building) => (
            <BuildingMesh
              allBuildings={visibleBuildings}
              building={building}
              key={building.id}
              onDestroy={
                buildOpen && destroyModifier ? destroyCurrentBuild : null
              }
              playerRef={playerRef}
            />
          ))}
        {visibleBuildings
          .filter((building) => building.type !== 'foundation')
          .map((building) => (
            <BuildingMesh
              allBuildings={visibleBuildings}
              building={building}
              key={building.id}
              onDestroy={
                buildOpen && destroyModifier ? destroyCurrentBuild : null
              }
              playerRef={playerRef}
            />
          ))}
      </>
    ),
    [buildOpen, destroyModifier, visibleBuildings],
  );

  const resourceModelElements = useMemo(
    () => (
      <>
        {visibleTreePoints.map((tree) => {
          const treeId = tree.id ?? tree.file;
          const displayPosition = positionOnTerrain(tree.position);
          return (
            <group key={treeId}>
              {resourceStates[treeId]?.depletedUntil > Date.now() ? (
                <Suspense
                  fallback={
                    <TreeStumpFallback
                      position={displayPosition}
                      scale={tree.scale}
                      rotationY={tree.rotationY}
                    />
                  }
                >
                  <NatureStump
                    id={treeId}
                    position={displayPosition}
                    scale={tree.scale}
                    rotationY={tree.rotationY}
                    onResourceCommand={handleResourceCommand}
                  />
                </Suspense>
              ) : (
                <Suspense fallback={null}>
                  <NatureTree
                    file={tree.file}
                    id={treeId}
                    position={displayPosition}
                    scale={tree.scale}
                    rotationY={tree.rotationY}
                    onResourceCommand={handleResourceCommand}
                  />
                </Suspense>
              )}
            </group>
          );
        })}
        {visibleRockPoints.map((rock) => {
          const depleted = resourceStates[rock.id]?.depletedUntil > Date.now();
          const fallbackScale = rock.radius / 34;
          const fallbackY = depleted ? 6 * fallbackScale : 18 * fallbackScale;
          const displayPosition = positionOnTerrain(rock.position);
          const fallbackPosition = [
            rock.position[0],
            getTerrainHeight(rock.position[0], rock.position[2]) + fallbackY,
            rock.position[2],
          ];
          return (
            <group key={rock.id}>
              {depleted ? (
                <LowPolyRock
                  depleted
                  id={rock.id}
                  position={fallbackPosition}
                  scale={fallbackScale}
                  onResourceCommand={handleResourceCommand}
                />
              ) : (
                <Suspense
                  fallback={
                    <LowPolyRock
                      id={rock.id}
                      position={fallbackPosition}
                      scale={fallbackScale}
                      onResourceCommand={handleResourceCommand}
                    />
                  }
                >
                  <NatureRock
                    file={rock.file}
                    id={rock.id}
                    position={displayPosition}
                    radius={rock.radius}
                    rotationY={rock.rotationY}
                    scale={rock.scale}
                    onResourceCommand={handleResourceCommand}
                  />
                </Suspense>
              )}
            </group>
          );
        })}
        {visiblePlantResourcePoints.map((plant) => {
          const depleted = resourceStates[plant.id]?.depletedUntil > Date.now();
          const displayPosition = positionOnTerrain(plant.position);
          return (
            <group key={plant.id}>
              {!depleted && (
                <Suspense fallback={null}>
                  <NaturePlantResource
                    file={plant.file}
                    id={plant.id}
                    type={plant.type}
                    position={displayPosition}
                    radius={plant.radius}
                    rotationY={plant.rotationY}
                    scale={plant.scale}
                    onResourceCommand={handleResourceCommand}
                  />
                </Suspense>
              )}
            </group>
          );
        })}
      </>
    ),
    [
      handleResourceCommand,
      resourceStates,
      visiblePlantResourcePoints,
      visibleRockPoints,
      visibleTreePoints,
    ],
  );

  const resourceOverlayElements = useMemo(
    () => (
      <>
        {visibleTreePoints.map((tree) => {
          const treeId = tree.id ?? tree.file;
          return (
            <ResourceNodeOverlay
              active={activeResourceId === treeId}
              key={`resource-overlay-${treeId}`}
              position={positionOnTerrain(tree.position)}
              state={resourceStates[treeId]}
              type='tree'
            />
          );
        })}
        {visibleRockPoints.map((rock) => (
          <ResourceNodeOverlay
            active={activeResourceId === rock.id}
            key={`resource-overlay-${rock.id}`}
            position={positionOnTerrain(rock.position)}
            state={resourceStates[rock.id]}
            type='stone'
          />
        ))}
        {visiblePlantResourcePoints.map((plant) => (
          <ResourceNodeOverlay
            active={activeResourceId === plant.id}
            key={`resource-overlay-${plant.id}`}
            position={positionOnTerrain(plant.position)}
            state={resourceStates[plant.id]}
            type={plant.type}
          />
        ))}
      </>
    ),
    [
      activeResourceId,
      resourceStates,
      visiblePlantResourcePoints,
      visibleRockPoints,
      visibleTreePoints,
    ],
  );

  const playerRuntimeElements = useMemo(
    () => (
      <>
        <Suspense
          fallback={
            <PlayerFallback
              initialPosition={initialPlayerPosition}
              playerRef={playerRef}
            />
          }
        >
          <PlayerAvatar
            attackRequestRef={attackRequestRef}
            attackTimingRef={attackTimingRef}
            cursorLookRef={cursorLookRef}
            equipment={equipment}
            equippedWeaponId={equippedWeaponId}
            initialPosition={initialPlayerPosition}
            isBlockingRef={isPlayerBlockingRef}
            isDeadRef={isPlayerDeadRef}
            isMovingRef={isPlayerMovingRef}
            isRunningRef={isPlayerRunningRef}
            playerRef={playerRef}
            publishHeadLook
            torchEquipped={torchEquipped}
            toolStateRef={toolStateRef}
          />
          <Creatures
            attackableRegistryRef={attackableRegistryRef}
            creatureStates={creatureStates}
            onAttack={triggerAttack}
            visibleWindow={visibleWindow}
          />
          {visibleProps.map((prop) => (
            <WorldModel
              key={prop.url}
              url={prop.url}
              position={positionOnTerrain(prop.position)}
              scale={prop.scale}
              rotation={prop.rotation}
            />
          ))}
          <RemotePlayers
            attackableRegistryRef={attackableRegistryRef}
            buildings={buildings}
            onAttack={triggerAttack}
            players={remotePlayers}
            visibleWindow={visibleWindow}
          />
        </Suspense>
        <DestinationRing ringRef={ringRef} />
        <CombatFloaters items={combatFloaters} playerRef={playerRef} />
        <SceneRuntime
          buildings={buildings}
          cameraOffset={cameraOffset}
          hydratedPlayerObjectRef={hydratedPlayerObjectRef}
          initialPlayerPosition={initialPlayerPosition}
          isPlayerMovingRef={isPlayerMovingRef}
          isPlayerBlockingRef={isPlayerBlockingRef}
          isPlayerDeadRef={isPlayerDeadRef}
          isPlayerRunningRef={isPlayerRunningRef}
          playerRef={playerRef}
          playerPositionAppliedRef={playerPositionAppliedRef}
          moveTargetRef={moveTargetRef}
          resourceStates={resourceStates}
          ringRef={ringRef}
        />
        <PlayerOcclusionFader playerRef={playerRef} />
      </>
    ),
    [
      buildings,
      cameraOffset,
      combatFloaters,
      creatureStates,
      equippedWeaponId,
      initialPlayerPosition,
      inputReady,
      resourceStates,
      remotePlayers,
      torchEquipped,
      visibleProps,
      visibleWindow,
    ],
  );

  return (
    <>
      <CanvasCursorTracker cursorLookRef={cursorLookRef} inputReady={inputReady} />
      <AtmosphericSky />
      <SceneLightingRig
        playerRef={playerRef}
        qualityConfig={qualityConfig}
        settings={settings}
      />
      <Ground
        inputReady={inputReady}
        isBuildMode={buildOpen}
        isDestroyMode={destroyModifier}
        onAttack={triggerAttack}
        onBuildPlace={placeCurrentBuild}
        onBuildPointer={updateBuildPreview}
        onMoveTarget={setMoveTarget}
      />
      <PlayerTorchFillLight
        playerRef={playerRef}
        torchEquipped={torchEquipped}
      />
      <RainWeather playerRef={playerRef} />
      <GatherParticles particlesRef={gatherParticlesRef} />
      {settings.contactShadows && (
        <WebGlOnlyContactShadows qualityConfig={qualityConfig} />
      )}
      {groundCoverElements}
      {buildingElements}
      <BuildingPreview preview={buildPreview} />
      {resourceModelElements}
      {resourceOverlayElements}
      {playerRuntimeElements}
    </>
  );
}

function RenderSettingsMenu({
  isOpen,
  onOpenChange,
  onSettingsChange,
  settings,
}) {
  const setSetting = (key, value) => {
    onSettingsChange((current) =>
      sanitizeRenderSettings({ ...current, quality: 'custom', [key]: value }),
    );
  };

  const applyPreset = (preset) => {
    onSettingsChange(sanitizeRenderSettings(preset.settings));
  };

  return (
    <div
      className='render-settings'
      onContextMenu={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className='render-settings-bar'>
        <button
          type='button'
          className='render-settings-toggle'
          aria-expanded={isOpen}
          aria-label='Render settings'
          title='Render settings'
          onClick={() => onOpenChange((current) => !current)}
        >
          <svg aria-hidden='true' viewBox='0 0 24 24'>
            <path d='M12 8.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z' />
            <path d='M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.5-2.4 1a8.2 8.2 0 0 0-2.6-1.5L14.1 2h-4.2l-.3 3a8.2 8.2 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0 0 3l-2 1.5 2 3.5 2.4-1a8.2 8.2 0 0 0 2.6 1.5l.3 3h4.2l.3-3a8.2 8.2 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z' />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className='render-settings-panel'>
          <div
            className='settings-presets'
            role='group'
            aria-label='Quality presets'
          >
            {Object.entries(RENDER_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type='button'
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <label className='settings-row'>
            <span>Render Scale</span>
            <select
              value={settings.renderScale}
              onChange={(event) =>
                setSetting('renderScale', Number(event.target.value))
              }
            >
              <option value={1}>1x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
            </select>
          </label>

          <label className='settings-row'>
            <span>Ground Cover</span>
            <input
              type='range'
              min='0'
              max={MAX_GROUND_COVER_COUNT}
              step='12'
              value={settings.groundCoverCount}
              onChange={(event) =>
                setSetting('groundCoverCount', Number(event.target.value))
              }
            />
            <output>{settings.groundCoverCount}</output>
          </label>

          <label className='settings-check'>
            <input
              type='checkbox'
              checked={settings.mainShadows}
              onChange={(event) =>
                setSetting('mainShadows', event.target.checked)
              }
            />
            Main Shadows
          </label>

          <label className='settings-check'>
            <input
              type='checkbox'
              checked={settings.contactShadows}
              onChange={(event) =>
                setSetting('contactShadows', event.target.checked)
              }
            />
            Contact Shadows
          </label>

          <label className='settings-check'>
            <input
              type='checkbox'
              checked={settings.showStats}
              onChange={(event) =>
                setSetting('showStats', event.target.checked)
              }
            />
            FPS Stats
          </label>
        </div>
      )}
    </div>
  );
}

function PerformanceStats() {
  const statsRef = useRef(null);

  useEffect(() => {
    const stats = new Stats();
    stats.showPanel(0);
    const statsElement = stats.dom;
    statsElement.style.position = 'fixed';
    statsElement.style.top = '0';
    statsElement.style.left = '0';
    statsElement.style.zIndex = '10000';
    statsElement.style.pointerEvents = 'auto';
    document.body.appendChild(statsElement);
    statsRef.current = stats;

    return () => {
      statsRef.current = null;
      statsElement.remove();
    };
  }, []);

  useFrame(() => {
    statsRef.current?.update();
  });

  return null;
}

export default function ThreeWorldPreview() {
  const cameraOffset = useMemo(() => getCameraOffset(CAMERA_TUNING), []);
  const initialCameraPosition = useMemo(() => {
    const player = gameRuntimeStore.getState().player;
    return [
      (Number(player.x) || 0) + cameraOffset.x,
      (Number(player.y) || 0) + cameraOffset.y,
      (Number(player.z) || 0) + cameraOffset.z,
    ];
  }, [cameraOffset]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(loadRenderSettings);
  const [worldDataReady, setWorldDataReady] = useState(isWorldDataReady);
  const [assetsReady, setAssetsReady] = useState(false);
  const [vegetationReady, setVegetationReady] = useState(false);
  const [sceneWarmupReady, setSceneWarmupReady] = useState(false);
  const loadingStepsComplete = useGameUiStore((state) =>
    state.loadingSteps.every((step) => step.status === 'complete'),
  );
  const handleAssetsReady = useCallback(() => {
    setAssetsReady(true);
  }, []);
  const handleVegetationReady = useCallback(() => {
    setVegetationReady(true);
  }, []);
  const qualityConfig =
    RENDER_QUALITY_CONFIG[settings.quality] ?? RENDER_QUALITY_CONFIG.balanced;
  const canvasDpr = useMemo(() => {
    const devicePixelRatio =
      typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    return [
      1,
      Math.min(settings.renderScale, MAX_CANVAS_DPR, devicePixelRatio),
    ];
  }, [settings.renderScale]);

  useEffect(() => {
    const roundedOffset = getRoundedCameraOffset(CAMERA_TUNING);
    gameRuntimeStore.getState().setCamera({
      distance: CAMERA_TUNING.distance,
      angle: CAMERA_TUNING.angle,
      offset: roundedOffset,
    });
  }, []);

  useEffect(() => {
    const handleWorldDataReady = () => setWorldDataReady(true);
    window.addEventListener(WORLD_DATA_READY_EVENT, handleWorldDataReady);
    setWorldDataReady(isWorldDataReady());
    return () => {
      window.removeEventListener(WORLD_DATA_READY_EVENT, handleWorldDataReady);
    };
  }, []);

  useEffect(() => {
    if (
      !worldDataReady ||
      !assetsReady ||
      !vegetationReady ||
      sceneWarmupReady
    ) {
      return;
    }

    let cancelled = false;
    let warmupTimer = null;
    let frameId = null;
    let timeReady = false;
    let framesReady = false;

    const completeIfReady = () => {
      if (cancelled || !timeReady || !framesReady) return;
      setLoadingStep('settle', {
        status: 'complete',
        detail: 'Scene warmed up.',
      });
      setSceneWarmupReady(true);
    };
    const waitFrames = (remaining) => {
      if (remaining <= 0) {
        framesReady = true;
        completeIfReady();
        return;
      }
      frameId = window.requestAnimationFrame(() => waitFrames(remaining - 1));
    };

    setLoadingStep('settle', {
      status: 'loading',
      detail: 'Warming shadows and first frames...',
    });
    warmupTimer = window.setTimeout(() => {
      timeReady = true;
      completeIfReady();
    }, SCENE_WARMUP_MS);
    waitFrames(SCENE_WARMUP_FRAMES);

    return () => {
      cancelled = true;
      if (warmupTimer != null) window.clearTimeout(warmupTimer);
      if (frameId != null) window.cancelAnimationFrame(frameId);
    };
  }, [assetsReady, sceneWarmupReady, vegetationReady, worldDataReady]);

  useEffect(() => {
    if (!sceneWarmupReady || !loadingStepsComplete) return;
    const loadingScreen = document.getElementById('loadingScreen');
    if (!loadingScreen || loadingScreen.classList.contains('is-error')) return;
    setLoadingDetail('Entering Mossvale...');
    gameUiStore.getState().hideLoading();
    loadingScreen.classList.add('is-hidden');
  }, [loadingStepsComplete, sceneWarmupReady]);

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  return (
    <div
      className='three-world-preview'
      onContextMenu={(event) => event.preventDefault()}
    >
      <Canvas
        dpr={canvasDpr}
        gl={(props) => createThreeRenderer(props, qualityConfig)}
        onCreated={({ gl }) => {
          if (gl.shadowMap) gl.shadowMap.type = THREE.VSMShadowMap;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = SCENE_LIGHTING.toneMappingExposure;
        }}
        shadows={settings.mainShadows || settings.contactShadows}
        camera={{
          position: initialCameraPosition,
          fov: 40,
          near: 1,
          far: 6000,
        }}
      >
        <color attach='background' args={[SCENE_LIGHTING.backgroundColor]} />
        {settings.fogEnabled && (
          <fog
            attach='fog'
            args={[
              SCENE_LIGHTING.fogColor,
              getFogDistance(SCENE_LIGHTING.fogNear, settings.fogIntensity),
              getFogDistance(SCENE_LIGHTING.fogFar, settings.fogIntensity),
            ]}
          />
        )}
        <LoadingProgressBridge />
        {settings.showStats && <PerformanceStats />}
        <Suspense fallback={null}>
          <CoreAssetPreloader onReady={handleAssetsReady} />
          <VegetationAssetPreloader onReady={handleVegetationReady} />
        </Suspense>
        <SceneContent
          cameraOffset={cameraOffset}
          qualityConfig={qualityConfig}
          settings={settings}
        />
        <SceneEnvironmentCycle settings={settings} />
      </Canvas>
      <RenderSettingsMenu
        isOpen={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSettingsChange={setSettings}
        settings={settings}
      />
    </div>
  );
}

useGLTF.preload(KNIGHT_MODEL_URL);
useGLTF.preload(AXE_MODEL_URL);
useGLTF.preload(SWORD_MODEL_URL);
Object.values(KAYKIT_HELD_WEAPON_MODEL_URLS).forEach((url) => {
  useGLTF.preload(url);
});
useGLTF.preload(`${ADVENTURER_ANIMATION_BASE}Rig_Medium_MovementBasic.glb`);
useGLTF.preload(`${ADVENTURER_ANIMATION_BASE}Rig_Medium_General.glb`);
useGLTF.preload(MONSTER_MODEL_URLS.pinkBlob);
useGLTF.preload(MONSTER_MODEL_URLS.orc);
useGLTF.preload(MONSTER_MODEL_URLS.mushnub);
useGLTF.preload(MONSTER_MODEL_URLS.dragon);
