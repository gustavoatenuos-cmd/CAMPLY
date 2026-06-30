const http = require('http');
const url = require('url');

let requestCounts = {};
let forcedTimeout = false;
let forcedRateLimit = false;

let reconciliationState = 'A'; // 'A' or 'B'
let oauthTokenExchangeCount = 0;
let oauthMeCount = 0;

const MOCK_PORT = process.env.MOCK_PORT || 9999;
const MOCK_HOST = process.env.MOCK_HOST || `mock-graph:${MOCK_PORT}`;

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const path = decodeURIComponent(parsedUrl.pathname);
  
  // Extract accountId early for logging
  const match = path.match(/(act_[^/&?]+)/);
  const accountId = match ? decodeURIComponent(match[1]) : 'act_unknown';
  
  if (!requestCounts[accountId]) requestCounts[accountId] = 0;
  requestCounts[accountId]++;

  // Sanitize logging (no secrets, no full query string)
  const reqId = Math.random().toString(36).substring(7);
  console.log(`[MOCK] req_id=${reqId} method=${req.method} path=${path} scenario=${accountId} count=${requestCounts[accountId]}`);

  // Masked token capture (for two active integrations)
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token) {
      if (!global.usedTokens) global.usedTokens = {};
      const masked = token.substring(0, 4) + '***' + token.substring(token.length - 4);
      global.usedTokens[accountId] = global.usedTokens[accountId] || new Set();
      global.usedTokens[accountId].add(masked);
    }
  }

  res.setHeader('Content-Type', 'application/json');
  
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  
  if (path === '/health') {
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  if (path === '/test-stats') {
    res.statusCode = 200;
    return res.end(JSON.stringify({
      oauth_token_exchange_count: global.oauthTokenExchangeCount || 0,
      oauth_long_token_exchange_count: global.oauthLongTokenExchangeCount || 0,
      oauth_me_count: global.oauthMeCount || 0,
      request_counts: requestCounts,
      used_tokens: Object.fromEntries(Object.entries(global.usedTokens || {}).map(([k, v]) => [k, Array.from(v)]))
    }));
  }

  if (path === '/reset') {
    requestCounts = {};
    forcedTimeout = false;
    forcedRateLimit = false;
    reconciliationState = 'A';
    global.oauthTokenExchangeCount = 0;
    global.oauthLongTokenExchangeCount = 0;
    global.oauthMeCount = 0;
    global.usedTokens = {};
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'reset' }));
  }
  
  if (path === '/set_reconciliation_state') {
    reconciliationState = parsedUrl.query.state || 'A';
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok', state: reconciliationState }));
  }

  if (path === '/set_partial_mode') {
    global.partialMode = parsedUrl.query.mode || 'complete';
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok', mode: global.partialMode }));
  }

  // OAuth endpoints
  if (path.includes('/oauth/access_token')) {
    if (parsedUrl.query.grant_type === 'fb_exchange_token') {
      global.oauthLongTokenExchangeCount = (global.oauthLongTokenExchangeCount || 0) + 1;
    } else {
      global.oauthTokenExchangeCount = (global.oauthTokenExchangeCount || 0) + 1;
    }
    return res.end(JSON.stringify({ access_token: 'mock_long_lived_token', token_type: 'bearer', expires_in: 3600 }));
  }
  if (path.includes('/me')) {
    global.oauthMeCount = (global.oauthMeCount || 0) + 1;
    return res.end(JSON.stringify({ id: '123456789', name: 'Mock User' }));
  }

  let date_start = '2026-06-27';
  let date_stop = '2026-06-27';
  if (parsedUrl.query.time_range) {
     try {
       const tr = JSON.parse(parsedUrl.query.time_range);
       if (tr.since) date_start = tr.since;
       if (tr.until) date_stop = tr.until;
     } catch(e){}
  }

  if (path.endsWith(`/${accountId}`) || path.endsWith(`/${accountId}/`)) {
    if (accountId === 'act_api_error') {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: 'Invalid parameter' } }));
    }
    return res.end(JSON.stringify({
      id: accountId,
      timezone_name: 'America/Sao_Paulo',
      currency: 'BRL'
    }));
  }

  if (accountId === 'act_error') {
    res.statusCode = 500;
    return res.end(JSON.stringify({
      error: { message: "Internal Server Error", type: "OAuthException", code: 1, fbtrace_id: "A1b2C3d4E5f6G7" }
    }));
  }

  if (accountId === 'act_unauthorized') {
    res.statusCode = 401;
    return res.end(JSON.stringify({
      error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 }
    }));
  }

  if (accountId === 'act_rate_limit_recovered') {
    if (requestCounts[accountId] <= 2) {
      res.statusCode = 429;
      return res.end(JSON.stringify({
        error: { message: "Rate limit exceeded.", type: "OAuthException", code: 17 }
      }));
    }
  }

  if (accountId === 'act_rate_limit_exhausted') {
    res.statusCode = 429;
    return res.end(JSON.stringify({
      error: { message: "Rate limit exceeded.", type: "OAuthException", code: 17 }
    }));
  }

  if (accountId === 'act_timeout') {
    setTimeout(() => {
      res.statusCode = 504;
      res.end(JSON.stringify({ error: { message: "Gateway Timeout" } }));
    }, 250); // 250ms is larger than 200ms timeout
    return;
  }

  if (accountId === 'act_invalid_payload') {
    res.statusCode = 200;
    return res.end("<html><body>Not JSON</body></html>");
  }

  if (path.match(/\/act_[a-z0-9_]+$/)) {
    return res.end(JSON.stringify({
      id: accountId,
      timezone_name: 'America/Sao_Paulo',
      currency: 'BRL'
    }));
  }

  if (path.includes('/campaigns')) {
    let campaigns = [];
    if (accountId === 'act_simple') {
      campaigns = [
        { id: 'camp_123', name: 'Simple Campaign', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE', daily_budget: '1000' },
        { id: 'camp_456', name: 'Other Campaign', objective: 'OUTCOME_TRAFFIC', effective_status: 'ACTIVE' },
        { id: 'camp_789', name: 'Third Campaign', objective: 'OUTCOME_ENGAGEMENT', effective_status: 'PAUSED' }
      ];
    } else if (accountId === 'act_zero') {
      campaigns = [{ id: 'camp_zero', name: 'Zero Delivery Campaign', objective: 'OUTCOME_TRAFFIC', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_mixed_obj') {
      campaigns = [{ id: 'camp_mix_obj', name: 'Mixed Objective', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_mixed_attr') {
      campaigns = [{ id: 'camp_mix_attr', name: 'Mixed Attribution', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_mixed_dest') {
      campaigns = [{ id: 'camp_mix_dest', name: 'Mixed Destination', objective: 'OUTCOME_ENGAGEMENT', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_partial_test') {
      campaigns = [{ id: 'camp_partial', name: 'Partial Campaign', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_ssrf') {
      campaigns = [{ id: 'camp_ssrf', name: 'SSRF Campaign', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_reconciliation') {
      campaigns = [{ id: 'camp_recon', name: reconciliationState === 'A' ? 'Recon Campaign A' : 'Recon Campaign B', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }];
    } else if (accountId === 'act_duas_integrações') {
      campaigns = [{ id: 'camp_duas', name: 'Duas Int', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' }];
    }
    return res.end(JSON.stringify({ data: campaigns }));
  }

  if (path.includes('/adsets')) {
    let adsets = [];
    if (accountId === 'act_simple') {
      adsets = [
        { id: 'adset_123', campaign_id: 'camp_123', name: 'Adset 123', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
        { id: 'adset_456', campaign_id: 'camp_456', name: 'Adset 456', optimization_goal: 'LINK_CLICKS', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
        { id: 'adset_789', campaign_id: 'camp_789', name: 'Adset 789', optimization_goal: 'POST_ENGAGEMENT', effective_status: 'PAUSED', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }
      ];
    } else if (accountId === 'act_zero') {
      adsets = [{ id: 'adset_zero', campaign_id: 'camp_zero', name: 'Adset Zero', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }] }];
    } else if (accountId === 'act_mixed_obj') {
      adsets = [
        { id: 'adset_obj1', campaign_id: 'camp_mix_obj', name: 'Adset Obj 1', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
        { id: 'adset_obj2', campaign_id: 'camp_mix_obj', name: 'Adset Obj 2', optimization_goal: 'OFFSITE_CONVERSIONS', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }
      ];
    } else if (accountId === 'act_mixed_attr') {
      adsets = [
        { id: 'adset_attr1', campaign_id: 'camp_mix_attr', name: 'Adset Attr 1', optimization_goal: 'OFFSITE_CONVERSIONS', effective_status: 'ACTIVE', attribution_setting: '7d_click', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] },
        { id: 'adset_attr2', campaign_id: 'camp_mix_attr', name: 'Adset Attr 2', optimization_goal: 'OFFSITE_CONVERSIONS', effective_status: 'ACTIVE', attribution_setting: '1d_click', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }] }
      ];
    } else if (accountId === 'act_mixed_dest') {
      adsets = [
        { id: 'adset_dest1', campaign_id: 'camp_mix_dest', name: 'Adset Dest 1', optimization_goal: 'PAGE_LIKES', effective_status: 'ACTIVE', destination_type: 'FACEBOOK' },
        { id: 'adset_dest2', campaign_id: 'camp_mix_dest', name: 'Adset Dest 2', optimization_goal: 'MESSAGING_CONVERSATIONS', effective_status: 'ACTIVE', destination_type: 'MESSENGER' }
      ];
    } else if (accountId === 'act_partial_test') {
      adsets = [{ id: 'adset_partial', campaign_id: 'camp_partial', name: 'Adset Partial', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }];
    } else if (accountId === 'act_ssrf') {
      adsets = [{ id: 'adset_ssrf', campaign_id: 'camp_ssrf', name: 'Adset SSRF', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }];
    } else if (accountId === 'act_reconciliation') {
      adsets = [{ id: 'adset_recon', campaign_id: 'camp_recon', name: 'Adset Recon', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', destination_type: reconciliationState === 'A' ? 'FACEBOOK' : 'WEBSITE' }];
    } else if (accountId === 'act_duas_integrações') {
      adsets = [{ id: 'adset_duas', campaign_id: 'camp_duas', name: 'Adset Duas', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }];
    }
    return res.end(JSON.stringify({ data: adsets, paging: { cursors: { after: 'cursor' } } }));
  }

  if (path.includes('/insights')) {
    const isAdsetLevel = parsedUrl.search.includes('level=adset');
    let insights = [];
    
    if (accountId === 'act_partial_test') {
      const page = parsedUrl.query.after || '1';
      if (page === '1') {
        return res.end(JSON.stringify({
          data: [{ campaign_id: 'camp_partial', adset_id: 'adset_partial', impressions: '1000', spend: '10.00', reach: '500', date_start, date_stop }],
          paging: { cursors: { after: 'page2' }, next: `http://${MOCK_HOST}/v25.0/${accountId}/insights?after=page2&level=${isAdsetLevel?'adset':'campaign'}` }
        }));
      } else {
        if (global.partialMode === 'partial') {
          res.statusCode = 500;
          return res.end(JSON.stringify({ error: { message: 'Pagination failed on page 2' } }));
        } else {
          return res.end(JSON.stringify({
            data: [{ campaign_id: 'camp_partial', adset_id: 'adset_partial', impressions: '500', spend: '5.00', reach: '200', date_start, date_stop }],
            paging: { cursors: { after: 'cursor' } }
          }));
        }
      }
    }

    if (accountId === 'act_ssrf') {
      const page = parsedUrl.query.after || '1';
      if (page === '1') {
        return res.end(JSON.stringify({
          data: [{ campaign_id: 'camp_ssrf', impressions: '10', spend: '1.00', date_start, date_stop }],
          paging: { cursors: { after: 'page2' }, next: `http://169.254.169.254/latest/meta-data/` }
        }));
      }
    }

    if (accountId === 'act_simple') {
      insights = isAdsetLevel 
        ? [
            { campaign_id: 'camp_123', adset_id: 'adset_123', impressions: '1000', spend: '50.00', actions: [{action_type: 'lead', value: '5'}], date_start, date_stop },
            { campaign_id: 'camp_456', adset_id: 'adset_456', impressions: '500', spend: '25.00', actions: [{action_type: 'link_click', value: '10'}], date_start, date_stop },
            { campaign_id: 'camp_789', adset_id: 'adset_789', impressions: '200', spend: '10.00', actions: [{action_type: 'post_engagement', value: '20'}], date_start, date_stop }
          ]
        : [
            { campaign_id: 'camp_123', impressions: '1000', spend: '50.00', actions: [{action_type: 'lead', value: '5'}], reach: '800', date_start, date_stop },
            { campaign_id: 'camp_456', impressions: '500', spend: '25.00', actions: [{action_type: 'link_click', value: '10'}], reach: '400', date_start, date_stop },
            { campaign_id: 'camp_789', impressions: '200', spend: '10.00', actions: [{action_type: 'post_engagement', value: '20'}], reach: '100', date_start, date_stop }
          ];
    } else if (accountId === 'act_zero') {
      insights = [];
    } else if (accountId === 'act_mixed_obj') {
      insights = isAdsetLevel 
        ? [
            { campaign_id: 'camp_mix_obj', adset_id: 'adset_obj1', impressions: '1000', spend: '20.00', date_start, date_stop },
            { campaign_id: 'camp_mix_obj', adset_id: 'adset_obj2', impressions: '2000', spend: '40.00', actions: [{action_type: 'purchase', value: '2'}], action_values: [{action_type: 'purchase', value: '80'}], date_start, date_stop }
          ]
        : [{ campaign_id: 'camp_mix_obj', impressions: '3000', spend: '60.00', reach: '2500', date_start, date_stop }];
    } else if (accountId === 'act_mixed_attr') {
      insights = isAdsetLevel 
        ? [
            { campaign_id: 'camp_mix_attr', adset_id: 'adset_attr1', impressions: '1000', spend: '20.00', actions: [{action_type: 'purchase', value: '2'}], action_values: [{action_type: 'purchase', value: '40'}], date_start, date_stop, attribution_setting: '7d_click' },
            { campaign_id: 'camp_mix_attr', adset_id: 'adset_attr2', impressions: '2000', spend: '40.00', actions: [{action_type: 'purchase', value: '5'}], action_values: [{action_type: 'purchase', value: '80'}], date_start, date_stop, attribution_setting: '1d_click' }
          ]
        : [{ campaign_id: 'camp_mix_attr', impressions: '3000', spend: '60.00', actions: [{action_type: 'purchase', value: '7'}], action_values: [{action_type: 'purchase', value: '120'}], date_start, date_stop }];
    } else if (accountId === 'act_mixed_dest') {
      insights = isAdsetLevel 
        ? [
            { campaign_id: 'camp_mix_dest', adset_id: 'adset_dest1', impressions: '1000', spend: '20.00', date_start, date_stop },
            { campaign_id: 'camp_mix_dest', adset_id: 'adset_dest2', impressions: '1500', spend: '30.00', date_start, date_stop }
          ]
        : [{ campaign_id: 'camp_mix_dest', impressions: '2500', spend: '50.00', date_start, date_stop }];
    } else if (accountId === 'act_reconciliation') {
      let attr = reconciliationState === 'A' ? '7d_click' : '1d_click';
      insights = isAdsetLevel
        ? [{ campaign_id: 'camp_recon', adset_id: 'adset_recon', impressions: '100', spend: '10', date_start, date_stop, attribution_setting: attr }]
        : [{ campaign_id: 'camp_recon', impressions: '100', spend: '10', date_start, date_stop }];
    } else if (accountId === 'act_duas_integrações') {
      insights = isAdsetLevel
        ? [{ campaign_id: 'camp_duas', adset_id: 'adset_duas', impressions: '100', spend: '10', date_start, date_stop }]
        : [{ campaign_id: 'camp_duas', impressions: '100', spend: '10', date_start, date_stop }];
    }
    
    return res.end(JSON.stringify({ data: insights, paging: { cursors: { after: 'cursor' } } }));
  }

  res.end(JSON.stringify({ data: [] }));
});

server.listen(MOCK_PORT, '0.0.0.0', () => {
  console.log(`Mock Graph API running on port ${MOCK_PORT} (Host: ${MOCK_HOST})`);
});
