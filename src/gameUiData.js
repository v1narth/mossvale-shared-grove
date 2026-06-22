import { publicAssetUrl } from './publicAssets.js';

export const PLAYER_NAME_STORAGE_KEY = 'mossvale_player_name';

export const RESOURCE_KEYS = ['wood', 'stone', 'flower', 'cotton'];
export const BAG_SLOT_COUNT = 30;
export const QUICK_SLOT_COUNT = 9;
export const EQUIPMENT_SLOTS = ['head', 'weapon', 'body', 'offhand', 'charm', 'legs', 'charm2', 'feet'];

const INVENTORY_ICON_BASE = publicAssetUrl('inventory');
const CRAFT_RESOURCE_ICON_BASE = `${INVENTORY_ICON_BASE}/craft-resources`;

function inventoryImage(key) {
  return `${INVENTORY_ICON_BASE}/${key}.png`;
}

function craftResourceImage(resourceKey, fileName) {
  return `${CRAFT_RESOURCE_ICON_BASE}/${resourceKey}/${fileName}.png`;
}

export const resourceTierImages = {
  wood: [
    craftResourceImage('wood', 't1_raw_log'),
    craftResourceImage('wood', 't2_planks'),
    craftResourceImage('wood', 't3_blocks'),
    craftResourceImage('wood', 't4_rare_timber'),
  ],
  stone: [
    craftResourceImage('stone', 't1_raw_stone'),
    craftResourceImage('stone', 't2_brick'),
    craftResourceImage('stone', 't3_ore'),
    craftResourceImage('stone', 't4_crystal'),
  ],
  flower: [
    craftResourceImage('flower', 't1_bloom'),
    craftResourceImage('flower', 't2_petals'),
    craftResourceImage('flower', 't3_rare_bloom'),
    craftResourceImage('flower', 't4_glowleaf'),
  ],
  cotton: [
    craftResourceImage('cotton', 't1_cotton'),
    craftResourceImage('cotton', 't2_spun_thread'),
    craftResourceImage('cotton', 't3_cloth_roll'),
    craftResourceImage('cotton', 't4_fine_bolt'),
  ],
};

export function resourceTierImage(resourceKey, tier = 1) {
  const tiers = resourceTierImages[resourceKey];
  if (!tiers?.length) return inventoryImage(resourceKey);
  const tierIndex = Math.max(0, Math.min(tiers.length - 1, Math.floor(tier) - 1));
  return tiers[tierIndex];
}

export const weaponDefs = [
  { id: 'stick', name: 'Walking Stick', icon: 'K', image: inventoryImage('stick'), level: 1, range: 36, cooldown: 0.66, damage: 1, speed: 0, color: '#d7a45c', type: 'Weapon', weaponType: 'melee', starter: true, desc: 'A starter branch. Good enough for light defense while you gather crafting parts.' },
  { id: 'sword', name: 'Knight Sword', icon: 'S', image: inventoryImage('sword'), level: 1, range: 48, cooldown: 0.48, damage: 2, speed: 0, color: '#eef3df', type: 'Weapon', weaponType: 'melee', desc: 'A KayKit one-handed sword with a clean, reliable close-range swing.' },
  { id: 'dagger', name: 'Rogue Dagger', icon: 'D', image: inventoryImage('dagger'), level: 1, range: 38, cooldown: 0.36, damage: 1, speed: 0, color: '#d9e0cf', type: 'Weapon', weaponType: 'melee', desc: 'A quick KayKit dagger for fast close-range cuts.' },
  { id: 'bow', name: 'Ranger Bow', icon: 'B', image: inventoryImage('bow'), level: 2, range: 260, cooldown: 0.96, damage: 2, speed: 500, color: '#f0d27a', type: 'Weapon', weaponType: 'arrow', desc: 'A KayKit bow with a visible string and long-range arrows.' },
  { id: 'crossbow', name: 'Rogue Crossbow', icon: 'C', image: inventoryImage('crossbow'), level: 3, range: 285, cooldown: 1.05, damage: 3, speed: 620, color: '#d6ccb8', type: 'Weapon', weaponType: 'arrow', desc: 'A sturdy KayKit crossbow for slower, heavier ranged shots.' },
  { id: 'wand', name: 'Mage Wand', icon: 'W', image: inventoryImage('wand'), level: 3, range: 320, cooldown: 1.08, damage: 2, speed: 720, color: '#cfb2ff', type: 'Weapon', weaponType: 'spark', desc: 'A KayKit wand for quick firebolts and careful long-range aim.' },
  { id: 'staff', name: 'Mage Staff', icon: 'F', image: inventoryImage('staff'), level: 4, range: 380, cooldown: 1.18, damage: 3, speed: 820, color: '#b99cff', type: 'Weapon', weaponType: 'spark', desc: 'A full KayKit staff with fast, heavy magical reach.' },
  { id: 'battle_axe', name: 'Battle Axe', icon: 'A', image: inventoryImage('battle_axe'), level: 3, range: 54, cooldown: 0.78, damage: 3, speed: 0, color: '#d8b16b', type: 'Weapon', weaponType: 'melee', desc: 'A one-handed KayKit axe with weightier melee hits.' },
  { id: 'great_axe', name: 'Great Axe', icon: 'G', image: inventoryImage('great_axe'), level: 4, range: 62, cooldown: 1.08, damage: 4, speed: 0, color: '#e1bd78', type: 'Weapon', weaponType: 'melee', desc: 'A two-handed KayKit axe for slow, heavy close-range impact.' },
];

