import { randomInt } from 'node:crypto';
import type { ImageInput } from '../attachments.js';
import { DiscordChannel } from './discord.js';
import { TelegramChannel } from './telegram.js';
import {
  platformLabel,
  type ChannelEvent,
  type RemoteChannel,
  type RemoteDecision,
  type RemotePlatform,
  type RemoteTarget,
} from './types.js';

export type RemoteState = { status: 'connecting' | 'online' | 'error'; name?: string; detail?: string };

export type RemoteMessage = { target: RemoteTarget; userName: string; text: string; images: ImageInput[] };

export type HubEvents = {
  onMessage: (message: RemoteMessage) => void;
  onState: (platform: RemotePlatform, state: RemoteState | null) => void;
  onPaired: (platform: RemotePlatform, userName: string) => void;
  isAllowed: (platform: RemotePlatform, userId: string) => boolean;
  allow: (platform: RemotePlatform, userId: string) => void;
};

const textDecisions: Record<string, RemoteDecision> = {
  y: 'once',
  ya: 'once',
  yes: 'once',
  izinkan: 'once',
  a: 'always',
  selalu: 'always',
  n: 'deny',
  no: 'deny',
  tidak: 'deny',
  tolak: 'deny',
  stop: 'stop',
};

const newCode = () => String(randomInt(100000, 1000000));

export class RemoteHub {
  private readonly channels = new Map<RemotePlatform, { channel: RemoteChannel; token: string }>();
  private readonly approvals = new Map<string, { target: RemoteTarget; resolve: (decision: RemoteDecision) => void }>();
  private readonly failedPairs = new Map<string, number>();
  private nextApproval = 1;
  pairingCode = newCode();

  constructor(private readonly events: () => HubEvents) {}

  running(platform: RemotePlatform, token: string): boolean {
    return this.channels.get(platform)?.token === token;
  }

  start(platform: RemotePlatform, token: string): void {
    if (this.running(platform, token)) return;
    this.stop(platform);
    const onError = (error: Error) => this.events().onState(platform, { status: 'error', detail: error.message });
    const emit = (event: ChannelEvent) => this.handle(event);
    const channel = platform === 'telegram' ? new TelegramChannel(token, emit, onError) : new DiscordChannel(token, emit, onError);
    this.channels.set(platform, { channel, token });
    this.events().onState(platform, { status: 'connecting' });
    channel
      .start()
      .then((name) => {
        if (this.channels.get(platform)?.channel === channel) this.events().onState(platform, { status: 'online', name });
      })
      .catch((error: Error) => {
        if (this.channels.get(platform)?.channel !== channel) return;
        channel.stop();
        this.channels.delete(platform);
        this.events().onState(platform, { status: 'error', detail: error.message });
      });
  }

  stop(platform?: RemotePlatform): void {
    for (const [key, { channel }] of this.channels) {
      if (platform && key !== platform) continue;
      channel.stop();
      this.channels.delete(key);
      this.events().onState(key, null);
    }
  }

  rotateCode(): string {
    this.pairingCode = newCode();
    return this.pairingCode;
  }

  send(target: RemoteTarget, text: string): void {
    void this.channels.get(target.platform)?.channel.send(target.chatId, text).catch(() => undefined);
  }

  async sendImage(target: RemoteTarget, image: ImageInput, caption?: string): Promise<void> {
    const channel = this.channels.get(target.platform)?.channel;
    if (!channel) throw new Error(`${platformLabel[target.platform]} is not connected`);
    await channel.sendImage(target.chatId, image, caption);
  }

  async broadcastImage(allowed: Record<RemotePlatform, string[]>, image: ImageInput, caption?: string): Promise<string[]> {
    const delivered: string[] = [];
    for (const [platform, { channel }] of this.channels) {
      for (const userId of allowed[platform] ?? []) {
        try {
          await channel.sendImage(await channel.directChat(userId), image, caption);
          delivered.push(platformLabel[platform]);
        } catch {
          continue;
        }
      }
    }
    return delivered;
  }

  connected(): RemotePlatform[] {
    return [...this.channels.keys()];
  }

  log(target: RemoteTarget, line: string): void {
    void this.channels.get(target.platform)?.channel.log(target.chatId, line).catch(() => undefined);
  }

  typing(target: RemoteTarget): void {
    void this.channels.get(target.platform)?.channel.typing(target.chatId).catch(() => undefined);
  }

  askApproval(target: RemoteTarget, text: string): { id: string; decision: Promise<RemoteDecision> } {
    const id = String(this.nextApproval++);
    const decision = new Promise<RemoteDecision>((resolve) => this.approvals.set(id, { target, resolve }));
    void this.channels.get(target.platform)?.channel.askApproval(target.chatId, id, text).catch(() => undefined);
    return { id, decision };
  }

  settleApproval(id: string): void {
    this.approvals.delete(id);
  }

  private resolveApproval(id: string, decision: RemoteDecision): boolean {
    const pending = this.approvals.get(id);
    if (!pending) return false;
    this.approvals.delete(id);
    pending.resolve(decision);
    return true;
  }

  private handle(event: ChannelEvent): boolean {
    const events = this.events();
    const { platform } = event.target;
    const allowed = events.isAllowed(platform, event.userId);

    if (event.kind === 'decision') return allowed && this.resolveApproval(event.approvalId, event.decision);

    const pairing = event.text.match(/^\/pair(?:@\w+)?\s+(\d{6})$/i);
    if (!allowed) {
      if (!event.addressed) return false;
      const key = `${platform}:${event.userId}`;
      const failures = this.failedPairs.get(key) ?? 0;
      if (failures >= 5) return false;
      if (pairing && pairing[1] === this.pairingCode) {
        events.allow(platform, event.userId);
        this.rotateCode();
        this.failedPairs.delete(key);
        events.onPaired(platform, event.userName);
        this.send(event.target, `✅ Paired! This ${platformLabel[platform]} account can now control Cream. Send /help to see how.`);
        return true;
      }
      if (pairing) {
        this.failedPairs.set(key, failures + 1);
        this.send(event.target, failures + 1 >= 5 ? '⛔ Too many attempts. Try again after Cream restarts.' : '❌ Wrong pairing code.');
        return false;
      }
      this.send(event.target, '🔒 This account is not paired. Type /remote in Cream to see the code, then send /pair <code> here.');
      return false;
    }

    if (pairing) {
      this.send(event.target, 'This account is already paired.');
      return true;
    }

    const answer = textDecisions[event.text.trim().toLowerCase()];
    if (answer) {
      const pending = [...this.approvals].find(([, a]) => a.target.platform === platform && a.target.chatId === event.target.chatId);
      if (pending) return this.resolveApproval(pending[0], answer);
    }

    if (!event.addressed) return false;
    events.onMessage({ target: event.target, userName: event.userName, text: event.text, images: event.images });
    return true;
  }
}
