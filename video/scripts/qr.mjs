import {toFile} from 'qrcode';

await toFile('public/brand/qr-demo.png', 'ALMOX-ERP DEMONSTRACAO | A-03-02 | MAT-042', {
  width: 500,
  margin: 2,
  color: {dark: '#1b1c25', light: '#f9f6f4'},
});