export const itemDefs = [
  { key: 'wood', name: 'Wood', singular: 'wood', plural: 'wood', image: resourceTierImage('wood', 1), tierImages: resourceTierImages.wood, className: 'wood', type: 'Resource', level: 1, desc: 'Building material gathered from roundleaf trees. Used for foundations, walls, planting, and wooden gear.' },
  { key: 'stone', name: 'Stone', singular: 'stone', plural: 'stone', image: resourceTierImage('stone', 1), tierImages: resourceTierImages.stone, className: 'stone', type: 'Resource', level: 2, desc: 'Heavy moss stone gathered from rocks. Useful for blades, heads, and sturdy crafted pieces.' },
  { key: 'flower', name: 'Flowers', singular: 'flower', plural: 'flowers', image: resourceTierImage('flower', 1), tierImages: resourceTierImages.flower, className: 'flower', type: 'Resource', level: 1, desc: 'Bright grove petals picked near lakes and soft clearings. A cheerful crafting ingredient.' },
  { key: 'cotton', name: 'Cotton', singular: 'cotton', plural: 'cotton', image: resourceTierImage('cotton', 1), tierImages: resourceTierImages.cotton, className: 'cotton', type: 'Resource', level: 1, desc: 'Soft white fiber picked from cotton tufts. Essential for bandages and bowstrings.' },
  { key: 'wood_block', name: 'Wood Block', singular: 'wood block', plural: 'wood blocks', image: resourceTierImage('wood', 2), className: 'wood-block', type: 'Material', level: 1, desc: 'Squared wood refined from raw logs. Used for weapon handles, shields, and sturdy craft frames.' },
  { key: 'stone_brick', name: 'Stone Brick', singular: 'stone brick', plural: 'stone bricks', image: resourceTierImage('stone', 2), className: 'stone-brick', type: 'Material', level: 2, desc: 'Cut stone refined from moss rock. Used for blades, hammer heads, and stronger fittings.' },
  { key: 'cloth', name: 'Cloth', singular: 'cloth', plural: 'cloth', image: resourceTierImage('cotton', 3), className: 'cloth', type: 'Material', level: 1, desc: 'Woven cotton cloth. Used for bandages, bowstrings, padding, and travel gear.' },
  { key: 'petal_extract', name: 'Petal Extract', singular: 'petal extract', plural: 'petal extract', image: resourceTierImage('flower', 3), className: 'petal-extract', type: 'Material', level: 2, desc: 'Pressed glowflower essence. Used for utility craft, charms, and energy weapons.' },
  { key: 'bandage', name: 'Bandage', singular: 'bandage', plural: 'bandages', image: inventoryImage('bandage'), className: 'bandage', type: 'Consumable', displayType: 'Consumable', level: 1, desc: 'A clean cotton wrap with petals tucked in. Use it to restore 2 health.', useLabel: 'use bandage' },
  { key: 'torch', name: 'Torch', singular: 'torch', plural: 'torches', image: inventoryImage('torch'), className: 'torch', type: 'Utility', displayType: 'Utility', level: 1, slot: 'offhand', desc: 'A pitch-wrapped branch that throws warm light around you. Equip it in your offhand to brighten the nearby grove.', useLabel: 'equip' },
  { key: 'cloth_cap', name: 'Cloth Cap', singular: 'cloth cap', plural: 'cloth caps', image: inventoryImage('cloth_cap'), className: 'armor-head', type: 'Armor', displayType: 'Armor', level: 1, slot: 'head', hpBonus: 1, desc: 'A soft cap that keeps your head out of trouble. Equip for +1 max health.', useLabel: 'equip' },
  { key: 'padded_vest', name: 'Padded Vest', singular: 'padded vest', plural: 'padded vests', image: inventoryImage('padded_vest'), className: 'armor-body', type: 'Armor', displayType: 'Armor', level: 2, slot: 'body', hpBonus: 2, desc: 'Layered cloth padding over a small wood frame. Equip for +2 max health.', useLabel: 'equip' },
  { key: 'wooden_shield', name: 'Wooden Shield', singular: 'wooden shield', plural: 'wooden shields', image: inventoryImage('wooden_shield'), className: 'armor-offhand', type: 'Armor', displayType: 'Armor', level: 2, slot: 'offhand', hpBonus: 1, desc: 'A blocky offhand guard made from refined wood. Equip for +1 max health.', useLabel: 'equip' },
  { key: 'trail_boots', name: 'Trail Boots', singular: 'trail boots', plural: 'trail boots', image: inventoryImage('trail_boots'), className: 'armor-feet', type: 'Armor', displayType: 'Armor', level: 2, slot: 'feet', hpBonus: 1, desc: 'Cloth boots with stone-studded soles. Equip for +1 max health.', useLabel: 'equip' },
  { key: 'petal_charm', name: 'Petal Charm', singular: 'petal charm', plural: 'petal charms', image: inventoryImage('petal_charm'), className: 'armor-charm', type: 'Armor', displayType: 'Armor', level: 3, slot: 'charm', hpBonus: 1, desc: 'A tiny woven charm soaked in glowflower extract. Equip for +1 max health.', useLabel: 'equip' },
];

