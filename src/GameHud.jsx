import { useEffect, useState } from 'react';
import { ensureAudio, playSfx } from './audioRuntime.js';
import {
  BAG_SLOT_COUNT,
  QUICK_SLOT_COUNT,
  abilitySets,
  buildPieces,
  canEquipItemInSlot,
  compatibleEquipmentSlots,
  craftCategories,
  craftingRecipes,
  equipmentSlotForItem,
  itemForKey,
  itemLevelShort,
  itemLevelText,
  weaponDefs,
} from './gameUiData.js';
import { gameUiStore } from './gameUiStore.js';
import { useGameUiStore } from './useGameUiStore.js';

function percent(current, max) {
  return `${Math.round((current / Math.max(1, max)) * 100)}%`;
}

function ItemIcon({ itemKey, className = '' }) {
  const [failedImage, setFailedImage] = useState(null);
  const item = itemForKey(itemKey);
  if (item?.image && failedImage !== item.image) {
    const itemClass = item?.kind === 'weapon' || item?.type === 'Weapon' ? `weapon-${item.id || item.key}` : item?.className || itemKey || 'wood';
    return (
      <span className={`item-art ${itemClass} ${className}`} aria-hidden="true">
        <img src={item.image} alt="" draggable={false} onError={() => setFailedImage(item.image)} />
      </span>
    );
  }
  if (item?.kind === 'weapon' || item?.type === 'Weapon') {
    return (
      <span
        className={`weapon-prop weapon-${item.id || item.key} ${className}`}
        style={{ '--item-color': item.color }}
        aria-hidden="true"
      />
    );
  }
  return <span className={`item-icon ${item?.className || itemKey || 'wood'} ${className}`} aria-hidden="true" />;
}

function writeDragPayload(event, payload) {
  gameUiStore.getState().setDragPayload(payload);
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('application/json', JSON.stringify(payload));
  event.dataTransfer.setData('text/plain', JSON.stringify(payload));
}

function readDragPayload(event) {
  const transfer = event.dataTransfer?.getData('application/json') || event.dataTransfer?.getData('text/plain');
  if (transfer) {
    try {
      return JSON.parse(transfer);
    } catch {
      return gameUiStore.getState().dragPayload;
    }
  }
  return gameUiStore.getState().dragPayload;
}

function clearDragPayload() {
  gameUiStore.getState().setDragPayload(null);
}

function itemSlotVisual(item) {
  const slotSpecialty =
    item?.kind === 'weapon'
      ? item.weaponType === 'arrow'
        ? 'ranged'
        : item.weaponType === 'spark'
          ? 'magic'
          : 'melee'
      : item?.kind || 'empty';
  const slotLevel = item ? Math.max(1, Math.min(4, Math.floor(item.level || 1))) : 0;
  return {
    className: `inventory-slot-${slotSpecialty} inventory-slot-level-${slotLevel}`,
    style: item ? { '--slot-accent': item.color || '#d7a45c' } : undefined,
  };
}

function moveDroppedPayloadToInventory(payload, index) {
  if (!payload?.key) return false;
  const store = gameUiStore.getState();
  if (payload.source === 'equipment') {
    if (!payload.slotId || !store.unequipItem(payload.slotId)) return false;
  }
  return gameUiStore.getState().moveInventoryItem(payload.key, index);
}

function PlayerCard() {
  const playerName = useGameUiStore((state) => state.playerName);
  const health = useGameUiStore((state) => state.health);
  const energy = useGameUiStore((state) => state.energy);

  return (
    <div className="player-card">
      <div className="player-identity">
        <div id="playerAvatar" className="traveler-avatar" aria-hidden="true">
          <img src="/assets/ui/player-avatar.png" alt="" draggable="false" />
        </div>
        <span id="playerName" className="player-nameplate">
          {playerName}
        </span>
      </div>
      <div className="player-status">
        <div className="status-frame">
          <div className="status-row health-row" aria-label="Health">
            <span>HP</span>
            <div className="health-shell">
              <span id="healthProgress" style={{ width: percent(health.current, health.max) }} />
            </div>
            <strong id="healthCount">
              {health.current}/{health.max}
            </strong>
          </div>
          <div className="status-row energy-row" aria-label="Energy">
            <span>EN</span>
            <div className="energy-shell">
              <span id="energyProgress" style={{ width: percent(energy.current, energy.max) }} />
            </div>
            <strong id="energyCount">
              {energy.current}/{energy.max}
            </strong>
          </div>
        </div>
      </div>
    </div>
  );
}

