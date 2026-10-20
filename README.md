# TikSound (iPhone-app)

TikTok-links → offline playlist. Echte app, geïnstalleerd via USB-C. Audio staat op je telefoon, dus vliegtuigmodus is geen probleem.

## 1. Server op je PC (alleen nodig om sounds toe te voegen)
In deze map (server.js heeft geen extra packages nodig):
```
winget install OpenJS.NodeJS.LTS
winget install yt-dlp.yt-dlp
node server.js
```
Hij print een adres zoals `http://192.168.1.20:3000` — dat vul je in de app in (⚙︎). iPhone en PC op dezelfde wifi.
Eerste keer vraagt iOS om "lokaal netwerk" toegang → Sta toe. Windows Firewall-melding voor Node → Sta toe (privé netwerk).

## 2. App bouwen (gratis, in de cloud)
1. Maak een GitHub-repo en push deze map:
   ```
   git init && git add . && git commit -m "TikSound"
   git branch -M main
   git remote add origin https://github.com/<jij>/tiksound-app.git
   git push -u origin main
   ```
2. GitHub → **Actions** → "Build iOS" draait vanzelf (~15 min).
3. Klaar → klik de run → onderaan **TikSound-ipa** downloaden → unzip → `TikSound.ipa`.

Tip: maak de repo **public**, dan zijn de Mac-buildminuten onbeperkt gratis. Private kan ook (~10 builds/maand gratis).

## 3. Installeren via USB-C
1. Installeer **iTunes** (van apple.com, niet Microsoft Store) en **Sideloadly** (sideloadly.io).
2. iPhone via USB-C aan PC → "Vertrouw deze computer".
3. Sideloadly: sleep `TikSound.ipa` erin, vul je Apple ID in → Start.
4. iPhone: Instellingen → Algemeen → VPN en apparaatbeheer → je Apple ID → **Vertrouw**.
5. iPhone: Instellingen → Privacy en beveiliging → **Ontwikkelaarsmodus** aan (herstart).

## Elke 7 dagen
Gratis Apple ID = app verloopt na 7 dagen. Je sounds blijven bewaard; gewoon in Sideloadly opnieuw op Start drukken (zelfde .ipa, zelfde Apple ID). Sideloadly kan dit ook automatisch via wifi als je PC aan staat.

## Gebruik
- Plak link → Voeg toe (of 📋)
- Tik = afspelen, ✕ of lang drukken = verwijderen
- 🔀 shuffle, 🔁 alles herhalen / 🔂 één / uit
- Werkt op lockscreen en met scherm uit

TikTok-links werken niet meer? `yt-dlp -U` op je PC.
