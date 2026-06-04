export function decodeConsoleBuffer(buffer: Buffer, platform: NodeJS.Platform = process.platform): string {
  const utf8 = buffer.toString('utf8');
  if (platform !== 'win32') return utf8;
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    return utf8;
  }
}
