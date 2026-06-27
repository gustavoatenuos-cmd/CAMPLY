const fs = require('fs');
let content = fs.readFileSync('src/components/TodayView.tsx', 'utf8');

// Replace the catch block in handleSyncClient to show an alert
content = content.replace(
  '} catch(err) {',
  '} catch(err: any) {\n      alert("Erro ao sincronizar: " + err.message);'
);

fs.writeFileSync('src/components/TodayView.tsx', content);
