'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
} from 'recharts';
import {
  StatCell,
  ChartSection,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  PAPER_SERIES,
  PAPER_GRID,
} from './chart-primitives';
import type { ChartConfig } from './chart-primitives';
import type { AppointmentsAnalyticsData } from '@/lib/analytics-data';
import {
  SECTION_RHYTHM,
  STAT_NUMBER,
  TITLE_FONT,
  CAPTION,
  H3,
  BODY_MUTED,
} from '@/lib/typography';

const appointmentsOverTimeConfig = {
  count: { label: 'Appointments', color: 'hsl(var(--foreground))' },
} satisfies ChartConfig;

const appointmentsByStatusConfig = {
  Completed: { label: 'Completed', color: 'hsl(var(--foreground))' },
  Scheduled: { label: 'Scheduled', color: 'hsl(var(--foreground) / 0.7)' },
  Confirmed: { label: 'Confirmed', color: 'hsl(var(--foreground) / 0.55)' },
  Cancelled: { label: 'Cancelled', color: 'hsl(var(--muted-foreground) / 0.4)' },
  'No-show': { label: 'No-show', color: 'hsl(var(--muted-foreground) / 0.55)' },
  Pending: { label: 'Pending', color: 'hsl(var(--muted-foreground) / 0.25)' },
} satisfies ChartConfig;

// Status fills — outcome-ordered: Completed darkest (success), Cancelled lightest.
const STATUS_FILLS: Record<string, string> = {
  Completed: 'hsl(var(--foreground))',
  Scheduled: 'hsl(var(--foreground) / 0.7)',
  Confirmed: 'hsl(var(--foreground) / 0.55)',
  'No-show': 'hsl(var(--muted-foreground) / 0.55)',
  Cancelled: 'hsl(var(--muted-foreground) / 0.4)',
  Pending: 'hsl(var(--muted-foreground) / 0.25)',
};

export function AppointmentsView({ data }: { data: AppointmentsAnalyticsData }) {
  return (
    <div className={SECTION_RHYTHM}>
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-border/70 rounded-xl overflow-hidden border border-border/70">
        <StatCell label="Total appointments" value={data.totalAppointments} sub="all time" />
        <StatCell label="Completed" value={data.completedAppointments} sub="appointments finished" />
        <StatCell
          label="Cancelled / No-show"
          value={data.cancelledAppointments + data.noShowAppointments}
          sub={`${data.noShowAppointments} no-show`}
        />
        <StatCell
          label="Appointment-to-deal rate"
          value={data.completedAppointments > 0 ? `${data.appointmentConversionRate}%` : '--'}
          sub={`${data.appointmentsConvertedToDeals} converted`}
        />
      </div>

      {/* Charts */}
      <div className="grid sm:grid-cols-2 gap-4">
        <ChartSection title="Appointments over time" sub="Appointment bookings per month">
          <ChartContainer config={appointmentsOverTimeConfig} className="h-[220px] w-full">
            <AreaChart data={data.appointmentsOverTime}>
              <defs>
                <linearGradient id="appointmentsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke={PAPER_GRID} strokeDasharray="3 3" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} width={28} tick={{ fontSize: 11 }} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area
                type="monotone"
                dataKey="count"
                name="Appointments"
                stroke="var(--color-count)"
                fill="url(#appointmentsGrad)"
                strokeWidth={1.5}
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        </ChartSection>

        <ChartSection title="Appointments by status" sub="Breakdown of appointment outcomes">
          {data.appointmentsByStatus.length > 0 ? (
            <ChartContainer config={appointmentsByStatusConfig} className="h-[220px] w-full">
              <PieChart>
                <Pie
                  data={data.appointmentsByStatus}
                  dataKey="count"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                >
                  {data.appointmentsByStatus.map((entry, i) => (
                    <Cell
                      key={entry.label}
                      fill={STATUS_FILLS[entry.label] ?? PAPER_SERIES[i % PAPER_SERIES.length]}
                    />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent nameKey="label" hideLabel />} />
                <ChartLegend content={<ChartLegendContent nameKey="label" />} />
              </PieChart>
            </ChartContainer>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
              No appointment data yet.
            </div>
          )}
        </ChartSection>
      </div>

      {/* Conversion funnel */}
      <ChartSection title="Appointment conversion funnel" sub="From booked appointments to closed deals">
        <div className="flex flex-col sm:flex-row gap-4 items-stretch py-2">
          {[
            { label: 'Booked', count: data.totalAppointments },
            { label: 'Completed', count: data.completedAppointments },
            { label: 'Converted to deal', count: data.appointmentsConvertedToDeals },
          ].map((stage, i) => {
            const opacity = 1 - i * 0.15;
            const pct =
              data.totalAppointments > 0 && i > 0
                ? Math.round((stage.count / data.totalAppointments) * 100)
                : null;
            return (
              <div
                key={stage.label}
                className="flex-1 rounded-xl border border-border/70 bg-background px-5 py-4 flex sm:flex-col items-center sm:items-start gap-3 sm:gap-1"
              >
                <p
                  className={STAT_NUMBER}
                  style={{ ...TITLE_FONT, opacity }}
                >
                  {stage.count}
                </p>
                <div className="flex flex-col">
                  <p className={H3}>{stage.label}</p>
                  {pct != null && (
                    <p className={CAPTION}>{pct}% of booked</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ChartSection>

      {data.totalAppointments === 0 && (
        <div className="rounded-xl border border-border/70 bg-background px-6 py-12 text-center">
          <p className={BODY_MUTED}>
            Appointment analytics will appear here once appointments are scheduled and completed.
          </p>
        </div>
      )}
    </div>
  );
}