function GatherHud() {
  const gatherHud = useGameUiStore((state) => state.gatherHud);
  return (
    <div className="gather-hud" id="gatherHud" hidden={!gatherHud} aria-hidden={!gatherHud}>
      <ItemIcon itemKey={gatherHud?.resourceKey || 'wood'} />
      <div className="gather-track">
        <div className="gather-meta">
          <strong id="gatherName">{gatherHud?.name || 'Gathering'}</strong>
        </div>
        <div className="gather-progress">
          <span id="gatherProgress" style={{ width: `${Math.round(Math.min(1, gatherHud?.progress || 0) * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function PickupToasts() {
  const pickupToasts = useGameUiStore((state) => state.pickupToasts);
  return (
    <div className="pickup-toasts" id="pickupToasts" aria-live="polite" aria-atomic="false">
      {pickupToasts.map((toast) => {
        const entries = Object.entries(toast.items).filter(([, count]) => count > 0);
        const first = entries[0]?.[0] || 'wood';
        return (
          <div className="pickup-toast" role="status" key={toast.id}>
            <ItemIcon itemKey={first} />
            <div className="pickup-toast-body">
              <div className="pickup-toast-items">
                {entries.map(([key, count]) => {
                  const item = itemForKey(key);
                  return (
                    <span key={key}>
                      <strong>+ {count}</strong>
                      <span>{count === 1 ? item?.singular || item?.name || key : item?.plural || item?.name || key}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Quickbar() {
  const state = useGameUiStore();
  const slots = state.quickSlots;
  return (
    <div className="quickbar" id="quickbar" aria-label="Quick bar">
      {slots.map((key, index) => {
        const item = state.itemForKey(key);
        const slotVisual = itemSlotVisual(item);
        return (
          <button
            type="button"
            className={`quick-slot ${slotVisual.className} ${
              index === state.selectedSlot ? 'is-active' : ''
            } ${item ? '' : 'is-empty'} ${
              state.dragPayload?.source === 'quickbar' && state.dragPayload?.index === index ? 'is-dragging' : ''
            }`}
            data-slot={index}
            draggable={Boolean(item)}
            key={`${key || 'empty'}-${index}`}
            style={slotVisual.style}
            onClick={() => gameUiStore.getState().selectQuickSlot(index)}
            onDragStart={(event) => {
              if (!item) return;
              writeDragPayload(event, { source: 'quickbar', key: item.key, index });
            }}
            onDragEnd={clearDragPayload}
            onDragOver={(event) => {
              if (!gameUiStore.getState().dragPayload) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(event) => {
              const payload = readDragPayload(event);
              if (!payload?.key) return;
              event.preventDefault();
              gameUiStore.getState().assignQuickSlot(payload.key, index, payload.source === 'quickbar' ? payload.index : null);
            }}
            title={item ? undefined : `${index + 1}: Empty quick slot`}
            aria-label={item ? `Select ${item.name}, ${itemLevelText(item)}` : `Empty quick slot ${index + 1}`}
          >
            <span className="slot-key">{index + 1}</span>
            {item ? (
              <>
                <span className="slot-level">{itemLevelShort(item)}</span>
                <ItemIcon itemKey={item.key} className="slot-icon" />
                <span className="quick-slot-tooltip" role="tooltip">
                  <strong>{item.name}</strong>
                  <span>
                    {item.displayType || item.type || 'Item'} - {itemLevelText(item)}
                  </span>
                  {item.desc ? <small>{item.desc}</small> : null}
                </span>
              </>
            ) : (
              <span className="slot-empty">+</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Abilitybar() {
  const state = useGameUiStore();
  const currentWeapon = state.itemForKey(state.equipment.weapon) || state.itemForKey(weaponDefs[0].id, { includeLocked: true });
  const abilities = abilitySets[currentWeapon?.id] || abilitySets.stick;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 120);
    return () => window.clearInterval(tick);
  }, []);

  return (
    <div className="abilitybar" id="abilitybar" aria-label="Ability bar">
      {['Q', 'W', 'E', 'R'].map((key, index) => {
        const ability = abilities[index];
        const remaining = Math.max(0, (state.abilityCooldownEnds[ability.id] || 0) - now);
        const cooldownScale = remaining > 0 ? Math.min(1, remaining / (ability.cooldown * 1000)) : 0;
        return (
          <button
            type="button"
            className={`ability-slot ${remaining > 0 ? 'is-cooling' : 'is-ready'}`}
            data-ability={index}
            key={ability.id}
            style={{
              '--ability-color': currentWeapon?.color,
              '--ability-icon': `url("${ability.icon}")`,
              '--cooldown-scale': cooldownScale.toFixed(3),
            }}
            title={`${key}: ${ability.name} - ${ability.desc}`}
            aria-label={`${key}, ${ability.name}. ${ability.desc}`}
            onClick={() => gameUiStore.getState().useAbility(ability, index)}
          >
            <span className="slot-key">{key}</span>
            <span className="ability-icon" aria-hidden="true" />
            <span className="ability-name">{ability.name}</span>
            <span className="ability-cooldown">{remaining > 0 ? Math.ceil(remaining / 1000) : ''}</span>
          </button>
        );
      })}
    </div>
  );
}

function InventoryPanel() {
  const state = useGameUiStore();
  const slots = state.inventoryLayout;
  const selected = state.itemForKey(state.selectedItemKey);
  const selectedEquipmentSlots = selected ? compatibleEquipmentSlots(selected) : [];
  const selectedEquippedSlot =
    selectedEquipmentSlots.find((slotId) => state.equipment[slotId] === selected?.key) || null;
  const selectedEquipmentSlot =
    selectedEquippedSlot || selectedEquipmentSlots.find((slotId) => !state.equipment[slotId]) || selectedEquipmentSlots[0] || null;
  const selectedIsEquipped = Boolean(selectedEquippedSlot);
  const equipmentSlots = [
    { id: 'head', label: 'head', area: 'head' },
    { id: 'weapon', label: 'weapon', area: 'weapon' },
    { id: 'body', label: 'body', area: 'body' },
    { id: 'offhand', label: 'offhand', area: 'offhand' },
    { id: 'charm', label: 'charm', area: 'charm' },
    { id: 'legs', label: 'leggings', area: 'legs' },
    { id: 'charm2', label: 'charm', area: 'charm2' },
    { id: 'feet', label: 'feet', area: 'feet' },
  ];
  const used = slots.filter(Boolean).length;

  return (
    <>
      <div className={`inventory-panel ${state.inventoryOpen ? 'is-open' : ''}`} id="inventoryPanel" aria-hidden={!state.inventoryOpen}>
        <div className="inventory-head">
          <div>
            <div className="panel-title">Inventory</div>
            <strong id="inventoryTitle">Your bag</strong>
          </div>
          <button
            id="inventoryClose"
            title="Close inventory"
            aria-label="Close inventory"
            onClick={() => gameUiStore.getState().setInventoryOpen(false)}
          >
            x
          </button>
        </div>
        <div className="equipment-grid" id="equipmentSlots" aria-label="Equipped items">
          {equipmentSlots.map((slot) => {
            const item = state.itemForKey(state.equipment[slot.id]);
            const draggedItem = state.itemForKey(state.dragPayload?.key);
            const canDrop = draggedItem ? canEquipItemInSlot(draggedItem, slot.id) : false;
            const slotVisual = itemSlotVisual(item);
            const commonProps = {
              'data-equip-slot': slot.id,
              onDragOver: (event) => {
                const payload = gameUiStore.getState().dragPayload;
                const payloadItem = gameUiStore.getState().itemForKey(payload?.key);
                if (!payloadItem || !canEquipItemInSlot(payloadItem, slot.id)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              },
              onDrop: (event) => {
                const payload = readDragPayload(event);
                const payloadItem = gameUiStore.getState().itemForKey(payload?.key);
                if (!payloadItem || !canEquipItemInSlot(payloadItem, slot.id)) return;
                event.preventDefault();
                gameUiStore.getState().equipItem(payload.key, slot.id);
                clearDragPayload();
              },
            };
            return item ? (
              <button
                className={`equipment-slot is-filled equipment-${slot.area} ${slotVisual.className} ${
                  canDrop ? 'is-drop-target' : ''
                }`}
                type="button"
                data-item={item.key}
                draggable
                style={slotVisual.style}
                title={`${item.name}, ${itemLevelText(item)}`}
                aria-label={`${item.name}, ${itemLevelText(item)}`}
                key={slot.id}
                onClick={(event) => {
                  if (event.shiftKey) gameUiStore.getState().unequipItem(slot.id);
                  else gameUiStore.getState().setSelectedItemKey(item.key);
                }}
                onDragStart={(event) => {
                  gameUiStore.getState().setSelectedItemKey(null);
                  writeDragPayload(event, { source: 'equipment', key: item.key, slotId: slot.id });
                }}
                onDragEnd={clearDragPayload}
                {...commonProps}
              >
                <span className="item-level-badge">{itemLevelShort(item)}</span>
                <ItemIcon itemKey={item.key} className="equipment-weapon-icon" />
              </button>
            ) : (
              <div
                className={`equipment-slot is-empty equipment-${slot.area} ${canDrop ? 'is-drop-target' : ''}`}
                title={`Empty ${slot.label} slot`}
                aria-label={`Empty ${slot.label} slot`}
                key={slot.id}
                {...commonProps}
              >
                <span className="equipment-label">{slot.label}</span>
              </div>
            );
          })}
        </div>
        <div className="bag-head">
          <div className="panel-title">Bag</div>
          <small id="bagSpace">
            {used}/{BAG_SLOT_COUNT} slots
          </small>
        </div>
        <div className="bag-grid" id="inventorySlots" aria-label="Inventory slots">
          {slots.map((key, index) =>
            key ? (
              (() => {
                const item = state.itemForKey(key);
                const slotVisual = itemSlotVisual(item);
                return (
              <button
                type="button"
                className={`bag-slot is-filled ${item.className} ${slotVisual.className} ${
                  state.dragPayload?.source === 'inventory' && state.dragPayload?.index === index ? 'is-dragging' : ''
                }`}
                data-slot={index}
                data-item={key}
                draggable
                key={`${key}-${index}`}
                style={slotVisual.style}
                onClick={(event) => {
                  if (event.shiftKey && equipmentSlotForItem(item)) gameUiStore.getState().equipItem(key);
                  else gameUiStore.getState().setSelectedItemKey(key);
                }}
                onDragStart={(event) => {
                  gameUiStore.getState().setSelectedItemKey(null);
                  writeDragPayload(event, { source: 'inventory', key, index });
                }}
                onDragEnd={clearDragPayload}
                onDragOver={(event) => {
                  if (!gameUiStore.getState().dragPayload) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  const payload = readDragPayload(event);
                  if (!payload?.key) return;
                  event.preventDefault();
                  moveDroppedPayloadToInventory(payload, index);
                  clearDragPayload();
                }}
                title={`${item.name}, ${itemLevelText(item)}`}
                aria-label={`${item.name}, ${itemLevelText(item)}`}
              >
                <span className="item-level-badge">{itemLevelShort(item)}</span>
                <ItemIcon itemKey={key} />
                {item.kind === 'resource' || item.kind === 'consumable' ? <strong className="item-count">{item.count}</strong> : null}
              </button>
                );
              })()
            ) : (
              <div
                className="bag-slot is-empty"
                data-slot={index}
                aria-label="Empty inventory slot"
                key={`empty-${index}`}
                onDragOver={(event) => {
                  if (!gameUiStore.getState().dragPayload) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(event) => {
                  const payload = readDragPayload(event);
                  if (!payload?.key) return;
                  event.preventDefault();
                  moveDroppedPayloadToInventory(payload, index);
                  clearDragPayload();
                }}
              />
            ),
          )}
        </div>
        <small id="inventorySummary">Drag items to sort, assign quick slots, or equip gear.</small>
      </div>

      <div className={`item-popover ${selected ? 'is-open' : ''}`} id="itemPopover" aria-hidden={!selected}>
        {selected ? (
          <div className="item-popover-card" role="dialog" aria-modal="false" aria-labelledby="itemPopoverName">
            <button
              className="item-popover-close"
              id="itemPopoverClose"
              aria-label="Close item details"
              onClick={() => gameUiStore.getState().setSelectedItemKey(null)}
            >
              x
            </button>
            <div className="item-popover-head">
              <ItemIcon itemKey={selected.key} className={selected.kind === 'weapon' ? 'item-popover-weapon' : ''} />
              <div>
                <strong id="itemPopoverName">{selected.name}</strong>
                <small id="itemPopoverType">
                  {selected.displayType || selected.type} - {itemLevelText(selected)}
                </small>
              </div>
            </div>
            <p id="itemPopoverDesc">{selected.desc}</p>
            <div className="item-popover-stats">
              <span>
                <small>Level</small>
                <strong id="itemPopoverLevel">{selected.level || 1}</strong>
              </span>
              <span>
                <small>Count</small>
                <strong id="itemPopoverCount">{selected.kind === 'resource' || selected.kind === 'consumable' ? selected.count : 1}</strong>
              </span>
            </div>
            {selected.kind === 'consumable' || selectedEquipmentSlot ? (
              <button
                className="item-popover-action"
                id="itemPopoverAction"
                type="button"
                onClick={() => {
                  if (selectedIsEquipped) gameUiStore.getState().unequipItem(selectedEquippedSlot);
                  else if (selectedEquipmentSlot) gameUiStore.getState().equipItem(selected.key, selectedEquipmentSlot);
                  else gameUiStore.getState().useItem(selected.key);
                }}
              >
                {selectedEquipmentSlot
                  ? selectedIsEquipped
                    ? 'unequip'
                    : 'equip'
                  : selected.useLabel || 'use'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function BuildPanel() {
  const state = useGameUiStore();
  const currentPiece = buildPieces[state.selectedBuildIndex] || buildPieces[0];
  const turn = state.buildRotation % 2 === 0 ? 'horizontal' : 'vertical';
  return (
    <div className={`build-panel ${state.buildOpen ? 'is-open' : ''}`} id="buildPanel" aria-hidden={!state.buildOpen}>
      <div className="inventory-head">
        <div>
          <div className="panel-title">Build</div>
          <strong id="buildTitle">Wood pieces</strong>
        </div>
        <button
          id="buildClose"
          title="Close build mode"
          aria-label="Close build mode"
          onClick={() => gameUiStore.getState().setBuildOpen(false)}
        >
          x
        </button>
      </div>
      <div className="build-grid" id="buildPieces">
        {buildPieces.map((piece) => (
          <button
            type="button"
            className={`build-piece ${piece.id === currentPiece.id ? 'is-active' : ''}`}
            key={piece.id}
            style={{ '--item-color': piece.color }}
            disabled={(state.inventory.wood || 0) < piece.cost}
            onClick={() => {
              gameUiStore.getState().setSelectedBuildIndex(buildPieces.indexOf(piece));
              playSfx((state.inventory.wood || 0) >= piece.cost ? 'ui' : 'error');
              gameUiStore.getState().setActionLine(`${piece.name} selected.`);
            }}
          >
            <span className="item-level-badge">{itemLevelShort(piece)}</span>
            <strong>{piece.name}</strong>
            <small>{piece.cost} wood</small>
          </button>
        ))}
      </div>
      <div className="build-actions">
        <button
          type="button"
          id="rotateBuild"
          title="Rotate selected piece"
          aria-label="Rotate selected piece"
          onClick={() => gameUiStore.getState().rotateBuild()}
        >
          rotate
        </button>
        <button
          type="button"
          id="cancelBuild"
          title="Cancel build mode"
          aria-label="Cancel build mode"
          onClick={() => gameUiStore.getState().setBuildOpen(false)}
        >
          cancel
        </button>
      </div>
      <small id="buildHint">
        {currentPiece.name}: {currentPiece.cost} wood. {turn}. Click or tap ground to place.
      </small>
    </div>
  );
}

function CraftPanel() {
  const state = useGameUiStore();
  const recipe = craftingRecipes.find((item) => item.id === state.craftRecipeId);
  const recipes = craftingRecipes.filter((item) => item.category === state.craftCategory);
  const selectedOutput = recipe ? state.itemForKey(recipe.output.key, { includeLocked: true }) : null;
  const maxQuantity = recipe ? state.maxCraftQuantity(recipe) : 1;
  const status = recipe ? state.craftStatus(recipe, state.craftQuantity) : null;
  return (
    <div className={`craft-panel ${state.craftOpen ? 'is-open' : ''}`} id="craftPanel" aria-hidden={!state.craftOpen}>
      <div className="inventory-head">
        <button
          className="craft-back"
          type="button"
          id="craftBack"
          title="Back to recipes"
          aria-label="Back to recipes"
          hidden={!recipe}
          onClick={() => gameUiStore.getState().setCraftRecipeId(null)}
        >
          {'<'}
        </button>
        <div>
          <div className="panel-title">Craft</div>
          <strong id="craftTitle">{selectedOutput?.name || 'Recipes'}</strong>
        </div>
        <button
          id="craftClose"
          title="Close crafting"
          aria-label="Close crafting"
          onClick={() => gameUiStore.getState().setCraftOpen(false)}
        >
          x
        </button>
      </div>
      <div className="craft-tabs" id="craftCategories" aria-label="Crafting sections" hidden={Boolean(recipe)}>
        {craftCategories.map((item) => (
          <button
            type="button"
            className={`craft-tab ${state.craftCategory === item.id ? 'is-active' : ''}`}
            key={item.id}
            onClick={() => gameUiStore.getState().setCraftCategory(item.id)}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className={`craft-grid ${recipe ? 'is-detail' : ''}`} id="craftRecipes">
        {recipe && selectedOutput ? (
          <section className="craft-detail" data-recipe={recipe.id} aria-label={`${selectedOutput.name} crafting details`}>
            <div className="craft-detail-icon">
              <ItemIcon itemKey={selectedOutput.key} className="craft-detail-item" />
            </div>
            <strong>{selectedOutput.name}</strong>
            <p>{selectedOutput.desc || recipe.desc}</p>
            <div className="craft-detail-costs" aria-label="Required materials">
              {Object.entries(recipe.cost).map(([key, count]) => {
                const required = count * state.craftQuantity;
                const available = state.inventory[key] || 0;
                return (
                  <span className={`craft-cost ${available >= required ? 'is-met' : 'is-missing'}`} key={key}>
                    {itemForKey(key)?.name || key} {available}/{required}
                  </span>
                );
              })}
            </div>
            <div className="craft-quantity">
              <label htmlFor="craftQuantityRange">Quantity</label>
              <div className="craft-quantity-controls">
                <input
                  id="craftQuantityRange"
                  type="range"
                  min="1"
                  max={maxQuantity}
                  value={state.craftQuantity}
                  disabled={maxQuantity <= 1}
                  onChange={(event) => gameUiStore.getState().setCraftQuantity(recipe, event.target.value)}
                />
                <input
                  id="craftQuantityInput"
                  type="text"
                  pattern="[0-9]*"
                  value={state.craftQuantity}
                  inputMode="numeric"
                  aria-label="Craft quantity"
                  disabled={maxQuantity <= 1}
                  onChange={(event) => gameUiStore.getState().setCraftQuantity(recipe, event.target.value)}
                />
              </div>
              <small className="craft-quantity-max">Max {maxQuantity}</small>
            </div>
            <button
              className="craft-detail-action"
              type="button"
              disabled={!status?.canCraft}
              onClick={() => gameUiStore.getState().craftRecipe(recipe, state.craftQuantity)}
            >
              {status?.canCraft ? `Craft ${state.craftQuantity > 1 ? `${state.craftQuantity} ${selectedOutput.plural || selectedOutput.name}` : selectedOutput.name}` : status?.label}
            </button>
          </section>
        ) : (
          recipes.map((listRecipe) => {
          const listStatus = state.craftStatus(listRecipe);
          const output = state.itemForKey(listRecipe.output.key, { includeLocked: true });
          return (
            <button
              type="button"
              className={`craft-recipe ${listStatus.canCraft ? '' : 'is-unavailable'}`}
              key={listRecipe.id}
              onClick={() => {
                playSfx('ui', 0.55);
                gameUiStore.getState().setCraftRecipeId(listRecipe.id);
              }}
            >
              <ItemIcon itemKey={output?.key} />
              <span>
              <strong>{output?.name || listRecipe.id}</strong>
              <small>{listRecipe.desc}</small>
              <span className="craft-costs">
                {Object.entries(listRecipe.cost).map(([key, count]) => (
                  <span className={`craft-cost ${(state.inventory[key] || 0) >= count ? 'is-met' : 'is-missing'}`} key={key}>
                    {itemForKey(key)?.name || key} {state.inventory[key] || 0}/{count}
                  </span>
                ))}
              </span>
              </span>
              <span className="craft-status">{listStatus.label}</span>
            </button>
          );
        }))}
      </div>
      <small id="craftSummary">
        {recipe
          ? status?.canCraft
            ? 'Ready.'
            : status?.reason || `Can't craft ${selectedOutput?.name || 'that'} yet.`
          : `${craftCategories.find((item) => item.id === state.craftCategory)?.name || 'Recipes'}: refine raw resources first, then craft utilities, weapons, and armor from those materials.`}
      </small>
    </div>
  );
}

function LoadingScreen() {
  const loadingHidden = useGameUiStore((state) => state.loadingHidden);
  const loadingDetail = useGameUiStore((state) => state.loadingDetail);
  const loadingSteps = useGameUiStore((state) => state.loadingSteps);
  const totalSteps = Math.max(1, loadingSteps.length);
  const completeSteps = loadingSteps.filter((step) => step.status === 'complete').length;
  const hasActiveStep = loadingSteps.some((step) => step.status === 'loading');
  const progress = Math.min(
    loadingHidden ? 100 : 96,
    ((completeSteps + (hasActiveStep ? 0.45 : 0)) / totalSteps) * 100,
  );
  return (
    <div
      className={`loading-screen ${loadingHidden ? 'is-hidden' : ''}`}
      id="loadingScreen"
      role="status"
      aria-live="polite"
    >
      <div className="loading-mark" aria-hidden="true" />
      <strong id="loadingTitle">Loading grove</strong>
      <span id="loadingDetail">{loadingDetail}</span>
      <div
        className="loading-progress"
        aria-label="Loading progress"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(progress)}
        role="progressbar"
      >
        <span style={{ width: `${progress}%` }} />
      </div>
    </div>
  );
}

