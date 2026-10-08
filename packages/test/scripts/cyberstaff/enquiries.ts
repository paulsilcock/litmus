import type { Caller } from "./cyberstaff-driver.ts";

/** A customer's enquiry, and what's notable about the caller making it. */
export interface Enquiry extends Caller {
  /** Who's calling, in a few words. */
  caller: string;
}

/**
 * One customer per Twilio number: Cyberstaff remembers callers by
 * number, so sharing one would let an earlier call fill in the details.
 */
export const enquiries: Enquiry[] = [
  {
    caller: "a caller who gets straight to the point",
    name: "James Walker",
    phone: "+16282980503",
    email: "james.walker@example.com",
    street: "14 Shaftesbury Road",
    area: "Wilton",
    job: "a washing machine installation",
    available: "Thursday",
  },
  {
    caller: "a caller who only answers what they're asked",
    name: "Anna Fairfax-Lowe",
    phone: "+15623157736",
    street: "3 Church Road",
    area: "Alderbury",
    job: "a washing machine installation",
    available: "Thursday",
    speaking:
      "You answer questions briefly and don't offer any details unless asked for them",
  },
  {
    caller: "a caller who speaks Polish",
    name: "Tomasz Nowak",
    phone: "+12058581416",
    email: "tomasz.nowak@example.com",
    street: "27 West Street",
    area: "Wilton",
    job: "a washing machine installation",
    available: "Friday",
    language: "Polish",
  },
];
