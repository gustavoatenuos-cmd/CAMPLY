/**
 * Groups Meta campaigns by the objective categories Meta itself shows in Ads
 * Manager (ODAX: Reconhecimento, Tráfego, Engajamento, Cadastros, Promoção do
 * app, Vendas). The raw Meta objective (OUTCOME_* or a legacy value) decides
 * the column; the classified objective only refines the card label (e.g.
 * "WhatsApp" inside Engajamento) and is the fallback when the raw value is
 * missing.
 */
export type ObjectiveGroupId =
  | 'sales'
  | 'leads'
  | 'engagement'
  | 'traffic'
  | 'awareness'
  | 'app'
  | 'other';

export interface ObjectiveGroup {
  id: ObjectiveGroupId;
  label: string;
  description: string;
  accent: string; // hex, used for column header and badges
}

export const OBJECTIVE_GROUPS: ObjectiveGroup[] = [
  { id: 'sales', label: 'Vendas', description: 'Compras, catálogo e conversões', accent: '#60a5fa' },
  { id: 'leads', label: 'Cadastros', description: 'Formulários e leads', accent: '#c084fc' },
  { id: 'engagement', label: 'Engajamento', description: 'Mensagens, interações e vídeo', accent: '#34d399' },
  { id: 'traffic', label: 'Tráfego', description: 'Cliques para site, app ou perfil', accent: '#22d3ee' },
  { id: 'awareness', label: 'Reconhecimento', description: 'Alcance e lembrança da marca', accent: '#fbbf24' },
  { id: 'app', label: 'Promoção do app', description: 'Instalações e eventos no app', accent: '#f472b6' },
  { id: 'other', label: 'Sem objetivo definido', description: 'Objetivo não informado pela Meta', accent: '#94a3b8' },
];

const RAW_OBJECTIVE_GROUP: Record<string, ObjectiveGroupId> = {
  OUTCOME_SALES: 'sales',
  CONVERSIONS: 'sales',
  PRODUCT_CATALOG_SALES: 'sales',
  STORE_VISITS: 'sales',
  OUTCOME_LEADS: 'leads',
  LEAD_GENERATION: 'leads',
  OUTCOME_ENGAGEMENT: 'engagement',
  POST_ENGAGEMENT: 'engagement',
  PAGE_LIKES: 'engagement',
  EVENT_RESPONSES: 'engagement',
  MESSAGES: 'engagement',
  VIDEO_VIEWS: 'engagement',
  OUTCOME_TRAFFIC: 'traffic',
  LINK_CLICKS: 'traffic',
  OUTCOME_AWARENESS: 'awareness',
  BRAND_AWARENESS: 'awareness',
  REACH: 'awareness',
  OUTCOME_APP_PROMOTION: 'app',
  APP_INSTALLS: 'app',
};

const CLASSIFIED_OBJECTIVE_GROUP: Record<string, ObjectiveGroupId> = {
  SALES: 'sales',
  LEADS: 'leads',
  ENGAGEMENT: 'engagement',
  VIDEO: 'engagement',
  WHATSAPP: 'engagement',
  MESSENGER: 'engagement',
  INSTAGRAM_DIRECT: 'engagement',
  MESSAGING_OTHER: 'engagement',
  TRAFFIC: 'traffic',
  PROFILE_VISITS: 'traffic',
  AWARENESS: 'awareness',
  APP: 'app',
};

export const CLASSIFIED_OBJECTIVE_LABELS: Record<string, string> = {
  SALES: 'Vendas',
  LEADS: 'Leads',
  ENGAGEMENT: 'Engajamento',
  VIDEO: 'Vídeo',
  WHATSAPP: 'WhatsApp',
  MESSENGER: 'Messenger',
  INSTAGRAM_DIRECT: 'Instagram Direct',
  MESSAGING_OTHER: 'Mensagens',
  TRAFFIC: 'Tráfego',
  PROFILE_VISITS: 'Visitas ao perfil',
  AWARENESS: 'Reconhecimento',
  APP: 'App',
  MIXED: 'Misto',
  UNCLASSIFIED: 'Não classificado',
};

const GENERIC_CLASSIFIED = new Set(['SALES', 'LEADS', 'TRAFFIC', 'ENGAGEMENT', 'AWARENESS', 'APP']);

export function objectiveGroupFor(rawObjective: string | null | undefined, classifiedObjective: string | null | undefined): ObjectiveGroupId {
  const raw = (rawObjective || '').trim().toUpperCase();
  if (raw && RAW_OBJECTIVE_GROUP[raw]) return RAW_OBJECTIVE_GROUP[raw];
  const classified = (classifiedObjective || '').trim().toUpperCase();
  if (classified && CLASSIFIED_OBJECTIVE_GROUP[classified]) return CLASSIFIED_OBJECTIVE_GROUP[classified];
  return 'other';
}

export function objectiveGroup(id: ObjectiveGroupId): ObjectiveGroup {
  return OBJECTIVE_GROUPS.find((group) => group.id === id) ?? OBJECTIVE_GROUPS[OBJECTIVE_GROUPS.length - 1];
}

/** Sub-label shown on the card when it adds information to the column name. */
export function objectiveDetailLabel(classifiedObjective: string | null | undefined, group: ObjectiveGroupId): string | null {
  const classified = (classifiedObjective || '').trim().toUpperCase();
  const label = CLASSIFIED_OBJECTIVE_LABELS[classified];
  if (!label || classified === 'UNCLASSIFIED') return null;
  // Generic classes only repeat the column (e.g. "Leads" inside Cadastros).
  if (GENERIC_CLASSIFIED.has(classified) && CLASSIFIED_OBJECTIVE_GROUP[classified] === group) return null;
  if (label === objectiveGroup(group).label) return null;
  return label;
}
