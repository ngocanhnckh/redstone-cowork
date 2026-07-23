import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Account, AccountSession } from "@rcw/shared";
import { ACCOUNT_STORE, type AccountStore } from "../domain/accounts/account-store.port";
import { AccountsService, type LoginContext } from "./accounts.service";

// Face biometric sign-in. Descriptors are 128-float embeddings computed ON-DEVICE
// (face-api.js) — the server only ever sees vectors, never images. Matching is plain
// Euclidean distance; a match under THRESHOLD is the same person. Sign-in requires the
// biometric match AND a device-bound secret (possession), so face is never sufficient
// alone and descriptors are only ever matched within the device's own account.

// face-api.js FaceRecognitionNet: same-person distances ~0.3–0.4, different ~0.6+.
const THRESHOLD = 0.5;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function distance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export class FaceError extends Error {
  constructor(public readonly reason: "no-match" | "no-device" | "not-enrolled") {
    super(reason);
  }
}

@Injectable()
export class FaceService {
  constructor(
    @Inject(ACCOUNT_STORE) private readonly store: AccountStore,
    private readonly accounts: AccountsService,
  ) {}

  /** Enroll a descriptor for the signed-in account AND trust this device: returns a
   *  one-time device secret the client stores for later face sign-in. */
  async enroll(account: Account, descriptor: number[], deviceLabel: string): Promise<{ deviceSecret: string }> {
    await this.store.addFaceDescriptor(account.id, descriptor);
    const deviceSecret = "rcwd_" + randomBytes(24).toString("hex");
    await this.store.trustDevice({
      id: randomUUID(),
      accountId: account.id,
      secretHash: sha256(deviceSecret),
      label: deviceLabel.slice(0, 200),
      createdAt: new Date(),
    });
    return { deviceSecret };
  }

  /** Admin pre-enrollment: store a descriptor computed from the roster photo (no device). */
  async enrollDescriptor(accountId: string, descriptor: number[]): Promise<void> {
    await this.store.addFaceDescriptor(accountId, descriptor);
  }

  /** Face sign-in: resolve the device→account, match the live descriptor against that
   *  account's enrolled descriptors, and issue a session. Two-factor by construction. */
  async login(deviceSecret: string, descriptor: number[], ctx: LoginContext): Promise<AccountSession> {
    const account = await this.store.findDeviceAccount(sha256(deviceSecret), new Date());
    if (!account) throw new FaceError("no-device");
    const enrolled = await this.store.getFaceDescriptors(account.id);
    if (!enrolled.length) throw new FaceError("not-enrolled");
    const best = enrolled.reduce((m, d) => Math.min(m, distance(descriptor, d)), Infinity);
    if (best > THRESHOLD) throw new FaceError("no-match");
    return this.accounts.issueSession(account, { ...ctx, method: "face" });
  }

  static get threshold(): number {
    return THRESHOLD;
  }
}
