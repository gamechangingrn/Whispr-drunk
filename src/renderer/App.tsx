import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowRight, AudioLines, BookOpen, Check, ChevronDown,
  ChevronRight, CircleHelp, Copy, Download, FileText, History, Home,
  Keyboard, LoaderCircle, Mic, Minus, Monitor, Pencil, Plus,
  RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Square, SquarePen, Trash2, Upload, X,
} from 'lucide-react';
import { initialState, type AppState, type DictionaryEntry, type ModelState, type SessionMode, type SnippetEntry } from './bridge';

type Page = 'home' | 'history' | 'dictionary' | 'snippets' | 'models' | 'settings';
type Act = (action: string, payload?: unknown) => Promise<any>;
const navigation = [
  { id: 'home' as const, name: 'Home', icon: Home },
  { id: 'history' as const, name: 'History', icon: History },
  { id: 'dictionary' as const, name: 'Dictionary', icon: BookOpen },
  { id: 'snippets' as const, name: 'Snippets', icon: FileText },
];
const phaseLabels: Record<string, string> = { idle: 'Ready to listen', starting: 'Starting microphone', recording: 'Listening', finalizing: 'Transcribing', processing: 'Transcribing', formatting: 'Refining your words', inserting: 'Inserting text', complete: 'Dictation complete', error: 'Needs your attention', cancelled: 'Recording cancelled' };
const activePhases = new Set(['starting', 'recording', 'finalizing', 'processing', 'formatting', 'inserting']);
const busyPhases = new Set(['starting', 'finalizing', 'processing', 'formatting', 'inserting']);
const installingStates = new Set(['downloading', 'installing', 'verifying', 'setting-up', 'loading']);
const readyStates = new Set(['ready', 'installed', 'loaded', 'unloaded']);

