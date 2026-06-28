const http = require('http');

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  
  if (req.url.includes('/insights')) {
    res.end(JSON.stringify({
      data: [
        {
          campaign_id: 'mock_c_1',
          adset_id: 'mock_a_1',
          impressions: '1000',
          spend: '50.00',
          reach: '800',
          actions: [
            { action_type: 'lead', value: '10' }
          ],
          action_values: [
            { action_type: 'lead', value: '50.00' }
          ]
        }
      ],
      paging: { cursors: { after: 'abc' } }
    }));
  } else if (req.url.includes('fields=id,name,objective,status,effective_status')) {
    res.end(JSON.stringify({
      data: [
        {
          id: 'mock_c_1',
          name: 'Mock Campaign',
          objective: 'OUTCOME_LEADS',
          effective_status: 'ACTIVE'
        }
      ]
    }));
  } else if (req.url.includes('fields=id,name,campaign_id,optimization_goal,destination_type,promoted_object,attribution_spec,status,effective_status')) {
    res.end(JSON.stringify({
      data: [
        {
          id: 'mock_a_1',
          campaign_id: 'mock_c_1',
          name: 'Mock Adset',
          optimization_goal: 'LEAD_GENERATION',
          effective_status: 'ACTIVE',
          attribution_spec: [
            { event_type: 'CLICK_THROUGH', window_days: 7 },
            { event_type: 'VIEW_THROUGH', window_days: 1 }
          ]
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
