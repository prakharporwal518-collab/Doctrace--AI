// Anomalies by rule, as a horizontal bar chart (Recharts).
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface AnomalyDatum {
  name: string;
  count: number;
  high: boolean;
}

export default function AnomalyChart({ data }: { data: AnomalyDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 38 + 20)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <XAxis type="number" allowDecimals={false} tick={{ fill: '#6f7a96', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={170} tick={{ fill: '#a1aac0', fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
          contentStyle={{ background: '#1e2640', border: '1px solid #2c3654', borderRadius: 8, color: '#e9edf6', fontSize: 12 }}
          formatter={(v) => [String(v), 'Anomalies']}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18} label={{ position: 'right', fill: '#e9edf6', fontSize: 12 }}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.high ? '#ff5d6c' : '#ff9f43'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
