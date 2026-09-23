import type { Client } from '../types';

/**
 * Fixed palette for client identification. Every colour is readable on the
 * dark surfaces (brand-ink / brand-surface) both as text and as a 4px stripe.
 */
export const CLIENT_COLOR_PALETTE: Array<{ value: string; label: string }> = [
  { value: '#22c55e', label: 'Verde' },
  { value: '#14b8a6', label: 'Turquesa' },
  { value: '#06b6d4', label: 'Ciano' },
  { value: '#3b82f6', label: 'Azul' },
  { value: '#6366f1', label: 'Índigo' },
  { value: '#a855f7', label: 'Roxo' },
  { value: '#ec4899', label: 'Rosa' },
  { value: '#f43f5e', label: 'Vermelho' },
  { value: '#f97316', label: 'Laranja' },
  { value: '#f59e0b', label: 'Âmbar' },
  { value: '#eab308', label: 'Amarelo' },
  { value: '#84cc16', label: 'Lima' },
];

const PALETTE_VALUES = new Set(CLIENT_COLOR_PALETTE.map((color) => color.value));

export function isPaletteColor(value: unknown): value is string {
  return typeof value === 'string' && PALETTE_VALUES.has(value.toLowerCase());
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** Client's chosen colour, or a stable automatic one derived from its id. */
export function clientColor(client: Pick<Client, 'id' | 'color'> | null | undefined): string {
  if (client && isPaletteColor(client.color)) return client.color.toLowerCase();
  const seed = client?.id || 'client';
  return CLIENT_COLOR_PALETTE[hashString(seed) % CLIENT_COLOR_PALETTE.length].value;
}
