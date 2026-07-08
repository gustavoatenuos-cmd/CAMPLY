const fs = require('fs');

let ov = fs.readFileSync('src/components/OverviewView.tsx', 'utf8');
ov = ov.replace(
  'Users,\n} from \'lucide-react\';',
  'Users,\n  LayoutGrid,\n  List,\n} from \'lucide-react\';'
);
fs.writeFileSync('src/components/OverviewView.tsx', ov, 'utf8');

let gridTest = fs.readFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', 'utf8');
gridTest = gridTest.replace(
  "const mockGlobalClient: GlobalClientPerformance = {",
  "const mockGlobalClient = {\n      clientStatus: 'active',"
);
gridTest = gridTest.replace(
  "]\n    };",
  "]\n    } as unknown as GlobalClientPerformance;"
);
fs.writeFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', gridTest, 'utf8');
