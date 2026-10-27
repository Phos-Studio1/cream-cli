import type { ImageInput } from '../attachments.js';
import { htmlToPlain, toTelegramHtml } from './format.js';
import { download, type ChannelEvent, type RemoteChannel, type RemoteDecision } from './types.js';

type Progress = { lines: string[]; messageId?: number; timer?: NodeJS.Timeout; busy?: boolean; dirty?: boolean };

const apiBase = (process.env.TELEGRAM_API_URL ?? 'https://api.telegram.org').replace(/\/+$/, '');

const decisionLabels: Record<RemoteDecision, string> = {
  once: '✔ Allowed',
  always: '✔ Always allowed',
  deny: '✖ Denied',
  stop: '■ Stopped',
};

export class TelegramChannel implements RemoteChannel {
  readonly platform = 'telegram' as const;
  private readonly controller = new AbortController();
  private offset = 0;
  private stopped = false;
  private username = '';
  private readonly progress = new Map<string, Progress>();

  constructor(
    private readonly token: string,
    private readonly emit: (event: ChannelEvent) => boolean,
    private readonly onError: (error: Error) => void,
  ) {}

  private async call<T = any>(method: string, body: Record<string, unknown> = {}, timeoutMs = 15000): Promise<T> {
    const res = await fetch(`${apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeoutMs)]),
    });
    const json = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed (HTTP ${res.status})`);
    return json.result;
  }

  async start(): Promise<string> {
    const me = await this.call<{ username: string }>('getMe');
    this.username = me.username;
    const pending = await this.call<{ update_id: number }[]>('getUpdates', { offset: -1, timeout: 0 });
    if (pending.length) this.offset = pending.at(-1)!.update_id + 1;
    void this.poll();
    return `@${me.username}`;
  }

  stop(): void {
    this.stopped = true;
    this.controller.abort();
  }

  private async poll(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.call<any[]>(
          'getUpdates',
          { offset: this.offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
          40000,
        );
        for (const update of updates) {
          this.offset = update.update_id + 1;
          void this.handle(update).catch((error: Error) => this.onError(error));
        }
      } catch (error) {
        if (this.stopped) return;
        this.onError(error as Error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async handle(update: any): Promise<void> {
    const query = update.callback_query;
    if (query) {
      const [tag, approvalId, decision] = String(query.data ?? '').split(':');
      if (tag !== 'ap' || !approvalId || !decision) return;
      const message = query.message;
      const accepted = this.emit({
        kind: 'decision',
        target: { platform: 'telegram', chatId: String(message?.chat.id ?? query.from.id) },
        userId: String(query.from.id),
        approvalId,
        decision: decision as RemoteDecision,
      });
      const label = accepted ? decisionLabels[decision as RemoteDecision] : 'Expired or not allowed';
      await this.call('answerCallbackQuery', { callback_query_id: query.id, text: label });
      if (accepted && message)
        await this.call('editMessageText', {
          chat_id: message.chat.id,
          message_id: message.message_id,
          text: `${message.text}\n\n${label}`,
          ...(message.entities ? { entities: message.entities } : {}),
        }).catch(() => undefined);
      return;
    }

    const message = update.message;
    if (!message?.from) return;
    const text: string = message.text ?? message.caption ?? '';
    const images: ImageInput[] = [];

    const photo = message.photo?.at(-1);
    if (photo) images.push({ data: await this.file(photo.file_id), mime: 'image/jpeg', width: photo.width, height: photo.height });
    if (message.document?.mime_type?.startsWith('image/'))
      images.push({ data: await this.file(message.document.file_id), mime: message.document.mime_type });

    const mention = this.username ? `@${this.username}` : '';
    const isPrivate = message.chat.type === 'private';
    this.emit({
      kind: 'message',
      target: { platform: 'telegram', chatId: String(message.chat.id) },
      userId: String(message.from.id),
      userName: message.from.username ? `@${message.from.username}` : message.from.first_name ?? 'pengguna',
      text: mention ? text.replace(mention, '').trim() : text.trim(),
      images,
      addressed: isPrivate || (Boolean(mention) && text.includes(mention)) || text.startsWith('/'),
    });
  }

  private async file(fileId: string): Promise<Buffer> {
    const file = await this.call<{ file_path: string }>('getFile', { file_id: fileId });
    return download(`${apiBase}/file/bot${this.token}/${file.file_path}`);
  }

  private async sendHtml(chatId: string, html: string, extra: Record<string, unknown> = {}): Promise<{ message_id: number }> {
    const base = { chat_id: chatId, link_preview_options: { is_disabled: true }, ...extra };
    try {
      return await this.call('sendMessage', { ...base, text: html, parse_mode: 'HTML' });
    } catch (error) {
      if (!/parse|entit|tag/i.test((error as Error).message)) throw error;
      return this.call('sendMessage', { ...base, text: htmlToPlain(html) });
    }
  }

  async send(chatId: string, text: string): Promise<void> {
    this.progress.delete(chatId);
    for (const chunk of toTelegramHtml(text)) await this.sendHtml(chatId, chunk);
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
    const html = toTelegramHtml(['**⚙️ Working…**', '', ...entry.lines.slice(-25)].join('\n'))[0]!;
    try {
      if (!entry.messageId) entry.messageId = (await this.sendHtml(chatId, html)).message_id;
      else await this.call('editMessageText', { chat_id: chatId, message_id: entry.messageId, text: html, parse_mode: 'HTML' });
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

  private async upload(method: string, form: FormData): Promise<void> {
    const res = await fetch(`${apiBase}/bot${this.token}/${method}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000)]),
    });
    const json = (await res.json()) as { ok: boolean; description?: string };
    if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed (HTTP ${res.status})`);
  }

  async sendImage(chatId: string, image: ImageInput, caption?: string): Promise<void> {
    this.progress.delete(chatId);
    const extension = image.mime.split('/')[1] ?? 'png';
    const build = (field: 'photo' | 'document') => {
      const form = new FormData();
      form.set('chat_id', chatId);
      if (caption) {
        form.set('caption', toTelegramHtml(caption, 1000)[0]!);
        form.set('parse_mode', 'HTML');
      }
      form.set(field, new Blob([new Uint8Array(image.data)], { type: image.mime }), `screenshot.${extension}`);
      return form;
    };
    if (image.data.length > 10 * 1024 * 1024) return this.upload('sendDocument', build('document'));
    try {
      await this.upload('sendPhoto', build('photo'));
    } catch {
      await this.upload('sendDocument', build('document'));
    }
  }

  async directChat(userId: string): Promise<string> {
    return userId;
  }

  async typing(chatId: string): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' });
  }

  async askApproval(chatId: string, approvalId: string, text: string): Promise<void> {
    const button = (label: string, decision: RemoteDecision) => ({ text: label, callback_data: `ap:${approvalId}:${decision}` });
    await this.sendHtml(chatId, toTelegramHtml(text, 3500)[0]!, {
      reply_markup: {
        inline_keyboard: [
          [button('✔ Allow', 'once'), button('✔ Always', 'always')],
          [button('✖ Deny', 'deny'), button('■ Stop', 'stop')],
        ],
      },
    });
  }
}
