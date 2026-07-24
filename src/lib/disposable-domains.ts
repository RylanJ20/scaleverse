// Common disposable-email domains (plan: denylist on signup's recovery email).
// Deliberately small and high-confidence — a miss costs nothing (the email is
// optional and unverified), a false positive blocks a real recovery address.
const DISPOSABLE = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "10minutemail.com",
  "10minemail.com",
  "tempmail.com",
  "temp-mail.org",
  "tempmail.dev",
  "throwawaymail.com",
  "yopmail.com",
  "yopmail.fr",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "mintemail.com",
  "trashmail.com",
  "mailnesia.com",
  "mytemp.email",
  "fakeinbox.com",
  "spamgourmet.com",
  "mohmal.com",
  "tempinbox.com",
  "emailondeck.com",
  "burnermail.io",
  "mail-temp.com",
  "moakt.com",
  "tmpmail.org",
  "tmpmail.net",
  "inboxkitten.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase();
  return !!domain && DISPOSABLE.has(domain);
}
