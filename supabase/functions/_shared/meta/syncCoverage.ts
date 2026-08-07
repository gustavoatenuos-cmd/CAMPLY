import { MetaInsightRow, PeriodCompletenessStatus } from './aggregation.ts';
import { insightHasDelivery } from './mixedAttributionDetector.ts';


export interface PeriodRangeValidation {
  status: 'complete' | 'partial' | 'zero_delivery' | 'validation_error';
  warnings: string[];
  errors: string[];
  metadata: {
    requestedDateStart: string;
    requestedDateStop: string;
    returnedDateStart: string | null;
    returnedDateStop: string | null;
    missingStartDays: number;
    missingEndDays: number;
    rangeMatchesRequest: boolean;
  };
}

export function getRequestedPeriodRange(period: string, timezone: string, now = new Date()): { requestedDateStart: string, requestedDateStop: string } {
  const today = timezone !== 'UNKNOWN' ? localIsoDate(now, timezone) : null;
  if (period === 'last_90d') {
    if (!today) throw new Error('Timezone unavailable for exact last_90d validation.');
    return {
      requestedDateStart: shiftIsoDate(today, -89),
      requestedDateStop: today
    };
  } else if (period === 'this_month') {
    if (!today) throw new Error('Timezone unavailable for exact this_month validation.');
    return {
      requestedDateStart: `${today.slice(0, 8)}01`,
      requestedDateStop: today
    };
  } else if (period === 'this_week') {
    if (!today) throw new Error('Timezone unavailable for exact this_week validation.');
    return {
      requestedDateStart: weekMondayIsoDate(today),
      requestedDateStop: today
    };
  }
  return { requestedDateStart: '', requestedDateStop: '' };
}

export interface VerifiedScopeCoverage {
  status: 'complete' | 'partial' | 'zero_delivery' | 'unavailable';
  requestedDateStart: string;
  requestedDateStop: string;
  coveredDateStart: string | null;
  coveredDateStop: string | null;
  expectedDays: number;
  coveredDays: number;
  missingDates: string[];
  reason: string | null;
}

export interface PersistedSyncVerification {
  runId: string;
  runStatus: 'success' | 'partial' | 'failed';
  accountMetricsCount: number;
  campaignMetricsCount: number;
  accountCoverage: VerifiedScopeCoverage;
  campaignCoverage: VerifiedScopeCoverage;
  dashboardAccountQualified: boolean;
  dashboardCampaignQualified: boolean;
}

export const localIsoDate = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
};