export const craftCategories = [
  { id: 'materials', name: 'Materials' },
  { id: 'utilities', name: 'Utilities' },
  { id: 'weapons', name: 'Weapons' },
  { id: 'armor', name: 'Armor' },
];

export const craftingRecipes = [
  { id: 'wood_block', category: 'materials', output: { key: 'wood_block', count: 1 }, cost: { wood: 3 }, desc: 'Refine raw wood into a sturdy block.' },
  { id: 'stone_brick', category: 'materials', output: { key: 'stone_brick', count: 1 }, cost: { stone: 3 }, desc: 'Cut raw stone into a usable brick.' },
  { id: 'cloth', category: 'materials', output: { key: 'cloth', count: 1 }, cost: { cotton: 3 }, desc: 'Weave cotton into crafting cloth.' },
  { id: 'petal_extract', category: 'materials', output: { key: 'petal_extract', count: 1 }, cost: { flower: 3 }, desc: 'Press flowers into bright extract.' },
  { id: 'bandage', category: 'utilities', output: { key: 'bandage', count: 1 }, cost: { cloth: 1, petal_extract: 1 }, desc: 'Restore 2 health when used.' },
  { id: 'torch', category: 'utilities', output: { key: 'torch', equipment: true }, cost: { wood_block: 1, cloth: 1, petal_extract: 1 }, desc: 'Equip in your offhand to light the nearby area.' },
  { id: 'sword', category: 'weapons', output: { key: 'sword', weapon: true }, cost: { wood_block: 2, stone_brick: 1 }, desc: 'Craft a KayKit one-handed sword.' },
  { id: 'dagger', category: 'weapons', output: { key: 'dagger', weapon: true }, cost: { wood_block: 1, stone_brick: 1 }, desc: 'Craft a KayKit rogue dagger.' },
  { id: 'bow', category: 'weapons', output: { key: 'bow', weapon: true }, cost: { wood_block: 2, cloth: 1 }, desc: 'Craft a KayKit ranger bow.' },
  { id: 'crossbow', category: 'weapons', output: { key: 'crossbow', weapon: true }, cost: { wood_block: 2, stone_brick: 2, cloth: 1 }, desc: 'Craft a KayKit rogue crossbow.' },
  { id: 'wand', category: 'weapons', output: { key: 'wand', weapon: true }, cost: { wood_block: 1, stone_brick: 1, petal_extract: 2 }, desc: 'Craft a KayKit mage wand.' },
  { id: 'staff', category: 'weapons', output: { key: 'staff', weapon: true }, cost: { wood_block: 2, stone_brick: 1, petal_extract: 3 }, desc: 'Craft a KayKit mage staff.' },
  { id: 'battle_axe', category: 'weapons', output: { key: 'battle_axe', weapon: true }, cost: { wood_block: 2, stone_brick: 2 }, desc: 'Craft a KayKit one-handed axe.' },
  { id: 'great_axe', category: 'weapons', output: { key: 'great_axe', weapon: true }, cost: { wood_block: 3, stone_brick: 3 }, desc: 'Craft a KayKit two-handed axe.' },
  { id: 'cloth_cap', category: 'armor', output: { key: 'cloth_cap', armor: true }, cost: { cloth: 1 }, desc: 'Head armor. +1 max health.' },
  { id: 'padded_vest', category: 'armor', output: { key: 'padded_vest', armor: true }, cost: { cloth: 3, wood_block: 1 }, desc: 'Body armor. +2 max health.' },
  { id: 'wooden_shield', category: 'armor', output: { key: 'wooden_shield', armor: true }, cost: { wood_block: 2, cloth: 1 }, desc: 'Offhand armor. +1 max health.' },
  { id: 'trail_boots', category: 'armor', output: { key: 'trail_boots', armor: true }, cost: { cloth: 2, stone_brick: 1 }, desc: 'Foot armor. +1 max health.' },
  { id: 'petal_charm', category: 'armor', output: { key: 'petal_charm', armor: true }, cost: { cloth: 1, petal_extract: 2 }, desc: 'Charm armor. +1 max health.' },
];

