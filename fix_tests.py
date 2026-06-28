import os
import re

def fix_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # match applyMetaSyncToWorkspace(client, [campaigns], currData)
    # and replace the second arg with a payload object

    def repl(m):
        arg2 = m.group(1)
        return f"applyMetaSyncToWorkspace(client, {{ runId: 'r1', status: 'success', completenessByPeriod: {{}}, failedAdsetIds: [], campaigns: {arg2} }}"
    
    # We find applyMetaSyncToWorkspace(client, <arg2>,
    # We replace <arg2> with the object
    content = re.sub(r'applyMetaSyncToWorkspace\(client,\s*([^,]+),', repl, content)
    
    # Handle the specific case for workspaceIntegration.test.ts
    content = re.sub(r'applyMetaSyncToWorkspace\(mockClient,\s*([^,]+),', r"applyMetaSyncToWorkspace(mockClient, { runId: 'r1', status: 'success', completenessByPeriod: {}, failedAdsetIds: [], campaigns: \1 },", content)

    with open(filepath, 'w') as f:
        f.write(content)

fix_file('src/__tests__/meta/advancedMetaFlows.test.ts')
fix_file('src/__tests__/meta/workspaceIntegration.test.ts')
