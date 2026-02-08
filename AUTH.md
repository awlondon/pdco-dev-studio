# Auth integration guide

## 1. Auth architecture (correct for this stack)

Stack:
- GitHub Pages (static frontend)
- Cloudflare Worker backend
- No server-rendered pages

Use OAuth → ID token → Worker verification → session token.

Flow (Google + Apple)

Frontend
  ↓ OAuth popup
Provider (Google / Apple)
  ↓ ID token (JWT)
Frontend
  ↓ POST /auth/verify
Cloudflare Worker
  ↓ verify token
  ↓ issue session token (JWT)
Frontend
  ↓ store session (localStorage)
  ↓ uiState = APP

No cookies required. No redirects required. Works cross-domain.

## 2. Google Sign-In (recommended first)

### A. Google Cloud Console setup

Create OAuth Client

Type: Web

Authorized origins:
- http://localhost:3000
- https://dev.primarydesignco.com
- https://primarydesignco.com

Save Client ID.

### B. Frontend: load Google Identity Services

```html
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

### C. Frontend: Google button (drop-in)

```html
<div id="google-signin"></div>
```

```js
function initGoogleAuth() {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    ux_mode: 'popup'
  });

  google.accounts.id.renderButton(
    document.getElementById('google-signin'),
    {
      theme: 'outline',
      size: 'large',
      width: 260
    }
  );
}
```

### D. Handle Google response

```js
async function handleGoogleCredential(response) {
  // response.credential is a JWT
  const res = await fetch(`${BACKEND_URL}/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: response.credential })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error);

  persistSession(data.session);
  enterApp();
}
```

### E. Worker: verify Google token

```js
import jwt from '@tsndr/cloudflare-worker-jwt';

export async function handleGoogleAuth(request, env) {
  const { id_token } = await request.json();

  const payload = jwt.decode(id_token).payload;

  if (payload.aud !== env.GOOGLE_CLIENT_ID) {
    return jsonError('Invalid audience', 401);
  }

  const user = {
    id: `google:${payload.sub}`,
    email: payload.email,
    name: payload.name,
    provider: 'google'
  };

  return issueSession(user, env);
}
```

## 3. Apple Sign-In (slightly more annoying, still clean)

### A. Apple Developer setup

Enable Sign in with Apple.

Create Service ID.

Domains:
- dev.primarydesignco.com
- primarydesignco.com

Redirect URI:
- https://dev.primarydesignco.com/auth/apple/callback

### B. Frontend: Apple button

```html
<script src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"></script>

<div id="apple-signin"></div>
```

```js
AppleID.auth.init({
  clientId: APPLE_CLIENT_ID,
  scope: 'name email',
  redirectURI: APPLE_REDIRECT_URI,
  usePopup: true
});

<button onclick="signInWithApple()">Continue with Apple</button>

async function signInWithApple() {
  const res = await AppleID.auth.signIn();
  await sendAppleTokenToBackend(res.authorization.id_token);
}
```

### C. Worker: verify Apple token

Apple uses public keys → same pattern.

```js
export async function handleAppleAuth(request, env) {
  const { id_token } = await request.json();

  const payload = jwt.decode(id_token).payload;

  if (payload.aud !== env.APPLE_CLIENT_ID) {
    return jsonError('Invalid audience', 401);
  }

  const user = {
    id: `apple:${payload.sub}`,
    email: payload.email,
    provider: 'apple'
  };

  return issueSession(user, env);
}
```

## 4. Session + UI state wiring (critical)

### A. Session persistence (frontend)

```js
function persistSession(session) {
  localStorage.setItem('maya_session', JSON.stringify(session));
}

function getAuthenticatedUser() {
  const raw = localStorage.getItem('maya_session');
  if (!raw) return null;
  return JSON.parse(raw);
}
```

### B. Enter app (single authority)

```js
function enterApp() {
  uiState = UI_STATE.APP;
  showAnalytics = false;
  render();
}
```

### C. Bootstrap (never regress this)

```js
function bootstrapApp() {
  const user = getAuthenticatedUser();

  if (!user) {
    uiState = UI_STATE.AUTH;
    renderAuth();
    return;
  }

  uiState = UI_STATE.APP;
  showAnalytics = false;
  render();
}
```

Call once on load.

## 5. Backend: issue session token

```js
function issueSession(user, env) {
  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email,
      provider: user.provider,
      iat: Date.now()
    },
    env.SESSION_SECRET
  );

  return json({
    session: {
      token,
      user
    }
  });
}
```

## 6. What NOT to do (to prevent regressions)

❌ Do NOT:
- Auto-open analytics after auth.
- Tie analytics to onAuthSuccess.
- Default showAnalytics = true.
- Render analytics without uiState === APP.

One violation = regression.

## 7. Resulting UX

Page loads → Sign in screen.

Click Google / Apple → Popup auth.

App loads instantly.

Analytics hidden until clicked.

Credits visible immediately.

## 8. Troubleshooting (what “does nothing” really means)

### A. Google / Apple buttons do nothing

This almost always means the UI is rendered but not wired to auth.

First check if a click handler exists:

```js
getEventListeners(document.querySelector('.google-btn'));
```

If you get `{}`, it is a dead button. Fix by attaching handlers:

```js
googleBtn.addEventListener('click', () => startGoogleAuth());
appleBtn.addEventListener('click', () => startAppleAuth());
```

If the button lives inside a form, ensure it does not submit the form:

```html
<button type="button">Continue with Google</button>
```

### B. OAuth redirect URL mismatch (silent failure)

If handlers exist but nothing happens (no popup, no network request), you
almost certainly have a redirect URI mismatch.

Google Console must whitelist:
- https://dev.primarydesignco.com/auth/google/callback

Apple Developer must configure:
- Service ID
- Return URL
- Domain verification file

Apple fails silently when any of these are wrong.

### C. Error 401: invalid_client (OAuth client not found)

This is a Google Cloud Console configuration error. It happens when the
`client_id` does not map to a valid **Web application** OAuth client for the
current project.

Fix checklist:
- Ensure the OAuth client type is **Web application** (not Android/iOS/Desktop).
- Confirm the client ID belongs to the active Google Cloud project.
- Add authorized JavaScript origins (required even for popup):
  - http://localhost:3000
  - https://dev.primarydesignco.com

After updating the client:
- Update `window.GOOGLE_CLIENT_ID` in `index.html`.
- Hard refresh the page.

### D. SDK never initialized

Common mistake: initialization runs before the script loads or before the
auth UI is mounted.

Fix pattern:

```js
window.onload = () => initAuthProviders();
```

## 9. Email magic link issues

### A. Confirm the frontend actually hits the backend

Add a server-side log and verify it fires:

```js
console.log('MAGIC LINK SEND ATTEMPT', email);
```

If you do not see it, the frontend never called the endpoint.

### B. Common email failures (most cases)

- No SMTP provider configured (SendGrid/Postmark/SES/Resend)
- From domain not verified (Gmail drops it)
- Magic link uses localhost (works locally, fails for users)

### C. Minimum viable setup (Resend example)

```js
import { Resend } from 'resend';

const resend = new Resend(RESEND_API_KEY);

await resend.emails.send({
  from: 'Maya <auth@primarydesignco.com>',
  to: email,
  subject: 'Sign in to Maya',
  html: `<a href="${magicLink}">Sign in</a>`
});
```

Make sure:
- primarydesignco.com DNS verified
- SPF + DKIM set

## 10. Why this happened

Right now the system has:
- UI for auth
- But no auth orchestration layer

Auth is not just buttons. The full chain is:

UI → Provider SDK → Redirect → Callback → Session → UI unlock

Only the UI and part of the form submission are currently present.

## 11. Recommended next steps (order matters)

1. **Add visible failures today**
   - Add toasts on all auth attempts:

     ```js
     .catch(err => showError(err.message || 'Authentication failed'));
     ```

2. **Temporarily hide Apple + Google**
   - Dead buttons destroy trust.

3. **Get email auth working end-to-end**
   - Once email works, you can test users, credits, and upgrades.

4. **Centralize auth in one module**
   - One file:
     - `auth.start(provider)`
     - `auth.callback()`
     - `auth.signOut()`
     - `auth.getSession()`

No auth logic should live inside modals.
