/**
 * Google Search Console access (copied from pdf.techsource.pro, same service account).
 *
 * A service account rather than an OAuth user client, because a desktop
 * client's refresh token expires after seven days while the consent screen
 * sits in "Testing", and `webmasters.readonly` is a sensitive scope, so
 * leaving Testing means going through Google verification. A service account
 * has no refresh token to expire: sign a JWT, trade it for an hour of access.
 *
 * The account holds no IAM role. Its permission comes from the Search Console
 * side, where the address below is added as a property user. That is also the
 * failure everybody hits first: a valid token against a property the account
 * was never added to returns 200 with an empty body, not 403.
 */

import { execFileSync } from 'node:child_process'
import { createSign } from 'node:crypto'

const VAULT = '/opt/homebrew/bin/vault'
const VAULT_ADDR = 'https://vault.techsource.pro'
const SECRET = 'secret/internal/gsc-pdf-techsource'
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly'
const API = 'https://searchconsole.googleapis.com/webmasters/v3'

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

const credentials = () => {
  const raw = execFileSync(VAULT, ['kv', 'get', `-field=value`, SECRET], {
    env: { ...process.env, VAULT_ADDR },
    encoding: 'utf8',
  })
  return JSON.parse(raw)
}

let cachedToken = null

/** Access tokens last an hour; a single run never needs a second one. */
export const accessToken = async () => {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value

  const sa = credentials()
  const now = Math.floor(Date.now() / 1000)
  const unsigned = [
    b64({ alg: 'RS256', typ: 'JWT' }),
    b64({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }),
  ].join('.')
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
    signal: AbortSignal.timeout(15000),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`token exchange failed (${response.status}): ${JSON.stringify(body)}`)

  cachedToken = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 }
  return cachedToken.value
}

const call = async (path, init = {}) => {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(30000),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`${path} failed (${response.status}): ${JSON.stringify(body)}`)
  return body
}

/**
 * dwg.moonforge.tech sits inside the domain property for moonforge.tech
 * (seo/site.json `gscProperty`), so the property is named exactly rather than
 * matched by host: a looser match would also hit a URL-prefix property for the
 * main site if one is ever added. An empty list is the signal that the service
 * account has not been added as a property user yet.
 */
export const resolveSite = async (property) => {
  const { siteEntry = [] } = await call('/sites')
  if (siteEntry.length === 0 || !siteEntry.some((entry) => entry.siteUrl === property)) {
    throw new Error(
      `property ${property} is not visible to the service account - add ` +
        'gsc-reader@pdf-techsource-seo.iam.gserviceaccount.com as a Full user in Search Console ' +
        `(Settings -> Users and permissions). Visible now: ${siteEntry.map((e) => e.siteUrl).join(', ') || 'nothing'}`,
    )
  }
  return property
}

export const searchAnalytics = async (siteUrl, body) =>
  call(`/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    body: JSON.stringify({ rowLimit: 1000, ...body }),
  })

/**
 * URL Inspection lives on a different host and API version, and needs the
 * account to be an owner or full user - a restricted user gets 403 here while
 * search analytics keeps working, which reads like a broken script.
 */
export const inspectUrl = async (siteUrl, inspectionUrl) => {
  const response = await fetch('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect', {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ siteUrl, inspectionUrl, languageCode: 'en-US' }),
    signal: AbortSignal.timeout(30000),
  })
  const body = await response.json()
  if (!response.ok) throw new Error(`inspect ${inspectionUrl} failed (${response.status}): ${JSON.stringify(body)}`)
  return body.inspectionResult
}
