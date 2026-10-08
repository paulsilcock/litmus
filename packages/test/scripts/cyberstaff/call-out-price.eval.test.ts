/**
 * Cyberstaff's receptionist was set up from hamish-the-plumber.com, so
 * that site is the answer key. Places real calls, so it only runs when
 * asked, one file at a time:
 *
 *   CYBERSTAFF_EVALS=1 vp test --run packages/test/scripts/cyberstaff/call-out-price.eval.test.ts
 *
 * Needs, in the repo's .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * TWILIO_FROM_NUMBER, CYBERSTAFF_NUMBER, CYBERSTAFF_EMAIL,
 * CYBERSTAFF_PASSWORD, OPENAI_API_KEY.
 */
import { evaluate } from "#litmus-test/evaluate/index.ts";

import { CyberstaffDsl } from "./cyberstaff-dsl.ts";
import { evalsEnabled, setting } from "./settings.ts";

evaluate.runIf(evalsEnabled)(
  "a customer asking what a weekday call-out costs is told £75",
  async () => {
    await using cyberstaff = await CyberstaffDsl.open();

    await cyberstaff.customer.asksWhatItCosts({
      phone: setting("TWILIO_FROM_NUMBER"),
      area: "the centre of Salisbury",
      job: "a dripping kitchen tap, on a weekday during office hours",
    });

    cyberstaff.customer.checkWasGreetedAs({ business: "Hamish" });
    // The site: "£75 for up to an hour + parts (Mon-Fri 9am - 5pm within
    // 5 miles of Salisbury)".
    cyberstaff.customer.checkWasQuoted({ pounds: 75 });
  },
  { samples: 1, passRate: 1, timeout: 4 * 60_000 },
);
