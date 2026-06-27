const fs = require('fs');
let content = fs.readFileSync('src/components/TodayView.tsx', 'utf8');

const dashboardStart = content.indexOf('{/* ===== DASHBOARD POR CLIENTE ===== */}');
if (dashboardStart === -1) process.exit(1);

// Find the end of the dashboard div. It's a `<div className="mb-8 rounded-2xl...` which closes right before `<div className="mt-8 grid gap-6 2xl:grid-cols-[1.15fr_0.85fr]">`
const nextSection = content.indexOf('<div className="mt-8 grid gap-6 2xl:grid-cols-[1.15fr_0.85fr]">');
const dashboardContent = content.slice(dashboardStart, nextSection);

// Remove dashboard from old location
content = content.replace(dashboardContent, '');

// Insert it right after the 4 metrics boxes: `</div>\n\n      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">`
// Wait, actually I'll insert it after the top title section `</button>\n      </div>` around line 540
// Wait, the user wants it at the top of the initial screen. The initial screen has the title "Esta é a operação agora."
const targetStr = `Nova tarefa rápida\n        </button>\n      </div>\n`;
content = content.replace(targetStr, targetStr + '\n      ' + dashboardContent);

// Fix double counting in the dashboard sum:
// Replace `const activeCampaigns = data.campaigns.filter(c => c.clientId === client.id && ['live', 'optimize'].includes(c.status));`
// with `const activeCampaigns = data.campaigns.filter(c => c.clientId === client.id && ['live', 'optimize'].includes(c.status) && !c.subCampaignIds?.length);`
content = content.replace(
  /const activeCampaigns = data.campaigns.filter\(c => c.clientId === client.id && \['live', 'optimize'\].includes\(c.status\)\);/g,
  `const activeCampaigns = data.campaigns.filter(c => c.clientId === client.id && ['live', 'optimize'].includes(c.status) && !(c.subCampaignIds?.length > 0));`
);

fs.writeFileSync('src/components/TodayView.tsx', content);
