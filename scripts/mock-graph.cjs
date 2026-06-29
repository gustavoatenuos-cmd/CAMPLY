const http = require('http');
const url = require('url');

let requestCounts = {};
let forcedTimeout = false;
let forcedRateLimit = false;

const MOCK_PORT = process.env.MOCK_PORT || 9999;
const MOCK_HOST = process.env.MOCK_HOST || `mock-graph:${MOCK_PORT}`;

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  const parsedUrl = url.parse(req.url, true);
  const path = parsedUrl.pathname;

  // Mask logging (don't log secrets)
  // console.log(`[MOCK] ${req.method} ${path}`);
  
  if (path === '/health') {
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'ok' }));
  }

  if (path === '/reset') {
    requestCounts = {};
    forcedTimeout = false;
    forcedRateLimit = false;
    res.statusCode = 200;
    return res.end(JSON.stringify({ status: 'reset' }));
  }

  const match = path.match(/(act_[a-z_]+)/);
  const accountId = match ? match[1] : 'act_unknown';

  if (!requestCounts[accountId]) requestCounts[accountId] = 0;
  
  if (path.includes('/insights')) {
     requestCounts[accountId]++;
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

  if (accountId === 'act_rate_limit') {
    if (requestCounts[accountId] <= 2) {
      res.statusCode = 429;
      return res.end(JSON.stringify({
        error: { message: "Rate limit exceeded.", type: "OAuthException", code: 17 }
      }));
    }
    // rate_limit_recovered works by returning success on 3rd try, though our function doesn't retry automatically yet,
    // we can simulate it if needed, or just let it fail.
  }

  if (accountId === 'act_timeout') {
    // In node, we just don't end the response for a while
    setTimeout(() => {
      res.statusCode = 504;
      res.end(JSON.stringify({ error: { message: "Gateway Timeout" } }));
    }, 15000); // 15s timeout
    return;
  }

  if (accountId === 'act_invalid_payload') {
    res.statusCode = 200;
    return res.end("<html><body>Not JSON</body></html>"); // Simulate bad gateway or parsing error
  }

  if (path.match(/\/act_[a-z_]+$/)) {
    return res.end(JSON.stringify({
      id: accountId,
      timezone_name: 'America/Sao_Paulo',
      currency: 'BRL'
    }));
  }

  if (path.includes('/campaigns')) {
    let campaigns = [];
    if (accountId === 'act_simple') {
      campaigns = [{ id: 'camp_simple', name: 'Simple Campaign', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE', daily_budget: '1000' }];
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
    }
    return res.end(JSON.stringify({ data: campaigns }));
  }

  if (path.includes('/adsets')) {
    let adsets = [];
    if (accountId === 'act_simple') {
      adsets = [{ id: 'adset_simple', campaign_id: 'camp_simple', name: 'Adset Simple', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }];
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
    } else if (accountId === 'act_partial') {
      adsets = [{ id: 'adset_partial', campaign_id: 'camp_partial', name: 'Adset Partial', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }];
    } else if (accountId === 'act_ssrf') {
      adsets = [{ id: 'adset_ssrf', campaign_id: 'camp_ssrf', name: 'Adset SSRF', optimization_goal: 'LEAD_GENERATION', effective_status: 'ACTIVE', attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }] }];
    }
    return res.end(JSON.stringify({ data: adsets, paging: { cursors: { after: 'cursor' } } }));
  }

  if (path.includes('/insights')) {
    const isAdsetLevel = parsedUrl.search.includes('level=adset');
    let insights = [];
    
    if (accountId === 'act_partial') {
      const isSecondRun = requestCounts[accountId] > 1;
      const page = parsedUrl.query.after || '1';
      if (page === '1') {
        if (isSecondRun) {
          return res.end(JSON.stringify({
            data: [{ campaign_id: 'camp_partial', adset_id: 'adset_partial', impressions: '1000', spend: '10.00', date_start, date_stop }],
            paging: { cursors: { after: 'page2' }, next: `http://${MOCK_HOST}/v25.0/${accountId}/insights?after=page2&level=${isAdsetLevel?'adset':'campaign'}` }
          }));
        } else {
          return res.end(JSON.stringify({
            data: [{ campaign_id: 'camp_partial', adset_id: 'adset_partial', impressions: '1000', spend: '10.00', reach: '500', date_start, date_stop }],
            paging: { cursors: { after: 'cursor' } }
          }));
        }
      } else {
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: { message: 'Pagination failed on page 2' } }));
      }
    }

    if (accountId === 'act_ssrf') {
      const page = parsedUrl.query.after || '1';
      if (page === '1') {
        return res.end(JSON.stringify({
          data: [{ campaign_id: 'camp_ssrf', impressions: '10', spend: '1.00', date_start, date_stop }],
          // SSRF attempt: redirecting pagination to an internal metadata endpoint or internal network
          paging: { cursors: { after: 'page2' }, next: `http://169.254.169.254/latest/meta-data/` }
        }));
      }
    }

    if (accountId === 'act_simple') {
      insights = isAdsetLevel 
        ? [{ campaign_id: 'camp_simple', adset_id: 'adset_simple', impressions: '1000', spend: '50.00', actions: [{action_type: 'lead', value: '5'}], date_start, date_stop }]
        : [{ campaign_id: 'camp_simple', impressions: '1000', spend: '50.00', actions: [{action_type: 'lead', value: '5'}], reach: '800', date_start, date_stop }];
    } else if (accountId === 'act_zero') {
      insights = isAdsetLevel 
        ? [{ campaign_id: 'camp_zero', adset_id: 'adset_zero', impressions: '0', spend: '0', date_start, date_stop }]
        : [{ campaign_id: 'camp_zero', impressions: '0', spend: '0', reach: '0', date_start, date_stop }];
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
    }
    
    return res.end(JSON.stringify({ data: insights, paging: { cursors: { after: 'cursor' } } }));
  }

  res.end(JSON.stringify({ data: [] }));
});

server.listen(MOCK_PORT, '0.0.0.0', () => {
  console.log(`Mock Graph API running on port ${MOCK_PORT} (Host: ${MOCK_HOST})`);
});
