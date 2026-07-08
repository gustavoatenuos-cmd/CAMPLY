const fs = require('fs');

function fixTestFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (!content.includes('@vitest-environment jsdom')) {
    content = "/**\n * @vitest-environment jsdom\n */\n" + content;
  }
  if (!content.includes('@testing-library/jest-dom')) {
    content = "import '@testing-library/jest-dom';\n" + content;
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

fixTestFile('src/components/clients/ClientLogo.test.tsx');
fixTestFile('src/components/performance/ClientPerformanceCardGrid.test.tsx');