function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'brand-small' : ''}`}><span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /><i /></span>{!small && <span>willfull<span className="brand-period">.</span></span>}</span>;
}

function Shortcut({ value, fallback = 'Not assigned' }: { value?: string; fallback?: string }) {
  if (!value) return <span className="shortcut-unset">{fallback}</span>;
  return <span className="shortcut" aria-label={value}>{value.split('+').map((key, i) => <kbd key={`${key}-${i}`}>{key.trim().replace('Control', 'Ctrl').replace('Super', 'Win')}</kbd>)}</span>;
}

function IconButton({ children, label, onClick, disabled = false, danger = false }: { children: ReactNode; label: string; onClick?: () => void; disabled?: boolean; danger?: boolean }) {
  return <button className={`icon-button ${danger ? 'danger' : ''}`} type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>{children}</button>;
}

function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p>{action}</div>;
}

function PageHeader({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className="page-header"><div><h1>{title}</h1><p>{description}</p></div>{children && <div className="page-actions">{children}</div>}</header>;
}

function SearchBox({ value, setValue, placeholder }: { value: string; setValue: (value: string) => void; placeholder: string }) {
  return <label className="search-box"><Search size={16} /><input value={value} onChange={event => setValue(event.target.value)} placeholder={placeholder} aria-label={placeholder} />{value && <button onClick={() => setValue('')} aria-label="Clear search" type="button"><X size={14} /></button>}</label>;
}

function Toggle({ checked, onChange, disabled = false, label }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label: string }) {
  return <button className="toggle" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} type="button"><span /></button>;
}

function StatusPill({ status, readyLabel = 'Ready' }: { status: string; readyLabel?: string }) {
  const isReady = readyStates.has(status);
  const working = installingStates.has(status);
  return <span className={`status-pill ${isReady ? 'positive' : status === 'error' ? 'negative' : ''}`}>{working ? <LoaderCircle size={12} className="spin" /> : <span className="status-dot" />}{status === 'unloaded' ? 'Installed · idle' : isReady ? readyLabel : working ? 'Setting up' : status === 'error' ? 'Setup failed' : status === 'unknown' ? 'Unavailable' : 'Not installed'}</span>;
}

export default function App() {
  const [state, setState] = useState<AppState>(initialState);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<Page>('home');
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const overlay = new URLSearchParams(window.location.search).has('overlay');

  const notify = useCallback((message: string, error = false) => {
    setNotice({ message, error });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), error ? 8000 : 3500);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('overlay-document', overlay);
    const bridge = window.willfull;
    if (!bridge) { setLoading(false); return; }
    let mounted = true;
    bridge.getState().then(next => { if (mounted) { setState(next); setConnected(true); } }).catch(error => { if (mounted) notify(error.message || 'Could not connect to the desktop service.', true); }).finally(() => { if (mounted) setLoading(false); });
    const unsubscribe = bridge.onState(next => { if (mounted) { setState(next); setConnected(true); } });
    return () => { mounted = false; unsubscribe(); };
  }, [notify, overlay]);

  const act = useCallback<Act>(async (action, payload) => {
    if (!window.willfull) { notify('Open Willfull on your desktop to use this control.', true); return undefined; }
    setPending(action);
    try {
      const response = await window.willfull.invoke(action, payload);
      if (response?.error) throw new Error(response.error);
      return response;
    } catch (error) { notify(error instanceof Error ? error.message : 'That action did not finish. Please try again.', true); return undefined; }
    finally { setPending(null); }
  }, [notify]);

  if (overlay) return <RecordingOverlay state={state} act={act} connected={connected} />;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-area"><Brand /></div>
      <nav aria-label="Main navigation">{navigation.map(item => <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`} onClick={() => setPage(item.id)}><item.icon size={18} strokeWidth={1.75} /><span>{item.name}</span>{item.id === 'history' && state.history.length > 0 && <span className="nav-count">{state.history.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom">
        <button className={`model-nav ${page === 'models' ? 'selected' : ''}`} onClick={() => setPage('models')}><span className="model-nav-icon"><AudioLines size={19} /></span><span><strong>Local models</strong><small>{readyStates.has(state.models.speech.status) ? 'Speech model ready' : 'Manage your engines'}</small></span><ChevronRight size={15} /></button>
        <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => setPage('settings')}><Settings2 size={18} strokeWidth={1.75} /><span>Settings</span></button>
        <div className="sidebar-foot"><ShieldCheck size={14} /><span>Made to stay on your device</span></div>
      </div>
    </aside>
    <div className="workspace">
      <div className="titlebar"><span className="breadcrumb">Workspace <ChevronRight size={12} /> <span>{page === 'models' ? 'Local models' : page.charAt(0).toUpperCase() + page.slice(1)}</span></span><div className="titlebar-right"><span className="local-label"><span />Local processing</span>{window.willfull && <div className="window-controls"><button aria-label="Minimize window" onClick={() => act('window:minimize')}><Minus size={13} /></button><button aria-label="Maximize window" onClick={() => act('window:maximize')}><Square size={11} /></button><button aria-label="Close window" onClick={() => act('window:close')}><X size={14} /></button></div>}</div></div>
      <main className="main-content">
        {!connected && !loading && <div className="connection-notice"><Monitor size={17} /><div><strong>Desktop preview</strong><span>Microphone, model setup, and saved data are available in the desktop app.</span></div></div>}
        {loading ? <div className="loading-shell" aria-label="Loading desktop state"><span /><span /><span /></div> : <>
          {page === 'home' && <HomePage state={state} act={act} connected={connected} pending={pending} navigate={setPage} notify={notify} />}
          {page === 'history' && <HistoryPage state={state} act={act} connected={connected} notify={notify} navigate={setPage} />}
          {page === 'dictionary' && <DictionaryPage state={state} act={act} connected={connected} pending={pending} />}
          {page === 'snippets' && <SnippetsPage state={state} act={act} connected={connected} pending={pending} />}
          {page === 'models' && <ModelsPage state={state} act={act} connected={connected} pending={pending} />}
          {page === 'settings' && <SettingsPage state={state} act={act} connected={connected} />}
        </>}
      </main>
      <footer className="statusbar"><span><span className={`connection-dot ${connected ? 'connected' : ''}`} />{connected ? 'Desktop connected' : loading ? 'Connecting to desktop…' : 'Preview · desktop not connected'}</span><span>English <span className="statusbar-divider" />{state.metrics.appRamMb != null ? `${Math.round(state.metrics.appRamMb)} MB app memory` : 'Memory measured in desktop app'}</span></footer>
    </div>
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{notice.message}</span><button aria-label="Dismiss notification" onClick={() => setNotice(null)}><X size={15} /></button></div>}
    {state.commandPreview && <CommandPreview state={state} act={act} pending={pending} />}
  </div>;
}

