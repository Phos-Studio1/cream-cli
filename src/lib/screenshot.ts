import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Screenshot = { data: Buffer; mime: 'image/png'; width?: number; height?: number };

export type ScreenScope = 'all' | 'primary';

const windowsCapture = (scope: ScreenScope) => `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace Native -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][Native.Dpi]::SetProcessDPIAware()
$bounds = ${scope === 'primary' ? '[System.Windows.Forms.Screen]::PrimaryScreen.Bounds' : '[System.Windows.Forms.SystemInformation]::VirtualScreen'}
$bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bitmap.Size)
$stream = New-Object System.IO.MemoryStream
$bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
[Console]::Out.Write((@{ width = $bounds.Width; height = $bounds.Height; data = [Convert]::ToBase64String($stream.ToArray()) } | ConvertTo-Json -Compress))
`;

function run(command: string, args: string[]): Promise<{ code: number | null; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout: Buffer.concat(out), stderr }));
  });
}

async function captureWindows(scope: ScreenScope): Promise<Screenshot> {
  const encoded = Buffer.from(windowsCapture(scope), 'utf16le').toString('base64');
  const { code, stdout, stderr } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encoded]);
  if (code !== 0) throw new Error(stderr.trim().split('\n').at(-1) || `PowerShell exited with code ${code}`);
  const json = JSON.parse(stdout.toString('utf8'));
  return { data: Buffer.from(json.data, 'base64'), mime: 'image/png', width: json.width, height: json.height };
}

async function captureUnix(): Promise<Screenshot> {
  const file = path.join(os.tmpdir(), `creamcli-shot-${Date.now()}.png`);
  const attempts: [string, string[]][] =
    process.platform === 'darwin'
      ? [['screencapture', ['-x', '-t', 'png', file]]]
      : [
          ['grim', [file]],
          ['gnome-screenshot', ['-f', file]],
          ['import', ['-window', 'root', file]],
        ];
  try {
    for (const [command, args] of attempts) {
      try {
        const { code } = await run(command, args);
        if (code === 0 && fs.existsSync(file)) return { data: fs.readFileSync(file), mime: 'image/png' };
      } catch {
        continue;
      }
    }
    throw new Error('No screenshot tool available (needs screencapture, grim, gnome-screenshot or ImageMagick).');
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export function captureScreen(scope: ScreenScope = 'all'): Promise<Screenshot> {
  return process.platform === 'win32' ? captureWindows(scope) : captureUnix();
}
