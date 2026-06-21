import { useSyncExternalStore } from 'react';
import { gameUiStore } from './gameUiStore.js';

export function useGameUiStore(selector = (state) => state) {
  return useSyncExternalStore(
    gameUiStore.subscribe,
    () => selector(gameUiStore.getState()),
    () => selector(gameUiStore.getInitialState()),
  );
}
