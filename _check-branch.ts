import { Octokit } from '@octokit/rest';

let connectionSettings: any;
async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY ? 'repl ' + process.env.REPL_IDENTITY : process.env.WEB_REPL_RENEWAL ? 'depl ' + process.env.WEB_REPL_RENEWAL : null;
  if (!xReplitToken) throw new Error('X_REPLIT_TOKEN not found');
  connectionSettings = await fetch('https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github', { headers: { 'Accept': 'application/json', 'X_REPLIT_TOKEN': xReplitToken } }).then(res => res.json()).then(data => data.items?.[0]);
  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;
  if (!connectionSettings || !accessToken) throw new Error('GitHub not connected');
  return accessToken;
}

async function main() {
  const accessToken = await getAccessToken();
  const octokit = new Octokit({ auth: accessToken });
  const owner = 'leftthumbs';
  const repo = 'Portfolio-Sentinel';

  // Get the comparison between main and the branch
  const { data: comparison } = await octokit.repos.compareCommitsWithBasehead({
    owner, repo,
    basehead: 'main...claude/improve-benchmark-calculations-Bilr6',
  });

  console.log(`=== Branch Comparison ===`);
  console.log(`Status: ${comparison.status}`);
  console.log(`Ahead by: ${comparison.ahead_by} commits`);
  console.log(`Behind by: ${comparison.behind_by} commits`);
  console.log(`Total commits: ${comparison.total_commits}`);
  console.log(`\n=== Changed Files (${comparison.files?.length || 0}) ===`);
  
  for (const file of comparison.files || []) {
    console.log(`\n--- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions}) ---`);
    if (file.patch) {
      // Show first 80 lines of the patch
      const lines = file.patch.split('\n');
      console.log(lines.slice(0, 80).join('\n'));
      if (lines.length > 80) console.log(`... (${lines.length - 80} more lines)`);
    }
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
