# ALAZ NEON — Premium Görsel Yükseltme ve Kalite Planı

Hedef: Oyunu "neon efekt yığını" seviyesinden, TV + mobil için tasarlanmış, tutarlı, hızlı ve
hissi yüksek bir parti oyununa taşımak. Plan fazlara bölünmüştür; her faz tek bir PR olarak
uygulanır ve kendi kabul kriterleriyle kapanır.

---

## 0. Teşhis (mevcut durum)

Kod tabanı küçük (~2.7k satır TSX/CSS), bu bir avantaj: radikal görsel değişim ucuz.
Aşağıdakiler premium algıyı en çok düşüren noktalar. Dosya referansları verilmiştir.

### Görsel / tasarım sistemi
| # | Bulgu | Neden önemli | Yer |
|---|-------|--------------|-----|
| G1 | `Inter` referans verilmiş ama hiçbir yerde yüklenmemiş; sistem fontuna düşüyor. Display font yok. | Tipografi premium algının %50'si. Şu an her cihazda farklı görünüyor. | `src/index.css:15` |
| G2 | Renk paleti çelişkili: token'larda pink/purple var, marka turuncu (alaz) ama parçacıklar mavi/pembe/beyaz. | Tek bir görsel dil yok. | `index.css @theme`, `ParticleBackground.tsx:33` |
| G3 | 8 katmanlı `text-shadow` (`text-glow-premium-*`), her panelde `backdrop-blur-xl`, tam ekran `animate-shake`, ayrıca 2 adet parçacık canvas'ı (Layout + HostDisplay) aynı anda çiziliyor. | iPad Safari / TV tarayıcısında jank. Premium = akıcı. | `index.css`, `Layout.tsx`, `HostDisplay.tsx:365` |
| G4 | Her sayfa açılışında 4 sn'lik intro (Landing, Join, Setup, Play). Oyuncu QR okutup 4 sn bekliyor. | Sürtünme. Premium ürünler sizi bekletmez. | `PlayerJoin.tsx`, `PlayerGame.tsx:25`, `HostSetup.tsx:29` |
| G5 | Spacing/tipografi ölçeği yok; her ekran kendi `text-[10px]`, `tracking-[0.2em]` değerlerini uyduruyor. | Tutarsızlık, bakım maliyeti. | tüm sayfalar |
| G6 | `prefers-reduced-motion` hiç dikkate alınmıyor. | Erişilebilirlik + bazı cihazlarda hareket rahatsızlığı. | global |
| G7 | Tanımsız sınıflar: `custom-scrollbar`, `animate-spin-slow`. Ölü dosya: `App.css` (Vite şablonu). | Kalite sinyali. | `HostDisplay.tsx`, `src/App.css` |
| G8 | Karışık dil/kopya: "Ready for the ultimate mythical challenge?", "PTS", "Nickname / Team Name". | Marka tutarlılığı. | `LandingPage.tsx`, `HostDisplay.tsx` podium |
| G9 | Podyum ve tur özeti "bilgi gösteriyor", "kutlamıyor": konfeti yok, skor sayacı animasyonsuz, kazananın sahneye çıkışı yok. | Parti oyununun duygusal zirvesi burada. | `HostDisplay.tsx` review/finished |

### Oyun kalitesi / doğruluk
| # | Bulgu | Etki | Yer |
|---|-------|------|-----|
| K1 | Harf karşılaştırması `toLowerCase()` ile yapılıyor; Türkçe `I/ı`, `İ/i` yanlış. "Isparta" geçer, "ısparta" reddedilir. Harf havuzunda Ç Ö Ş Ü İ yok. | Haksız puan kaybı, oyuncu güveni. | `HostDisplay.tsx:126,150`, `PlayerGame.tsx` |
| K2 | `PlayerGame` efekti `[roomId, roomStatus]`'a bağlı: her durum değişiminde kanal yeniden kuruluyor ve `fetchRoom` cevapları sıfırlıyor → tur bitince oyuncu "—" görüyor. `roundPoints` hesabı bayat closure kullanıyor. | Görünür hata. | `PlayerGame.tsx:33-112` |
| K3 | Timer host'ta çalışıyor, her 5 sn'de DB'ye yazılıyor; oyuncu tarafı bu yazıya göre "atlıyor". | Sürüklenme, gereksiz realtime trafiği. | `HostDisplay.tsx:348`, `PlayerGame.tsx` |
| K4 | Tek chunk 608 KB (gzip 184 KB). Host'a özel `qrcode.react`, oyuncuya da iniyor. | Mobil ilk açılış. | `vite.config.ts`, `App.tsx` |
| K5 | Aynı harf oyun içinde tekrar gelebilir; harf seçimi düz rastgele. | Tekrar hissi. | `HostDisplay.tsx:264` |
| K6 | Benzersizlik tam eşleşmeye dayalı: "İstanbul" / "istanbul" / "Istanbul " ayrı sayılıyor. | Puanlama adaleti. | `HostDisplay.tsx:140` |

