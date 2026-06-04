import { describe, expect, it } from 'vitest';
import { decodeConsoleBuffer } from './decode-console-output.js';

describe('decodeConsoleBuffer', () => {
  it('keeps utf-8 output unchanged on non-windows paths', () => {
    const text = 'hello world';
    expect(decodeConsoleBuffer(Buffer.from(text, 'utf8'), 'linux')).toBe(text);
  });

  it('falls back to gb18030 on windows when utf-8 decoding produces replacement chars', () => {
    const buffer = Buffer.from([0x57,0x69,0x6e,0x64,0x6f,0x77,0x73,0x20,0x49,0x50,0x20,0xc5,0xe4,0xd6,0xc3]);
    expect(decodeConsoleBuffer(buffer, 'win32')).toBe('Windows IP 配置');
  });
});
