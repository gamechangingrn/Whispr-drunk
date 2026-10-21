import type { AppState } from '../shared/types';
export type { AppState, ModelState, DictionaryItem as DictionaryEntry, Snippet as SnippetEntry } from '../shared/types';
export type SessionMode = 'dictation' | 'command';

export const initialState: AppState = {
  session: { phase: 'idle', mode: 'dictation', level: 0, partial: '', result: '' },
  settings: { mode: 'literal', historyEnabled: false, launchAtLogin: false, deviceId: '-1', hotkey: '', commandHotkey: '', toggleHotkey: '', appStyles: false, style: 'neutral', editorDevice: 'auto', onboardingComplete: false, idleUnloadMinutes: 10 },
  models: { speech: { status: 'missing', name: 'Phonon-2' }, editor: { status: 'missing', name: 'Qwen3.5 4B' } },
  history: [], dictionary: [], snippets: [], devices: [], metrics: {},
};