---

## 1. "Premium" tanımı (tasarım ilkeleri)

Bunlar her fazda uygulanacak kurallar. Antigravity'e prompt yazarken bu listeyi yapıştırın.

1. **Az ama net efekt.** Glow en fazla 3 katman. Bir ekranda aynı anda tek "hero" glow. Blur'lu panel sayısı ekran başına ≤ 3.
2. **10-foot UI (TV kuralları).** 1080p TV'de 3 m mesafeden: gövde metni ≥ 28 px, ikincil ≥ 22 px, kontrast ≥ 7:1. Kenarlardan %5 güvenli alan. Saf beyaz (#fff) yerine sıcak beyaz (#f5f1ea) — büyük alanlarda halo yapmaz.
3. **Tipografi hiyerarşisi.** 1 display font (marka + büyük sayılar), 1 gövde font. Boyut ölçeği: 12/14/16/20/24/32/48/72/120/200. Harf aralığı sadece display'de.
4. **Amaçlı hareket.** Mikro: 150–250 ms. Sahne geçişi: 400–600 ms. Easing: `cubic-bezier(0.2, 0.8, 0.2, 1)`. Stagger: 40–60 ms. Sonsuz döngü animasyonu bir ekranda ≤ 2. `prefers-reduced-motion` → tüm sonsuz animasyonlar kapalı, geçişler fade.
5. **Tek marka rengi + tek vurgu.** Birincil: alaz-orange. Vurgu: neon-blue (sadece hız/oyuncu aksiyonu). Semantik: gold (kazanan), success, danger. Pembe/mor kaldırılır.
6. **Duygusal zirveyi tasarla.** Harf açılışı, son 10 sn, tur özeti reveal'ı, podyum: her birinin ses + hareket + ışık "vuruşu" var. Geri kalan her şey sakin.
7. **Bekletme yok.** Intro sadece oturumda bir kez, oyuncu tarafında hiç.

---

## 2. Fazlar

### Faz 0 — Hijyen ve doğruluk (tasarım kararı gerektirmez) ✅ bu PR'da
- Türkçe yerel-duyarlı harf karşılaştırma ve normalizasyon (`src/lib/turkish.ts`) — K1, K6.
- `PlayerGame` efekt bağımlılığı ve bayat closure düzeltmesi — K2.
- Tanımsız `custom-scrollbar` / `animate-spin-slow` sınıflarının eklenmesi, `App.css` silinmesi — G7.
- `index.html`: `lang="tr"`, `theme-color`, açıklayıcı `title`.
- Kabul: `npm run build` ve `npm run lint` temiz; oyuncu tur sonunda kendi cevaplarını görüyor.

