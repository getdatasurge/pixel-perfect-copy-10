

# Fix: Replace Placeholder QR Code with Real Scannable QR Code

## Problem
The QR code modal shows a fake visual pattern (manual canvas drawing) instead of a real, scannable QR code. The `qrcode` library is already in `package.json` but the component never imports or uses it.

## Solution

**File: `src/components/emulator/QRCodeModal.tsx`**

Replace the entire placeholder canvas drawing logic (lines 22-76) with the `qrcode` library's `toCanvas` method:

1. Add `import QRCode from 'qrcode';` at the top
2. Replace the `useEffect` body (lines 22-76) with:
   ```typescript
   const qrData = buildQRCodeData(device);
   QRCode.toCanvas(canvasRef.current, qrData, {
     width: 200,
     margin: 2,
     color: { dark: '#000000', light: '#ffffff' },
     errorCorrectionLevel: 'M',
   }).catch((err: Error) => {
     console.error('Failed to generate QR code:', err);
     toast({ title: 'QR Error', description: 'Failed to generate QR code', variant: 'destructive' });
   });
   ```
3. Remove the placeholder disclaimer text (lines 111-113): "Note: This is a visual placeholder..."

## Scope
Single file change: `src/components/emulator/QRCodeModal.tsx`. No new dependencies needed -- `qrcode` and `@types/qrcode` are already in `package.json`.

