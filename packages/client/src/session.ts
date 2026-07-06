import type { TeamId } from '@cs2d/shared';

export interface BotsRequest {
  perTeam: number;
  difficulty: 'easy' | 'normal' | 'hard';
}

export interface SessionConfig {
  name: string;
  roomCode: string;
  map: string;
  team?: TeamId;
  botsRequested?: BotsRequest;
}

/** Set by menu.ts once the player picks quick-play / create / join; read by GameScene. */
export const session: SessionConfig = { name: '', roomCode: '', map: 'dust2' };
