const http = require('http');
const url = require('url');
const crypto = require('crypto');

let requestCounts = {};
let pathCounts = {};
let reconciliationState = 'A';
let partialState = 'success';
let oauthShortTokenExchangeCount = 0;
let oauthLongTokenExchangeCount = 0;
let oauthMeCount = 0;
let authFingerprints = {};

const MOCK_PORT = process.env.MOCK_PORT || 9999;
const MOCK_HOST = process.env.MOCK_HOST || `mock-graph:${MOCK_PORT}`;

const fingerprint = (value) => value
  ? crypto.createHash('sha256').update(value).digest('hex').slice(0, 12)
  : null;

function resetState() {
  requestCounts = {};
  pathCounts = {};
  reconciliationState = 'A';
  partialState = 'success';
  oauthShortTokenExchangeCount = 0;
  oauthLongTokenExchangeCount = 0;
  oauthMeCount = 0;
  authFingerprints = {};
}

function accountFromPath(pathname) {
  const match = pathname.match(/(act_[a-z0-9_]+)/);
  return match ? match[1] : 'act_unknown';
}

function requestKind(pathname) {
  if (pathname.includes('/campaigns')) return 'campaigns';
  if (pathname.includes('/adsets')) return 'adsets';
  if (pathname.includes('/insights')) return 'insights';
  return 'account';
}

