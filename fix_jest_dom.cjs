const fs = require('fs');

function fixJestDom(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  content = content.replace("import '@testing-library/jest-dom';", "import '@testing-library/jest-dom/vitest';");
  fs.writeFileSync(filePath, content, 'utf8');
}

fixJestDom('src/components/clients/ClientLogo.test.tsx');
fixJestDom('src/components/performance/ClientPerformanceCardGrid.test.tsx');