export const buildPieces = [
  { id: 'foundation', name: 'Foundation', level: 1, cost: 2, w: 160, h: 160, blocks: false, color: '#caa46b' },
  { id: 'wall', name: 'Wall', level: 1, cost: 3, w: 160, h: 40, blocks: true, color: '#9a6b43' },
  { id: 'door', name: 'Door', level: 2, cost: 4, w: 160, h: 40, blocks: false, color: '#7c5536' },
  { id: 'window', name: 'Window', level: 2, cost: 4, w: 160, h: 40, blocks: true, color: '#a8784f' },
  { id: 'roof', name: 'Roof', level: 2, cost: 5, w: 160, h: 160, blocks: false, color: '#8f6a42' },
];

const ICON_BASE = 'https://game-icons.net/icons/ffffff/000000/1x1';

function gameIcon(author, slug) {
  return `${ICON_BASE}/${author}/${slug}.svg`;
}

export const abilitySets = {
  stick: [
    { id: 'stick_q', name: 'Poke', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 1.8, desc: 'A quick cautious jab.' },
    { id: 'stick_w', name: 'Brace', icon: gameIcon('lorc', 'riot-shield'), cooldown: 6.2, desc: 'Briefly blocks the next incoming hit.' },
    { id: 'stick_e', name: 'Step', icon: gameIcon('lorc', 'sprint'), cooldown: 5.2, desc: 'Hop forward and jab.' },
    { id: 'stick_r', name: 'Sweep', icon: gameIcon('delapouite', 'dagger-rose'), cooldown: 8.5, desc: 'A modest sweep around you.' },
  ],
  sword: [
    { id: 'sword_q', name: 'Quick Cut', icon: gameIcon('delapouite', 'dagger-rose'), cooldown: 1.4, desc: 'Fast short slash in your aim direction.' },
    { id: 'sword_w', name: 'Guard', icon: gameIcon('lorc', 'riot-shield'), cooldown: 5.5, desc: 'Briefly blocks the next incoming hit.' },
    { id: 'sword_e', name: 'Lunge', icon: gameIcon('lorc', 'sprint'), cooldown: 4.6, desc: 'Dash forward and slash on arrival.' },
    { id: 'sword_r', name: 'Whirl', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 7.2, desc: 'A soft spinning slash around you.' },
  ],
  dagger: [
    { id: 'dagger_q', name: 'Stab', icon: gameIcon('delapouite', 'dagger-rose'), cooldown: 1.1, desc: 'A fast close jab.' },
    { id: 'dagger_w', name: 'Feint', icon: gameIcon('lorc', 'sprint'), cooldown: 4.8, desc: 'Step aside and cut back in.' },
    { id: 'dagger_e', name: 'Gouge', icon: gameIcon('delapouite', 'medallist'), cooldown: 5.8, desc: 'A committed short strike.' },
    { id: 'dagger_r', name: 'Flurry', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 8.2, desc: 'A tight burst of knife cuts.' },
  ],
  bow: [
    { id: 'bow_q', name: 'Aimed', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 2.4, desc: 'A stronger arrow with extra reach.' },
    { id: 'bow_w', name: 'Volley', icon: gameIcon('lorc', 'transfuse'), cooldown: 6.8, desc: 'Three arrows fan through the grove.' },
    { id: 'bow_e', name: 'Bramble', icon: gameIcon('lorc', 'vine-leaf'), cooldown: 7.8, desc: 'Pinprick burst at the aimed patch.' },
    { id: 'bow_r', name: 'Flare', icon: gameIcon('delapouite', 'soul'), cooldown: 9.5, desc: 'A bright scout flare that clips a wide patch.' },
  ],
  crossbow: [
    { id: 'crossbow_q', name: 'Bolt', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 2.7, desc: 'A heavy straight bolt.' },
    { id: 'crossbow_w', name: 'Pin', icon: gameIcon('delapouite', 'ringed-tentacle'), cooldown: 6.6, desc: 'A careful shot that rewards spacing.' },
    { id: 'crossbow_e', name: 'Crank', icon: gameIcon('delapouite', 'medallist'), cooldown: 8.2, desc: 'Set up a harder follow-up.' },
    { id: 'crossbow_r', name: 'Barrage', icon: gameIcon('lorc', 'transfuse'), cooldown: 10.5, desc: 'Loose a compact spread of bolts.' },
  ],
  pistol: [
    { id: 'pistol_q', name: 'Double', icon: gameIcon('delapouite', 'medallist'), cooldown: 2.2, desc: 'Two quick shots with tiny spread.' },
    { id: 'pistol_w', name: 'Roll', icon: gameIcon('lorc', 'sprint'), cooldown: 5.5, desc: 'Hop forward and fire from the hip.' },
    { id: 'pistol_e', name: 'Ricochet', icon: gameIcon('lorc', 'transfuse'), cooldown: 7.2, desc: 'Instantly tags up to three nearby bots.' },
    { id: 'pistol_r', name: 'Smoke', icon: gameIcon('delapouite', 'soul'), cooldown: 8.5, desc: 'Pop smoke, shove close bots, and block briefly.' },
  ],
  rifle: [
    { id: 'rifle_q', name: 'Mark', icon: gameIcon('delapouite', 'medallist'), cooldown: 3.8, desc: 'Heavy single shot with long reach.' },
    { id: 'rifle_w', name: 'Pierce', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 7.4, desc: 'A straight piercing round.' },
    { id: 'rifle_e', name: 'Focus', icon: gameIcon('delapouite', 'soul'), cooldown: 8.5, desc: 'Steady breath, then a brutal hit.' },
    { id: 'rifle_r', name: 'Thunder', icon: gameIcon('lorc', 'dragon-head'), cooldown: 11, desc: 'A loud impact at the aimed patch.' },
  ],
  laser: [
    { id: 'laser_q', name: 'Pulse', icon: gameIcon('delapouite', 'soul'), cooldown: 2.1, desc: 'Clean fast energy pulse.' },
    { id: 'laser_w', name: 'Prism', icon: gameIcon('lorc', 'transfuse'), cooldown: 6.4, desc: 'Five tiny beams in a prism fan.' },
    { id: 'laser_e', name: 'Blink', icon: gameIcon('lorc', 'sprint'), cooldown: 7.5, desc: 'Blink forward and emit a short ray.' },
    { id: 'laser_r', name: 'Overbeam', icon: gameIcon('lorc', 'dragon-head'), cooldown: 10.5, desc: 'A long instant beam through the aim line.' },
  ],
  spear: [
    { id: 'spear_q', name: 'Jab', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 1.8, desc: 'Long narrow poke.' },
    { id: 'spear_w', name: 'Sweep', icon: gameIcon('delapouite', 'dagger-rose'), cooldown: 5.2, desc: 'Wide crescent sweep.' },
    { id: 'spear_e', name: 'Vault', icon: gameIcon('lorc', 'sprint'), cooldown: 6.2, desc: 'Leap forward with a spear point.' },
    { id: 'spear_r', name: 'Pin', icon: gameIcon('delapouite', 'ringed-tentacle'), cooldown: 8.4, desc: 'Committed thrust with heavy damage.' },
  ],
  wand: [
    { id: 'wand_q', name: 'Spark', icon: gameIcon('delapouite', 'soul'), cooldown: 2.3, desc: 'A slow bright spark.' },
    { id: 'wand_w', name: 'Ring', icon: gameIcon('delapouite', 'ringed-tentacle'), cooldown: 7.2, desc: 'Fairy ring around your feet.' },
    { id: 'wand_e', name: 'Bloom', icon: gameIcon('lorc', 'vine-leaf'), cooldown: 7.8, desc: 'Magic bloom at the aimed patch.' },
    { id: 'wand_r', name: 'Comet', icon: gameIcon('lorc', 'dragon-head'), cooldown: 10, desc: 'A lazy comet burst.' },
  ],
  staff: [
    { id: 'staff_q', name: 'Spark', icon: gameIcon('delapouite', 'soul'), cooldown: 2.5, desc: 'A heavier magic spark.' },
    { id: 'staff_w', name: 'Ward', icon: gameIcon('lorc', 'riot-shield'), cooldown: 7.4, desc: 'A brief magical guard.' },
    { id: 'staff_e', name: 'Bloom', icon: gameIcon('lorc', 'vine-leaf'), cooldown: 8.2, desc: 'A larger grove burst.' },
    { id: 'staff_r', name: 'Comet', icon: gameIcon('lorc', 'dragon-head'), cooldown: 10.8, desc: 'A slow heavy comet.' },
  ],
  battle_axe: [
    { id: 'battle_axe_q', name: 'Cleave', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 1.9, desc: 'A weighty close chop.' },
    { id: 'battle_axe_w', name: 'Brace', icon: gameIcon('lorc', 'riot-shield'), cooldown: 6.2, desc: 'Plant your feet and guard.' },
    { id: 'battle_axe_e', name: 'Rush', icon: gameIcon('lorc', 'sprint'), cooldown: 6.6, desc: 'Step in with a hard axe hit.' },
    { id: 'battle_axe_r', name: 'Sweep', icon: gameIcon('delapouite', 'dagger-rose'), cooldown: 9.4, desc: 'A broad axe sweep.' },
  ],
  great_axe: [
    { id: 'great_axe_q', name: 'Hew', icon: gameIcon('skoll', 'drop-weapon'), cooldown: 2.4, desc: 'A slow heavy chop.' },
    { id: 'great_axe_w', name: 'Quake', icon: gameIcon('lorc', 'transfuse'), cooldown: 8.0, desc: 'A heavy stomp and swing.' },
    { id: 'great_axe_e', name: 'Shove', icon: gameIcon('lorc', 'sprint'), cooldown: 7.2, desc: 'Push forward behind the axe.' },
    { id: 'great_axe_r', name: 'Reap', icon: gameIcon('lorc', 'dragon-head'), cooldown: 11.2, desc: 'A broad finishing arc.' },
  ],
  hammer: [
    { id: 'hammer_q', name: 'Bonk', icon: gameIcon('delapouite', 'medallist'), cooldown: 2.6, desc: 'Short heavy smack.' },
    { id: 'hammer_w', name: 'Quake', icon: gameIcon('lorc', 'transfuse'), cooldown: 7.8, desc: 'Ground thump around you.' },
    { id: 'hammer_e', name: 'Shove', icon: gameIcon('lorc', 'sprint'), cooldown: 6.4, desc: 'Step in with a punishing shove.' },
    { id: 'hammer_r', name: 'Crater', icon: gameIcon('lorc', 'dragon-head'), cooldown: 11.5, desc: 'Big slow impact at the aimed patch.' },
  ],
  blaster: [
    { id: 'blaster_q', name: 'Burst', icon: gameIcon('lorc', 'transfuse'), cooldown: 2.8, desc: 'Three punchy energy shots.' },
    { id: 'blaster_w', name: 'Comet', icon: gameIcon('lorc', 'dragon-head'), cooldown: 6.2, desc: 'One heavy pink bolt.' },
    { id: 'blaster_e', name: 'Shell', icon: gameIcon('lorc', 'riot-shield'), cooldown: 8.2, desc: 'Bubble up and shock close bots.' },
    { id: 'blaster_r', name: 'Star', icon: gameIcon('delapouite', 'soul'), cooldown: 10.8, desc: 'A wide starburst of bright shots.' },
  ],
};

