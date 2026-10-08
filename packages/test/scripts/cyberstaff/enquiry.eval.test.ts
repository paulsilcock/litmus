/**
 * Cyberstaff's receptionist was set up from hamish-the-plumber.com.
 * Places real calls, so it only runs when asked, one file at a time:
 *
 *   CYBERSTAFF_EVALS=1 vp test --run packages/test/scripts/cyberstaff/enquiry.eval.test.ts
 *
 * Needs, in the repo's .env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * CYBERSTAFF_NUMBER, CYBERSTAFF_EMAIL, CYBERSTAFF_PASSWORD,
 * OPENAI_API_KEY. HEADED=1 shows the dashboard's browser.
 */
import { evaluate } from "#litmus-test/evaluate/index.ts";

import { CyberstaffDsl } from "./cyberstaff-dsl.ts";
import { enquiries } from "./enquiries.ts";
import { evalsEnabled } from "./settings.ts";

evaluate.runIf(evalsEnabled).scenarios(enquiries, {
  labelBy: (enquiry) => enquiry.caller,
  samples: 1,
  passRate: 1,
  timeout: 8 * 60_000,
})(
  "the business can follow up an enquiry from what the receptionist recorded",
  async (enquiry) => {
    await using cyberstaff = await CyberstaffDsl.open();
    await cyberstaff.business.asksCallersForTheirEmail();
    await cyberstaff.business.acceptCallsIn({ language: enquiry.language });

    await cyberstaff.customer.phonesTheBusiness(enquiry);

    cyberstaff.customer.checkWasGreetedAs({ business: "Hamish" });
    cyberstaff.customer.checkWasNotAskedToRepeatThemselves();
    await cyberstaff.business.checkEnquiryRecorded({
      name: enquiry.name,
      phone: enquiry.phone,
      email: enquiry.email,
      area: enquiry.area,
      job: "washing machine",
      available: enquiry.available,
    });
  },
);
