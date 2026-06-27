const fs = require('fs');

function patchFile(filepath) {
  if (!fs.existsSync(filepath)) return;
  let code = fs.readFileSync(filepath, 'utf8');

  // Comment out isConversion lines
  code = code.replace(/const isConversion = /g, '// const isConversion = ');
  
  // Replace results with 0 or fallback
  code = code.replace(/const results = c.insights\?.actions\?\.filter[^\n]+/g, 
    'const results = c.results || 0; // Legacy fallback');
    
  code = code.replace(/const pResults = \(pInsights as any\)\.actions\?\.filter[^\n]+/g, 
    'const pResults = c.metricsByPeriod?.[preset]?.results || 0; // Legacy fallback');

  fs.writeFileSync(filepath, code);
}

patchFile('src/components/TodayView.tsx');
patchFile('src/components/ClientsView.tsx');
