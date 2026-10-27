import type { ImageInput } from '../attachments.js';
import { tablesToCodeBlocks } from './format.js';
import { download, splitMessage, type ChannelEvent, type RemoteChannel } from './types.js';

type Progress = { lines: string[]; messageId?: string; timer?: NodeJS.Timeout; busy?: boolean; dirty?: boolean };

const api = 'https://discord.com/api/v10';
const gateway = 'wss://gateway.discord.gg/?v=10&encoding=json';

const intents = { guilds: 1 << 0, guildMessages: 1 << 9, directMessages: 1 << 12, messageContent: 1 << 15 };

const fatalCodes: Record<number, string> = {
  4004: 'Invalid Discord bot token',
  4010: 'Invalid shard',
  4011: 'Sharding required',
  4012: 'Invalid gateway version',
  4013: 'Invalid intents',
};

export class DiscordChannel implements RemoteChannel {
  readonly platform = 'discord' as const;
  private socket?: WebSocket;
  private heartbeat?: NodeJS.Timeout;
  private sequence: number | null = null;
  private stopped = false;
  private botId = '';
  private intents = intents.guilds | intents.guildMessages | intents.directMessages | intents.messageContent;
  private readonly progress = new Map<string, Progress>();

  constructor(
    private readonly token: string,
    private readonly emit: (event: ChannelEvent) => boolean,
    private readonly onError: (error: Error) => void,
  ) {}

  private async rest<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bot ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://github.com/creamcli, 1.0)',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 204) return undefined as T;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { message?: string }).message ?? `Discord ${path} failed (HTTP ${res.status})`);
    return json as T;
  }

  async start(): Promise<string> {
    const me = await this.rest<{ id: string; username: string }>('GET', '/users/@me');
    this.botId = me.id;
    await this.connect();
    return me.username;
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.heartbeat);
    this.socket?.close(1000);
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let ready = false;
      const socket = new WebSocket(gateway);
      this.socket = socket;
      const sendPayload = (payload: unknown) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(payload));

      socket.onmessage = (event) => {
        const payload = JSON.parse(String(event.data));
        if (payload.s !== null && payload.s !== undefined) this.sequence = payload.s;

        if (payload.op === 10) {
          clearInterval(this.heartbeat);
          this.heartbeat = setInterval(() => sendPayload({ op: 1, d: this.sequence }), payload.d.heartbeat_interval);
          sendPayload({
            op: 2,
            d: { token: this.token, intents: this.intents, properties: { os: process.platform, browser: 'creamcli', device: 'creamcli' } },
          });
        } else if (payload.op === 1) sendPayload({ op: 1, d: this.sequence });
        else if (payload.op === 7 || payload.op === 9) socket.close(4000);
        else if (payload.op === 0) {
          if (payload.t === 'READY') {
            ready = true;
            resolve();
          } else if (payload.t === 'MESSAGE_CREATE') void this.handle(payload.d).catch((error: Error) => this.onError(error));
        }
      };

      socket.onclose = (event) => {
        clearInterval(this.heartbeat);
        if (this.stopped) return;
        if (event.code === 4014 && this.intents & intents.messageContent) {
          this.intents &= ~intents.messageContent;
          this.onError(
            new Error('Message Content Intent is not enabled in the Discord Developer Portal. DMs still work; server messages need a mention.'),
          );
          this.connect().then(resolve, reject);
          return;
        }
        const fatal = fatalCodes[event.code];
        if (fatal) {
          this.stopped = true;
          const error = new Error(fatal);
          return ready ? this.onError(error) : reject(error);
        }
        setTimeout(() => {
          if (!this.stopped) this.connect().then(ready ? undefined : resolve, ready ? (e: Error) => this.onError(e) : reject);
        }, 5000);
      };

      socket.onerror = () => undefined;
    });
  }

  private async handle(message: any): Promise<void> {
    if (!message.author || message.author.bot || message.author.id === this.botId) return;
    const content = String(message.content ?? '');
    const mentioned = content.includes(`<@${this.botId}>`) || content.includes(`<@!${this.botId}>`);
    const text = content.replace(new RegExp(`<@!?${this.botId}>`, 'g'), '').trim();
    const images: ImageInput[] = [];
    for (const file of message.attachments ?? [])
      if (String(file.content_type ?? '').startsWith('image/'))
        images.push({ data: await download(file.url), mime: file.content_type, width: file.width, height: file.height });

    this.emit({
      kind: 'message',
      target: { platform: 'discord', chatId: message.channel_id },
      userId: message.author.id,
      userName: message.author.global_name ?? message.author.username,
      text,
      images,
      addressed: !message.guild_id || mentioned || text.startsWith('/pair'),
    });
  }

  async send(chatId: string, text: string): Promise<void> {
    this.progress.delete(chatId);
    for (const chunk of splitMessage(tablesToCodeBlocks(text), 1900)) await this.rest('POST', `/channels/${chatId}/messages`, { content: chunk });
  }

  async log(chatId: string, line: string): Promise<void> {
    const entry = this.progress.get(chatId) ?? { lines: [] as string[] };
    entry.lines.push(line);
    this.progress.set(chatId, entry);
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.flushProgress(chatId, entry), entry.messageId ? 900 : 150);
  }

  private async flushProgress(chatId: string, entry: Progress): Promise<void> {
    if (entry.busy) {
      entry.dirty = true;
      return;
    }
    entry.busy = true;
    const content = ['**⚙️ Working…**', ...entry.lines.slice(-25)].join('\n').slice(0, 1900);
    try {
      if (!entry.messageId) entry.messageId = (await this.rest<{ id: string }>('POST', `/channels/${chatId}/messages`, { content })).id;
      else await this.rest('PATCH', `/channels/${chatId}/messages/${entry.messageId}`, { content });
    } catch {
      entry.dirty = false;
    } finally {
      entry.busy = false;
      if (entry.dirty) {
        entry.dirty = false;
        entry.timer = setTimeout(() => void this.flushProgress(chatId, entry), 900);
      }
    }
  }

  async sendImage(chatId: string, image: ImageInput, caption?: string): Promise<void> {
    this.progress.delete(chatId);
    const filename = `screenshot.${image.mime.split('/')[1] ?? 'png'}`;
    const form = new FormData();
    form.set('payload_json', JSON.stringify({ content: (caption ?? '').slice(0, 1900), attachments: [{ id: 0, filename }] }));
    form.set('files[0]', new Blob([new Uint8Array(image.data)], { type: image.mime }), filename);
    const res = await fetch(`${api}/channels/${chatId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${this.token}`, 'User-Agent': 'DiscordBot (https://github.com/creamcli, 1.0)' },
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { message?: string };
      throw new Error(json.message ?? `Discord upload failed (HTTP ${res.status})`);
    }
  }

  async directChat(userId: string): Promise<string> {
    return (await this.rest<{ id: string }>('POST', '/users/@me/channels', { recipient_id: userId })).id;
  }

  async typing(chatId: string): Promise<void> {
    await this.rest('POST', `/channels/${chatId}/typing`);
  }

  async askApproval(chatId: string, _approvalId: string, text: string): Promise<void> {
    await this.send(chatId, `${text}\n\nReply: **y** allow · **a** always · **n** deny · **stop** stop`);
  }
}
