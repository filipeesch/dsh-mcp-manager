/**
 * The HTML page the callback listener answers with.
 *
 * Nothing here is OAuth-specific beyond the wording: the caller decides whether
 * the flow succeeded and supplies an already-redacted message, because the
 * attempt log and this page share one redactor and provider error text is the
 * most likely place for a credential to appear.
 */

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

/** Only an absolute http(s) URL may become the "back" link. */
function safeReturnUrl(value) {
  try {
    const url = new URL(String(value ?? ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    return url.origin + '/';
  } catch {
    return '';
  }
}

/**
 * @param {{ ok: boolean, message: string, returnUrl?: string }} input
 * @returns {string} a complete HTML document
 */
export function renderCallbackPage({ ok, message, returnUrl } = {}) {
  const title = ok ? '✅ Authorized' : '❌ Authorization failed';
  const back = safeReturnUrl(returnUrl);
  const link = back ? `<p><a href="${escapeHtml(back)}">Back to DSH</a></p>` : '';
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + '<body style="font-family:system-ui;padding:40px;max-width:640px">'
    + `<h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p>${link}</body>`;
}

/**
 * Write a page with the headers this listener needs: no caching, and a
 * connection that closes so a stopped listener can release its port
 * immediately instead of waiting for a keep-alive timeout.
 */
export function sendCallbackPage(res, status, input) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  res.end(renderCallbackPage(input));
}
