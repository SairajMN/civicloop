import { readFile } from 'node:fs/promises';
import { CognitoIdentityProviderClient, CreateIdentityProviderCommand, DescribeUserPoolClientCommand, UpdateIdentityProviderCommand, UpdateUserPoolClientCommand } from '@aws-sdk/client-cognito-identity-provider';

const envText = await readFile(new URL('../.env', import.meta.url), 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).map((line) => {
  const at = line.indexOf('=');
  return at < 0 ? [line.trim(), ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^(["'])(.*)\1$/, '$2')];
}));
const region = env.AWS_REGION;
const userPoolId = env.COGNITO_USER_POOL_ID;
const clientId = env.COGNITO_APP_CLIENT_ID;
const clientIdGoogle = env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!region || !userPoolId || !clientId || !clientIdGoogle || !clientSecret || clientIdGoogle.startsWith('your_') || clientSecret.startsWith('replace_')) {
  console.log('Google OAuth credentials or deployed Cognito IDs are not configured; email/password sign-in remains available.');
  process.exit(0);
}

const client = new CognitoIdentityProviderClient({ region });
const provider = { UserPoolId: userPoolId, ProviderName: 'Google', ProviderType: 'Google', ProviderDetails: { client_id: clientIdGoogle, client_secret: clientSecret, authorize_scopes: 'openid email profile' }, AttributeMapping: { email: 'email', username: 'sub' } };
try { await client.send(new CreateIdentityProviderCommand(provider)); }
catch (error) {
  if (error.name !== 'DuplicateProviderException') throw error;
  await client.send(new UpdateIdentityProviderCommand(provider));
}

const current = await client.send(new DescribeUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId }));
const existing = current.UserPoolClient;
if (!existing) throw new Error('Cognito app client was not found.');
const writable = ['ClientName', 'RefreshTokenValidity', 'AccessTokenValidity', 'IdTokenValidity', 'TokenValidityUnits', 'ReadAttributes', 'WriteAttributes', 'ExplicitAuthFlows', 'SupportedIdentityProviders', 'CallbackURLs', 'LogoutURLs', 'DefaultRedirectURI', 'AllowedOAuthFlows', 'AllowedOAuthScopes', 'AllowedOAuthFlowsUserPoolClient', 'AnalyticsConfiguration', 'PreventUserExistenceErrors', 'EnableTokenRevocation', 'EnablePropagateAdditionalUserContextData', 'AuthSessionValidity', 'RefreshTokenRotation'];
const update = Object.fromEntries(writable.filter((key) => existing[key] !== undefined).map((key) => [key, existing[key]]));
update.SupportedIdentityProviders = [...new Set([...(existing.SupportedIdentityProviders || []), 'Google'])];
await client.send(new UpdateUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId, ...update }));
console.log('Google sign-in provider configured in Cognito. The OAuth client secret was not printed or added to browser assets.');
