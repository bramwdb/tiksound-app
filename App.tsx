import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SymbolView, type SFSymbol } from 'expo-symbols';

type Track = { id: string; title: string; author: string; url: string; file: string; added: number };
type Repeat = 'all' | 'single' | 'none';

const C = {
  bg: '#000000',
  surface: '#121214',
  raised: '#1c1c1f',
  line: '#26262a',
  txt: '#ffffff',
  sub: '#8e8e93',
  faint: '#48484a',
  acc: '#fe2c55',
  ok: '#30d158',
  err: '#ff453a',
};
const TILE = ['#3a2a4a', '#2a3a4a', '#2a4a3e', '#4a3a2a', '#4a2a35', '#2f2f4a', '#3e4a2a', '#4a2a2a'];

const dir = () => new Directory(Paths.document, 'sounds');
const fileOf = (t: Track) => new File(dir(), t.file);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmt = (s: number) => (isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
const shuffled = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const tileColor = (id: string) => TILE[[...id].reduce((n, c) => n + c.charCodeAt(0), 0) % TILE.length];

function Icon({ name, size = 22, color = C.txt, weight = 'semibold' as const }: { name: SFSymbol; size?: number; color?: string; weight?: 'regular' | 'medium' | 'semibold' | 'bold' }) {
  return <SymbolView name={name} size={size} tintColor={color} weight={weight} type="monochrome" style={{ width: size, height: size }} />;
}

function Artwork({ id, size, playing }: { id?: string; size: number; playing?: boolean }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.22, backgroundColor: id ? tileColor(id) : C.raised, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={playing ? 'waveform' : 'music.note'} size={size * 0.42} color={playing ? C.acc : 'rgba(255,255,255,0.75)'} />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [server, setServer] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; kind: 'info' | 'ok' | 'err' } | null>(null);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<Repeat>('all');
  const [settings, setSettings] = useState(false);
  const loaded = useRef(false);

  const playlist = useAudioPlaylist({ loop: 'all', updateInterval: 500 });
  const st = useAudioPlaylistStatus(playlist);
  const byId = useMemo(() => new Map(tracks.map(t => [t.id, t])), [tracks]);
  const currentId = order[st.currentIndex];
  const current = currentId ? byId.get(currentId) : undefined;
  const lockActive = useRef(false);

  // ---------- Opslag ----------
  useEffect(() => {
    (async () => {
      await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
      try { dir().create({ intermediates: true, idempotent: true }); } catch {}
      const [t, s, sh, rp] = await Promise.all(['tracks', 'server', 'shuffle', 'repeat'].map(k => AsyncStorage.getItem(k)));
      const list: Track[] = (t ? JSON.parse(t) : []).filter((x: Track) => fileOf(x).exists);
      setTracks(list);
      setServer(s || '');
      setShuffle(sh === '1');
      setRepeat((rp as Repeat) || 'all');
      if (!s) setSettings(true);
      loaded.current = true;
    })();
  }, []);
  useEffect(() => { if (loaded.current) AsyncStorage.setItem('tracks', JSON.stringify(tracks)); }, [tracks]);
  useEffect(() => { if (loaded.current) AsyncStorage.multiSet([['shuffle', shuffle ? '1' : '0'], ['repeat', repeat]]); }, [shuffle, repeat]);
  useEffect(() => { playlist.loop = repeat; }, [repeat, playlist]);
  useEffect(() => { if (msg?.kind === 'ok') { const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t); } }, [msg]);

  // ---------- Native playlist ----------
  const rebuild = useCallback((list: Track[], doShuffle: boolean, startId?: string) => {
    const wasPlaying = playlist.playing;
    let ids = list.map(t => t.id);
    if (doShuffle) {
      ids = shuffled(ids);
      if (startId) ids = [startId, ...ids.filter(i => i !== startId)];
    }
    playlist.clear();
    for (const id of ids) playlist.add({ uri: fileOf(list.find(t => t.id === id)!).uri });
    setOrder(ids);
    const idx = startId ? ids.indexOf(startId) : 0;
    if (idx > 0) playlist.skipTo(idx);
    if (wasPlaying && ids.length) playlist.play();
  }, [playlist]);

  const built = useRef(false);
  useEffect(() => {
    if (!loaded.current || built.current) return;
    built.current = true;
    rebuild(tracks, shuffle);
  }, [tracks, shuffle, rebuild]);

  // Lockscreen
  useEffect(() => {
    if (!current) return;
    const meta = { title: current.title, artist: current.author || 'TikSound' };
    if (!lockActive.current) {
      playlist.setActiveForLockScreen(true, meta, { showNextTrack: true, showPreviousTrack: true });
      lockActive.current = true;
    } else playlist.updateLockScreenMetadata(meta);
  }, [current, playlist]);

  // ---------- Toevoegen ----------
  const add = async (link: string) => {
    link = link.trim();
    if (!link) return;
    if (!server) { setSettings(true); return; }
    if (tracks.some(t => t.url === link)) { setMsg({ t: 'Staat al in je playlist', kind: 'info' }); return; }
    setBusy(true); setMsg({ t: 'Audio ophalen…', kind: 'info' });
    try {
      const r = await fetch(`${server}/api/prepare`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: link }),
      });
      const info = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(info.error || `Server fout ${r.status}`);
      const id = uid();
      const name = `${id}.m4a`;
      await File.downloadFileAsync(`${server}/api/file/${info.id}`, new File(dir(), name));
      const t: Track = { id, title: info.title || 'TikTok sound', author: info.uploader || '', url: link, file: name, added: Date.now() };
      setTracks(prev => [...prev, t]);
      playlist.add({ uri: fileOf(t).uri });
      setOrder(prev => [...prev, id]);
      setUrl('');
      setMsg({ t: 'Toegevoegd', kind: 'ok' });
    } catch (e: any) {
      const m = String(e?.message || e);
      setMsg({ t: /network|fetch/i.test(m) ? 'Server niet bereikbaar — draait hij en zit je op dezelfde wifi?' : m, kind: 'err' });
    }
    setBusy(false);
  };

  const paste = async () => {
    const t = (await Clipboard.getStringAsync()).trim();
    if (!t) { setMsg({ t: 'Klembord is leeg', kind: 'info' }); return; }
    setUrl(t);
    add(t);
  };

  const remove = (t: Track) => {
    const idx = order.indexOf(t.id);
    if (idx >= 0) playlist.remove(idx);
    setOrder(o => o.filter(i => i !== t.id));
    setTracks(list => list.filter(x => x.id !== t.id));
    try { fileOf(t).delete(); } catch {}
  };

  const options = (t: Track) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: t.title, options: ['Annuleer', 'Verwijderen'], destructiveButtonIndex: 1, cancelButtonIndex: 0, userInterfaceStyle: 'dark' },
        i => { if (i === 1) remove(t); },
      );
    } else {
      Alert.alert(t.title, undefined, [{ text: 'Annuleer', style: 'cancel' }, { text: 'Verwijderen', style: 'destructive', onPress: () => remove(t) }]);
    }
  };

  const playTrack = (t: Track) => {
    const idx = order.indexOf(t.id);
    if (idx < 0) return;
    if (t.id === currentId) { st.playing ? playlist.pause() : playlist.play(); return; }
    playlist.skipTo(idx);
    playlist.play();
  };

  const toggleShuffle = () => { const s = !shuffle; setShuffle(s); rebuild(tracks, s, currentId); };
  const cycleRepeat = () => setRepeat(r => (r === 'all' ? 'single' : r === 'single' ? 'none' : 'all'));

  const [barW, setBarW] = useState(1);
  const progress = st.duration ? Math.min(1, st.currentTime / st.duration) : 0;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.h1}>TikSound</Text>
            <Text style={s.count}>{tracks.length === 1 ? '1 sound' : `${tracks.length} sounds`}</Text>
          </View>
          <Pressable onPress={() => setSettings(true)} hitSlop={12} style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
            <Icon name="gearshape.fill" size={18} color={C.sub} />
          </Pressable>
        </View>

        {/* Toevoegen */}
        <View style={s.addBox}>
          <Icon name="link" size={16} color={C.sub} weight="medium" />
          <TextInput
            style={s.input} value={url} onChangeText={setUrl} placeholder="TikTok-link plakken" placeholderTextColor={C.faint}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={() => add(url)}
            editable={!busy}
          />
          {busy ? (
            <ActivityIndicator color={C.sub} style={{ marginRight: 4 }} />
          ) : url.trim() ? (
            <Pressable onPress={() => add(url)} hitSlop={8} style={({ pressed }) => [s.addBtn, pressed && s.pressed]}>
              <Icon name="arrow.up" size={15} color="#fff" weight="bold" />
            </Pressable>
          ) : (
            <Pressable onPress={paste} hitSlop={8} style={({ pressed }) => [s.pasteBtn, pressed && s.pressed]}>
              <Text style={s.pasteTxt}>Plak</Text>
            </Pressable>
          )}
        </View>
        {msg && (
          <View style={s.msgRow}>
            {msg.kind !== 'info' && <Icon name={msg.kind === 'ok' ? 'checkmark.circle.fill' : 'exclamationmark.circle.fill'} size={14} color={msg.kind === 'ok' ? C.ok : C.err} />}
            <Text style={[s.msgTxt, msg.kind === 'err' && { color: C.err }]} numberOfLines={2}>{msg.t}</Text>
          </View>
        )}

        {/* Lijst */}
        <FlatList
          data={tracks}
          keyExtractor={t => t.id}
          style={{ marginTop: 10 }}
          contentContainerStyle={{ paddingBottom: 16, flexGrow: 1 }}
          ItemSeparatorComponent={() => <View style={s.sep} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Icon name="music.note.list" size={44} color={C.faint} weight="regular" />
              <Text style={s.emptyTitle}>Nog geen sounds</Text>
              <Text style={s.emptyTxt}>Plak een TikTok-link terwijl je online bent.{'\n'}Daarna werkt alles in vliegtuigmodus.</Text>
            </View>
          }
          renderItem={({ item }) => {
            const on = item.id === currentId;
            return (
              <Pressable onPress={() => playTrack(item)} onLongPress={() => options(item)} style={({ pressed }) => [s.row, pressed && { backgroundColor: C.surface }]}>
                <Artwork id={item.id} size={48} playing={on && st.playing} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.title, on && { color: C.acc }]} numberOfLines={1}>{item.title}</Text>
                  <Text style={s.author} numberOfLines={1}>{item.author || 'Onbekend'}</Text>
                </View>
                <Pressable onPress={() => options(item)} hitSlop={12} style={({ pressed }) => [{ padding: 6 }, pressed && s.pressed]}>
                  <Icon name="ellipsis" size={18} color={C.sub} />
                </Pressable>
              </Pressable>
            );
          }}
        />

        {/* Player */}
        <SafeAreaView edges={['bottom']} style={s.player}>
          <Pressable
            onLayout={e => setBarW(e.nativeEvent.layout.width)}
            onPress={e => st.duration && playlist.seekTo((e.nativeEvent.locationX / barW) * st.duration)}
            style={s.barHit}
          >
            <View style={s.bar}>
              <View style={[s.barFill, { width: `${progress * 100}%` }]} />
            </View>
            <View style={[s.thumb, { left: progress * barW - 5 }]} />
          </Pressable>
          <View style={s.times}>
            <Text style={s.time}>{fmt(st.currentTime)}</Text>
            <Text style={s.time}>-{fmt(Math.max(0, st.duration - st.currentTime))}</Text>
          </View>

          <View style={s.nowRow}>
            <Artwork id={current?.id} size={44} playing={st.playing} />
            <View style={{ flex: 1 }}>
              <Text style={s.nowTitle} numberOfLines={1}>{current ? current.title : 'Niks aan het spelen'}</Text>
              <Text style={s.author} numberOfLines={1}>{current ? current.author || 'Onbekend' : 'Kies een sound'}</Text>
            </View>
          </View>

          <View style={s.ctrls}>
            <Pressable onPress={toggleShuffle} hitSlop={10} style={({ pressed }) => [s.ctrl, pressed && s.pressed]}>
              <Icon name="shuffle" size={19} color={shuffle ? C.acc : C.sub} />
              {shuffle && <View style={s.dot} />}
            </Pressable>
            <Pressable onPress={() => (st.currentTime > 3 ? playlist.seekTo(0) : playlist.previous())} hitSlop={10} style={({ pressed }) => [s.ctrl, pressed && s.pressed]}>
              <Icon name="backward.fill" size={26} />
            </Pressable>
            <Pressable
              disabled={!tracks.length}
              onPress={() => (st.playing ? playlist.pause() : playlist.play())}
              style={({ pressed }) => [s.play, !tracks.length && { opacity: 0.3 }, pressed && { transform: [{ scale: 0.94 }] }]}
            >
              <Icon name={st.playing ? 'pause.fill' : 'play.fill'} size={26} color="#000" />
            </Pressable>
            <Pressable onPress={() => playlist.next()} hitSlop={10} style={({ pressed }) => [s.ctrl, pressed && s.pressed]}>
              <Icon name="forward.fill" size={26} />
            </Pressable>
            <Pressable onPress={cycleRepeat} hitSlop={10} style={({ pressed }) => [s.ctrl, pressed && s.pressed]}>
              <Icon name={repeat === 'single' ? 'repeat.1' : 'repeat'} size={19} color={repeat === 'none' ? C.sub : C.acc} />
              {repeat !== 'none' && <View style={s.dot} />}
            </Pressable>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <Settings
        visible={settings}
        value={server}
        onClose={() => setSettings(false)}
        onSave={v => { setServer(v); AsyncStorage.setItem('server', v); setSettings(false); }}
      />
    </SafeAreaView>
  );
}