export function emptyInventory() {
  return Object.fromEntries(itemDefs.map((item) => [item.key, 0]));
}

export function emptyEquipment() {
  return Object.fromEntries(EQUIPMENT_SLOTS.map((slot) => [slot, null]));
}

export function defaultOwnedWeapons() {
  return Object.fromEntries(weaponDefs.filter((weapon) => weapon.starter).map((weapon) => [weapon.id, true]));
}

export function normalizeInventory(items = {}) {
  const next = { ...emptyInventory() };
  for (const [key, value] of Object.entries(items || {})) {
    if (key in next) next[key] = Math.max(0, Number(value) || 0);
  }
  return next;
}

export function baseItemForKey(key) {
  if (!key) return null;
  const weapon = weaponDefs.find((item) => item.id === key || item.key === key);
  if (weapon) return { ...weapon, key: weapon.id, kind: 'weapon', className: 'weapon', displayType: 'Weapon', count: 1 };
  const item = itemDefs.find((def) => def.key === key);
  if (!item) return null;
  const kind =
    item.type === 'Consumable'
      ? 'consumable'
      : item.type === 'Armor'
        ? 'armor'
        : item.type === 'Utility'
          ? 'utility'
          : 'resource';
  return { ...item, kind, count: 0 };
}

export function itemForKey(key) {
  return baseItemForKey(key);
}

export function itemLevel(item) {
  return Math.max(1, Math.floor(item?.level || 1));
}

export function itemLevelText(item) {
  return `Level ${itemLevel(item)}`;
}

export function itemLevelShort(item) {
  return `L${itemLevel(item)}`;
}

export function countLabel(key, count) {
  const item = baseItemForKey(key);
  const amount = Number(count) || 0;
  const name = amount === 1 ? item?.singular || item?.name || key : item?.plural || item?.name || key;
  return `${amount} ${name}`;
}

export function inventorySummary(items = {}) {
  const parts = Object.entries(normalizeInventory(items))
    .filter(([, count]) => count > 0)
    .map(([key, count]) => countLabel(key, count));
  return parts.length ? parts.join(', ') : 'nothing';
}

export function equipmentSlotForItem(item) {
  if (item?.kind === 'weapon') return 'weapon';
  return item?.slot || null;
}

export function compatibleEquipmentSlots(item) {
  const slotId = equipmentSlotForItem(item);
  if (slotId === 'charm') return ['charm', 'charm2'];
  return slotId ? [slotId] : [];
}

export function canEquipItemInSlot(item, slotId) {
  return Boolean(slotId && compatibleEquipmentSlots(item).includes(slotId));
}