### Faz 1 — Tasarım sistemi temeli (tek PR, tüm ekranları besler)
1. **Token'lar** (`index.css @theme`): renk (primary/accent/gold/success/danger + 5 nötr), spacing 4 tabanlı, radius (12/20/32), z-index katmanları, süre/easing token'ları.
2. **Fontlar**: Google Fonts üzerinden `font-display: swap` + preload. Öneri: display için **Unbounded** veya **Bebas Neue** (sayılar ve marka), gövde için **Inter**. Tek `@font-face` noktası.
3. **Glow sınıflarını sadeleştir**: `text-glow-{blue,alaz,gold}` 3 katman; `text-glow-premium-*` ve `ultra-*` kaldır. `glass-panel` tek sınıf + `data-tone` varyantı.
4. **Motion primitives** (`src/lib/motion.ts`): `fadeUp`, `scaleIn`, `stagger(i)` varyantları + `useReducedMotion` sarmalayıcı. Sayfalar kendi `initial/animate` objeleri yazmayı bırakır.
5. **Arka plan**: tek `ParticleBackground` (Layout'ta), renk token'dan, `speed` bir context ile yönetilir; HostDisplay'deki ikinci kopya kaldırılır. Parçacık sayısı cihaz piksel alanına göre (mobilde 20, TV'de 60).
6. **Intro politikası**: `sessionStorage` bayrağı; Landing'de bir kez, Join/Play/Setup'ta hiç.
- Kabul: Lighthouse Performance (mobil) ≥ 85; tek font ailesi yükleniyor; hiçbir ekran 8-katman glow kullanmıyor.

### Faz 2 — Host (TV) sahneleri
Her sahne için "vuruş" (beat) tanımı:
1. **Lobby**: Oda kodu hero (display font, 200 px), QR sağda sabit; oyuncu kartları `layout` animasyonu ile katılır, katılınca kısa "ping" sesi + kart parlaması. Kaç kişi hazır göstergesi.
2. **Countdown**: 3-2-1 sayıları scale+blur ile; son vuruşta harf kutusu "damga" gibi iner (spring, hafif overshoot), bass hit sesi.
3. **Playing**: Harf solda büyük, süre sağda dairesel progress ring (sayı değil sadece ring + sayı birlikte). Son 10 sn: ring kırmızıya döner, tik sesi, ekran shake yerine ring pulse (tam ekran shake kaldırılır). Kategori kartları alt şeritte; her kategori için "kaç oyuncu doldurdu" küçük gösterge (Faz 5 realtime ile).
4. **Review**: Önce 1.5 sn "hesaplanıyor" (spinner yerine harf ve kategori isimleri süzülerek geçer), sonra kategori kategori **reveal**: her kategori 600 ms arayla açılır, benzersiz cevaplar altın çerçeveyle "pop" yapar. Host'un reddet/onayla dokunuşu haptik benzeri kısa flash verir. Skor sütunu `useSpring` sayaç ile artar.
5. **Podium**: Sıra 3 → 2 → 1, birinci gelince konfeti (canvas, 2 sn) + stinger. "Oyunun En'leri" kartları sonrasında stagger ile.
- Kabul: 1080p TV'de 3 m'den kod ve harf okunuyor; 60 fps (Chrome Performance panelinde long task yok).

### Faz 3 — Player (mobil) sahneleri
1. **Join**: Intro yok. Kod alanı otomatik büyük harf, 4–6 karakter maskesi; hata mesajı alanın altında.
2. **Play (yazma)**: Klavye açıkken görünür alan için `100dvh` + `env(safe-area-inset-bottom)`. Her kategori kartı: etiket + input aynı satırda; harf uyuşmazlığı anlık kırmızı kenar (mevcut) + hafif titreşim (`navigator.vibrate(30)`). "Hızlı gönder" butonu klavye üstünde sabit. Kalan süre üstte ince progress ring.
3. **Round result**: Kendi cevapların yanına ✓ / benzersiz ★ / ✗ (host review sonrası `answers` tablosundan puan bilgisi Faz 5 ile gelir). Puan artışı `useSpring` sayaç.
4. **Bağlantı durumu**: Realtime kopunca üstte ince sarı şerit "Yeniden bağlanıyor".
- Kabul: iPhone SE ve Android küçük ekranda klavye açıkken input görünür; Lighthouse a11y ≥ 90.

### Faz 4 — Ses ve haptik
- `src/lib/audio.ts`: tek `AudioContext`, ilk dokunuşta unlock (iOS). Sentez ile: `tick`, `submit`, `reveal`, `unique`, `stinger`, `bassHit`. Dosya yok, ağırlık yok.
- Master volume + host ekranında ses aç/kapa.
- Mobilde `navigator.vibrate` (destek varsa) — gönder, harf hatası, tur bitti.

