const fs = require('fs');

// Fix OverviewView.tsx
let ov = fs.readFileSync('src/components/OverviewView.tsx', 'utf8');
if (!ov.includes('LayoutGrid')) {
  ov = ov.replace(
    'Users,\n} from \'lucide-react\';',
    'Users,\n  LayoutGrid,\n  List,\n} from \'lucide-react\';'
  );
  fs.writeFileSync('src/components/OverviewView.tsx', ov, 'utf8');
}

// Fix ClientPerformanceCardGrid.tsx
let grid = fs.readFileSync('src/components/performance/ClientPerformanceCardGrid.tsx', 'utf8');
grid = grid.replace(/client\.lastSuccessfulRun\?\.timestamp/g, "client.lastSuccessfulRun?.finishedAt");
grid = grid.replace(/size="sm" /g, "");
grid = grid.replace(/decision\.operationalProfile/g, "(client.analysisProfile)");
grid = grid.replace(
  "<CampaignHierarchicalTable accounts={client.accounts} period={period} />",
  "{client.accounts.map(acc => (\n            <div key={acc.adAccountId} className=\"mb-4 last:mb-0\">\n              <h4 className=\"font-bold text-sm mb-2 text-white\">{acc.accountName}</h4>\n              <CampaignHierarchicalTable account={acc} period={period} />\n            </div>\n          ))}"
);
fs.writeFileSync('src/components/performance/ClientPerformanceCardGrid.tsx', grid, 'utf8');

// Fix ClientPerformanceCardGrid.test.tsx
let gridTest = fs.readFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', 'utf8');
gridTest = gridTest.replace(
  "performanceScore: 0,\n",
  ""
);
fs.writeFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', gridTest, 'utf8');
