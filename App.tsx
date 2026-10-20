import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';

type Track = { id: string; title: string; author: string; url: string; file: string; added: number };
type Repeat = 'all' | 'single' | 'none';

const C = { bg: '#0b0b0f', card: '#16161d', line: '#25252f', txt: '#f2f2f5', dim: '#8a8a99', acc: '#fe2c55', acc2: '#25f4ee' };
const dir = () => new Directory(Paths.document, 'sounds');
const fileOf = (t: Track) => new File(dir(), t.file);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fmt = (s: number) => (isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');
const shuffled = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [order, setOrder] = useState<string[]>([]); // afspeelvolgorde (ids) zoals in de native playlist
  const [server, setServer] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
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

  // ---------- Native playlist opbouwen ----------
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

  // Eerste keer na laden
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
    if (tracks.some(t => t.url === link)) { setMsg({ t: 'Die staat er al in.' }); return; }
    setBusy(true); setMsg({ t: 'Audio ophalen…' });
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
      setMsg({ t: `✓ ${t.title}` });
    } catch (e: any) {
      const m = String(e?.message || e);
      setMsg({ t: /network|fetch/i.test(m) ? 'Server niet bereikbaar. Draait hij, en zit je op dezelfde wifi?' : m, err: true });
    }
    setBusy(false);
  };

  const paste = async () => {
    const t = await Clipboard.getStringAsync();
    setUrl(t);
    add(t);
  };

  const remove = (t: Track) => Alert.alert('Verwijderen?', t.title, [
    { text: 'Annuleer', style: 'cancel' },
    {
      text: 'Verwijder', style: 'destructive', onPress: () => {
        const idx = order.indexOf(t.id);
        if (idx >= 0) playlist.remove(idx);
        setOrder(o => o.filter(i => i !== t.id));
        setTracks(list => list.filter(x => x.id !== t.id));
        try { fileOf(t).delete(); } catch {}
      },
    },
  ]);

  const playTrack = (t: Track) => {
    const idx = order.indexOf(t.id);
    if (idx < 0) return;
    playlist.skipTo(idx);
    playlist.play();
  };

  const toggleShuffle = () => {
    const s = !shuffle;
    setShuffle(s);
    rebuild(tracks, s, currentId);
  };
  const cycleRepeat = () => setRepeat(r => (r === 'all' ? 'single' : r === 'single' ? 'none' : 'all'));

  const [barW, setBarW] = useState(1);
  const progress = st.duration ? Math.min(1, st.currentTime / st.duration) : 0;

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.header}>
          <Text style={s.h1}>Tik<Text style={{ color: C.acc }}>Sound</Text></Text>
          <Pressable onPress={() => setSettings(true)} hitSlop={10}><Text style={s.gear}>⚙︎</Text></Pressable>
        </View>

        <View style={s.addRow}>
          <TextInput
            style={s.input} value={url} onChangeText={setUrl} placeholder="Plak TikTok-link…" placeholderTextColor={C.dim}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={() => add(url)}
          />
          <Pressable style={[s.btn, s.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={() => add(url)}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.btnTxt}>Voeg toe</Text>}
          </Pressable>
        </View>
        <Pressable style={s.paste} disabled={busy} onPress={paste}><Text style={s.dim}>📋  Plakken en toevoegen</Text></Pressable>
        {msg && <Text style={[s.msg, msg.err && { color: '#ff6b81' }]} numberOfLines={2}>{msg.t}</Text>}

        <FlatList
          data={tracks}
          keyExtractor={t => t.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 20 }}
          ListEmptyComponent={<Text style={s.empty}>Nog geen sounds.{'\n'}Voeg links toe terwijl je online bent — daarna werkt alles in vliegtuigmodus.</Text>}
          renderItem={({ item, index }) => {
            const on = item.id === currentId;
            return (
              <Pressable style={[s.item, on && s.itemOn]} onPress={() => playTrack(item)} onLongPress={() => remove(item)}>
                <Text style={[s.num, on && { color: C.acc }]}>{on && st.playing ? '♪' : index + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.title} numberOfLines={1}>{item.title}</Text>
                  {!!item.author && <Text style={s.author} numberOfLines={1}>{item.author}</Text>}
                </View>
                <Pressable onPress={() => remove(item)} hitSlop={10}><Text style={s.del}>✕</Text></Pressable>
              </Pressable>
            );
          }}
        />

        <SafeAreaView edges={['bottom']} style={s.player}>
          <Text style={s.now} numberOfLines={1}>{current ? current.title : 'Niks aan het spelen'}</Text>
          <Text style={s.author} numberOfLines={1}>{current?.author || ' '}</Text>
          <Pressable
            onLayout={e => setBarW(e.nativeEvent.layout.width)}
            onPress={e => st.duration && playlist.seekTo((e.nativeEvent.locationX / barW) * st.duration)}
            style={s.barHit}
          >
            <View style={s.bar}><View style={[s.barFill, { width: `${progress * 100}%` }]} /></View>
          </Pressable>
          <View style={s.times}><Text style={s.time}>{fmt(st.currentTime)}</Text><Text style={s.time}>{fmt(st.duration)}</Text></View>
          <View style={s.ctrls}>
            <Pressable onPress={toggleShuffle} hitSlop={8}><Text style={[s.ctrl, shuffle && { color: C.acc2 }]}>🔀</Text></Pressable>
            <Pressable onPress={() => (st.currentTime > 3 ? playlist.seekTo(0) : playlist.previous())} hitSlop={8}><Text style={s.ctrl}>⏮</Text></Pressable>
            <Pressable style={s.play} onPress={() => (st.playing ? playlist.pause() : playlist.play())} disabled={!tracks.length}>
              <Text style={s.playTxt}>{st.playing ? '❚❚' : '▶'}</Text>
            </Pressable>
            <Pressable onPress={() => playlist.next()} hitSlop={8}><Text style={s.ctrl}>⏭</Text></Pressable>
            <Pressable onPress={cycleRepeat} hitSlop={8}>
              <Text style={[s.ctrl, repeat !== 'none' && { color: C.acc2 }]}>{repeat === 'single' ? '🔂' : '🔁'}</Text>
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
  const [test, setTest] = useState<string | null>(null);
  useEffect(() => { if (visible) { setV(value); setTest(null); } }, [visible, value]);
  const norm = (x: string) => { x = x.trim().replace(/\/+$/, ''); return x && !/^https?:\/\//.test(x) ? 'http://' + x : x; };
  const check = async () => {
    setTest('Testen…');
    try {
      const r = await fetch(`${norm(v)}/api/ping`);
      const j = await r.json();
      setTest(j.app === 'tiksound' ? '✓ Verbonden' : '✗ Geen TikSound-server');
    } catch { setTest('✗ Niet bereikbaar'); }
  };
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.root, { padding: 20 }]}>
        <Text style={[s.h1, { marginBottom: 6 }]}>Server</Text>
        <Text style={[s.dim, { marginBottom: 16 }]}>
          Het adres dat <Text style={{ color: C.txt }}>node server.js</Text> op je PC laat zien, bijv. http://192.168.1.20:3000.
          Alleen nodig om sounds toe te voegen — afspelen werkt zonder.
        </Text>
        <TextInput
          style={s.input} value={v} onChangeText={setV} placeholder="http://192.168.1.20:3000" placeholderTextColor={C.dim}
          autoCapitalize="none" autoCorrect={false} keyboardType="url"
        />
        {test && <Text style={[s.msg, { paddingHorizontal: 0 }]}>{test}</Text>}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Pressable style={[s.btn, { flex: 1 }]} onPress={check}><Text style={s.btnTxt}>Test</Text></Pressable>
          <Pressable style={[s.btn, s.primary, { flex: 1 }]} onPress={() => onSave(norm(v))}><Text style={s.btnTxt}>Opslaan</Text></Pressable>
        </View>
        <Pressable onPress={onClose} style={{ marginTop: 24, alignSelf: 'center' }}><Text style={s.dim}>Sluiten</Text></Pressable>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 },
  h1: { color: C.txt, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  gear: { color: C.dim, fontSize: 24 },
  addRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  input: { flex: 1, backgroundColor: C.card, borderColor: C.line, borderWidth: 1, color: C.txt, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  btn: { backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', minHeight: 46 },
  primary: { backgroundColor: C.acc },
  btnTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  paste: { marginHorizontal: 16, marginTop: 8, backgroundColor: C.card, borderRadius: 12, padding: 11, alignItems: 'center' },
  dim: { color: C.dim, fontSize: 14, lineHeight: 20 },
  msg: { color: C.dim, fontSize: 13, paddingHorizontal: 16, marginTop: 8 },
  empty: { color: C.dim, textAlign: 'center', marginTop: 50, lineHeight: 22, paddingHorizontal: 20 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.card, borderRadius: 14, padding: 12, marginTop: 8 },
  itemOn: { borderColor: C.acc, borderWidth: 2, padding: 10 },
  num: { width: 22, textAlign: 'center', color: C.dim, fontSize: 14 },
  title: { color: C.txt, fontSize: 16, fontWeight: '500' },
  author: { color: C.dim, fontSize: 13, marginTop: 1 },
  del: { color: C.dim, fontSize: 18, paddingHorizontal: 4 },
  player: { backgroundColor: '#121218', borderTopColor: C.line, borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12 },
  now: { color: C.txt, fontSize: 16, fontWeight: '600' },
  barHit: { paddingVertical: 10 },
  bar: { height: 4, backgroundColor: C.line, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: C.acc },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: C.dim, fontSize: 11 },
  ctrls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  ctrl: { color: C.dim, fontSize: 24, padding: 6 },
  play: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.txt, alignItems: 'center', justifyContent: 'center' },
  playTxt: { color: C.bg, fontSize: 22, fontWeight: '700' },
});
