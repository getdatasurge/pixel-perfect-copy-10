import { Helmet } from 'react-helmet-async';
import LoRaWANEmulator from '@/components/LoRaWANEmulator';

export default function DeviceEmulator() {
  return (
    <>
      <Helmet>
        <title>LoRaWAN Device Emulator</title>
        <meta name="description" content="Simulate LoRaWAN temperature, humidity, and door sensors for refrigerator and freezer monitoring" />
      </Helmet>
      <div className="min-h-screen bg-background">
        <LoRaWANEmulator />
      </div>
    </>
  );
}
