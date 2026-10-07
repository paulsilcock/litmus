import type { Audio } from "@litmus/core/ai";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  PhoneDriver,
  type PhoneDriverOptions,
} from "#litmus-test/drivers/phone.ts";
import { FakeTwilio } from "#litmus-test/test-support/fake-twilio.ts";

class TestPhone extends PhoneDriver {
  dial(to = "+447700900123"): Promise<void> {
    return this.call(to);
  }

  callerSays(audio: Audio): Promise<void> {
    return this.speak(audio);
  }

  calleeSays(sampleRate = 24_000): Promise<Audio> {
    return this.listen(sampleRate);
  }

  finish(): Promise<void> {
    return this.hangUp();
  }
}

/** A phone driver wired to a fake Twilio, reached on localhost. */
async function phoneFor(
  twilio: FakeTwilio,
  options: Partial<PhoneDriverOptions> = {},
): Promise<TestPhone> {
  const phone = new TestPhone({
    twilio: {
      accountSid: "AC123",
      authToken: "secret",
      from: "+15550001111",
      apiUrl: twilio.apiUrl,
    },
    expose: async (port) => ({ url: `http://127.0.0.1:${port}` }),
    ...options,
  });
  await phone.init();
  return phone;
}

describe("phone driver", () => {
  it("a call goes to the number dialled, from the driver's own number", async () => {
    await using twilio = await FakeTwilio.start();
    await using phone = await phoneFor(twilio);

    await phone.dial("+447700900123");

    expect(twilio.calls()).toEqual([
      { to: "+447700900123", from: "+15550001111" },
    ]);
  });

  it("what the callee says reaches the caller, at the rate it listens at", async () => {
    await using twilio = await FakeTwilio.start();
    await using phone = await phoneFor(twilio);
    await phone.dial();

    twilio.says(Array<number>(80).fill(0.5));
    const heard = await phone.calleeSays(24_000);

    expect(heard.sampleRate).toBe(24_000);
    expect(heard.samples).toHaveLength(240);
    // μ-law is coarse at loud levels: 0.5 comes back as about 0.51.
    for (const sample of heard.samples) expect(sample).toBeCloseTo(0.5, 1);
  });

  it("what the caller says reaches the callee as phone audio", async () => {
    await using twilio = await FakeTwilio.start();
    await using phone = await phoneFor(twilio);
    await phone.dial();

    await phone.callerSays({
      samples: Array<number>(24).fill(0.25),
      sampleRate: 24_000,
    });

    await vi.waitFor(() => expect(twilio.heard()).toHaveLength(8));
    for (const sample of twilio.heard()) expect(sample).toBeCloseTo(0.25, 2);
  });

  it("hanging up lets the caller's last words finish playing", async () => {
    await using twilio = await FakeTwilio.start();
    await using phone = await phoneFor(twilio);
    twilio.holdsPlayback();
    await phone.dial();
    await phone.callerSays({ samples: [0.25, 0.25, 0.25], sampleRate: 24_000 });

    const hangingUp = phone.finish();
    await vi.waitFor(() => expect(twilio.isPlaying()).toBe(true));
    const hungUpWhilePlaying = twilio.callerHungUp();
    twilio.finishPlaying();
    await hangingUp;

    expect(hungUpWhilePlaying).toBe(false);
    expect(twilio.callerHungUp()).toBe(true);
  });

  it("a call Twilio refuses fails with Twilio's reason", async () => {
    await using twilio = await FakeTwilio.start();
    await using phone = await phoneFor(twilio);
    twilio.refusesCalls("The 'To' number 123 is not a valid phone number.");

    await expect(phone.dial("123")).rejects.toThrow(
      "Twilio didn't place the call to 123: The 'To' number 123 is not a valid phone number.",
    );
  });

  it("a call nobody answers fails clearly, and doesn't keep ringing", async () => {
    await using twilio = await FakeTwilio.start();
    await using phone = await phoneFor(twilio, { answerTimeout: 50 });
    twilio.leavesCallsUnanswered();

    await expect(phone.dial("+447700900123")).rejects.toThrow(
      "The call to +447700900123 wasn't answered within 0.05s",
    );
    expect(twilio.callerHungUp()).toBe(true);
  });

  it("the callee hanging up ends the call", async () => {
    await using twilio = await FakeTwilio.start();
    await using phone = await phoneFor(twilio);
    await phone.dial();

    twilio.hangsUp();

    await expect(phone.calleeSays()).rejects.toThrow("The call has ended.");
  });
});
