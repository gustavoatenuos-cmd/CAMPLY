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

// Fix ClientPerformanceCardGrid.test.tsx
let gridTest = fs.readFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', 'utf8');
gridTest = gridTest.replace(
  "campaignHierarchy: []",
  ""
);
fs.writeFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', gridTest, 'utf8');
