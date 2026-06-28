const http = require('http');

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url.includes('/insights')) {
    if (req.url.includes('level=adset')) {
      res.end(JSON.stringify({
        data: [
          {
            campaign_id: 'mock_c_mixed',
            adset_id: 'mock_a_mix1',
            date_start: '2026-06-27',
            date_stop: '2026-06-27',
            impressions: '1000',
            spend: '50.00',
            reach: '800',
            actions: [{ action_type: 'lead', value: '10' }],
            action_values: [{ action_type: 'lead', value: '50.00' }]
          },
          {
            campaign_id: 'mock_c_mixed',
            adset_id: 'mock_a_mix2',
            date_start: '2026-06-27',
            date_stop: '2026-06-27',
            impressions: '500',
            spend: '20.00',
            reach: '400',
            actions: [{ action_type: 'lead', value: '5' }],
            action_values: [{ action_type: 'lead', value: '25.00' }]
          }
        ]
      }));
    } else {
      res.end(JSON.stringify({
        data: [
          {
            campaign_id: 'mock_c_1',
            date_start: '2026-06-27',
            date_stop: '2026-06-27',
            impressions: '1000',
            spend: '50.00',
            reach: '800',
            actions: [{ action_type: 'lead', value: '10' }],
            action_values: [{ action_type: 'lead', value: '50.00' }]
          },
          {
            campaign_id: 'mock_c_zero',
            date_start: '2026-06-27',
            date_stop: '2026-06-27',
            impressions: '0',
            spend: '0.00',
            reach: '0'
          },
          {
            campaign_id: 'mock_c_mixed',
            date_start: '2026-06-27',
            date_stop: '2026-06-27',
            impressions: '1500',
            spend: '70.00',
            reach: '1200'
          }
        ],
        paging: { cursors: { after: 'abc' } }
      }));
    }
  } else if (req.url.includes('fields=id,name,objective,status,effective_status') && !req.url.includes('adset')) {
    res.end(JSON.stringify({
      data: [
        { id: 'mock_c_1', name: 'Mock Campaign 1', objective: 'OUTCOME_LEADS', effective_status: 'ACTIVE' },
        { id: 'mock_c_zero', name: 'Mock Zero Delivery', objective: 'OUTCOME_TRAFFIC', effective_status: 'ACTIVE' },
        { id: 'mock_c_mixed', name: 'Mock Mixed Attribution', objective: 'OUTCOME_SALES', effective_status: 'ACTIVE' }
      ]
    }));
  } else if (req.url.includes('fields=id,name,campaign_id,optimization_goal,destination_type,promoted_object,attribution_spec,status,effective_status')) {
    res.end(JSON.stringify({
      data: [
        {
          id: 'mock_a_1',
          campaign_id: 'mock_c_1',
          name: 'Mock Adset 1',
          optimization_goal: 'LEAD_GENERATION',
          effective_status: 'ACTIVE',
          attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }, { event_type: 'VIEW_THROUGH', window_days: 1 }]
        },
        {
          id: 'mock_a_zero',
          campaign_id: 'mock_c_zero',
          name: 'Mock Adset Zero',
          optimization_goal: 'LINK_CLICKS',
          effective_status: 'ACTIVE',
          attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }]
        },
        {
          id: 'mock_a_mix1',
          campaign_id: 'mock_c_mixed',
          name: 'Mock Adset Mix 1',
          optimization_goal: 'OFFSITE_CONVERSIONS',
          effective_status: 'ACTIVE',
          attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }]
        },
        {
          id: 'mock_a_mix2',
          campaign_id: 'mock_c_mixed',
          name: 'Mock Adset Mix 2',
          optimization_goal: 'OFFSITE_CONVERSIONS',
          effective_status: 'ACTIVE',
          attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }]
        }
      ]
    }));
  } else {
    res.end(JSON.stringify({ data: [] }));
  }
});

server.listen(9999, () => {
  console.log('Mock Graph API running on port 9999');
});
