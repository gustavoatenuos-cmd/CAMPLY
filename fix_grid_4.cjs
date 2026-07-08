const fs = require('fs');

let ov = fs.readFileSync('src/components/OverviewView.tsx', 'utf8');
ov = "import { LayoutGrid, List } from 'lucide-react';\n" + ov;
fs.writeFileSync('src/components/OverviewView.tsx', ov, 'utf8');

let testContent = fs.readFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', 'utf8');
testContent = testContent.replace(
  "const mockGlobalClient = {\n      clientStatus: 'active',",
  "const mockGlobalClient = {\n      clientStatus: 'active',"
);
// just cast
testContent = testContent.replace(
  "]\n    } as unknown as GlobalClientPerformance;",
  "]\n    } as any;"
);
if (!testContent.includes('as any')) {
  testContent = testContent.replace("dataQuality: { status: 'complete', reason: null },", "dataQuality: { status: 'complete', reason: null } as any,");
  testContent = testContent.replace("const mockGlobalClient = {", "const mockGlobalClient: any = {");
}

fs.writeFileSync('src/components/performance/ClientPerformanceCardGrid.test.tsx', testContent, 'utf8');
