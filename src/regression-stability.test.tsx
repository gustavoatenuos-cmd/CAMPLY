// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@testing-library/react';
import { OverviewView } from './components/OverviewView';
import { ClientAnalyticsView } from './components/ClientAnalyticsView';
import * as metaSyncService from './lib/meta/metaSyncService';

vi.mock('./lib/meta/metaSyncService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/meta/metaSyncService')>();
  return {
    ...actual,
    syncMetaAsset: vi.fn(),
  };
});

describe('Regression & Stability Tests', () => {
  it('favicon.svg is a valid XML', () => {
    const faviconPath = path.resolve(__dirname, '../public/favicon.svg');
    const content = fs.readFileSync(faviconPath, 'utf8');
    
    const { DOMParser } = window;
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    
    expect(parseError).toBeNull();
    expect(doc.documentElement.tagName.toLowerCase()).toBe('svg');
  });

  it('index.html references versioned favicon', () => {
    const indexPath = path.resolve(__dirname, '../index.html');
    const content = fs.readFileSync(indexPath, 'utf8');
    expect(content).toContain('href="/favicon.svg?v=camply-2"');
  });

  it('DashboardUnavailable container handles scroll properly', () => {
    const overviewPath = path.resolve(__dirname, 'components/OverviewView.tsx');
    const content = fs.readFileSync(overviewPath, 'utf8');
    expect(content).toMatch(/<div className="h-full overflow-y-auto bg-brand-ink">/);
  });
  
  it('Sidebar allows independent scroll in low height viewports', () => {
    const sidebarPath = path.resolve(__dirname, 'components/Sidebar.tsx');
    const content = fs.readFileSync(sidebarPath, 'utf8');
    expect(content).toMatch(/xl:overflow-y-auto/);
    expect(content).not.toMatch(/xl:overflow-x-visible/);
  });

  describe('Meta Sync Isolation', () => {
    const mockData = {
      clients: [], projects: [], financials: [], activityLogs: [], users: [], agentAlerts: [], campaigns: [], tasks: [], receivables: []
    } as any;

    it('OverviewView does NOT trigger syncMetaAsset', () => {
      vi.mocked(metaSyncService.syncMetaAsset).mockClear();
      render(<OverviewView data={mockData} insights={[]} updateData={vi.fn()} setActiveView={vi.fn()} />);
      expect(metaSyncService.syncMetaAsset).not.toHaveBeenCalled();
    });

    it('ClientAnalyticsView does NOT trigger syncMetaAsset', () => {
      vi.mocked(metaSyncService.syncMetaAsset).mockClear();
      render(<ClientAnalyticsView data={mockData} updateData={vi.fn()} setActiveView={vi.fn()} />);
      expect(metaSyncService.syncMetaAsset).not.toHaveBeenCalled();
    });

    it('MetaIntegrationView continues to be the only one authorized (has sync trigger)', () => {
      const metaViewPath = path.resolve(__dirname, 'components/MetaIntegrationView.tsx');
      const content = fs.readFileSync(metaViewPath, 'utf8');
      expect(content).toContain('syncMetaAsset(');
    });
  });
});