function HomePage({ state, act, connected, pending, navigate, notify }: { state: AppState; act: Act; connected: boolean; pending: string | null; navigate: (page: Page) => void; notify: (text: string, error?: boolean) => void }) {
  const [selectedMode, setMode] = useState<SessionMode>('dictation');
  const [practice, setPractice] = useState('');
  const [formatted, setFormatted] = useState('');
  const recording = state.session.phase === 'recording';
  const active = activePhases.has(state.session.phase);
  const mode = active ? state.session.mode : selectedMode;
  const busy = busyPhases.has(state.session.phase);
  const speechReady = readyStates.has(state.models.speech.status);
  const editorReady = readyStates.has(state.models.editor.status);
  const result = recording ? state.session.partial : state.session.result || state.session.partial || '';
  const canRecord = connected && state.metrics.nativeReady !== false && speechReady && (mode !== 'command' || editorReady);
  const phaseText = active ? phaseLabels[state.session.phase] || state.session.phase : !connected ? 'Desktop controls unavailable' : !speechReady ? 'Your speech model needs setup' : phaseLabels[state.session.phase] || 'Ready to listen';

  async function formatPractice(event: FormEvent) {
    event.preventDefault();
    const response = await act('playground:transcribe', { text: practice });
    if (response !== undefined) setFormatted(typeof response === 'string' ? response : response.text || response.result || '');
  }

  return <div className="page home-page">
    <PageHeader title="A little less typing." description="Speak naturally. Keep your train of thought."><span className="quiet-label"><ShieldCheck size={15} />Your words stay here</span></PageHeader>
    {connected && !state.settings.onboardingComplete && <div className="setup-guide"><span className="setup-guide-icon"><AudioLines size={21} /></span><div><strong>{speechReady ? 'Your voice has a new home.' : 'A minute of setup. A lot less typing.'}</strong><p>{speechReady ? 'Your speech model is installed. Choose a microphone in Settings, then try your shortcut in another app.' : 'Start by installing the speech model, then choose your microphone and try a dictation.'}</p></div>{speechReady ? <button className="button secondary small" onClick={() => act('settings:update', { onboardingComplete: true })}><Check size={13} />Got it</button> : <button className="button secondary small" onClick={() => navigate('models')}>Set up models <ArrowRight size={13} /></button>}</div>}
    <div className="dictation-workspace">
      <div className="dictation-toolbar"><div className="segmented" aria-label="Recording mode"><button className={mode === 'dictation' ? 'selected' : ''} onClick={() => setMode('dictation')} disabled={active}><Mic size={15} />Dictate</button><button className={mode === 'command' ? 'selected' : ''} onClick={() => setMode('command')} disabled={active}><Sparkles size={15} />Edit selection</button></div><button className="text-button subdued" onClick={() => navigate('settings')}><SlidersHorizontal size={15} />{state.settings.mode === 'clean' ? 'Clean' : 'Literal'}<ChevronDown size={13} /></button></div>
      <div className={`capture-area ${recording ? 'is-recording' : ''}`}>
        <div className="capture-intro"><div className="mic-symbol">{busy ? <LoaderCircle size={25} className="spin" /> : mode === 'command' ? <Sparkles size={25} strokeWidth={1.6} /> : <Mic size={27} strokeWidth={1.6} />}</div><h2>{recording ? 'Go on, we’re listening.' : busy ? phaseText : mode === 'command' ? 'Say what you’d like to change.' : 'Put your voice to work.'}</h2><p>{mode === 'command' ? 'Select text in another app, then use your edit shortcut.' : 'Place your cursor in any app, hold your shortcut, and speak.'}</p></div>
        <div className={`waveform ${recording ? 'live' : ''}`} aria-label={recording ? 'Microphone audio level' : 'Microphone inactive'}>{Array.from({ length: 33 }, (_, i) => <span key={i} style={{ height: `${recording ? 5 + Math.max(0, Math.min(1, state.session.level || 0)) * (14 + (Math.sin(i * 1.7) + 1) * 19) : 4 + (Math.sin(i * 0.63) + 1) * (i > 8 && i < 25 ? 9 : 3)}px`, opacity: recording ? 0.45 + ((i * 7) % 10) / 18 : i > 8 && i < 25 ? 0.55 : 0.3 }} />)}</div>
        <div className="capture-actions">{recording ? <><button className="button primary" onClick={() => act('stop')}><Square size={14} fill="currentColor" />Finish {mode === 'command' ? 'instruction' : 'dictation'}</button><button className="button secondary" onClick={() => act('cancel')}>Cancel <kbd>Esc</kbd></button></> : <button className="button primary record-button" disabled={!canRecord || busy || pending === 'start'} onClick={() => act('start', { mode })}>{busy || pending === 'start' ? <LoaderCircle size={17} className="spin" /> : <Mic size={17} />}{busy ? 'Processing…' : mode === 'command' ? 'Record an instruction' : 'Start dictation'}</button>}</div>
        <div className="capture-shortcut">{active ? <><span className="status-dot recording-dot" />{phaseText}</> : <><span>or hold</span><Shortcut value={mode === 'command' ? state.settings.commandHotkey : state.settings.hotkey} fallback="your desktop shortcut" /></>}</div>
        {state.session.error && <div className="inline-error" role="alert">{state.session.error}</div>}
        {connected && !speechReady && !active && <button className="setup-link" onClick={() => navigate('models')}>Set up Phonon-2 to start dictating <ArrowRight size={14} /></button>}
        {connected && mode === 'command' && !editorReady && speechReady && <button className="setup-link" onClick={() => navigate('models')}>Set up the local editor for voice instructions <ArrowRight size={14} /></button>}
      </div>
      <div className="transcript-area"><div className="section-label"><span>{recording ? 'Live transcript' : 'Latest dictation'}</span>{state.session.result && <button className="text-button" onClick={async () => { const r = await act('result:copy'); if (r !== undefined) notify('Transcript copied.'); }}><Copy size={13} />Copy</button>}</div><div className={`transcript-text ${result ? '' : 'placeholder'}`} aria-live="polite">{result || 'Your words will appear here. A finished dictation is inserted into your active app.'}</div>{state.session.targetName && <div className="target-label"><Monitor size={12} />{state.session.targetName}</div>}{state.session.notice && <div className="session-notice"><CircleHelp size={13} /><span>{state.session.notice}</span></div>}</div>
    </div>
    <div className="home-lower"><div className="shortcut-guide"><h3>Make it second nature</h3><div><span>Hold to speak</span><Shortcut value={state.settings.hotkey} /></div><div><span>Speak hands-free</span><Shortcut value={state.settings.toggleHotkey} /></div><div><span>Edit selected text</span><Shortcut value={state.settings.commandHotkey} /></div><button className="text-button" onClick={() => navigate('settings')}>Customize shortcuts <ArrowRight size={13} /></button></div><form className="practice-panel" onSubmit={formatPractice}><div className="practice-heading"><h3>A place to try your words</h3><span>Formatting only</span></div><textarea value={practice} onChange={event => { setPractice(event.target.value); setFormatted(''); }} placeholder="Type a phrase to try your dictionary, snippets, and cleanup…" aria-label="Formatting playground" rows={2} /><div className="practice-bottom"><span>Uses your current dictation settings.</span><button className="button small secondary" disabled={!connected || !practice.trim() || pending === 'playground:transcribe'}>{pending === 'playground:transcribe' ? <LoaderCircle size={13} className="spin" /> : <ArrowRight size={13} />}Try it</button></div>{formatted && <div className="practice-result" aria-live="polite"><Check size={14} /><span>{formatted}</span></div>}</form></div>
  </div>;
}

