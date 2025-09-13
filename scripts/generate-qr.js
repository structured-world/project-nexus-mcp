import QRCode from 'qrcode';
import fs from 'fs';

const address = 'TFDsezHa1cBkoeZT5q2T49Wp66K8t2DmdA';

// Generate QR code as SVG
const qrCodeSVG = await QRCode.toString(address, {
  type: 'svg',
  width: 200,
  margin: 2,
  color: {
    dark: '#000000',
    light: '#FFFFFF'
  }
});

// Save to file
fs.writeFileSync('./docs/usdt-qr.svg', qrCodeSVG);
console.log('QR code generated successfully at ./docs/usdt-qr.svg');
console.log('Address encoded:', address);