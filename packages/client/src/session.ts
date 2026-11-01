import type { TeamId } from '@cs2d/shared';
import type { MatchStartMethod } from './analytics.js';

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
  /** How the player got here from the menu; GameScene reports it once the server admits them. */
  entry?: MatchStartMethod;
}

/** Set by menu.ts once the player picks quick-play / create / join; read by GameScene. */
export const session: SessionConfig = { name: '', roomCode: '', map: 'dust2' };
