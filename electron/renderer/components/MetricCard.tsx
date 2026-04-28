export function MetricCard(props: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'good' | 'warning' | 'danger';
}) {
  return (
    <div className={`metric-card metric-card--${props.tone ?? 'neutral'}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      {props.detail != null ? <small>{props.detail}</small> : null}
    </div>
  );
}