function HistoryPage({ state, act, connected, notify, navigate }: { state: AppState; act: Act; connected: boolean; notify: (message: string, error?: boolean) => void; navigate: (page: Page) => void }) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [clearConfirm, setClearConfirm] = useState(false);
  const entries = state.history.filter(item => `${item.text} ${item.raw} ${item.app}`.toLowerCase().includes(search.toLowerCase()));
  const grouped = entries.reduce<Record<string, typeof entries>>((groups, entry) => { const date = new Date(entry.createdAt).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); (groups[date] ||= []).push(entry); return groups; }, {});
  return <div className="page"><PageHeader title="Your words, within reach." description="Revisit, copy, and recover dictations saved on this device.">{state.history.length > 0 && <button className="button secondary small" onClick={() => setClearConfirm(true)}><Trash2 size={14} />Clear history</button>}</PageHeader>
    {connected && !state.settings.historyEnabled && <div className="info-strip"><History size={17} /><span>History is off. New dictations won’t be saved.</span><button className="text-button" onClick={() => navigate('settings')}>Change in settings <ArrowRight size={13} /></button></div>}
    {clearConfirm && <div className="confirm-strip" role="alert"><span>Delete all {state.history.length} saved dictations? This can’t be undone.</span><button className="button small secondary" onClick={() => setClearConfirm(false)}>Keep history</button><button className="button small destructive" onClick={async () => { await act('history:clear'); setClearConfirm(false); }}>Delete all</button></div>}
    <div className="list-toolbar"><SearchBox value={search} setValue={setSearch} placeholder="Search your dictations" /><span className="result-count">{entries.length} {entries.length === 1 ? 'dictation' : 'dictations'}</span></div>
    {entries.length ? <div className="history-groups">{Object.entries(grouped).map(([date, items]) => <section key={date}><h2 className="date-heading">{date}</h2>{items.map(entry => <article className="history-entry" key={entry.id}><div className="history-meta"><span>{new Date(entry.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span><span className="history-app"><Monitor size={12} />{entry.app || 'Desktop'}</span><span className="history-mode">{entry.mode === 'clean' ? 'Clean' : 'Literal'}</span><div className="row-actions"><IconButton label="Copy dictation" onClick={async () => { const r = await act('history:copy', { id: entry.id }); if (r !== undefined) notify('Dictation copied.'); }}><Copy size={15} /></IconButton><IconButton label="Delete dictation" danger onClick={() => act('history:delete', { id: entry.id })}><Trash2 size={15} /></IconButton></div></div><p>{entry.text}</p>{entry.raw !== entry.text && <><button className="text-button subtle" onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}><ChevronRight className={expanded === entry.id ? 'rotated' : ''} size={13} />Original transcript</button>{expanded === entry.id && <p className="original-transcript">{entry.raw}</p>}</>}</article>)}</section>)}</div> : <EmptyState icon={<History size={26} strokeWidth={1.5} />} title={search ? 'No matching dictations' : 'Your next thought starts here.'}>{search ? 'Try a different word, phrase, or application name.' : !connected ? 'Saved dictations will appear when you open the desktop app.' : 'Turn on history in Settings to keep a searchable record of your dictations.'}</EmptyState>}
  </div>;
}

