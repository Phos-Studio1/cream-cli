import { spawn } from 'node:child_process';

export type ClipboardContent =
  | { type: 'image'; data: Buffer; mime: string; width?: number; height?: number }
  | { type: 'text'; text: string }
  | { type: 'empty' };

const windowsReader = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$cb = [System.Windows.Forms.Clipboard]
function Emit($obj) { [Console]::Out.Write(($obj | ConvertTo-Json -Compress)) }
if ($cb::ContainsImage()) {
  $img = $cb::GetImage()
  $ms = New-Object System.IO.MemoryStream
  $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  Emit @{ type = 'image'; mime = 'image/png'; width = $img.Width; height = $img.Height; data = [Convert]::ToBase64String($ms.ToArray()) }
} elseif ($cb::ContainsFileDropList()) {
  $file = $cb::GetFileDropList() | Where-Object { $_ -match '\\.(png|jpe?g|gif|webp)$' } | Select-Object -First 1
  if ($file) {
    $ext = [IO.Path]::GetExtension($file).TrimStart('.').ToLower() -replace 'jpg', 'jpeg'
    Emit @{ type = 'image'; mime = "image/$ext"; data = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file)) }
  } else { Emit @{ type = 'empty' } }
} elseif ($cb::ContainsText()) {
  Emit @{ type = 'text'; data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($cb::GetText())) }
} else { Emit @{ type = 'empty' } }
`;

const windowsWriter = `
Add-Type -AssemblyName System.Windows.Forms
$text = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()))
[System.Windows.Forms.Clipboard]::SetText($text)
`;

function run(command: string, args: string[], input?: Buffer): Promise<{ code: number | null; stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => chunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(chunks) }));
    if (input) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function readWindows(): Promise<ClipboardContent> {
  const encoded = Buffer.from(windowsReader, 'utf16le').toString('base64');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded]);
  const json = JSON.parse(stdout.toString('utf8').trim() || '{"type":"empty"}');
  if (json.type === 'image')
    return { type: 'image', data: Buffer.from(json.data, 'base64'), mime: json.mime, width: json.width, height: json.height };
  if (json.type === 'text') return { type: 'text', text: Buffer.from(json.data, 'base64').toString('utf8') };
  return { type: 'empty' };
}

async function readUnix(): Promise<ClipboardContent> {
  const attempts: [string, string[], 'image' | 'text'][] =
    process.platform === 'darwin'
      ? [
          ['osascript', ['-e', 'set png to (the clipboard as «class PNGf»)', '-e', 'return png'], 'image'],
          ['pbpaste', [], 'text'],
        ]
      : [
          ['wl-paste', ['--type', 'image/png'], 'image'],
          ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], 'image'],
          ['wl-paste', ['--no-newline'], 'text'],
          ['xclip', ['-selection', 'clipboard', '-o'], 'text'],
        ];

  for (const [command, args, kind] of attempts) {
    try {
      const { code, stdout } = await run(command, args);
      if (code !== 0 || !stdout.length) continue;
      if (kind === 'text') return { type: 'text', text: stdout.toString('utf8') };
      if (process.platform === 'darwin') {
        const hex = stdout.toString('utf8').match(/«data PNGf([0-9A-F]+)»/i)?.[1];
        if (hex) return { type: 'image', data: Buffer.from(hex, 'hex'), mime: 'image/png' };
        continue;
      }
      return { type: 'image', data: stdout, mime: 'image/png' };
    } catch {
      continue;
    }
  }
  return { type: 'empty' };
}

export function readClipboard(): Promise<ClipboardContent> {
  return process.platform === 'win32' ? readWindows() : readUnix();
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      const encoded = Buffer.from(windowsWriter, 'utf16le').toString('base64');
      const input = Buffer.from(Buffer.from(text, 'utf8').toString('base64'));
      return (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded], input)).code === 0;
    }
    if (process.platform === 'darwin') return (await run('pbcopy', [], Buffer.from(text))).code === 0;
    for (const [command, args] of [
      ['wl-copy', []],
      ['xclip', ['-selection', 'clipboard']],
    ] as [string, string[]][]) {
      try {
        if ((await run(command, args, Buffer.from(text))).code === 0) return true;
      } catch {
        continue;
      }
    }
  } catch {
    return osc52(text);
  }
  return osc52(text);
}

function osc52(text: string): boolean {
  process.stdout.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
  return true;
}
