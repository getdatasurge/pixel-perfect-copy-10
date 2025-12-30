import { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Download } from 'lucide-react';
import { LoRaWANDevice, buildQRCodeData } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';

interface QRCodeModalProps {
  device: LoRaWANDevice | null;
  open: boolean;
  onClose: () => void;
}

export default function QRCodeModal({ device, open, onClose }: QRCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!device || !open || !canvasRef.current) return;

    const qrData = buildQRCodeData(device);
    
    // Simple QR-like visual representation (not a real QR code)
    // In production, use a library like 'qrcode' 
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 200;
    canvas.width = size;
    canvas.height = size;

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Generate pattern from data hash
    ctx.fillStyle = '#000000';
    const blockSize = 8;
    const blocks = size / blockSize;
    
    // Create deterministic pattern from qrData
    let hash = 0;
    for (let i = 0; i < qrData.length; i++) {
      hash = ((hash << 5) - hash + qrData.charCodeAt(i)) | 0;
    }
    
    for (let y = 0; y < blocks; y++) {
      for (let x = 0; x < blocks; x++) {
        // Corner patterns (finder patterns)
        const isCorner = 
          (x < 3 && y < 3) || 
          (x >= blocks - 3 && y < 3) || 
          (x < 3 && y >= blocks - 3);
        
        if (isCorner) {
          const inOuter = x < 3 ? x : blocks - 1 - x;
          const inY = y < 3 ? y : blocks - 1 - y;
          const isOuter = inOuter === 0 || inOuter === 2 || inY === 0 || inY === 2;
          const isInner = inOuter === 1 && inY === 1;
          if (isOuter || isInner) {
            ctx.fillRect(x * blockSize, y * blockSize, blockSize, blockSize);
          }
          continue;
        }
        
        // Data pattern
        const idx = y * blocks + x;
        const bit = ((hash >> (idx % 32)) ^ (hash >> ((idx + 7) % 32))) & 1;
        if (bit) {
          ctx.fillRect(x * blockSize, y * blockSize, blockSize, blockSize);
        }
      }
    }
  }, [device, open]);

  if (!device) return null;

  const qrData = buildQRCodeData(device);

  const copyData = async () => {
    await navigator.clipboard.writeText(qrData);
    toast({ title: 'Copied', description: 'QR data copied to clipboard' });
  };

  const downloadQR = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `${device.name.replace(/\s+/g, '-')}-qr.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
    toast({ title: 'Downloaded', description: 'QR code image saved' });
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Device QR Code</DialogTitle>
          <DialogDescription>
            Scan this code in your mobile app to claim {device.name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="bg-white p-4 rounded-lg shadow-inner">
            <canvas ref={canvasRef} className="w-48 h-48" />
          </div>
          
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            Note: This is a visual placeholder. In production, use a QR library for scannable codes.
          </p>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>QR Data (LoRaWAN Alliance Format)</Label>
            <div className="flex gap-2">
              <Input
                value={qrData}
                readOnly
                className="font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={copyData}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadQR} className="flex-1">
              <Download className="h-4 w-4 mr-2" />
              Download PNG
            </Button>
            <Button onClick={onClose} className="flex-1">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
