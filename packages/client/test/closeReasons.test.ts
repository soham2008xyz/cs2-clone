import { describe, expect, it } from 'vitest';
import { closeMessage } from '../src/net/closeReasons.js';

describe('closeMessage', () => {
  it('maps 4004 to "room not found"', () => {
    expect(closeMessage(4004, 'room not found')).toBe('room not found');
  });

  it('treats an abnormal close (1006) as a plain disconnect', () => {
    expect(closeMessage(1006, '')).toBe('disconnected from server');
  });

  it('shows the server reason for unmapped codes', () => {
    expect(closeMessage(4999, 'maintenance')).toBe('disconnected: maintenance');
  });

  it('falls back to a generic message when there is no reason', () => {
    expect(closeMessage(1001)).toBe('disconnected from server');
  });
});