function Settings({ visible, value, onClose, onSave }: { visible: boolean; value: string; onClose: () => void; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const [test, setTest] = useState<'idle' | 'busy' | 'ok' | 'fail' | 'wrong'>('idle');
  useEffect(() => { if (visible) { setV(value); setTest('idle'); } }, [visible, value]);
  const norm = (x: string) => { x = x.trim().replace(/\/+$/, ''); return x && !/^https?:\/\//.test(x) ? 'http://' + x : x; };
  const check = async () => {
    setTest('busy');
    try {
      const r = await fetch(`${norm(v)}/api/ping`);
      const j = await r.json();
      setTest(j.app === 'tiksound' ? 'ok' : 'wrong');
    } catch { setTest('fail'); }
  };
  const status = {
    idle: null,
    busy: { icon: null, txt: 'Verbinden…', color: C.sub },
    ok: { icon: 'checkmark.circle.fill' as SFSymbol, txt: 'Verbonden', color: C.ok },
    fail: { icon: 'xmark.circle.fill' as SFSymbol, txt: 'Niet bereikbaar', color: C.err },
    wrong: { icon: 'xmark.circle.fill' as SFSymbol, txt: 'Geen TikSound-server', color: C.err },
  }[test];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={s.sheet}>
        <View style={s.sheetHead}>
          <Text style={s.sheetTitle}>Instellingen</Text>
          <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => [s.iconBtn, pressed && s.pressed]}>
            <Icon name="xmark" size={14} color={C.sub} weight="bold" />
          </Pressable>
        </View>

        <Text style={s.label}>SERVER</Text>
        <View style={s.group}>
          <TextInput
            style={s.groupInput} value={v} onChangeText={t => { setV(t); setTest('idle'); }}
            placeholder="http://192.168.0.119:3000" placeholderTextColor={C.faint}
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
          />
          <View style={s.groupSep} />
          <Pressable onPress={check} style={({ pressed }) => [s.groupRow, pressed && { backgroundColor: C.line }]}>
            <Text style={s.groupLink}>Verbinding testen</Text>
            {status && (
              <View style={s.statusRow}>
                {status.icon && <Icon name={status.icon} size={14} color={status.color} />}
                <Text style={[s.statusTxt, { color: status.color }]}>{status.txt}</Text>
              </View>
            )}
          </Pressable>
        </View>
        <Text style={s.help}>
          Het adres dat <Text style={{ color: C.txt }}>node server.js</Text> op je PC laat zien. Alleen nodig om sounds toe te voegen — afspelen werkt zonder.
        </Text>

        <Pressable onPress={() => onSave(norm(v))} style={({ pressed }) => [s.saveBtn, pressed && { opacity: 0.85 }]}>
          <Text style={s.saveTxt}>Opslaan</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  pressed: { opacity: 0.5 },

  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  h1: { color: C.txt, fontSize: 34, fontWeight: '800', letterSpacing: -0.8 },
  count: { color: C.sub, fontSize: 15, marginTop: 2 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },

  addBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, backgroundColor: C.raised, borderRadius: 14, paddingLeft: 14, paddingRight: 6, height: 50 },
  input: { flex: 1, color: C.txt, fontSize: 16, height: '100%' },
  addBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.acc, alignItems: 'center', justifyContent: 'center' },
  pasteBtn: { paddingHorizontal: 14, height: 34, borderRadius: 10, backgroundColor: C.line, justifyContent: 'center' },
  pasteTxt: { color: C.txt, fontSize: 14, fontWeight: '600' },
  msgRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 24, marginTop: 10 },
  msgTxt: { color: C.sub, fontSize: 13, flex: 1 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 9 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginLeft: 82 },
  title: { color: C.txt, fontSize: 16, fontWeight: '500' },
  author: { color: C.sub, fontSize: 14, marginTop: 2 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 40, gap: 8 },
  emptyTitle: { color: C.txt, fontSize: 18, fontWeight: '600', marginTop: 8 },
  emptyTxt: { color: C.sub, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  player: { backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 6, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  barHit: { paddingVertical: 12, justifyContent: 'center' },
  bar: { height: 4, backgroundColor: C.line, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: C.txt },
  thumb: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: C.txt },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -4 },
  time: { color: C.sub, fontSize: 11, fontVariant: ['tabular-nums'] },
  nowRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  nowTitle: { color: C.txt, fontSize: 16, fontWeight: '600' },
  ctrls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 10, paddingHorizontal: 4 },
  ctrl: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: C.acc },
  play: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.txt, alignItems: 'center', justifyContent: 'center' },

  sheet: { flex: 1, backgroundColor: C.surface, paddingHorizontal: 20, paddingTop: 20 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  sheetTitle: { color: C.txt, fontSize: 22, fontWeight: '700' },
  label: { color: C.sub, fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginLeft: 16, marginBottom: 8 },
  group: { backgroundColor: C.raised, borderRadius: 12, overflow: 'hidden' },
  groupInput: { color: C.txt, fontSize: 16, paddingHorizontal: 16, height: 50 },
  groupSep: { height: StyleSheet.hairlineWidth, backgroundColor: C.line, marginLeft: 16 },
  groupRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 48 },
  groupLink: { color: C.acc, fontSize: 16 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusTxt: { fontSize: 14 },
  help: { color: C.sub, fontSize: 13, lineHeight: 18, marginTop: 10, marginHorizontal: 16 },
  saveBtn: { backgroundColor: C.acc, borderRadius: 14, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: 32 },
  saveTxt: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
