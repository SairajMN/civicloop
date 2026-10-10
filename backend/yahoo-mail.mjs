import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import nodemailer from 'nodemailer';

const secrets = new SecretsManagerClient({ region: process.env.AWS_REGION });

export async function sendYahooMail({ to, subject, text, attachments }) {
  if (!process.env.YAHOO_SECRET_ID) throw new Error('Yahoo SMTP is not configured.');
  const result = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.YAHOO_SECRET_ID }));
  const { username, appPassword } = JSON.parse(result.SecretString || '{}');
  if (!username?.endsWith('@yahoo.com') || !appPassword) throw new Error('Yahoo SMTP credentials are incomplete.');
  const mailer = nodemailer.createTransport({
    host: 'smtp.mail.yahoo.com',
    port: 465,
    secure: true,
    auth: { user: username, pass: appPassword },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 12000,
  });
  const sent = await mailer.sendMail({
    from: username,
    to,
    subject,
    text,
    attachments: attachments.map((file) => ({ filename: file.FileName, content: Buffer.from(file.RawContent), contentType: file.ContentType })),
  });
  if (!sent.messageId) throw new Error('Yahoo SMTP did not confirm the message.');
  return { messageId: sent.messageId, provider: 'Yahoo Mail' };
}