function DictionaryPage({ state, act, connected, pending }: { state: AppState; act: Act; connected: boolean; pending: string | null }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<DictionaryEntry> | null>(null);
  const writtenRef = useRef<HTMLInputElement>(null);
  const entries = state.dictionary.filter(entry => `${entry.heard} ${entry.written}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => { if (editing) writtenRef.current?.focus(); }, [editing?.id, Boolean(editing)]);
  async function save(event: FormEvent) { event.preventDefault(); if (!editing?.written?.trim()) return; const r = await act('dictionary:save', { ...editing, heard: (editing.heard || editing.written).trim(), written: editing.written.trim() }); if (r !== undefined) setEditing(null); }
  return <div className="page"><PageHeader title="Words that sound like you." description="Keep names, acronyms, and the terms you use spelled your way."><button className="button primary" disabled={!connected} onClick={() => setEditing({ heard: '', written: '' })}><Plus size={16} />Add a word</button></PageHeader>
    {editing && <form className="entry-editor" onSubmit={save}><div className="entry-editor-title"><h2>{editing.id ? 'Edit word' : 'Add to your dictionary'}</h2><IconButton label="Cancel editing" onClick={() => setEditing(null)}><X size={17} /></IconButton></div><div className="dictionary-fields"><label>Preferred spelling<input ref={writtenRef} value={editing.written || ''} maxLength={120} placeholder="e.g. Willfull" onChange={event => setEditing({ ...editing, written: event.target.value })} required /></label><label>Replace this spelling <span className="field-optional">optional</span><input value={editing.heard || ''} maxLength={120} placeholder="e.g. will full" onChange={event => setEditing({ ...editing, heard: event.target.value })} /></label></div><div className="editor-footer"><p>Replacements match whole words and keep your preferred spelling.</p><button className="button primary small" disabled={!editing.written?.trim() || pending === 'dictionary:save'}>{pending === 'dictionary:save' ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Save word</button></div></form>}
    <div className="list-toolbar"><SearchBox value={search} setValue={setSearch} placeholder="Search dictionary" /><div className="toolbar-actions"><button className="text-button" disabled={!connected} onClick={() => act('dictionary:import')}><Upload size={14} />Import</button><button className="text-button" disabled={!connected || !state.dictionary.length} onClick={() => act('dictionary:export')}><ArrowDownToLine size={14} />Export</button><span className="result-count">{entries.length} {entries.length === 1 ? 'word' : 'words'}</span></div></div>
    {entries.length ? <div className="data-table dictionary-table"><div className="table-head"><span>Preferred spelling</span><span>Replaces</span><span /></div>{entries.map(entry => <div className="table-row" key={entry.id}><strong>{entry.written}</strong><span className={entry.heard ? '' : 'muted'}>{entry.heard || 'Term only'}</span><div className="row-actions"><IconButton label={`Edit ${entry.written}`} onClick={() => setEditing(entry)}><Pencil size={15} /></IconButton><IconButton label={`Delete ${entry.written}`} danger onClick={() => act('dictionary:delete', { id: entry.id })}><Trash2 size={15} /></IconButton></div></div>)}</div> : <EmptyState icon={<BookOpen size={27} strokeWidth={1.5} />} title={search ? 'No matching words' : 'Give your vocabulary a home.'}>{search ? 'Try a different spelling or clear your search.' : 'Add a name or a term you use often. Add a replacement when the same misspelling keeps coming back.'}</EmptyState>}
    <div className="page-footnote"><CircleHelp size={14} /><span>Your dictionary applies to dictation after recognition. It doesn’t train the speech model.</span></div>
  </div>;
}

function SnippetsPage({ state, act, connected, pending }: { state: AppState; act: Act; connected: boolean; pending: string | null }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<SnippetEntry> | null>(null);
  const triggerRef = useRef<HTMLInputElement>(null);
  const entries = state.snippets.filter(entry => `${entry.trigger} ${entry.text}`.toLowerCase().includes(search.toLowerCase()));
  useEffect(() => { if (editing) triggerRef.current?.focus(); }, [editing?.id, Boolean(editing)]);
  async function save(event: FormEvent) { event.preventDefault(); if (!editing?.trigger?.trim() || !editing?.text?.trim()) return; const r = await act('snippets:save', { ...editing, trigger: editing.trigger.trim(), text: editing.text }); if (r !== undefined) setEditing(null); }
  return <div className="page"><PageHeader title="Say a little. Write a lot." description="Turn a spoken phrase into the text you reach for again and again."><button className="button primary" disabled={!connected} onClick={() => setEditing({ trigger: '', text: '' })}><Plus size={16} />New snippet</button></PageHeader>
    {editing && <form className="entry-editor" onSubmit={save}><div className="entry-editor-title"><h2>{editing.id ? 'Edit snippet' : 'Create a voice shortcut'}</h2><IconButton label="Cancel editing" onClick={() => setEditing(null)}><X size={17} /></IconButton></div><label>When I say<input ref={triggerRef} value={editing.trigger || ''} maxLength={120} placeholder="e.g. my email signature" onChange={event => setEditing({ ...editing, trigger: event.target.value })} required /></label><label>Write this<textarea rows={4} value={editing.text || ''} maxLength={20000} placeholder="The exact text you’d like to insert…" onChange={event => setEditing({ ...editing, text: event.target.value })} required /></label><div className="editor-footer"><p>Pick a distinctive phrase. Your expansion keeps its exact wording.</p><button className="button primary small" disabled={!editing.trigger?.trim() || !editing.text?.trim() || pending === 'snippets:save'}>{pending === 'snippets:save' ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Save snippet</button></div></form>}
    <div className="list-toolbar"><SearchBox value={search} setValue={setSearch} placeholder="Search snippets" /><div className="toolbar-actions"><button className="text-button" disabled={!connected} onClick={() => act('snippets:import')}><Upload size={14} />Import</button><button className="text-button" disabled={!connected || !state.snippets.length} onClick={() => act('snippets:export')}><ArrowDownToLine size={14} />Export</button><span className="result-count">{entries.length} {entries.length === 1 ? 'snippet' : 'snippets'}</span></div></div>
    {entries.length ? <div className="snippet-list">{entries.map(entry => <article className="snippet-entry" key={entry.id}><div className="snippet-trigger"><span className="quote-mark">“</span>{entry.trigger}<span className="quote-mark">”</span><ArrowRight size={15} /><div className="row-actions"><IconButton label={`Edit ${entry.trigger}`} onClick={() => setEditing(entry)}><Pencil size={15} /></IconButton><IconButton label={`Delete ${entry.trigger}`} danger onClick={() => act('snippets:delete', { id: entry.id })}><Trash2 size={15} /></IconButton></div></div><p>{entry.text}</p></article>)}</div> : <EmptyState icon={<FileText size={27} strokeWidth={1.5} />} title={search ? 'No matching snippets' : 'The things you say on repeat, simplified.'}>{search ? 'Search for a trigger phrase or a word in its expansion.' : 'Save an email signature, a quick reply, or a favorite prompt. Then speak its trigger during dictation.'}</EmptyState>}
  </div>;
}

function ModelsPage({ state, act, connected, pending }: { state: AppState; act: Act; connected: boolean; pending: string | null }) {
  return <div className="page"><PageHeader title="Small engines. All yours." description="Set up your local models once, then work without a connection." />
    <div className="model-list"><ModelRow model={state.models.speech} kind="speech" title={state.models.speech.name || 'Phonon-2'} subtitle="Speech recognition" description="Fermion’s English speech model turns your microphone audio into text. This is the engine behind every dictation." icon={<AudioLines size={26} strokeWidth={1.5} />} connected={connected} pending={pending} act={act} /><ModelRow model={state.models.editor} kind="editor" title={state.models.editor.name || 'Local text editor'} subtitle="Cleanup & voice instructions" description="Refine dictations and edit selected text with a separate local language model. Literal dictation works without it." icon={<Sparkles size={25} strokeWidth={1.5} />} connected={connected} pending={pending} act={act} /></div>
    <section className="resource-section"><div><h2>On this machine</h2><p>Live readings from the desktop app.</p></div><dl><div><dt>Application memory</dt><dd>{state.metrics.appRamMb != null ? `${Math.round(state.metrics.appRamMb)} MB` : 'Not measured yet'}</dd></div><div><dt>Speech worker</dt><dd>{state.metrics.speechRamMb != null ? `${Math.round(state.metrics.speechRamMb)} MB` : 'Not measured yet'}</dd></div><div><dt>Graphics processor</dt><dd>{state.metrics.gpuName || 'Not reported'}</dd></div></dl></section>
    <div className="local-explainer"><ShieldCheck size={21} /><div><h3>A one-time connection. A local workflow.</h3><p>Model setup downloads the files needed for processing. Your recordings and text are processed on this computer. Setup progress and any failures appear here.</p></div></div>
  </div>;
}

function ModelRow({ model, kind, title, subtitle, description, icon, connected, pending, act }: { model: ModelState; kind: 'speech' | 'editor'; title: string; subtitle: string; description: string; icon: ReactNode; connected: boolean; pending: string | null; act: Act }) {
  const installing = installingStates.has(model.status);
  const ready = readyStates.has(model.status);
  const action = kind === 'speech' ? 'models:setupSpeech' : 'models:setupEditor';
  const progress = model.progress == null ? null : Math.max(0, Math.min(100, model.progress <= 1 ? model.progress * 100 : model.progress));
  return <section className="model-row"><div className="model-symbol">{icon}</div><div className="model-detail"><span className="model-category">{subtitle}</span><div className="model-title"><h2>{title}</h2><StatusPill status={connected ? model.status : 'unknown'} /></div><p>{description}</p>{installing && <div className="download-progress"><div className={`progress-track ${progress == null ? 'indeterminate' : ''}`} role="progressbar" aria-label={`${title} setup progress`} aria-valuenow={progress ?? undefined} aria-valuemin={0} aria-valuemax={100}><span style={{ width: progress == null ? '35%' : `${progress}%` }} /></div><span>{progress != null ? `${Math.round(progress)}%` : 'Preparing…'}</span></div>}{model.message && <div className={`model-message ${model.status === 'error' ? 'error-text' : ''}`}>{model.message}</div>}{model.size && <span className="model-size">{model.size} model files</span>}</div><div className="model-action">{installing ? <button className="button secondary small" onClick={() => act('models:cancel', { model: kind })}>Cancel</button> : ready ? <span className="model-installed"><Check size={16} />Installed</span> : <button className="button primary small" disabled={!connected || pending === action} onClick={() => act(action)}>{pending === action ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />}{model.status === 'error' ? 'Try setup again' : 'Set up model'}</button>}</div></section>;
}

function SettingsPage({ state, act, connected }: { state: AppState; act: Act; connected: boolean }) {
  const update = (settings: Partial<AppState['settings']>) => act('settings:update', settings);
  return <div className="page settings-page"><PageHeader title="Make room for your flow." description="A few preferences. A workflow that feels like yours." />
    <section className="settings-section"><div className="settings-section-title"><Mic size={18} /><h2>Microphone</h2></div><div className="settings-row"><div><label htmlFor="audio-device">Input device</label><p>Choose the microphone used for dictation.</p></div><div className="device-select"><select id="audio-device" value={state.settings.deviceId || '-1'} disabled={!connected} onChange={event => update({ deviceId: event.target.value })}><option value="-1">System default microphone</option>{state.devices.filter(device => device.id !== '-1').map(device => <option value={device.id} key={device.id}>{device.name}</option>)}</select><IconButton label="Refresh microphone devices" disabled={!connected} onClick={() => act('devices:refresh')}><RefreshCw size={15} /></IconButton></div></div></section>
    <section className="settings-section"><div className="settings-section-title"><Keyboard size={18} /><h2>Shortcuts</h2></div><HotkeyRow title="Push to talk" description="Hold to record, release to insert." value={state.settings.hotkey} disabled={!connected} save={value => update({ hotkey: value })} /><HotkeyRow title="Hands-free dictation" description="Press once to start, again to finish." value={state.settings.toggleHotkey} disabled={!connected} save={value => update({ toggleHotkey: value })} /><HotkeyRow title="Edit selected text" description="Speak an instruction for your selection." value={state.settings.commandHotkey} disabled={!connected} save={value => update({ commandHotkey: value })} /><div className="settings-note">Press <kbd>Esc</kbd> to cancel an active recording.</div></section>
    <section className="settings-section"><div className="settings-section-title"><SlidersHorizontal size={18} /><h2>How your words are written</h2></div><div className="settings-row"><div><label htmlFor="cleanup-mode">Dictation mode</label><p>Literal preserves wording. Clean uses the local editor.</p></div><select id="cleanup-mode" value={state.settings.mode} disabled={!connected} onChange={event => update({ mode: event.target.value as 'literal' | 'clean' })}><option value="literal">Literal</option><option value="clean">Clean</option></select></div><div className="settings-row"><div><strong>Use a writing style</strong><p>Apply a chosen style when the local editor cleans up text.</p></div><Toggle label="Use a writing style" checked={state.settings.appStyles} disabled={!connected} onChange={value => update({ appStyles: value })} /></div>{state.settings.appStyles && <div className="settings-row"><div><label htmlFor="writing-style">Writing style</label><p>Choose the tone for your cleaned dictations.</p></div><select id="writing-style" value={state.settings.style} disabled={!connected} onChange={event => update({ style: event.target.value as AppState['settings']['style'] })}><option value="neutral">Natural</option><option value="email">Email</option><option value="casual">Casual</option><option value="code">Code & technical</option></select></div>}</section>
    <section className="settings-section"><div className="settings-section-title"><Monitor size={18} /><h2>Local performance</h2></div><div className="settings-row"><div><label htmlFor="editor-device">Text editor processor</label><p>Speech recognition uses the packed CPU engine.</p></div><select id="editor-device" value={state.settings.editorDevice} disabled={!connected} onChange={event => update({ editorDevice: event.target.value as AppState['settings']['editorDevice'] })}><option value="auto">Automatic</option><option value="gpu">GPU acceleration</option><option value="cpu">CPU only</option></select></div><div className="settings-row"><div><label htmlFor="idle-unload">Unload models when idle</label><p>Free memory between dictations. The next start takes longer.</p></div><select id="idle-unload" value={state.settings.idleUnloadMinutes} disabled={!connected} onChange={event => update({ idleUnloadMinutes: Number(event.target.value) })}><option value={0}>Keep loaded</option><option value={1}>After 1 minute</option><option value={5}>After 5 minutes</option><option value={10}>After 10 minutes</option><option value={30}>After 30 minutes</option><option value={60}>After 60 minutes</option></select></div></section>
    <section className="settings-section"><div className="settings-section-title"><ShieldCheck size={18} /><h2>Privacy & startup</h2></div><div className="settings-row"><div><strong>Save dictation history</strong><p>Keep raw and final transcripts on this device. Audio isn’t saved.</p></div><Toggle label="Save dictation history" checked={state.settings.historyEnabled} disabled={!connected} onChange={value => update({ historyEnabled: value })} /></div><div className="settings-row"><div><strong>Open Willfull when you sign in</strong><p>Keep your dictation shortcut ready in the background.</p></div><Toggle label="Open Willfull when you sign in" checked={state.settings.launchAtLogin} disabled={!connected} onChange={value => update({ launchAtLogin: value })} /></div></section>
    <div className="settings-end"><Brand small /><span>Willfull · Local Windows dictation</span><span>English</span></div>
  </div>;
}

function HotkeyRow({ title, description, value, disabled, save }: { title: string; description: string; value: string; disabled: boolean; save: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <div className="settings-row"><div><strong>{title}</strong><p>{description}</p></div>{editing ? <form className="hotkey-editor" onSubmit={event => { event.preventDefault(); if (draft.trim()) { save(draft.trim()); setEditing(false); } }}><input aria-label={`${title} shortcut`} value={draft} autoFocus onChange={event => setDraft(event.target.value)} placeholder="Ctrl+Alt+Space" /><button className="icon-button" aria-label="Save shortcut" disabled={!draft.trim()}><Check size={16} /></button><IconButton label="Cancel shortcut change" onClick={() => { setDraft(value); setEditing(false); }}><X size={15} /></IconButton></form> : <button className="shortcut-edit" disabled={disabled} onClick={() => setEditing(true)} aria-label={`Change ${title.toLowerCase()} shortcut`}><Shortcut value={value} /><Pencil size={12} /></button>}</div>;
}

function CommandPreview({ state, act, pending }: { state: AppState; act: Act; pending: string | null }) {
  const preview = state.commandPreview!;
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialogRef.current?.showModal(); return () => dialogRef.current?.close(); }, []);
  return <dialog className="command-dialog" ref={dialogRef} onCancel={event => { event.preventDefault(); act('command:dismiss'); }}><div className="dialog-heading"><span className="dialog-symbol"><Sparkles size={20} /></span><div><h2>Take a look before it goes.</h2><p>{preview.instruction}</p></div><IconButton label="Dismiss edit" onClick={() => act('command:dismiss')}><X size={19} /></IconButton></div><div className="preview-comparison"><section><h3>Original selection</h3><p>{preview.original}</p></section><section><h3>Proposed edit</h3><p>{preview.edited}</p></section></div><div className="command-apply-hint"><Keyboard size={16} /><span>Return to {preview.target?.processName || preview.target?.name || 'the original app'}, keep the text selected, then press <Shortcut value="Ctrl+Alt+A" /> to apply.</span></div><div className="dialog-footer"><span>The original selection is checked before replacement.</span><button className="button secondary" onClick={() => act('command:dismiss')}>Dismiss edit</button><button className="button primary" disabled={pending === 'result:copy'} onClick={() => act('result:copy')}><Copy size={15} />Copy edited text</button></div></dialog>;
}

function RecordingOverlay({ state, act, connected }: { state: AppState; act: Act; connected: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const recording = state.session.phase === 'recording';
  useEffect(() => { const timer = setInterval(() => setElapsed(state.session.startedAt ? Math.max(0, Math.floor((Date.now() - state.session.startedAt) / 1000)) : 0), 500); return () => clearInterval(timer); }, [state.session.startedAt]);
  return <div className={`recording-overlay ${recording ? 'listening' : ''}`}><Brand small /><span className="overlay-divider" /><div className="overlay-wave" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <span key={i} style={{ height: `${recording ? 4 + Math.min(1, state.session.level || 0) * (5 + ((i * 5) % 17)) : 4}px` }} />)}</div><div className="overlay-content"><strong>{!connected ? 'Connecting…' : state.commandPreview ? 'Edit ready · Ctrl+Alt+A to apply' : phaseLabels[state.session.phase] || state.session.phase}</strong>{(state.session.error || state.session.notice || state.session.partial) && <p>{state.session.error || state.session.notice || state.session.partial}</p>}</div>{state.commandPreview ? <IconButton label="Review the proposed edit" onClick={() => act('window:open')}><SquarePen size={16} /></IconButton> : <span className="overlay-time">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>}{recording && <IconButton label="Finish recording" onClick={() => act('stop')}><Square size={13} fill="currentColor" /></IconButton>}<IconButton label={state.commandPreview ? 'Dismiss edit' : 'Cancel recording'} onClick={() => act(state.commandPreview ? 'command:dismiss' : 'cancel')}><X size={15} /></IconButton></div>;
}
