import type { Client } from '../../types';
import type { GlobalClientPerformance } from '../performance/globalPerformanceDashboard';

export type ResolvedClientProfileStatus = 'confirmed' | 'suggested' | 'pending';
export type ResolvedClientProfileSource =
  | 'analysis_profile'
  | 'manual_client_segment'
  | 'meta_account_name'
  | 'campaign_name'
  | 'keyword_classifier'
  | 'missing';

export interface ResolvedClientProfile {
  clientId: string;
  detectedSegment: string | null;
  detectedSubsegment: string | null;
  confidence: number;
  source: ResolvedClientProfileSource;
  status: ResolvedClientProfileStatus;
  missingReasons: string[];
}

const keywordRules: Array<{ pattern: RegExp; segment: string; subsegment: string; confidence: number }> = [
  { pattern: /odonto|dent|implante|ortodo|sorriso|cl[ií]nica/i, segment: 'Saúde', subsegment: 'Odontologia', confidence: 0.82 },
  { pattern: /est[eé]tica|harmoniza|botox|beleza/i, segment: 'Saúde', subsegment: 'Estética', confidence: 0.78 },
  { pattern: /delivery|pedido|restaurante|pizza|hamb[uú]rguer|food/i, segment: 'Alimentação', subsegment: 'Delivery', confidence: 0.78 },
  { pattern: /cal[cç]ado|sapato|t[eê]nis|sand[aá]lia/i, segment: 'Varejo local', subsegment: 'Calçados', confidence: 0.78 },
  { pattern: /produto|cat[aá]logo|e-?commerce|loja/i, segment: 'Varejo local', subsegment: 'Produtos físicos', confidence: 0.68 },
  { pattern: /im[oó]vel|imobili[aá]ria|apartamento|lote/i, segment: 'Imobiliário', subsegment: 'Captação de leads', confidence: 0.72 },
  { pattern: /curso|escola|aula|mentoria/i, segment: 'Educação', subsegment: 'Curso online', confidence: 0.68 },
];

function textFromClient(client?: Client): string {
  if (!client) return '';
  return [client.name, client.company, client.segment, client.structure, client.notes]
    .filter(Boolean)
    .join(' ');
}

function textFromPerformance(client: GlobalClientPerformance): string {
  return [
    client.clientName,
    ...client.accounts.map((account) => account.accountName),
    ...client.metricGroups.map((group) => group.campaignName),
  ].filter(Boolean).join(' ');
}

function keywordMatch(text: string) {
  return keywordRules.find((rule) => rule.pattern.test(text)) ?? null;
}

export function resolveClientProfile(
  client: GlobalClientPerformance,
  workspaceClient?: Client
): ResolvedClientProfile {
  const profile = client.analysisProfile;
  if (profile?.analysisEnabled && profile.vertical && profile.subsegment) {
    return {
      clientId: client.clientId,
      detectedSegment: profile.vertical === 'Outros' && profile.customVertical ? profile.customVertical : profile.vertical,
      detectedSubsegment: profile.subsegment === 'Outros' && profile.customSubsegment ? profile.customSubsegment : profile.subsegment,
      confidence: 1,
      source: 'analysis_profile',
      status: 'confirmed',
      missingReasons: [],
    };
  }

  if (workspaceClient?.segment?.trim()) {
    const match = keywordMatch(textFromClient(workspaceClient));
    return {
      clientId: client.clientId,
      detectedSegment: workspaceClient.segment.trim(),
      detectedSubsegment: match?.subsegment ?? null,
      confidence: match ? Math.max(0.7, match.confidence) : 0.62,
      source: 'manual_client_segment',
      status: match ? 'suggested' : 'pending',
      missingReasons: match ? [] : ['Subsegmento pendente de confirmação'],
    };
  }

  const accountMatch = keywordMatch(client.accounts.map((account) => account.accountName).join(' '));
  if (accountMatch) {
    return {
      clientId: client.clientId,
      detectedSegment: accountMatch.segment,
      detectedSubsegment: accountMatch.subsegment,
      confidence: accountMatch.confidence,
      source: 'meta_account_name',
      status: accountMatch.confidence >= 0.8 ? 'suggested' : 'pending',
      missingReasons: accountMatch.confidence >= 0.8 ? [] : ['Segmento sugerido precisa de confirmação manual'],
    };
  }

  const campaignMatch = keywordMatch(client.metricGroups.map((group) => group.campaignName).join(' '));
  if (campaignMatch) {
    return {
      clientId: client.clientId,
      detectedSegment: campaignMatch.segment,
      detectedSubsegment: campaignMatch.subsegment,
      confidence: campaignMatch.confidence,
      source: 'campaign_name',
      status: campaignMatch.confidence >= 0.8 ? 'suggested' : 'pending',
      missingReasons: campaignMatch.confidence >= 0.8 ? [] : ['Segmento sugerido precisa de confirmação manual'],
    };
  }

  const broadMatch = keywordMatch(`${textFromClient(workspaceClient)} ${textFromPerformance(client)}`);
  if (broadMatch) {
    return {
      clientId: client.clientId,
      detectedSegment: broadMatch.segment,
      detectedSubsegment: broadMatch.subsegment,
      confidence: broadMatch.confidence,
      source: 'keyword_classifier',
      status: 'pending',
      missingReasons: ['Classificação automática precisa de confirmação manual'],
    };
  }

  return {
    clientId: client.clientId,
    detectedSegment: null,
    detectedSubsegment: null,
    confidence: 0,
    source: 'missing',
    status: 'pending',
    missingReasons: ['Cliente sem segmento/subsegmento definido'],
  };
}
