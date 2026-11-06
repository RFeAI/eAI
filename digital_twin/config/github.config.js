function getGitHubConfig() {
  const token = process.env.GITHUB_SERVICE_TOKEN;
  if (!token) throw new Error('GITHUB_SERVICE_TOKEN is not configured.');
  return { token, org: process.env.ORG_NAME || 'RFeAI' };
}

module.exports = { getGitHubConfig };
