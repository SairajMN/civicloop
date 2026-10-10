import { randomBytes } from 'node:crypto';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION });
const safeHeader = (value) => String(value || '').replace(/[\r\n]/g, ' ').trim();
const wrapBase64 = (value) => Buffer.from(value).toString('base64').match(/.{1,76}/g)?.join('\r\n') || '';

function rawMessage({ from, to, subject, text, attachments }) {
  const boundary = `civicloop-${randomBytes(12).toString('hex')}`;
  const lines = [
    `From: ${safeHeader(from)}`,
    `To: ${safeHeader(to)}`,
    `Subject: =?UTF-8?B?${Buffer.from(safeHeader(subject)).toString('base64')}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(text),
  ];
  for (const file of attachments) {
    const name = safeHeader(file.FileName).replace(/["\\]/g, '_');
    lines.push('', `--${boundary}`, `Content-Type: ${file.ContentType || 'application/octet-stream'}`, `Content-Disposition: attachment; filename="${name}"`, 'Content-Transfer-Encoding: base64', '', wrapBase64(file.RawContent));
  }
  lines.push('', `--${boundary}--`, '');
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

export async function sendGmailMail({ to, subject, text, attachments }) {
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.GMAIL_SECRET_ID }));
  const { clientId, clientSecret, refreshToken, fromEmail } = JSON.parse(secret.SecretString || '{}');
  if (![clientId, clientSecret, refreshToken, fromEmail].every(Boolean)) throw new Error('Gmail credentials are incomplete.');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!tokenResponse.ok) throw new Error(`Gmail token refresh failed (${tokenResponse.status}).`);
  const accessToken = (await tokenResponse.json()).access_token;
  if (!accessToken) throw new Error('Gmail token refresh returned no access token.');
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ raw: rawMessage({ from: fromEmail, to, subject, text, attachments }) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Gmail send failed (${response.status}).`);
  const result = await response.json();
  if (!result.id) throw new Error('Gmail did not return a message ID.');
  return { messageId: result.id, provider: 'Gmail' };
}
