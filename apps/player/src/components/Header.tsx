import type { ChannelState } from '@ogp/protocol';

export function Header(props: {
  connected: boolean;
  channels: ChannelState[];
  programChannel: string | undefined;
  onProgramChannel: (id: string) => void;
  onHelp: () => void;
}) {
  const ch = props.channels.find((c) => c.id === props.programChannel);
  const outputs = ch?.renderers.filter((r) => !r.preview) ?? [];
  const rendererState = outputs.length === 0 ? 'warn' : outputs.every((r) => r.responsive) ? 'ok' : 'err';
  return (
    <header className="header">
      <div className="brand">OGraf <span>Player</span></div>
      <label className="header-field">
        Program
        <select value={props.programChannel ?? ''} onChange={(e) => props.onProgramChannel(e.target.value)}>
          {props.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <span className={`pill ${rendererState}`} title={outputs.map((r) => r.name ?? r.userAgent ?? r.sessionId).join('\n')}>
        {outputs.length === 0 ? 'no output renderer' : `${outputs.length} output${outputs.length > 1 ? 's' : ''}${rendererState === 'err' ? ' – not responding' : ''}`}
      </span>
      <span className="grow" />
      <a className="header-link" href={ch ? `/render/${encodeURIComponent(ch.id)}?debug=1&bg=checker` : '#'} target="_blank" rel="noreferrer">Open renderer ↗</a>
      <span className={`pill ${props.connected ? 'ok' : 'err'}`}>{props.connected ? 'server connected' : 'server disconnected'}</span>
      <button className="ghost" onClick={props.onHelp} title="Keyboard shortcuts (?)">⌨ ?</button>
    </header>
  );
}
