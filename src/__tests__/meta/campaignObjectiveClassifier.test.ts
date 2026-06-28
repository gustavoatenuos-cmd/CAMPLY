// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { classifyCampaignObjective } from '../../lib/meta/campaignObjectiveClassifier';

describe('Campaign Objective Classifier', () => {
  it('classifies whatsapp correctly', () => {
    const obj = classifyCampaignObjective({
      campaignObjective: 'OUTCOME_ENGAGEMENT',
      adsetOptimizationGoal: 'CONVERSATIONS',
      adsetDestinationType: 'WHATSAPP'
    });
    expect(obj).toBe('WHATSAPP');
  });

  it('classifies sales correctly', () => {
    const obj = classifyCampaignObjective({
      campaignObjective: 'OUTCOME_SALES',
      adsetOptimizationGoal: 'OFFSITE_CONVERSIONS'
    });
    expect(obj).toBe('SALES');
  });

  it('falls back to UNCLASSIFIED when unknown', () => {
    const obj = classifyCampaignObjective({
      campaignObjective: 'UNKNOWN_MAGIC'
    });
    expect(obj).toBe('UNCLASSIFIED');
  });
});
