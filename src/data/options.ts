import { MetaCampaignObjective } from '../types';

export const metaCampaignObjectives: MetaCampaignObjective[] = [
  'Reconhecimento',
  'Tráfego',
  'Engajamento',
  'Cadastros',
  'Promoção do app',
  'Vendas',
];

export const campaignPlatforms = ['Meta Ads', 'Google Ads', 'TikTok Ads', 'Outro'] as const;

export const investmentPeriods = [
  { value: 'daily', label: 'Diário' },
  { value: 'weekly', label: 'Semanal' },
  { value: 'monthly', label: 'Mensal' },
] as const;

export const billingTypes = [
  { value: 'recurring', label: 'Mensalidade recorrente' },
  { value: 'one_time', label: 'Serviço pontual' },
] as const;
