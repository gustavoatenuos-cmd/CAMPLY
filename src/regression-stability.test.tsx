import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Regression & Stability Tests', () => {
  it('favicon.svg is a valid XML', () => {
    const faviconPath = path.resolve(__dirname, '../public/favicon.svg');
    const content = fs.readFileSync(faviconPath, 'utf8');
    expect(content).toContain('<svg');
    expect(content).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('index.html references versioned favicon', () => {
    const indexPath = path.resolve(__dirname, '../index.html');
    const content = fs.readFileSync(indexPath, 'utf8');
    expect(content).toContain('href="/favicon.svg?v=camply-2"');
  });

  it('DashboardUnavailable allows scroll via h-full and overflow-y-auto', () => {
    const overviewPath = path.resolve(__dirname, 'components/OverviewView.tsx');
    const content = fs.readFileSync(overviewPath, 'utf8');
    // Ensure DashboardUnavailable container has overflow-y-auto
    expect(content).toMatch(/function DashboardUnavailable[\s\S]*?className="h-full overflow-y-auto/);
  });

  it('Sidebar allows scroll independently in low height viewports', () => {
    const sidebarPath = path.resolve(__dirname, 'components/Sidebar.tsx');
    const content = fs.readFileSync(sidebarPath, 'utf8');
    expect(content).toMatch(/xl:overflow-y-auto/);
    expect(content).not.toMatch(/xl:overflow-x-visible/);
  });

  it('Only MetaIntegrationView triggers syncMetaAsset', () => {
    const overviewPath = path.resolve(__dirname, 'components/OverviewView.tsx');
    const overviewContent = fs.readFileSync(overviewPath, 'utf8');
    expect(overviewContent).not.toContain('syncMetaAsset');

    const analyticsPath = path.resolve(__dirname, 'components/ClientAnalyticsView.tsx');
    if (fs.existsSync(analyticsPath)) {
      const analyticsContent = fs.readFileSync(analyticsPath, 'utf8');
      expect(analyticsContent).not.toContain('syncMetaAsset');
    }
  });
});
