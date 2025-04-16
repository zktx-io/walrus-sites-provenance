export const base64url = {
  fromNumber: (number: string): string => {
    const hex = BigInt(number).toString(16).padStart(64, '0');
    const bytes = new Uint8Array(32);

    // Little-endian
    for (let i = 0; i < 32; i++) {
      const byteHex = hex.slice((31 - i) * 2, (32 - i) * 2);
      bytes[i] = parseInt(byteHex, 16);
    }

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let base64 = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = bytes[i + 1] ?? 0;
      const c = bytes[i + 2] ?? 0;
      const triplet = (a << 16) | (b << 8) | c;

      base64 += chars[(triplet >> 18) & 0x3f];
      base64 += chars[(triplet >> 12) & 0x3f];
      base64 += i + 1 < bytes.length ? chars[(triplet >> 6) & 0x3f] : '=';
      base64 += i + 2 < bytes.length ? chars[triplet & 0x3f] : '=';
    }

    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  toNumber: (input: string): string => {
    const base64chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

    const cleanInput = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (cleanInput.length % 4)) % 4);
    const base64 = cleanInput + padding;

    const bytes: number[] = [];
    for (let i = 0; i < base64.length; i += 4) {
      const chunk = base64.slice(i, i + 4);
      const vals = chunk.split('').map(c => (c === '=' ? 0 : base64chars.indexOf(c)));

      const triplet = (vals[0] << 18) | (vals[1] << 12) | ((vals[2] ?? 0) << 6) | (vals[3] ?? 0);

      if (chunk[1] !== '=') bytes.push((triplet >> 16) & 0xff);
      if (chunk[2] !== '=') bytes.push((triplet >> 8) & 0xff);
      if (chunk[3] !== '=') bytes.push(triplet & 0xff);
    }

    while (bytes.length < 32) {
      bytes.push(0);
    }

    if (bytes.length !== 32) {
      throw new Error(`Expected 32 bytes, got ${bytes.length}`);
    }

    let result = 0n;
    for (let i = 0; i < 32; i++) {
      result += BigInt(bytes[i]) << BigInt(8 * i);
    }

    return result.toString();
  },
};
