// Google-hosted statistics receiver. This is a public web-app URL, not a secret.
// The XML text and per-item audit records stay in the exported XML.
window.ANNOTATION_STATS_CONFIG = Object.freeze({
  endpoint: 'https://script.google.com/macros/s/AKfycbwmbbw9aEuQCnk6xHNIeEvsMhsGRjF5klLxPKkjmA1b7OnjoJXmwq84Gam58Pcq7iY/exec',
  idleMs: 10 * 60 * 1000,
  projectTimeZone: 'America/Chicago'
});
