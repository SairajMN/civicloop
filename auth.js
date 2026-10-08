(() => {
  const config = window.CIVICLOOP_CONFIG || {};
  const configured = Boolean(config.apiBaseUrl && config.cognitoDomain && config.cognitoClientId);
  let idToken = '';
  let claims = {};
  const base = String(config.cognitoDomain || '').replace(/\/$/, '');
  const redirectUri = `${location.origin}/`;
  const random = (size = 48) => [...crypto.getRandomValues(new Uint8Array(size))].map((n) => n.toString(16).padStart(2, '0')).join('');
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const readClaims = (token) => { try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return {}; } };

  async function finishSignIn() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (!code) return;
    const state = sessionStorage.getItem('civicloop.oauth-state');
    const verifier = sessionStorage.getItem('civicloop.pkce-verifier');
    sessionStorage.removeItem('civicloop.oauth-state');
    sessionStorage.removeItem('civicloop.pkce-verifier');
    if (!state || !verifier || params.get('state') !== state) throw new Error('Sign-in state check failed. Please try again.');
    const response = await fetch(`${base}/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.cognitoClientId, code, redirect_uri: redirectUri, code_verifier: verifier }) });
    const result = await response.json();
    if (!response.ok || !result.id_token) throw new Error(result.error_description || 'Could not finish sign-in.');
    idToken = result.id_token;
    claims = readClaims(idToken);
    history.replaceState({}, '', location.pathname);
  }

  window.CivicAuth = {
    configured,
    async initialize() { if (configured) await finishSignIn(); },
    async signIn() {
      if (!configured) return;
      const verifier = random(32);
      const state = random(16);
      const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
      sessionStorage.setItem('civicloop.oauth-state', state);
      sessionStorage.setItem('civicloop.pkce-verifier', verifier);
      const url = new URL(`${base}/oauth2/authorize`);
      url.search = new URLSearchParams({ client_id: config.cognitoClientId, response_type: 'code', scope: 'openid email profile', redirect_uri: redirectUri, state, code_challenge_method: 'S256', code_challenge: challenge });
      location.assign(url);
    },
    signOut() { idToken = ''; claims = {}; if (configured) location.assign(`${base}/logout?${new URLSearchParams({ client_id: config.cognitoClientId, logout_uri: redirectUri })}`); },
    token() { return idToken; },
    email() { return claims.email || ''; },
    isWard() { return String(claims['cognito:groups'] || '').split(/[\s,\[\]]+/).includes('WardDesk'); },
  };
  window.CIVICLOOP_AUTH_READY = window.CivicAuth.initialize().catch((error) => { console.error('Civicloop sign-in:', error.message); window.CIVICLOOP_AUTH_ERROR = error.message; });
})();
