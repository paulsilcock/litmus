import { OpenAIRealtimeVoiceModel } from "@litmus/ai/openai";
import type { Audio } from "@litmus/core/ai";

import type { Turn } from "#litmus-test/conversation.ts";
import { Driver } from "#litmus-test/drivers/base.ts";
import { cloudflareTunnel } from "#litmus-test/drivers/cloudflare-tunnel.ts";
import { PhoneDriver } from "#litmus-test/drivers/phone.ts";
import { UserSimulator } from "#litmus-test/simulator.ts";

import { Dashboard, type RecordedCall } from "./dashboard.ts";
import { printTurn } from "./live-transcript.ts";
import { setting } from "./settings.ts";

export type { RecordedCall };

/** Who's calling, and what they want doing. */
export interface Caller {
  name: string;
  /** The number they call from, and want calling back on. */
  phone: string;
  /** Their email address, if they're willing to give it. */
  email?: string;
  /** The street they live on, with the house number. */
  street: string;
  /** The town or village they live in, so where the job is. */
  area: string;
  /** The job, in the customer's words. */
  job: string;
  /** When they're free for someone to come out. */
  available: string;
  /** The language they speak. English unless said otherwise. */
  language?: string;
  /** Anything notable about how they talk. */
  speaking?: string;
}

/** How a call went, as the customer heard it. */
export interface CallRecord {
  from: string;
  startedAt: Date;
  greeting: string;
  transcript: readonly Turn[];
}

/**
 * Cyberstaff, from both ends: customers phoning the business, and the
 * owner's dashboard. Real phone calls with a simulated customer, and a
 * browser on the dashboard, are details it keeps to itself.
 *
 * Remembers the last call, and puts back any settings it changed when
 * it closes.
 */
export class CyberstaffDriver extends Driver {
  readonly #dashboard = new Dashboard();
  #lastCall?: CallRecord;

  /** Logs the business owner in to the dashboard. */
  override async init(): Promise<void> {
    await this.#dashboard.init();
  }

  /** Puts back any settings changed, then logs out. */
  override async [Symbol.asyncDispose](): Promise<void> {
    await this.#dashboard[Symbol.asyncDispose]();
  }

  /**
   * The customer rings the business, explains the job, and gives their
   * details, then says goodbye once told someone will be in touch.
   */
  phoneTheBusiness(caller: Caller): Promise<void> {
    const persona = [
      `${caller.name}, who lives at ${caller.street}, ${caller.area}`,
      `Your phone number is ${caller.phone}`,
      caller.email === undefined
        ? "You'd rather not give out your email address"
        : `Your email address is ${caller.email}`,
      caller.language === undefined
        ? undefined
        : `You speak only ${caller.language}`,
      caller.speaking,
    ]
      .filter((part) => part !== undefined)
      .join(". ");
    return this.#call({
      from: caller.phone,
      persona,
      goal: [
        `get a plumber to come out for ${caller.job}.`,
        `You're free ${caller.available}.`,
        "Once they've said someone will be in touch, say goodbye.",
      ].join(" "),
    });
  }

  /**
   * The customer rings the business to ask what a job costs, then says
   * goodbye once told a price.
   */
  askWhatItCosts(enquiry: {
    phone: string;
    area: string;
    job: string;
  }): Promise<void> {
    return this.#call({
      from: enquiry.phone,
      persona: `someone who lives in ${enquiry.area}`,
      goal: `find out how much it costs to have a plumber come out for ${enquiry.job}. Once you've been told a price, thank them and say goodbye.`,
    });
  }

  /** How the last call went, as the customer heard it. */
  lastCall(): CallRecord {
    if (this.#lastCall === undefined) {
      throw new Error("No customer has phoned the business yet.");
    }
    return this.#lastCall;
  }

  /**
   * What the business has on record from the last call, once the
   * dashboard has listed and summarised it.
   */
  recordOfLastCall(): Promise<RecordedCall> {
    const call = this.lastCall();
    return this.#dashboard.findCall({ from: call.from, after: call.startedAt });
  }

  /**
   * Has the receptionist take calls in `language`. Anything but English
   * needs multilingual calls switched on.
   */
  async acceptCallsIn(language = "English"): Promise<void> {
    if (language !== "English") await this.#dashboard.setMultilingual(true);
  }

  /** Has the receptionist ask callers for their email address. */
  askCallersForEmail(): Promise<void> {
    return this.#dashboard.setEmailCollection(true);
  }

  /**
   * Rings the business from `from`. The simulated customer, who is
   * `persona`, hears the receptionist's greeting, then pursues `goal`.
   */
  async #call(options: {
    from: string;
    persona: string;
    goal: string;
  }): Promise<void> {
    await using phone = new PhoneLine({
      twilio: {
        accountSid: setting("TWILIO_ACCOUNT_SID"),
        authToken: setting("TWILIO_AUTH_TOKEN"),
        from: options.from,
      },
      expose: cloudflareTunnel(),
    });
    await phone.init();

    const startedAt = new Date();
    await phone.dial(setting("CYBERSTAFF_NUMBER"));
    const model = new OpenAIRealtimeVoiceModel({
      apiKey: setting("OPENAI_API_KEY"),
    });
    await using customer = UserSimulator.voice({
      model,
      persona: options.persona,
      speak: (audio) => phone.say(audio),
      listen: () => phone.hear(model.inputSampleRate),
      watch: printTurn,
    });

    let greeting = "";
    try {
      // The receptionist answers first: let it finish its greeting before
      // the customer says why they're calling.
      greeting = await customer.hear();
      await customer.pursueGoal(options.goal, { maxTurns: 8 });
    } finally {
      this.#lastCall = {
        from: options.from,
        startedAt,
        greeting,
        transcript: await customer.transcript(),
      };
      await phone.putDown();
    }
  }
}

/** A phone line from one number, opened up for this driver's use. */
class PhoneLine extends PhoneDriver {
  dial(number: string): Promise<void> {
    return this.call(number);
  }

  say(audio: Audio): Promise<void> {
    return this.speak(audio);
  }

  hear(sampleRate: number): Promise<Audio> {
    return this.listen(sampleRate);
  }

  putDown(): Promise<void> {
    return this.hangUp();
  }
}
