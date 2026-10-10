import { SecretsManagerClient, GetSecretValueCommand, PutSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION });
const graph = 'https://graph.instagram.com/v25.0';

async function request(url, { token, body } = {}) {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    ...(body ? { body: new URLSearchParams(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Instagram API: ${data.error?.message || response.status}`);
  return data;
}

export async function instagramCredentials() {
  if (!process.env.INSTAGRAM_SECRET_ID) return null;
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.INSTAGRAM_SECRET_ID }));
  const value = JSON.parse(result.SecretString || '{}');
  if (!value.accessToken || !/^\d+$/.test(String(value.userId))) throw new Error('Instagram secret needs accessToken and numeric userId.');
  if (value.expiresAt && Number.isNaN(Date.parse(value.expiresAt))) throw new Error('Instagram secret has an invalid expiresAt timestamp.');
  if (value.expiresAt && Date.parse(value.expiresAt) < Date.now() + 7 * 86400000) {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', value.accessToken);
    const refreshed = await request(url, { token: value.accessToken });
    value.accessToken = refreshed.access_token;
    value.expiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
    await secrets.send(new PutSecretValueCommand({ SecretId: process.env.INSTAGRAM_SECRET_ID, SecretString: JSON.stringify(value) }));
  }
  return value;
}

export async function publishInstagram({ userId, accessToken, mediaUrl, isVideo, caption }) {
  const endpoint = `${graph}/${encodeURIComponent(userId)}`;
  const container = await request(`${endpoint}/media`, { token: accessToken, body: isVideo ? { media_type: 'REELS', video_url: mediaUrl, caption, share_to_feed: 'true' } : { image_url: mediaUrl, caption } });
  if (!container.id) throw new Error('Instagram did not create a media container.');
  for (let attempt = 0; attempt < 8; attempt++) {
    const status = await request(`${graph}/${encodeURIComponent(container.id)}?fields=status_code`, { token: accessToken });
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') throw new Error(`Instagram media processing ${status.status_code.toLowerCase()}.`);
    if (attempt === 7) throw new Error('Instagram media processing did not finish in time.');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const published = await request(`${endpoint}/media_publish`, { token: accessToken, body: { creation_id: container.id } });
  if (!published.id) throw new Error('Instagram did not confirm the published post.');
  let permalink = '';
  try { permalink = (await request(`${graph}/${encodeURIComponent(published.id)}?fields=permalink`, { token: accessToken })).permalink || ''; }
  catch { /* The post is already live; its URL can be recovered separately. */ }
  return { id: published.id, permalink };
}