export default function GameHud() {
  const loadingHidden = useGameUiStore((state) => state.loadingHidden);

  useEffect(() => {
    window.addEventListener('pointerdown', ensureAudio, { capture: true });
    window.addEventListener('keydown', ensureAudio, { capture: true });
    const onKeyDown = (event) => {
      if (event.repeat || event.target instanceof HTMLInputElement) return;
      const state = gameUiStore.getState();
      if (!state.loadingHidden) return;
      const key = event.key.toLowerCase();
      if (key === 'i') state.setInventoryOpen(!state.inventoryOpen);
      if (key === 'c') state.setCraftOpen(!state.craftOpen);
      if (key === 'b') state.setBuildOpen(!state.buildOpen);
      if (key === 'r' && state.buildOpen) {
        state.rotateBuild();
        return;
      }
      const abilityIndex = ['q', 'w', 'e', 'r'].indexOf(key);
      if (abilityIndex >= 0 && !state.buildOpen && !state.craftOpen && !state.inventoryOpen) {
        const currentWeapon = state.itemForKey(state.equipment.weapon) || state.itemForKey(weaponDefs[0].id, { includeLocked: true });
        const ability = (abilitySets[currentWeapon?.id] || abilitySets.stick)[abilityIndex];
        state.useAbility(ability, abilityIndex);
      }
      if (event.key === 'Escape') {
        state.setSelectedItemKey(null);
        state.setInventoryOpen(false);
        state.setCraftOpen(false);
        state.setBuildOpen(false);
      }
      const number = Number(event.key);
      if (number >= 1 && number <= QUICK_SLOT_COUNT) state.selectQuickSlot(number - 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', ensureAudio, { capture: true });
      window.removeEventListener('keydown', ensureAudio, { capture: true });
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  if (!loadingHidden) {
    return <LoadingScreen />;
  }

  return (
    <>
      <LoadingScreen />
      <div className="hud top-left">
        <PlayerCard />
      </div>
      <div className="hud target-hud" id="targetHud" hidden aria-hidden="true" aria-live="polite" />
      <Abilitybar />
      <Quickbar />
      <GatherHud />
      <PickupToasts />
      <InventoryPanel />
      <BuildPanel />
      <CraftPanel />
    </>
  );
}
