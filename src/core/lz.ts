// OWNER: core-data agent. Size-bounded inverse of lz-string's compressToEncodedURIComponent.
//
// lz-string's own decompressor has no output limit, and its output can grow quadratically with the
// input (a 20k-char share link can expand to 60M+ chars). This is a port of lz-string 1.5 `_decompress`
// for the URI-safe alphabet that gives up (null) as soon as the output passes `maxLength` chars.

const URI_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
const BITS_PER_CHAR = 6;
const REVERSE = new Map(Array.from(URI_ALPHABET, (ch, i) => [ch, i]));

/** Decompress an lz-string URI-component payload; null when invalid or longer than `maxLength` chars. */
export function decompressFromUriBounded(input: string, maxLength: number): string | null {
  const length = input.length;
  if (length === 0) return null;
  // Like lz-string: spaces are '+' mangled by form encoding; unknown characters read as 0.
  const valueAt = (i: number) => REVERSE.get(input.charAt(i) === ' ' ? '+' : input.charAt(i)) ?? 0;
  const resetBit = 1 << (BITS_PER_CHAR - 1);

  let val = valueAt(0);
  let position = resetBit;
  let index = 1;
  const readBits = (count: number): number => {
    let bits = 0;
    for (let power = 1, i = 0; i < count; i++, power *= 2) {
      const bit = val & position;
      position >>= 1;
      if (position === 0) {
        position = resetBit;
        val = valueAt(index++);
      }
      if (bit) bits += power;
    }
    return bits;
  };

  const dictionary: string[] = ['', '', ''];
  let dictSize = 4;
  let numBits = 3;
  let enlargeIn = 4;

  const first = readBits(2);
  if (first > 1) return null; // 2 = empty input, 3 = corrupt
  let w = String.fromCharCode(readBits(first === 0 ? 8 : 16));
  dictionary[3] = w;
  const result = [w];
  let total = w.length;

  for (;;) {
    if (index > length) return null; // ran out of input without an end marker
    let code = readBits(numBits);
    if (code === 2) return result.join('');
    if (code < 2) {
      dictionary[dictSize++] = String.fromCharCode(readBits(code === 0 ? 8 : 16));
      code = dictSize - 1;
      if (--enlargeIn === 0) {
        enlargeIn = 2 ** numBits;
        numBits++;
      }
    }

    let entry: string;
    if (code < dictSize && dictionary[code]) entry = dictionary[code];
    else if (code === dictSize) entry = w + w.charAt(0);
    else return null;

    total += entry.length;
    if (total > maxLength) return null;
    result.push(entry);

    dictionary[dictSize++] = w + entry.charAt(0);
    w = entry;
    if (--enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}
