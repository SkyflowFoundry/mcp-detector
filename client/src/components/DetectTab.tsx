import { TabsContent } from "@/components/ui/tabs";
import type { DetectionEvent, AggregateStats } from "@/lib/hooks/useDetection";
import { Shield, ShieldAlert, ShieldOff, ShieldCheck } from "lucide-react";

interface DetectTabProps {
  events: DetectionEvent[];
  stats: AggregateStats;
}

function SummaryCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className={`p-3 rounded-lg border ${color}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

const DetectTab = ({ events, stats }: DetectTabProps) => {
  const topEntityTypes = Object.entries(stats.byType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  return (
    <TabsContent value="detect" className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard
          label="Messages Scanned"
          value={stats.totalScanned}
          icon={<Shield className="h-4 w-4 text-blue-500" />}
          color="border-blue-200 dark:border-blue-800"
        />
        <SummaryCard
          label="PII Detected"
          value={stats.totalDetected}
          icon={<ShieldAlert className="h-4 w-4 text-amber-500" />}
          color="border-amber-200 dark:border-amber-800"
        />
        <SummaryCard
          label="Messages Blocked"
          value={stats.totalBlocked}
          icon={<ShieldOff className="h-4 w-4 text-red-500" />}
          color="border-red-200 dark:border-red-800"
        />
        <SummaryCard
          label="Clean Messages"
          value={stats.totalClean}
          icon={<ShieldCheck className="h-4 w-4 text-green-500" />}
          color="border-green-200 dark:border-green-800"
        />
      </div>

      {/* Direction Breakdown */}
      {stats.totalScanned > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg border">
            <div className="text-xs text-muted-foreground mb-1">
              Client → Server
            </div>
            <div className="text-lg font-semibold">
              {stats.byDirection.clientToServer}
            </div>
          </div>
          <div className="p-3 rounded-lg border">
            <div className="text-xs text-muted-foreground mb-1">
              Server → Client
            </div>
            <div className="text-lg font-semibold">
              {stats.byDirection.serverToClient}
            </div>
          </div>
        </div>
      )}

      {/* Entity Type Breakdown */}
      {topEntityTypes.length > 0 && (
        <div className="p-3 rounded-lg border">
          <h3 className="text-sm font-semibold mb-2">Entity Types Detected</h3>
          <div className="space-y-1">
            {topEntityTypes.map(([type, count]) => {
              const maxCount = topEntityTypes[0][1];
              const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;
              return (
                <div key={type} className="flex items-center gap-2">
                  <span className="text-xs font-mono w-40 truncate text-muted-foreground">
                    {type}
                  </span>
                  <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                  <span className="text-xs font-mono w-8 text-right">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Events */}
      <div className="p-3 rounded-lg border">
        <h3 className="text-sm font-semibold mb-2">
          Recent Detection Events ({events.length})
        </h3>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No detection events yet. Configure Skyflow credentials and connect
            to an MCP server to start scanning.
          </p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-auto">
            {events.slice(0, 50).map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </TabsContent>
  );
};

function EventRow({ event }: { event: DetectionEvent }) {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const directionIcon = event.direction === "client-to-server" ? "→" : "←";
  const entityTypes = [
    ...new Set(event.result.entities.map((e) => e.entity_type)),
  ];

  return (
    <div
      className={`p-2 rounded text-xs font-mono border ${
        event.blocked
          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
          : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{time}</span>
        <span>{directionIcon}</span>
        {event.blocked && (
          <span className="text-red-600 dark:text-red-400 font-semibold">
            BLOCKED
          </span>
        )}
        <span className="text-muted-foreground">
          {event.result.entityCount} entit
          {event.result.entityCount === 1 ? "y" : "ies"}
        </span>
      </div>
      {entityTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {entityTypes.map((type) => (
            <span
              key={type}
              className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]"
            >
              {type}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default DetectTab;
