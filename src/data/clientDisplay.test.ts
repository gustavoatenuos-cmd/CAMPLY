import { describe, expect, it } from 'vitest';
import { clientDisplayName, clientOptionLabel, resolveClientPrimaryName } from './clientDisplay';

describe('clientDisplayName', () => {
  it('prefers company, then name, then segment', () => {
    expect(clientDisplayName({ company: 'Donatellus', name: 'Joao', segment: 'alimentacao' })).toBe('Donatellus');
    expect(clientDisplayName({ company: '', name: 'Joao', segment: 'alimentacao' })).toBe('Joao');
    expect(clientDisplayName({ company: '', name: '', segment: 'alimentacao' })).toBe('alimentacao');
    expect(clientDisplayName({ company: '', name: '', segment: '' })).toBe('Cliente sem nome');
  });
});

describe('clientOptionLabel', () => {
  it('appends the raw name when it differs from the resolved display name', () => {
    expect(clientOptionLabel({ company: 'Donatellus', name: 'Joao', segment: '' }, [])).toBe('Donatellus · Joao');
  });

  it('does not duplicate the name when it is already the display name', () => {
    expect(clientOptionLabel({ company: '', name: 'Donatellus', segment: '' }, [])).toBe('Donatellus');
  });
});

describe('resolveClientPrimaryName', () => {
  it('trusts the backend-resolved performance.clientName over the local workspace record', () => {
    // Reproduces the real bug: a client whose workspace record has `company`
    // set correctly but `name` holding the project's contractor/responsible
    // name instead of the client's own name (data quirk seen across an
    // entire project's clients, e.g. company="Donatellus", name="Joao").
    const workspaceClient = { name: 'Joao', company: 'Donatellus', segment: 'alimentacao' };
    const performance = { clientName: 'Donatellus' };
    expect(resolveClientPrimaryName(workspaceClient, null, performance)).toBe('Donatellus');
  });

  it('never falls through to the workspace name when the backend name is present, even if company is blank', () => {
    const workspaceClient = { name: 'Joao', company: '', segment: 'alimentacao' };
    const performance = { clientName: 'Donatellus' };
    expect(resolveClientPrimaryName(workspaceClient, null, performance)).toBe('Donatellus');
  });

  it('falls back to clientDisplayName precedence when the backend name is missing', () => {
    expect(resolveClientPrimaryName({ name: 'Joao', company: 'Donatellus', segment: '' }, null, { clientName: null })).toBe('Donatellus');
    expect(resolveClientPrimaryName({ name: 'Joao', company: '', segment: '' }, null, undefined)).toBe('Joao');
  });

  it('falls back gracefully when nothing is available', () => {
    expect(resolveClientPrimaryName(undefined, null, undefined)).toBe('Cliente não encontrado');
    expect(resolveClientPrimaryName({ name: '', company: '', segment: '' }, null, { clientName: '' })).toBe('Cliente sem nome');
  });
});