### Faz 5 — Performans ve altyapı
1. **Timer senkronu**: `rooms.round_ends_at` (timestamptz) tek yazım; her istemci `Date.now()` ile kalan süreyi hesaplar. Saniyelik DB yazımı biter, sürüklenme biter.
2. **Kod bölme**: `React.lazy` ile host/player rotaları ayrı chunk; `qrcode.react` sadece host'a.
3. **Realtime hijyeni**: istemci başına tek kanal; oyuncu doldurma durumu için Supabase Presence (DB yazımı yok).
4. **Answers → puan**: `answers` tablosuna `score jsonb` sütunu; host `nextStep`'te tek `upsert`. Oyuncu kendi puan kırılımını okur.
5. `chunkSizeWarningLimit` yerine gerçek bölme; hedef mobil ilk yük < 120 KB gzip.

### Faz 6 — Oyun tasarımı kalitesi
1. **Harf havuzu**: Türkçe kelime-başı frekansına göre ağırlıklı seçim; oyun içinde tekrar yok; Ç Ö Ş Ü İ eklenir, ağırlığı düşük.
2. **Benzersizlik**: `tr-TR` küçük harf + trim + çoklu boşluk daraltma; opsiyonel Levenshtein ≤ 1 ile "benzer cevap" grubu host'a uyarı olarak gösterilir (otomatik birleştirmez).
3. **Boş kategori cezası yok ama "tam kağıt" bonusu** (+5) — doldurma motivasyonu.
4. **Zor mod** preset'i için süre otomatik 90 sn.
5. **Tekrar oyna**: podyumdan aynı oyuncularla yeni oyun (mevcut `resetGame` korunur, oyuncular lobiye otomatik döner).

---

## 3. Token / bütçe stratejisi (10 $ kota)

**İlke:** Muhakeme gerektiren, çok dosyaya dokunan işleri Claude'a; bak-düzelt döngüsü olan
görsel ince ayarları Antigravity'ye (yerel önizleme ile iterasyon ucuz) verin.

| Faz | Araç | Bütçe payı | Not |
|-----|------|-----------|-----|
| 0 | Claude (bu PR) | yapıldı | — |
| 1 | Claude | %20 | Token'lar + motion primitives + font: cross-file tutarlılık ister. |
| 2 | Antigravity (sahne başına) + Claude (review/podium reveal mantığı) | %30 | Sahneleri tek tek verin: "Lobby'yi Faz 2.1'e göre uygula". |
| 3 | Antigravity | %15 | Mobil önizleme ile iterasyon. |
| 4 | Claude | %5 | Tek dosya, sentez kodu. |
| 5 | Claude | %20 | Timer + kod bölme + realtime; test edilmesi gerekir. |
| 6 | Claude | %10 | Küçük ama hassas mantık. |

**Prompt kuralları (her araç için):**
1. Tek prompt = tek faz maddesi = tek PR. "Premium yap" deme; kabul kriterini yaz.
2. Bağlam olarak bu dosyayı ve ilgili dosya adlarını ver; tüm repo'yu okutma.
3. Yeniden yazım değil diff iste: "HostDisplay.tsx 415–475 arası lobby bloğunu değiştir".
4. Her prompt'un sonunda: "`npm run build && npm run lint` temiz olmalı."
5. Görsel işlerde ekran görüntüsü ile geri bildirim ver; kelimeyle tarif token yakar.
6. Faz 1 bitmeden Faz 2–3'e girme; aksi halde her sahne kendi token'ını uydurur (bugünkü durum).

---

## 4. Ölçüm / kabul (proje geneli)
- Lighthouse mobil: Performance ≥ 85, Accessibility ≥ 90.
- Chrome Performance: playing ve review sahnelerinde 50 ms üstü long task yok.
- Tek font ailesi, tek parçacık canvas'ı, ekran başına ≤ 3 blur panel.
- Türkçe harf testleri: `ı/I`, `i/İ`, `ş/Ş`, `ç/Ç` için başlangıç kontrolü ve benzersizlik doğru.
- Oyuncu tur sonunda kendi cevaplarını ve puanını görüyor.
