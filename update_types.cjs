const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf8');

// Replace the end of Campaign interface
code = code.replace(/metricsByPeriod\?: Record<string, CampaignMetrics>;/g, 
  `metricsByPeriod?: Record<string, CampaignMetrics>; // @deprecated legacy field
  classifiedObjective?: string;
  normalizedMetricsByPeriod?: Record<string, Record<string, number>>;`);

code = code.replace(/results\?: number;/g, `results?: number; // @deprecated`);
code = code.replace(/cpr\?: number;/g, `cpr?: number; // @deprecated`);
code = code.replace(/conversations\?: number;/g, `conversations?: number; // @deprecated`);

fs.writeFileSync('src/types.ts', code);
