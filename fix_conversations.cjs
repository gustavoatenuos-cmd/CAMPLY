const fs = require('fs');
let code = fs.readFileSync('src/components/TodayView.tsx', 'utf8');

// Replace both occurrences where pageViews is assigned
code = code.replace(
  /pageViews: Number\(\(pInsights as any\)\.actions\?\.find\(\(a: any\) => a\.action_type === 'landing_page_view' \|\| a\.action_type === 'view_content'\)\?\.value \|\| 0\),/g,
  `pageViews: Number((pInsights as any).actions?.find((a: any) => a.action_type === 'landing_page_view' || a.action_type === 'view_content')?.value || 0),
              conversations: Number((pInsights as any).actions?.filter((a: any) => a.action_type.includes('messaging')).reduce((sum: number, a: any) => sum + Number(a.value), 0) || 0),`
);

code = code.replace(
  /pageViews: Number\(c\.insights\?\.actions\?\.find\(\(a: any\) => a\.action_type === 'landing_page_view' \|\| a\.action_type === 'view_content'\)\?\.value \|\| 0\),/g,
  `pageViews: Number(c.insights?.actions?.find((a: any) => a.action_type === 'landing_page_view' || a.action_type === 'view_content')?.value || 0),
          conversations: Number(c.insights?.actions?.filter((a: any) => a.action_type.includes('messaging')).reduce((sum: number, a: any) => sum + Number(a.value), 0) || 0),`
);

fs.writeFileSync('src/components/TodayView.tsx', code);
