import { afterEach, describe, expect, it } from 'vitest';
import { MAX_PLAYERS_PER_ROOM } from '@cs2d/shared';
import { Room, RoomFullError } from '../src/room.js';

describe('room capacity', () => {
  const rooms: Room[] = [];
  const make = (): Room => {
    const r = new Room('testarena');
    rooms.push(r);
    return r;
  };
  afterEach(() => {
    for (const r of rooms) r.stop();
    rooms.length = 0;
  });

  it('refuses joins past MAX_PLAYERS_PER_ROOM', () => {
    const room = make();
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) room.addPlayer(null, `P${i}`);
    expect(room.isFull).toBe(true);
    expect(() => room.addPlayer(null, 'extra')).toThrow(RoomFullError);
    expect(room.players.size).toBe(MAX_PLAYERS_PER_ROOM);
  });

  it('counts bots toward the cap', () => {
    const room = make();
    room.fillBots(5);
    expect(room.players.size).toBe(MAX_PLAYERS_PER_ROOM);
    expect(room.isFull).toBe(true);
    expect(() => room.addPlayer(null, 'human')).toThrow(RoomFullError);
  });

  it('fillBots stops at the cap when the teams are lopsided', () => {
    const room = make();
    for (let i = 0; i < 6; i++) room.addPlayer(null, `H${i}`, 'T'); // 6 humans on T: more than perTeam
    room.fillBots(5);
    expect(room.players.size).toBe(MAX_PLAYERS_PER_ROOM);
  });

  it('frees a slot when a player leaves', () => {
    const room = make();
    const first = room.addPlayer(null, 'first');
    for (let i = 1; i < MAX_PLAYERS_PER_ROOM; i++) room.addPlayer(null, `P${i}`);
    room.removePlayer(first.id);
    expect(room.isFull).toBe(false);
    expect(() => room.addPlayer(null, 'again')).not.toThrow();
  });
});