function recordGraphRequest(req, accountId, kind) {
  requestCounts[accountId] = (requestCounts[accountId] || 0) + 1;
  pathCounts[accountId] = pathCounts[accountId] || {};
  pathCounts[accountId][kind] = (pathCounts[accountId][kind] || 0) + 1;

  const auth = req.headers.authorization || '';
  if (auth) {
    authFingerprints[accountId] = authFingerprints[accountId] || [];
    const value = fingerprint(auth);
    if (value && !authFingerprints[accountId].includes(value)) {
      authFingerprints[accountId].push(value);
    }
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  if (path === '/health') {
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  if (path === '/reset') {
    resetState();
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'reset' }));
  }

  if (path === '/test-stats') {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      request_counts: requestCounts,
      path_counts: pathCounts,
      oauth_short_token_exchange_count: oauthShortTokenExchangeCount,
      oauth_long_token_exchange_count: oauthLongTokenExchangeCount,
      oauth_me_count: oauthMeCount,
      auth_fingerprints: authFingerprints,
      reconciliation_state: reconciliationState,
      partial_state: partialState,
    }));
  }

  if (path === '/set_reconciliation_state') {
    reconciliationState = parsedUrl.query.state === 'B' ? 'B' : 'A';
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok', state: reconciliationState }));
  }

  if (path === '/set_partial_state') {
    partialState = parsedUrl.query.state === 'fail_page_2' ? 'fail_page_2' : 'success';
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok', state: partialState }));
  }

  if (path.includes('/oauth/access_token')) {
    if (parsedUrl.query.grant_type === 'fb_exchange_token') {
      oauthLongTokenExchangeCount++;
      return res.end(JSON.stringify({ access_token: 'mock_long_lived_token', token_type: 'bearer', expires_in: 3600 }));
    }

    oauthShortTokenExchangeCount++;
    return res.end(JSON.stringify({ access_token: 'mock_short_lived_token', token_type: 'bearer', expires_in: 3600 }));
  }

  if (path.endsWith('/me')) {
    oauthMeCount++;
    return res.end(JSON.stringify({ id: '123456789', name: 'Mock User' }));
  }

  const accountId = accountFromPath(path);
  const kind = requestKind(path);
  recordGraphRequest(req, accountId, kind);
  console.log(`[MOCK] ${req.method} ${path} account=${accountId} kind=${kind} count=${pathCounts[accountId][kind]}`);

  let date_start = '2026-06-27';
  let date_stop = '2026-06-27';
  if (parsedUrl.query.time_range) {
    try {
      const timeRange = JSON.parse(parsedUrl.query.time_range);
      if (timeRange.since) date_start = timeRange.since;
      if (timeRange.until) date_stop = timeRange.until;
    } catch (_) {
      // Invalid ranges are intentionally ignored by the mock.
    }
  }

  if (accountId === 'act_error') {
    res.statusCode = 500;
    return res.end(JSON.stringify({
      error: { message: 'Internal Server Error', type: 'OAuthException', code: 1, fbtrace_id: 'A1b2C3d4E5f6G7' },
    }));
  }

  if (accountId === 'act_unauthorized') {
    res.statusCode = 401;
    return res.end(JSON.stringify({
      error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 },
    }));
  }

  if (accountId === 'act_rate_limit_recovered' && kind === 'account' && pathCounts[accountId][kind] <= 2) {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: { message: 'Rate limit exceeded.', type: 'OAuthException', code: 17 } }));
  }

  if (accountId === 'act_rate_limit_exhausted') {
    res.statusCode = 429;
    return res.end(JSON.stringify({ error: { message: 'Rate limit exceeded.', type: 'OAuthException', code: 17 } }));
  }

  if (accountId === 'act_timeout') {
    setTimeout(() => {
      if (!res.writableEnded) {
        res.statusCode = 504;
        res.end(JSON.stringify({ error: { message: 'Gateway Timeout' } }));
      }
    }, 250);
    return;
  }

  if (accountId === 'act_invalid_payload') {
    res.statusCode = 200;
    return res.end('<html><body>Not JSON</body></html>');
  }

  if (path.match(/\/act_[a-z0-9_]+$/)) {
    return res.end(JSON.stringify({
      id: accountId,
      timezone_name: 'America/Sao_Paulo',
      currency: 'BRL',
    }));
  }

  if (path.includes('/campaigns')) {
    let campaigns = [];
    if (accountId === 'act_simple') {
      campaigns = [
        { id: 'camp_123', name: 'Simple Campaign', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE', daily_budget: '1000' },
        { id: 'camp_456', name: 'Other Campaign', objective: 'OUTCOME_TRAFFIC', effective_status: 'ACTIVE' },
        { id: 'camp_789', name: 'Third Campaign', objective: 'OUTCOME_ENGAGEMENT', effective_status: 'PAUSED' },
      ];
    } else if (accountId === 'act_zero') {
      campaigns = [{ id: 'camp_zero', name: 'Zero Delivery Campaign', objective: 'OUTCOME_TRAFFIC', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_mixed_obj') {
      campaigns = [{ id: 'camp_mix_obj', name: 'Mixed Objective', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_mixed_attr') {
      campaigns = [{ id: 'camp_mix_attr', name: 'Mixed Attribution', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_mixed_dest') {
      campaigns = [{ id: 'camp_mix_dest', name: 'Mixed Destination', objective: 'OUTCOME_ENGAGEMENT', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_partial') {
      campaigns = [{ id: 'camp_partial', name: 'Partial Campaign', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_ssrf') {
      campaigns = [{ id: 'camp_ssrf', name: 'SSRF Campaign', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_reconciliation') {
      campaigns = [{ id: 'camp_recon', name: reconciliationState === 'A' ? 'Recon Campaign A' : 'Recon Campaign B', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }];
    }
    return res.end(JSON.stringify({ data: campaigns }));
  }

  if (path.includes('/adsets')) {
    let adsets = [];
    if (accountId === 'act_simple') {
      adsets = [
        { id: 'adset_123', campaign_id: 'camp_123', name: 'Adset 123', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
        { id: 'adset_456', campaign_id: 'camp_456', name: 'Adset 456', optimization_goal: 'LINK_CLICKS', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
        { id: 'adset_789', campaign_id: 'camp_789', name: 'Adset 789', optimization_goal: 'POST_ENGAGEMENT', effective_status: 'PAUSED', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
      ];
    } else if (accountId === 'act_zero') {
      adsets = [{ id: 'adset_zero', campaign_id: 'camp_zero', name: 'Adset Zero', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }] }];
    } else if (accountId === 'act_mixed_obj') {
      adsets = [
        { id: 'adset_obj1', campaign_id: 'camp_mix_obj', name: 'Adset Obj 1', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
        { id: 'adset_obj2', campaign_id: 'camp_mix_obj', name: 'Adset Obj 2', optimization_goal: 'OFFSITE_CONVERSIONS', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
      ];
    } else if (accountId === 'act_mixed_attr') {
      adsets = [
        { id: 'adset_attr1', campaign_id: 'camp_mix_attr', name: 'Adset Attr 1', optimization_goal: 'OFFSITE_CONVERSIONS', effective_status: 'ACTIVE', attribution_setting: '7d_click', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
        { id: 'adset_attr2', campaign_id: 'camp_mix_attr', name: 'Adset Attr 2', optimization_goal: 'OFFSITE_CONVERSIONS', effective_status: 'ACTIVE', attribution_setting: '1d_click', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }] },
      ];
    } else if (accountId === 'act_mixed_dest') {
      adsets = [
        { id: 'adset_dest1', campaign_id: 'camp_mix_dest', name: 'Adset Dest 1', optimization_goal: 'PAGE_LIKES', effective_status: 'ACTIVE', destination_type: 'FACEBOOK' },
        { id: 'adset_dest2', campaign_id: 'camp_mix_dest', name: 'Adset Dest 2', optimization_goal: 'MESSAGING_CONVERSATIONS', effective_status: 'ACTIVE', destination_type: 'MESSENGER' },
      ];
    } else if (accountId === 'act_partial') {
      adsets = [{ id: 'adset_partial', campaign_id: 'camp_partial', name: 'Adset Partial', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }];
    } else if (accountId === 'act_ssrf') {
      adsets = [{ id: 'adset_ssrf', campaign_id: 'camp_ssrf', name: 'Adset SSRF', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }];
    } else if (accountId === 'act_reconciliation') {
      adsets = [{ id: 'adset_recon', campaign_id: 'camp_recon', name: 'Adset Recon', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', destination_type: reconciliationState === 'A' ? 'FACEBOOK' : 'WEBSITE', attribution_setting: reconciliationState === 'A' ? '7d_click' : '1d_click' }];
    }
    return res.end(JSON.stringify({ data: adsets }));
  }

  if (path.includes('/insights')) {
    const isAdsetLevel = parsedUrl.search.includes('level=adset');
    let insights = [];

    if (accountId === 'act_partial') {
      const page = parsedUrl.query.after || '1';
      if (partialState === 'fail_page_2' && page === '1') {
        return res.end(JSON.stringify({
          data: [{ campaign_id: 'camp_partial', adset_id: 'adset_partial', impressions: '1000', spend: '10.00', reach: '500', date_start, date_stop }],
          paging: { cursors: { after: 'page2' }, next: `http://${MOCK_HOST}/v25.0/${accountId}/insights?after=page2&level=${isAdsetLevel ? 'adset' : 'campaign'}` },
        }));
      }
      if (partialState === 'fail_page_2' && page === 'page2') {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: { message: 'Pagination failed on page 2' } }));
      }
      return res.end(JSON.stringify({
        data: [{ campaign_id: 'camp_partial', adset_id: 'adset_partial', impressions: '1000', spend: '10.00', reach: '500', date_start, date_stop }],
      }));
    }

    if (accountId === 'act_ssrf') {
      return res.end(JSON.stringify({
        data: [{ campaign_id: 'camp_ssrf', impressions: '10', spend: '1.00', date_start, date_stop }],
        paging: { cursors: { after: 'page2' }, next: 'http://169.254.169.254/latest/meta-data/' },
      }));
    }

    if (accountId === 'act_simple') {
      insights = isAdsetLevel
        ? [
            { campaign_id: 'camp_123', adset_id: 'adset_123', impressions: '1000', spend: '50.00', actions: [{ action_type: 'lead', value: '5' }], date_start, date_stop },
            { campaign_id: 'camp_456', adset_id: 'adset_456', impressions: '500', spend: '25.00', actions: [{ action_type: 'link_click', value: '10' }], date_start, date_stop },
            { campaign_id: 'camp_789', adset_id: 'adset_789', impressions: '200', spend: '10.00', actions: [{ action_type: 'post_engagement', value: '20' }], date_start, date_stop },
          ]
        : [
            { campaign_id: 'camp_123', impressions: '1000', spend: '50.00', actions: [{ action_type: 'lead', value: '5' }], reach: '800', date_start, date_stop },
            { campaign_id: 'camp_456', impressions: '500', spend: '25.00', actions: [{ action_type: 'link_click', value: '10' }], reach: '400', date_start, date_stop },
            { campaign_id: 'camp_789', impressions: '200', spend: '10.00', actions: [{ action_type: 'post_engagement', value: '20' }], reach: '100', date_start, date_stop },
          ];
    } else if (accountId === 'act_zero') {
      insights = [];
    } else if (accountId === 'act_mixed_obj') {
      insights = isAdsetLevel
        ? [
            { campaign_id: 'camp_mix_obj', adset_id: 'adset_obj1', impressions: '1000', spend: '20.00', date_start, date_stop },
            { campaign_id: 'camp_mix_obj', adset_id: 'adset_obj2', impressions: '2000', spend: '40.00', actions: [{ action_type: 'purchase', value: '2' }], action_values: [{ action_type: 'purchase', value: '80' }], date_start, date_stop },
          ]
        : [{ campaign_id: 'camp_mix_obj', impressions: '3000', spend: '60.00', reach: '2500', date_start, date_stop }];
    } else if (accountId === 'act_mixed_attr') {
      insights = isAdsetLevel
        ? [
            { campaign_id: 'camp_mix_attr', adset_id: 'adset_attr1', impressions: '1000', spend: '20.00', actions: [{ action_type: 'purchase', value: '2' }], action_values: [{ action_type: 'purchase', value: '40' }], date_start, date_stop, attribution_setting: '7d_click' },
            { campaign_id: 'camp_mix_attr', adset_id: 'adset_attr2', impressions: '2000', spend: '40.00', actions: [{ action_type: 'purchase', value: '5' }], action_values: [{ action_type: 'purchase', value: '80' }], date_start, date_stop, attribution_setting: '1d_click' },
          ]
        : [{ campaign_id: 'camp_mix_attr', impressions: '3000', spend: '60.00', actions: [{ action_type: 'purchase', value: '7' }], action_values: [{ action_type: 'purchase', value: '120' }], date_start, date_stop }];
    } else if (accountId === 'act_mixed_dest') {
      insights = isAdsetLevel
        ? [
            { campaign_id: 'camp_mix_dest', adset_id: 'adset_dest1', impressions: '1000', spend: '20.00', date_start, date_stop },
            { campaign_id: 'camp_mix_dest', adset_id: 'adset_dest2', impressions: '1500', spend: '30.00', date_start, date_stop },
          ]
        : [{ campaign_id: 'camp_mix_dest', impressions: '2500', spend: '50.00', date_start, date_stop }];
    } else if (accountId === 'act_reconciliation') {
      const attr = reconciliationState === 'A' ? '7d_click' : '1d_click';
      insights = isAdsetLevel
        ? [{ campaign_id: 'camp_recon', adset_id: 'adset_recon', impressions: '100', spend: '10', date_start, date_stop, attribution_setting: attr }]
        : [{ campaign_id: 'camp_recon', impressions: '100', spend: '10', date_start, date_stop }];
    }

    return res.end(JSON.stringify({ data: insights }));
  }

  return res.end(JSON.stringify({ data: [] }));
});

server.listen(MOCK_PORT, '0.0.0.0', () => {
  console.log(`Mock Graph API running on port ${MOCK_PORT}`);
});
