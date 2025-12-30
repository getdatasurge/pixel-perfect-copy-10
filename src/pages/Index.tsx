import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Radio, Link2, ClipboardList, BarChart3 } from "lucide-react";

const Index = () => {
  const tools = [
    {
      title: "Device Emulator",
      description: "Simulate LoRaWAN temperature, humidity, and door sensors with TTN-compatible payloads",
      icon: Radio,
      href: "/device-emulator",
      available: true,
    },
    {
      title: "TTN Integration",
      description: "Configure The Things Network webhooks and application settings",
      icon: Link2,
      href: "#",
      available: false,
    },
    {
      title: "Sensor Registry",
      description: "Manage registered sensors, gateways, and device provisioning",
      icon: ClipboardList,
      href: "#",
      available: false,
    },
    {
      title: "Test Dashboard",
      description: "View test results, data flow validation, and multi-tenant isolation checks",
      icon: BarChart3,
      href: "#",
      available: false,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            FrostGuard Developer Tools
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Development and testing tools for LoRaWAN sensor integration, TTN webhook simulation, and multi-tenant data validation.
          </p>
        </div>
      </div>

      {/* Feature Cards */}
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const content = (
              <Card
                className={`relative transition-all duration-200 ${
                  tool.available
                    ? "hover:border-primary hover:shadow-lg cursor-pointer"
                    : "opacity-60 cursor-not-allowed"
                }`}
              >
                {!tool.available && (
                  <div className="absolute top-3 right-3">
                    <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-1 rounded">
                      Coming Soon
                    </span>
                  </div>
                )}
                <CardHeader className="space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{tool.title}</CardTitle>
                    <CardDescription className="mt-2">
                      {tool.description}
                    </CardDescription>
                  </div>
                </CardHeader>
              </Card>
            );

            return tool.available ? (
              <Link key={tool.title} to={tool.href}>
                {content}
              </Link>
            ) : (
              <div key={tool.title}>{content}</div>
            );
          })}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-border mt-auto">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          FrostGuard LoRaWAN Development Suite
        </div>
      </div>
    </div>
  );
};

export default Index;