export const shiftIsoDate = (value: string, days: number): string => {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const weekMondayIsoDate = (value: string): string => {
  const date = new Date(`${value}T12:00:00Z`);
  const daysFromMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
};

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function calculateDaysBetween(start: string, stop: string): number {
  if (start > stop) return 0;
  const ms = new Date(`${stop}T12:00:00Z`).getTime() - new Date(`${start}T12:00:00Z`).getTime();
  return Math.round(ms / 86400000) + 1;
}

export function generateDateSeries(start: string, stop: string): string[] {
  const series = [];
  const days = calculateDaysBetween(start, stop);
  for (let i = 0; i < days; i++) {
    series.push(shiftIsoDate(start, i));
  }
  return series;
}

export const validateReturnedPeriodRange = (
  period: string,
  row: MetaInsightRow | undefined,
  timezone: string,
  collectionStatus: 'complete' | 'partial' | 'error',
  now = new Date()
): PeriodRangeValidation => {
  const warnings: string[] = [];
  const errors: string[] = [];
  const returnedDateStart = row?.date_start ?? null;
  const returnedDateStop = row?.date_stop ?? null;
  const today = timezone !== 'UNKNOWN' ? localIsoDate(now, timezone) : null;
  
  let requestedDateStart = '';
  let requestedDateStop = '';

  if (period === 'last_90d') {
    if (!today) {
      errors.push('Timezone unavailable for exact last_90d validation.');
      return {
        status: 'validation_error',
        warnings,
        errors,
        metadata: {
          requestedDateStart: '', requestedDateStop: '',
          returnedDateStart, returnedDateStop,
          missingStartDays: 0, missingEndDays: 0,
          rangeMatchesRequest: false
        }
      };
    }
    requestedDateStart = shiftIsoDate(today, -89);
    requestedDateStop = today;
  } else if (period === 'this_month') {
    if (!today) {
      errors.push('Timezone unavailable for exact this_month validation.');
      return {
        status: 'validation_error',
        warnings,
        errors,
        metadata: {
          requestedDateStart: '', requestedDateStop: '',
          returnedDateStart, returnedDateStop,
          missingStartDays: 0, missingEndDays: 0,
          rangeMatchesRequest: false
        }
      };
    }
    requestedDateStart = `${today.slice(0, 8)}01`;
    requestedDateStop = today;
  } else if (period === 'this_week') {
    if (!today) {
      errors.push('Timezone unavailable for exact this_week validation.');
      return {
        status: 'validation_error',
        warnings,
        errors,
        metadata: {
          requestedDateStart: '', requestedDateStop: '',
          returnedDateStart, returnedDateStop,
          missingStartDays: 0, missingEndDays: 0,
          rangeMatchesRequest: false
        }
      };
    }
    requestedDateStart = weekMondayIsoDate(today);
    requestedDateStop = today;
  } else {
    // Outros períodos 
    requestedDateStart = returnedDateStart || '';
    requestedDateStop = returnedDateStop || '';
  }

  const validDateStart = isIsoDate(returnedDateStart) ? returnedDateStart : null;
  const validDateStop = isIsoDate(returnedDateStop) ? returnedDateStop : null;

  if (validDateStart && validDateStop && validDateStart > validDateStop) {
    errors.push('Meta returned date_start after date_stop.');
  }
  if (today && validDateStop && validDateStop > today) {
    errors.push('Meta returned a future date_stop for the account timezone.');
  }

  let missingStartDays = 0;
  let missingEndDays = 0;
  let rangeMatchesRequest = false;

  if (validDateStart && validDateStop && requestedDateStart && requestedDateStop) {
    missingStartDays = calculateDaysBetween(requestedDateStart, shiftIsoDate(validDateStart, -1));
    missingEndDays = calculateDaysBetween(shiftIsoDate(validDateStop, 1), requestedDateStop);
    if (missingStartDays < 0) missingStartDays = 0;
    if (missingEndDays < 0) missingEndDays = 0;
    
    if (missingStartDays === 0 && missingEndDays === 0) {
      rangeMatchesRequest = true;
    }
  }

  let status: PeriodRangeValidation['status'] = 'validation_error';

  if (errors.length > 0) {
    status = 'validation_error';
  } else if (!row) {
    if (collectionStatus === 'complete' && requestedDateStart && requestedDateStop) {
      status = 'zero_delivery';
    } else {
      status = 'validation_error';
      errors.push('No insight row returned and collection was not confirmed complete.');
    }
  } else if (!validDateStart || !validDateStop) {
    status = 'validation_error';
    errors.push('Insight row is missing valid date_start or date_stop.');
  } else if (rangeMatchesRequest) {
    status = 'complete';
  } else if (missingStartDays > 0 || missingEndDays > 0) {
    status = 'partial';
  }

  return {
    status,
    warnings,
    errors,
    metadata: {
      requestedDateStart,
      requestedDateStop,
      returnedDateStart,
      returnedDateStop,
      missingStartDays,
      missingEndDays,
      rangeMatchesRequest,
    }
  };
};

export type CollectionCompletionStatus = PeriodCompletenessStatus;
export type RangeValidationStatus = 'complete' | 'partial' | 'zero_delivery' | 'validation_error';

export const buildVerifiedScopeCoverage = ({
  requestedDateStart,
  requestedDateStop,
  returnedRows,
  completionStatus,
  hasCollectionErrors,
}: {
  requestedDateStart: string;
  requestedDateStop: string;
  returnedRows: MetaInsightRow[];
  completionStatus: CollectionCompletionStatus;
  hasCollectionErrors: boolean;
}): VerifiedScopeCoverage => {
  const expectedSeries = generateDateSeries(requestedDateStart, requestedDateStop);
  const expectedDays = expectedSeries.length;

  const rowDates = new Set(returnedRows.filter(r => isIsoDate(r.date_start)).map(r => r.date_start));
  const missingDates = expectedSeries.filter(d => !rowDates.has(d));
  const coveredDays = expectedDays - missingDates.length;

  const validRows = returnedRows.filter(r => isIsoDate(r.date_start) && isIsoDate(r.date_stop));
  const sortedRows = validRows.sort((left, right) => String(left.date_start).localeCompare(String(right.date_start)));
  
  const coveredDateStart = sortedRows[0]?.date_start || null;
  const coveredDateStop = sortedRows[sortedRows.length - 1]?.date_stop || null;

  if (completionStatus === 'complete' && !hasCollectionErrors) {
    if (missingDates.length === 0) {
      return {
        status: 'complete',
        requestedDateStart,
        requestedDateStop,
        coveredDateStart: requestedDateStart,
        coveredDateStop: requestedDateStop,
        expectedDays,
        coveredDays,
        missingDates,
        reason: null,
      };
    }

    if (returnedRows.length === 0 && expectedDays > 0) {
      return {
        status: 'zero_delivery',
        requestedDateStart,
        requestedDateStop,
        coveredDateStart: requestedDateStart,
        coveredDateStop: requestedDateStop,
        expectedDays,
        coveredDays: expectedDays,
        missingDates: [],
        reason: null,
      };
    }
    
    // Corrigir zero delivery com rows (complete + returned rows mas sem entrega = zero_delivery)
    const hasDelivery = returnedRows.some(insightHasDelivery);
    if (!hasDelivery && expectedDays > 0) {
      return {
        status: 'zero_delivery',
        requestedDateStart,
        requestedDateStop,
        coveredDateStart: requestedDateStart,
        coveredDateStop: requestedDateStop,
        expectedDays,
        coveredDays: expectedDays,
        missingDates: [],
        reason: null,
      };
    }
  }
  
  if (completionStatus === 'zero_delivery' && !hasCollectionErrors) {
    return {
      status: 'zero_delivery',
      requestedDateStart,
      requestedDateStop,
      coveredDateStart: requestedDateStart,
      coveredDateStop: requestedDateStop,
      expectedDays,
      coveredDays: expectedDays,
      missingDates: [],
      reason: null,
    };
  }

  let status: VerifiedScopeCoverage['status'] = 'partial';
  let reason: string | null = null;

  if (
    completionStatus === 'partial_page' ||
    completionStatus === 'timeout' ||
    completionStatus === 'api_error' ||
    completionStatus === 'rate_limit_exhausted' ||
    completionStatus === 'missing_insight_row' ||
    completionStatus === 'validation_error'
  ) {
    status = coveredDays > 0 ? 'partial' : 'unavailable';
    reason = completionStatus;
  } else if (hasCollectionErrors) {
    status = coveredDays > 0 ? 'partial' : 'unavailable';
    reason = 'collection_errors';
  } else if (missingDates.length > 0) {
    status = 'partial';
    reason = 'missing_days';
  } else {
    // Fallback for complete but with errors, or partial status, etc.
    status = coveredDays > 0 ? 'partial' : 'unavailable';
    reason = 'partial_collection';
  }

  return {
    status,
    requestedDateStart,
    requestedDateStop,
    coveredDateStart,
    coveredDateStop,
    expectedDays,
    coveredDays,
    missingDates,
    reason,
  };
};
