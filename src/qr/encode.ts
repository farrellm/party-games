import qrcode from 'qrcode-generator';

export type Matrix = {
  size: number;
  /** Row-major, `size * size` entries. */
  dark: boolean[];
};

/**
 * Error correction M. The payload already fits comfortably (§3.2), and party
 * lighting is bad enough that spending the headroom on redundancy beats
 * spending it on a smaller code.
 */
const ERROR_CORRECTION = 'M';

/**
 * Handshake payloads are base45, whose alphabet is exactly QR's alphanumeric
 * charset. Declaring the mode is what buys the density: 5.5 bits per character
 * instead of 8, which is the difference between a version 8 code and a version
 * 11 one.
 */
export function encodeQr(text: string): Matrix {
  const mode = /^[0-9A-Z $%*+\-./:]*$/.test(text) ? 'Alphanumeric' : 'Byte';

  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(text, mode);
  qr.make();

  const size = qr.getModuleCount();
  const dark: boolean[] = new Array(size * size);
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) dark[row * size + col] = qr.isDark(row, col);
  }

  return { size, dark };
}

/** Version 1 is 21 modules and each version adds 4. */
export function qrVersion(matrix: Matrix): number {
  return (matrix.size - 17) / 4;
}
