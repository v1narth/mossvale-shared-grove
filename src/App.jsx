import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import GameHud from "./GameHud.jsx";
import {
  flushCloudPlayerPositionSave,
  loadCloudPlayerPosition,
  scheduleCloudPlayerPositionSave,
  subscribeCloudWorldState,
} from "./cloudPersistence.js";
import { gameUiStore, installGameUiApi } from "./gameUiStore.js";
import { gameRuntimeStore } from "./gameRuntimeStore.js";
import { EQUIPMENT_SLOTS } from "./gameUiData.js";

const ThreeWorldPreview = lazy(() => import("./ThreeWorldPreview.jsx"));
const PLAYER_PRESENCE_SYNC_INTERVAL_MS = 50;
const PLAYER_PRESENCE_SAVE_DELAY_MS = 35;
const PLAYER_PRESENCE_MOVE_DISTANCE = 4;
const PLAYER_PRESENCE_FACING_DELTA = 0.035;
const PLAYER_PRESENCE_HEARTBEAT_MS = 5000;
const PLAYER_HEAD_LOOK_DELTA = 0.025;
const GAME_SERVER_RECONNECT_MS = 1200;
let uninstallInitialGameUiApi = null;

function createGameServerPlayerId() {
  const raw =
    window.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.floor(Math.random() * 999999)}`;
  return `tab-${raw}`.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}

function normalizePresenceEquipment(equipment = {}) {
  return Object.fromEntries(
    EQUIPMENT_SLOTS.map((slot) => [
      slot,
      typeof equipment?.[slot] === "string" ? equipment[slot] : null,
    ]),
  );
}

function resolveGameServerUrl() {
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  const queryUrl = params.get("gameServer");

  const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const raw = queryUrl || (isLocalHost ? "ws://127.0.0.1:8787" : window.MOSSVALE_GAME_SERVER?.url);
  if (!raw) return "";

  try {
    const url = new URL(raw, window.location.href);
    return ["ws:", "wss:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

if (typeof window !== "undefined") {
  uninstallInitialGameUiApi = installGameUiApi();
}

export default function App() {
  const uninstallGameUiApiRef = useRef(null);
  const [canRenderWorld, setCanRenderWorld] = useState(false);

  useLayoutEffect(() => {
    uninstallGameUiApiRef.current = uninstallInitialGameUiApi || installGameUiApi();
    uninstallInitialGameUiApi = null;
    return () => {
      uninstallGameUiApiRef.current?.();
      uninstallGameUiApiRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribeWorld = null;
    let heartbeatTimer = null;
    let gameServerSocket = null;
    let gameServerReconnectTimer = null;
    let gameServerConnected = false;
    let gameServerPlayerId = null;
    let hydrationStarted = false;
    let lastCloudPersistedAt = 0;
    let lastPersistedPlayer = null;
    let lastPersistedPresenceKey = "";
    let lastPlayerPersistedAt = 0;
    const localPlayerId = createGameServerPlayerId();
    gameServerPlayerId = localPlayerId;
    const gameServerUrl = resolveGameServerUrl();
    window.__MOSSVALE_WORLD_DATA_READY__ = false;
    document.body.classList.add("renderer-3d-preview");
    const setLoadingStep = (id, status, detail) => {
      gameUiStore.getState().setLoadingStep(id, { status, detail });
    };
    const showLoading = () => gameUiStore.getState().showLoading();
    const syncLocalPresenceFromUi = () => {
      const ui = gameUiStore.getState();
      const equipment = normalizePresenceEquipment(ui.equipment);
      gameRuntimeStore.getState().setLocalPresence({
        name: ui.playerName,
        equipment,
        weaponId: equipment.weapon,
        offhandId: equipment.offhand,
      });
    };
    const presenceKey = (presence) =>
      [
        presence.name || "",
        presence.equipment?.head || "",
        presence.weaponId || "",
        presence.equipment?.body || "",
        presence.offhandId || "",
        presence.equipment?.feet || "",
        presence.equipment?.charm || "",
        presence.movementState || "idle",
        presence.actionState || "idle",
        presence.actionTool || "",
        presence.actionSequence || 0,
        presence.blocking ? "blocking" : "",
        Math.round((presence.headYaw || 0) / PLAYER_HEAD_LOOK_DELTA),
        Math.round((presence.headPitch || 0) / PLAYER_HEAD_LOOK_DELTA),
      ].join("|");
    const playerPresencePayload = () => {
      const runtime = gameRuntimeStore.getState();
      return {
        ...runtime.player,
        ...runtime.localPresence,
        id: localPlayerId,
        updatedAt: Date.now(),
      };
    };
    const sendGameServerMessage = (type, payload = {}) => {
      if (!gameServerConnected || gameServerSocket?.readyState !== WebSocket.OPEN) {
        return false;
      }
      gameServerSocket.send(JSON.stringify({ type, ...payload }));
      return true;
    };
    const sendGameServerState = () =>
      sendGameServerMessage("state", {
        ...playerPresencePayload(),
        renderer: "3d",
      });
    const sendGameServerAttack = ({
      weaponId = "sword",
      targetId = null,
      targetX = 0,
      targetY,
      targetZ,
      originX,
      originY,
      originZ,
      facing = 0,
    } = {}) =>
      sendGameServerMessage("attack", {
        weaponId,
        targetId,
        targetX,
        targetY: targetY ?? targetZ ?? 0,
        originX,
        originY: originY ?? originZ,
        facing,
      });
    const ownPlayerIds = () =>
      new Set([localPlayerId, gameServerPlayerId].filter(Boolean));
    const markRemotePlayerHit = (message) => {
      const damage = Math.max(0, Math.round(Number(message.damage) || 0));
      const now = Date.now();
      const runtime = gameRuntimeStore.getState();
      const target = runtime.remotePlayers.find(
        (player) => player.id === message.targetId,
      );
      runtime.upsertRemotePlayer({
        id: message.targetId,
        hp: Number.isFinite(Number(message.hp))
          ? Number(message.hp)
          : Math.max(0, (target?.hp ?? target?.maxHp ?? 5) - damage),
        hitUntil: now + 260,
        lastDamage: damage,
        lastDamageAt: now,
        updatedAt: now,
      });
      if (ownPlayerIds().has(message.attackerId)) {
        gameUiStore
          .getState()
          .setActionLine(`${message.weaponName || "Sword"} hit ${target?.name || "Traveler"}.`);
      }
    };
    const applyPvpHit = (message) => {
      if (ownPlayerIds().has(message.targetId)) {
        const damaged = gameUiStore
          .getState()
          .damagePlayer(message.damage, message.attackerName || "Traveler");
        if (damaged) sendGameServerState();
        return;
      }
      markRemotePlayerHit(message);
    };
    const showRemoteAttack = (message) => {
      if (ownPlayerIds().has(message.id)) return;
      const now = Date.now();
      const runtime = gameRuntimeStore.getState();
      const existing = runtime.remotePlayers.find((player) => player.id === message.id);
      runtime.upsertRemotePlayer({
        id: message.id,
        weaponId: message.weaponId || existing?.weaponId || "sword",
        actionState: "attack",
        actionTool: "sword",
        actionSequence: (existing?.actionSequence || 0) + 1,
        facing: Number.isFinite(Number(message.facing))
          ? Number(message.facing)
          : existing?.facing || 0,
        updatedAt: now,
      });
    };
    const startWorldDataHydration = () => {
      if (hydrationStarted || cancelled) return;
      hydrationStarted = true;
      setCanRenderWorld(false);
      gameRuntimeStore.getState().resetPlayerPositionReady();

      setLoadingStep("world", "loading", "Syncing shared grove state...");
      setLoadingStep("player", "loading", "Restoring traveler position...");
      setLoadingStep("inventory", "loading", "Loading inventory and equipment...");
      setLoadingStep("assets", "loading", "Loading models and animations...");
      setLoadingStep("vegetation", "loading", "Preparing vegetation assets...");

      const playerPositionReady = loadCloudPlayerPosition()
        .then((position) => {
          if (cancelled) return;
          if (position) {
            gameRuntimeStore.getState().setCloudPlayerPosition(position);
          } else {
            gameRuntimeStore.getState().markPlayerPositionReady();
          }
          setLoadingStep("player", "complete", "Traveler position ready.");
        })
        .catch((error) => {
          console.warn("Mossvale cloud player position load failed", error);
          if (!cancelled) {
            gameRuntimeStore.getState().markPlayerPositionReady();
            setLoadingStep("player", "complete", "Using a fresh traveler position.");
          }
        });
      const inventoryReady = gameUiStore
        .getState()
        .hydrateCloudInventory()
        .then(() => {
          if (!cancelled) {
            setLoadingStep("inventory", "complete", "Inventory ready.");
          }
        });
      const worldReady = gameUiStore
        .getState()
        .hydrateCloudWorld()
        .then(() => {
          if (!cancelled) {
            setLoadingStep("world", "complete", "World state ready.");
          }
        });

      Promise.allSettled([playerPositionReady, inventoryReady]).then(() => {
        if (!cancelled) setCanRenderWorld(true);
      });

      Promise.allSettled([
        inventoryReady,
        worldReady,
        playerPositionReady,
      ]).then(() => {
        if (cancelled) return;
        unsubscribeWorld = subscribeCloudWorldState((worldState) => {
          gameUiStore.getState().applyCloudWorldState(worldState);
        });
        heartbeatTimer = window.setInterval(() => {
          const runtime = gameRuntimeStore.getState();
          if (!runtime.playerPositionReady) return;
          runtime.pruneRemotePlayers();
          sendGameServerState();
          scheduleCloudPlayerPositionSave(playerPresencePayload(), 0);
        }, PLAYER_PRESENCE_HEARTBEAT_MS);
        window.MOSSVALE_GAME_API?.markWorldDataReady?.();
      });
    };
    const connectGameServer = () => {
      if (cancelled) return;
      window.clearTimeout(gameServerReconnectTimer);
      showLoading();

      if (!gameServerUrl || !("WebSocket" in window)) {
        setLoadingStep(
          "server",
          "error",
          "Game server is not configured. The grove will open when it is available.",
        );
        return;
      }

      setLoadingStep("server", "loading", "Connecting to the game server...");

      const socket = new WebSocket(gameServerUrl);
      gameServerSocket = socket;

      socket.addEventListener("open", () => {
        if (cancelled || gameServerSocket !== socket) return;
        gameServerConnected = true;
        gameServerPlayerId = localPlayerId;
        gameRuntimeStore.getState().setRemotePlayers([]);
        setLoadingStep("server", "complete", "Game server connected.");
        sendGameServerMessage("join", {
          ...playerPresencePayload(),
          renderer: "3d",
        });
        startWorldDataHydration();
      });

      socket.addEventListener("message", (event) => {
        if (cancelled || gameServerSocket !== socket) return;
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        if (message.type === "welcome") {
          gameServerPlayerId = message.id || localPlayerId;
          const runtime = gameRuntimeStore.getState();
          runtime.removeRemotePlayer(localPlayerId);
          runtime.removeRemotePlayer(gameServerPlayerId);
          return;
        }
        if (message.type === "snapshot") {
          const ownIds = new Set([localPlayerId, gameServerPlayerId].filter(Boolean));
          const receivedAt = Date.now();
          const snapshotSentAt = Number(message.sentAt) || receivedAt;
          gameRuntimeStore.getState().setRemotePlayers(
            (message.players || [])
              .filter((player) => !ownIds.has(player.id) && player.renderer === "3d")
              .map((player) => ({
                id: player.id,
                name: player.name || "Traveler",
                x: Number(player.x) || 0,
                y: 0,
                z: Number(player.z ?? player.y) || 0,
                facing: Number(player.facing) || 0,
                equipment: normalizePresenceEquipment(player.equipment || {
                  weapon: player.weaponId === undefined ? "stick" : player.weaponId,
                  offhand: player.offhandId || null,
                }),
                weaponId: player.weaponId === undefined ? "stick" : player.weaponId,
                offhandId: player.offhandId || null,
                vx: Number(player.vx) || 0,
                vz: Number(player.vz ?? player.vy) || 0,
                movementState: player.movementState || "idle",
                actionState: player.actionState || "idle",
                actionTool: player.actionTool || null,
                actionSequence: Number(player.actionSequence) || 0,
                blocking: Boolean(player.blocking || player.actionState === "block"),
                headYaw: Number(player.headYaw) || 0,
                headPitch: Number(player.headPitch) || 0,
                hp: Number.isFinite(Number(player.hp)) ? Number(player.hp) : 5,
                maxHp: Number.isFinite(Number(player.maxHp))
                  ? Number(player.maxHp)
                  : 5,
                sentAt: Number(player.sentAt) || snapshotSentAt,
                updatedAt: receivedAt,
              })),
          );
        }
        if (message.type === "leave") {
          gameRuntimeStore.getState().removeRemotePlayer(message.id);
        }
        if (message.type === "pvp-attack") {
          showRemoteAttack(message);
        }
        if (message.type === "pvp-hit") {
          applyPvpHit(message);
        }
      });

      const reconnect = () => {
        if (cancelled || gameServerSocket !== socket) return;
        gameServerConnected = false;
        gameServerSocket = null;
        hydrationStarted = false;
        unsubscribeWorld?.();
        unsubscribeWorld = null;
        if (heartbeatTimer != null) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        gameRuntimeStore.getState().setRemotePlayers([]);
        gameRuntimeStore.getState().resetPlayerPositionReady();
        setCanRenderWorld(false);
        showLoading();
        setLoadingStep("server", "loading", "Game server disconnected. Reconnecting...");
        gameServerReconnectTimer = window.setTimeout(
          connectGameServer,
          GAME_SERVER_RECONNECT_MS,
        );
      };
      socket.addEventListener("close", reconnect);
      socket.addEventListener("error", () => socket.close());
    };
    syncLocalPresenceFromUi();
    const unsubscribeUiPresence = gameUiStore.subscribe((state, previousState) => {
      if (
        state.playerName === previousState?.playerName &&
        state.equipment.head === previousState?.equipment?.head &&
        state.equipment.weapon === previousState?.equipment?.weapon &&
        state.equipment.body === previousState?.equipment?.body &&
        state.equipment.offhand === previousState?.equipment?.offhand &&
        state.equipment.feet === previousState?.equipment?.feet &&
        state.equipment.charm === previousState?.equipment?.charm
      ) {
        return;
      }
      syncLocalPresenceFromUi();
    });
    const unsubscribePlayerPosition = gameRuntimeStore.subscribe(
      (state, previousState) => {
        if (!state.playerPositionReady) return;

        const player = state.player;
        const presence = state.localPresence;
        const nextPresenceKey = presenceKey(presence);
        if (!previousState?.playerPositionReady) {
          lastPersistedPlayer = player;
          lastPersistedPresenceKey = nextPresenceKey;
          scheduleCloudPlayerPositionSave(playerPresencePayload(), 0);
          sendGameServerState();
          return;
        }

        const dx = lastPersistedPlayer
          ? player.x - lastPersistedPlayer.x
          : Infinity;
        const dz = lastPersistedPlayer
          ? player.z - lastPersistedPlayer.z
          : Infinity;
        const facingDelta = lastPersistedPlayer
          ? Math.abs(
              Math.atan2(
                Math.sin(player.facing - lastPersistedPlayer.facing),
                Math.cos(player.facing - lastPersistedPlayer.facing),
              ),
            )
          : Infinity;
        const movedEnough =
          dx * dx + dz * dz >
          PLAYER_PRESENCE_MOVE_DISTANCE * PLAYER_PRESENCE_MOVE_DISTANCE;
        const turnedEnough = facingDelta > PLAYER_PRESENCE_FACING_DELTA;
        const presenceChanged = nextPresenceKey !== lastPersistedPresenceKey;
        const now = performance.now();
        if (
          (!presenceChanged &&
            now - lastPlayerPersistedAt < PLAYER_PRESENCE_SYNC_INTERVAL_MS) ||
          (!presenceChanged && !movedEnough && !turnedEnough)
        ) {
          return;
        }

        lastPersistedPlayer = player;
        lastPersistedPresenceKey = nextPresenceKey;
        lastPlayerPersistedAt = now;
        sendGameServerState();
        if (
          presenceChanged ||
          movedEnough ||
          turnedEnough ||
          now - lastCloudPersistedAt > PLAYER_PRESENCE_HEARTBEAT_MS
        ) {
          lastCloudPersistedAt = now;
          scheduleCloudPlayerPositionSave(
            playerPresencePayload(),
            gameServerConnected ? 1200 : PLAYER_PRESENCE_SAVE_DELAY_MS,
          );
        }
      },
    );
    const saveLatestPlayerPosition = (delayMs = 0) => {
      const runtime = gameRuntimeStore.getState();
      if (!runtime.playerPositionReady) return;
      scheduleCloudPlayerPositionSave(playerPresencePayload(), delayMs);
    };
    const flushPosition = () => {
      saveLatestPlayerPosition(0);
      flushCloudPlayerPositionSave();
    };
    const flushPositionWhenHidden = () => {
      if (document.visibilityState === "hidden") flushPosition();
    };
    window.addEventListener("pagehide", flushPosition);
    document.addEventListener("visibilitychange", flushPositionWhenHidden);

    connectGameServer();
    if (window.MOSSVALE_GAME_API) {
      window.MOSSVALE_GAME_API.sendPvpAttack = sendGameServerAttack;
      window.MOSSVALE_GAME_API.localPlayerId = () => gameServerPlayerId || localPlayerId;
    }
    window.__MOSSVALE_DEBUG__ = {
      ...(window.__MOSSVALE_DEBUG__ ?? {}),
      snapshot: () => gameRuntimeStore.getState(),
    };

    return () => {
      cancelled = true;
      unsubscribeWorld?.();
      window.clearTimeout(gameServerReconnectTimer);
      gameServerSocket?.close();
      unsubscribeUiPresence();
      unsubscribePlayerPosition();
      if (heartbeatTimer != null) window.clearInterval(heartbeatTimer);
      flushPosition();
      window.removeEventListener("pagehide", flushPosition);
      document.removeEventListener("visibilitychange", flushPositionWhenHidden);
      document.body.classList.remove("renderer-3d-preview");
      if (window.MOSSVALE_GAME_API?.sendPvpAttack === sendGameServerAttack) {
        delete window.MOSSVALE_GAME_API.sendPvpAttack;
      }
      if (window.MOSSVALE_GAME_API?.localPlayerId) {
        delete window.MOSSVALE_GAME_API.localPlayerId;
      }
      if (!window.__MOSSVALE_DEBUG__) return;
      delete window.__MOSSVALE_DEBUG__.snapshot;
      if (Object.keys(window.__MOSSVALE_DEBUG__).length === 0) {
        delete window.__MOSSVALE_DEBUG__;
      }
    };
  }, []);

  return (
    <>
      {canRenderWorld ? (
        <Suspense fallback={null}>
          <ThreeWorldPreview />
        </Suspense>
      ) : null}
      <GameHud />
    </>
  );
}
