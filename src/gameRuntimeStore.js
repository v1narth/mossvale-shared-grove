import { createStore } from "zustand/vanilla";

export const gameRuntimeStore = createStore((set) => ({
  camera: {
    x: 1800,
    y: 1300,
    zoom: 1.5,
  },
  player: {
    x: 0,
    y: 0,
    z: 0,
    facing: 0,
  },
  playerPositionReady: false,
  moveTarget: {
    x: 0,
    z: 0,
  },
  localPresence: {
    name: 'Sprout',
    equipment: {
      head: null,
      weapon: 'stick',
      body: null,
      offhand: null,
      feet: null,
      charm: null,
    },
    weaponId: 'stick',
    offhandId: null,
    movementState: 'idle',
    actionState: 'idle',
    actionTool: null,
    actionSequence: 0,
    blocking: false,
    headYaw: 0,
    headPitch: 0,
  },
  remotePlayers: [],
  setCamera: (camera) => set({ camera }),
  setPlayer: (player) => set({ player }),
  setLocalPresence: (patch) =>
    set((state) => ({
      localPresence: {
        ...state.localPresence,
        ...patch,
      },
    })),
  setRemotePlayers: (remotePlayers) => set({ remotePlayers }),
  upsertRemotePlayer: (remotePlayer) =>
    set((state) => {
      const index = state.remotePlayers.findIndex(
        (player) => player.id === remotePlayer.id,
      );
      if (index < 0) {
        return {
          remotePlayers: [...state.remotePlayers, remotePlayer],
        };
      }
      const remotePlayers = [...state.remotePlayers];
      remotePlayers[index] = {
        ...remotePlayers[index],
        ...remotePlayer,
      };
      return { remotePlayers };
    }),
  removeRemotePlayer: (id) =>
    set((state) => ({
      remotePlayers: state.remotePlayers.filter((player) => player.id !== id),
    })),
  pruneRemotePlayers: (now = Date.now(), staleMs = 45000) =>
    set((state) => ({
      remotePlayers: state.remotePlayers.filter(
        (player) => !player.updatedAt || now - player.updatedAt < staleMs,
      ),
    })),
  setCloudPlayerPosition: (player) =>
    set({
      player,
      playerPositionReady: true,
      moveTarget: {
        x: player.x,
        z: player.z,
      },
    }),
  markPlayerPositionReady: () => set({ playerPositionReady: true }),
  resetPlayerPositionReady: () => set({ playerPositionReady: false }),
  setMoveTarget: (moveTarget) => set({ moveTarget }),
}));
