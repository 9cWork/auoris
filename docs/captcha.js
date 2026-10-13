// The bot check for signing up, signing in and password resets (Supabase Auth -> Attack Protection -> CAPTCHA, Cloudflare Turnstile).
// Both the website and the desktop app show this page in a small frame and get the answer by postMessage, so the Turnstile widget only
// ever runs on auoris.org. With SITEKEY empty the check is off: the page answers "off" at once and sign-in works without a token.
// Turn it on in this order: put the site key here and publish the website, release the app, THEN switch CAPTCHA on in Supabase.
const SITEKEY = '0x4AAAAAAFV5zi1LrvlUNU7G';
// only the website itself and the desktop app (served from this PC) get a token
const OK = /^(https:\/\/auoris\.org|http:\/\/(127\.0\.0\.1|localhost):\d{2,5})$/;
// Firefox has no ancestorOrigins: fall back to the embedding page's origin from the referrer. That is only a hint about where to
// send the answer - postMessage's targetOrigin makes the browser drop it unless the parent really is that origin.
const parentOrigin = (location.ancestorOrigins && location.ancestorOrigins[0]) || (() => { try { return new URL(document.referrer).origin; } catch (e) { return ''; } })();
const answer = v => { if (OK.test(parentOrigin)) parent.postMessage({ auorisCaptcha: v }, parentOrigin); };
if (!SITEKEY || parent === window) answer('off');
else {
  window.onTurnstileLoad = () => turnstile.render('#box', {
    sitekey: SITEKEY, theme: 'dark', callback: t => answer(t), 'error-callback': () => answer('error'), 'expired-callback': () => answer('expired'),
  });
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
  s.onerror = () => answer('error');
  document.head.appendChild(s);
}
