import '@testing-library/jest-dom/vitest';
/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClientPerformanceCardGrid } from './ClientPerformanceCardGrid';
import React from 'react';
import type { GlobalClientPerformance } from '../../lib/performance/globalPerformanceDashboard';
import type { Client } from '../../types';

describe('ClientPerformanceCardGrid', () => {
  it('renders empty state when no clients', () => {
    render(<ClientPerformanceCardGrid clients={[]} workspaceClients={[]} period="last_30d" />);
    expect(screen.getByText('Nenhum cliente atende aos filtros aplicados.')).toBeInTheDocument();
  });

  it('renders cards for each client using the same global performance data', () => {
    const mockGlobalClient: any = {
      clientStatus: 'active',
      clientId: 'c1',
      clientName: 'Test Global Client',
      accounts: [],
      dataQuality: { status: 'complete', reason: null } as any,
            evaluations: [],
      
      
    };

    const mockWorkspaceClient: Client = {
      id: 'c1',
      name: 'Workspace Client Name',
      company: 'Test Company',
      status: 'active',
      monthlyFee: 100,
      managementFeeType: 'recurring',
      dueDay: 10,
      adInvestmentPeriod: 'monthly',
      adInvestmentMeta: 1000,
      adInvestmentGoogle: 0,
      adInvestmentYoutube: 0,
      adInvestmentTikTok: 0,
      hasProject: false,
      segment: 'Retail',
      structure: 'B2C',
      contact: 'test@example.com',
      projectId: ''
    };

    render(
      <ClientPerformanceCardGrid 
        clients={[mockGlobalClient]} 
        workspaceClients={[mockWorkspaceClient]} 
        period="last_30d" 
      />
    );

    // Should render the card with the name from the workspace client
    expect(screen.getByText('Workspace Client Name')).toBeInTheDocument();
  });
});
