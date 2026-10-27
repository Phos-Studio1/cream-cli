import { describe, expect, it } from 'vitest';
import { RemoteHub, type HubEvents } from '../src/lib/remote/hub.js';
import type { ChannelEvent, RemoteChannel } from '../src/lib/remote/types.js';

function setup() {
  const sent: { chatId: string; text: string }[] = [];
  const allowed = new Set<string>();
  const received: string[] = [];
  const events: HubEvents = {
    onMessage: (message) => received.push(message.text),
    onState: () => undefined,
    onPaired: () => undefined,
    isAllowed: (_platform, userId) => allowed.has(userId),
    allow: (_platform, userId) => allowed.add(userId),
  };
  const hub = new RemoteHub(() => events);
  const channel: RemoteChannel = {
    platform: 'telegram',
    start: async () => '@bot',
    stop: () => undefined,
    send: async (chatId, text) => void sent.push({ chatId, text }),
    log: async () => undefined,
    sendImage: async () => undefined,
    directChat: async (userId) => userId,
    typing: async () => undefined,
    askApproval: async (chatId, _id, text) => void sent.push({ chatId, text }),
  };
  (hub as unknown as { channels: Map<string, unknown> }).channels.set('telegram', { channel, token: 't' });
  const handle = (event: ChannelEvent) => (hub as unknown as { handle: (e: ChannelEvent) => boolean }).handle(event);
  const message = (userId: string, text: string, addressed = true): ChannelEvent => ({
    kind: 'message',
    target: { platform: 'telegram', chatId: userId },
    userId,
    userName: userId,
    text,
    images: [],
    addressed,
  });
  return { hub, handle, message, sent, received, allowed };
}

describe('RemoteHub', () => {
  it('rejects strangers and pairs with the right code', () => {
    const { hub, handle, message, sent, received, allowed } = setup();
    handle(message('99', 'hello'));
    expect(sent.at(-1)?.text).toMatch(/not paired/);
    handle(message('99', '/pair 000000'));
    expect(sent.at(-1)?.text).toMatch(/Wrong pairing code/);
    const code = hub.pairingCode;
    handle(message('42', `/pair ${code}`));
    expect(allowed.has('42')).toBe(true);
    expect(hub.pairingCode).not.toBe(code);
    handle(message('42', 'hi cream'));
    expect(received).toEqual(['hi cream']);
  });

  it('locks out after five wrong codes', () => {
    const { hub, handle, message, sent } = setup();
    for (let i = 0; i < 5; i++) handle(message('7', '/pair 000000'));
    expect(sent.at(-1)?.text).toMatch(/Too many attempts/);
    handle(message('7', `/pair ${hub.pairingCode}`));
    expect(sent.at(-1)?.text).toMatch(/Too many attempts/);
  });

  it('ignores unaddressed group messages and resolves text approvals', async () => {
    const { hub, handle, message, received, allowed } = setup();
    allowed.add('42');
    expect(handle(message('42', 'chatting with friends', false))).toBe(false);
    expect(received).toEqual([]);
    const { decision } = hub.askApproval({ platform: 'telegram', chatId: '42' }, 'Run this command?');
    handle(message('42', 'ya'));
    await expect(decision).resolves.toBe('once');
  });

  it('rejects approval buttons from other users', () => {
    const { hub, handle, allowed } = setup();
    allowed.add('42');
    const { id } = hub.askApproval({ platform: 'telegram', chatId: '42' }, 'Write this file?');
    const press = (userId: string): ChannelEvent => ({ kind: 'decision', target: { platform: 'telegram', chatId: '42' }, userId, approvalId: id, decision: 'once' });
    expect(handle(press('99'))).toBe(false);
    expect(handle(press('42'))).toBe(true);
  });
});
