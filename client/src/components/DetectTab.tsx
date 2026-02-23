import { useState } from "react";
import { TabsContent } from "@/components/ui/tabs";
import type {
  DetectionEvent,
  AggregateStats,
  SkyflowEntity,
} from "@/lib/hooks/useDetection";
import { cn } from "@/lib/utils";
import {
  Shield,
  ShieldAlert,
  ShieldOff,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface DetectTabProps {
  events: DetectionEvent[];
  stats: AggregateStats;
}

function StatsPanel({ stats }: { stats: AggregateStats }) {
  const sensitivePercent =
    stats.totalScanned > 0
      ? Math.round((stats.totalDetected / stats.totalScanned) * 100)
      : 0;
  const cleanPercent = stats.totalScanned > 0 ? 100 - sensitivePercent : 0;

  return (
    <div className="p-4 rounded-lg border">
      {/* Hero stat */}
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-5 w-5 text-blue-500" />
        <span className="text-sm font-medium text-muted-foreground">
          Messages Scanned
        </span>
        <span className="text-3xl font-bold ml-auto">{stats.totalScanned}</span>
      </div>

      {/* Segmented proportion bar + labels */}
      {stats.totalScanned > 0 && (
        <>
          <div className="flex w-full h-3 rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 mb-2">
            {stats.totalDetected > 0 && (
              <div
                className="bg-amber-500 h-full transition-all"
                style={{ width: `${sensitivePercent}%` }}
              />
            )}
            {stats.totalClean > 0 && (
              <div
                className="bg-green-500 h-full transition-all"
                style={{ width: `${cleanPercent}%` }}
              />
            )}
          </div>

          <div className="flex justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-500" />
              <span className="font-medium">
                Sensitive: {stats.totalDetected} ({sensitivePercent}%)
              </span>
              {stats.totalBlocked > 0 && (
                <span className="text-red-600 dark:text-red-400 ml-2 flex items-center gap-0.5">
                  <ShieldOff className="h-3 w-3" />
                  {stats.totalBlocked} Blocked
                </span>
              )}
              {stats.totalTokenized > 0 && (
                <span className="text-blue-600 dark:text-blue-400 ml-2 flex items-center gap-0.5">
                  <Shield className="h-3 w-3" />
                  {stats.totalTokenized} Tokenized
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
              <span className="font-medium">
                Clean: {stats.totalClean} ({cleanPercent}%)
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EntityTable({ entities }: { entities: SkyflowEntity[] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="pb-1 pr-3 font-medium">Type</th>
            <th className="pb-1 pr-3 font-medium">Value</th>
            <th className="pb-1 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {entities.map((entity, idx) => {
            const topScore = Object.entries(entity.entity_scores).sort(
              ([, a], [, b]) => b - a,
            )[0];
            const scoreDisplay = topScore
              ? topScore[1] > 1
                ? `${Math.round(topScore[1])}%`
                : `${Math.round(topScore[1] * 100)}%`
              : "N/A";
            return (
              <tr
                key={idx}
                className="border-b border-gray-100 dark:border-gray-800"
              >
                <td className="py-1 pr-3">
                  <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200">
                    {entity.entity_type}
                  </span>
                </td>
                <td className="py-1 pr-3 font-mono break-all">
                  {entity.value}
                </td>
                <td className="py-1">{scoreDisplay}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <div
        className="flex items-center gap-1 cursor-pointer select-none"
        onClick={() => setOpen(!open)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(!open);
          }
        }}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h4>
      </div>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

function EventRow({ event }: { event: DetectionEvent }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(event.timestamp).toLocaleTimeString();
  const directionLabel =
    event.direction === "client-to-server"
      ? "Client \u2192 Server"
      : "Server \u2192 Client";
  const entityTypes = [
    ...new Set(event.result.entities.map((e) => e.entity_type)),
  ];

  return (
    <div
      className={`rounded text-xs font-mono border max-w-3xl ${
        event.blocked
          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950"
          : event.tokenized
            ? "border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950"
            : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950"
      }`}
    >
      {/* Summary line -- always visible, clickable */}
      <div
        className="flex items-center gap-2 p-2 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        )}
        <span className="text-muted-foreground">{time}</span>
        <span
          className={cn(
            "px-1.5 py-0.5 rounded text-[11px] font-medium",
            event.direction === "client-to-server"
              ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
              : "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
          )}
        >
          {directionLabel}
        </span>
        {event.blocked && (
          <span className="text-red-600 dark:text-red-400 font-semibold">
            BLOCKED
          </span>
        )}
        {event.tokenized && (
          <span className="text-blue-600 dark:text-blue-400 font-semibold">
            TOKENIZED
          </span>
        )}
        <span className="text-muted-foreground ml-auto">
          {event.result.entityCount} entit
          {event.result.entityCount === 1 ? "y" : "ies"}
        </span>
      </div>

      {/* Entity type tags -- always visible */}
      {entityTypes.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {entityTypes.map((type) => {
            const count = event.result.entities.filter(
              (e) => e.entity_type === type,
            ).length;
            return (
              <span
                key={type}
                className="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-[10px]"
              >
                {type}
                {count > 1 ? ` (${count})` : ""}
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded detail section */}
      {expanded && (
        <div className="border-t border-inherit p-3 space-y-3">
          <CollapsibleSection title="Original Text">
            <pre className="whitespace-pre-wrap break-words text-xs bg-white dark:bg-gray-900 p-2 rounded border max-h-40 overflow-auto">
              {event.result.originalText}
            </pre>
          </CollapsibleSection>

          <CollapsibleSection title="Processed Text">
            <pre className="whitespace-pre-wrap break-words text-xs bg-white dark:bg-gray-900 p-2 rounded border max-h-40 overflow-auto">
              {event.result.processedText}
            </pre>
          </CollapsibleSection>

          <CollapsibleSection
            title={`Detected Entities (${event.result.entities.length})`}
            defaultOpen={false}
          >
            <EntityTable entities={event.result.entities} />
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}

const DetectTab = ({ events, stats }: DetectTabProps) => {
  const topEntityTypes = Object.entries(stats.byType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  const sensitiveEvents = events.filter((e) => e.result.hasPii);

  return (
    <TabsContent value="detect" className="space-y-4">
      {/* Stats overview — 2-column on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Column 1: scan stats + direction */}
        <div className="space-y-4">
          <StatsPanel stats={stats} />

          {stats.totalScanned > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="text-xs text-blue-600 dark:text-blue-400 mb-1">
                  Client → Server
                </div>
                <div className="text-lg font-semibold">
                  {stats.byDirection.clientToServer}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-purple-200 dark:border-purple-800">
                <div className="text-xs text-purple-600 dark:text-purple-400 mb-1">
                  Server → Client
                </div>
                <div className="text-lg font-semibold">
                  {stats.byDirection.serverToClient}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Column 2: entity type breakdown */}
        {topEntityTypes.length > 0 && (
          <div className="p-3 rounded-lg border">
            <h3 className="text-sm font-semibold mb-2">
              Entity Types Detected
            </h3>
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
      </div>

      {/* Sensitive Messages */}
      <div className="p-3 rounded-lg border">
        <h3 className="text-sm font-semibold mb-2">
          Sensitive Messages ({sensitiveEvents.length})
        </h3>
        {sensitiveEvents.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {stats.totalScanned === 0
              ? "No detection events yet. Configure Skyflow credentials and connect to an MCP server to start scanning."
              : "No sensitive messages detected. All scanned messages are clean."}
          </p>
        ) : (
          <div className="space-y-2">
            {sensitiveEvents.slice(0, 50).map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        )}
      </div>
    </TabsContent>
  );
};

export default DetectTab;
